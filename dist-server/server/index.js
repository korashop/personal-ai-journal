import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { buildAnalysisInput, buildEntryTitle, buildPatternDebugReport, buildPatterns, buildSummary, chooseResurfacingCard, generateAnalysis, generatePatternReply, generateReply, integratePatternReplyIntoMemory, inferTags, rewriteMemoryDoc, transcribeJournalPhotosWithStatus, } from './lib/ai.js';
import { getStore, isLiveStore } from './lib/store.js';
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDistPath = join(__dirname, '../dist');
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function looksTransientError(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return ['bad gateway', 'gateway', 'timeout', 'timed out', 'fetch failed', 'network', 'temporarily unavailable'].some((token) => message.includes(token));
}
async function withTransientRetry(task, attempts = 3) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await task();
        }
        catch (error) {
            lastError = error;
            if (attempt === attempts - 1 || !looksTransientError(error)) {
                throw error;
            }
            await sleep(250 * (attempt + 1));
        }
    }
    throw lastError;
}
app.use(cors());
app.use(express.json({ limit: '4mb' }));
const createEntrySchema = z.object({
    rawText: z.string().default(''),
    source: z.enum(['typed', 'paste', 'photo']),
    transcribedText: z.string().optional(),
    userId: z.string().optional(),
});
const createConversationSchema = z.object({
    entryId: z.string().min(1),
    content: z.string().min(1),
    userId: z.string().optional(),
});
const updateEntrySchema = z.object({
    rawText: z.string().min(1),
    userId: z.string().optional(),
});
const patternReplySchema = z.object({
    pattern: z.object({
        id: z.string(),
        title: z.string(),
        overview: z.string(),
        status: z.enum(['emerging', 'active', 'deepening']).optional(),
        dimensions: z.array(z.string()),
        questions: z.array(z.string()),
        exploreOptions: z.array(z.string()),
        entryIds: z.array(z.string()),
        entryCount: z.number().optional(),
        updatedAt: z.string().optional(),
    }),
    content: z.string().min(1),
    userId: z.string().optional(),
});
async function refreshDerivedState(userId) {
    const { store } = getStore();
    const bootstrap = await store.getBootstrap(userId);
    const recentEntries = bootstrap.patternEntries;
    const memoryContent = await rewriteMemoryDoc(bootstrap.memoryDoc, recentEntries.slice(0, 8));
    await store.updateMemory(userId, memoryContent);
    const nextBootstrap = await store.getBootstrap(userId);
    const previousPatterns = shouldRefreshPatterns(nextBootstrap.patternEntries.length, nextBootstrap.patterns)
        ? []
        : nextBootstrap.patterns;
    const patterns = await buildPatterns(nextBootstrap.memoryDoc, nextBootstrap.patternEntries, previousPatterns);
    await store.updatePatterns(userId, patterns);
}
function triggerDerivedRefresh(userId) {
    void refreshDerivedState(userId).catch((error) => {
        console.error('Derived refresh failed', error);
    });
}
function shouldRefreshPatterns(entriesCount, patterns) {
    if (!patterns.length)
        return true;
    if (entriesCount >= 10 && patterns.length <= 3)
        return true;
    const singletonCount = patterns.filter((pattern) => (pattern.entryCount ?? 0) <= 1).length;
    if (patterns.length >= 5 && singletonCount / patterns.length >= 0.6)
        return true;
    if (patterns.length >= 4 && patterns.every((pattern) => pattern.status === 'emerging'))
        return true;
    const genericQuestionCount = patterns.filter((pattern) => pattern.questions.every((question) => /what keeps this theme in place right now|what concrete move would test a different way of operating here/i.test(question))).length;
    if (patterns.length >= 5 && genericQuestionCount / patterns.length >= 0.6)
        return true;
    const looksBrokenCopy = (text) => {
        const clean = text.trim();
        const words = clean.split(/\s+/).filter(Boolean);
        const lastWord = words[words.length - 1] ?? '';
        return (!clean ||
            /^this theme (?:shows up across|is emerging around)/i.test(clean) ||
            /\bkeeps showing up across \d+ entr/i.test(clean) ||
            /(?:\.{3,}|…)\s*$/.test(clean) ||
            /\b(?:and|as|at|because|but|for|from|if|in|into|of|on|or|rather|so|than|that|the|to|versus|while|with|without)\s*$/i.test(clean) ||
            (/^[a-z]{2,4}$/.test(lastWord) && !['want', 'need', 'work', 'love', 'team', 'ship', 'real', 'path', 'life'].includes(lastWord)) ||
            (/^[A-Za-z]/.test(clean) && !/[.!?"]$/.test(clean) && clean.length > 80));
    };
    return patterns.some((pattern) => looksBrokenCopy(pattern.title ?? '') ||
        looksBrokenCopy(pattern.overview) ||
        pattern.dimensions.some((dimension) => looksBrokenCopy(dimension)) ||
        pattern.questions.some((question) => looksBrokenCopy(question)));
}
function triggerPatternRefreshAfterReply(userId, pattern, userMessage, answer) {
    void (async () => {
        const { store } = getStore();
        const bootstrap = await store.getBootstrap(userId);
        const previousPatterns = shouldRefreshPatterns(bootstrap.patternEntries.length, bootstrap.patterns)
            ? []
            : bootstrap.patterns;
        const nextMemory = await integratePatternReplyIntoMemory(bootstrap.memoryDoc, {
            ...pattern,
            status: pattern.status ?? 'active',
            entryCount: pattern.entryCount ?? pattern.entryIds.length,
            updatedAt: pattern.updatedAt ?? new Date().toISOString(),
        }, userMessage, answer);
        const memoryDoc = await store.updateMemory(userId, nextMemory);
        const patterns = await buildPatterns(memoryDoc, bootstrap.patternEntries, previousPatterns);
        await store.updatePatterns(userId, patterns);
    })().catch((error) => {
        console.error('Pattern refresh after reply failed', error);
    });
}
app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
});
app.get('/api/bootstrap', async (request, response, next) => {
    try {
        const { mode, store } = getStore();
        const selectedEntryId = typeof request.query.entryId === 'string' ? request.query.entryId : null;
        const userId = config.demoUserId;
        const data = await withTransientRetry(() => store.getBootstrap(userId, selectedEntryId));
        const needsPatternRefresh = shouldRefreshPatterns(data.patternEntries.length, data.patterns);
        const previousPatterns = needsPatternRefresh ? [] : data.patterns;
        const patterns = !data.patterns.length || needsPatternRefresh
            ? await buildPatterns(data.memoryDoc, data.patternEntries, previousPatterns)
            : data.patterns;
        if ((!data.patterns.length || needsPatternRefresh) && patterns.length) {
            void store.updatePatterns(userId, patterns);
        }
        response.json({
            entries: data.entries,
            selectedEntry: data.selectedEntry,
            memoryDoc: data.memoryDoc,
            resurfacing: chooseResurfacingCard(data.memoryDoc, data.selectedEntry ? [data.selectedEntry] : [], data.highlights),
            patterns,
            mode,
        });
    }
    catch (error) {
        next(error);
    }
});
app.get('/api/patterns/debug', async (_request, response, next) => {
    try {
        const { store } = getStore();
        const userId = config.demoUserId;
        const data = await withTransientRetry(() => store.getBootstrap(userId));
        response.json({
            storedPatterns: data.patterns.map((pattern) => ({
                id: pattern.id,
                title: pattern.title,
                status: pattern.status,
                entryCount: pattern.entryCount,
                entryIds: pattern.entryIds,
                overview: pattern.overview,
                dimensions: pattern.dimensions,
            })),
            clusterDebug: buildPatternDebugReport(data.patternEntries),
        });
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/entries', upload.array('photos', 12), async (request, response, next) => {
    try {
        const parsed = createEntrySchema.parse(request.body);
        const { store } = getStore();
        const userId = parsed.userId ?? config.demoUserId;
        const bootstrap = await store.getBootstrap(userId);
        const files = request.files ?? [];
        if (!parsed.rawText.trim() && files.length === 0) {
            response.status(400).json({ error: 'Add text or at least one image before submitting.' });
            return;
        }
        let rawText = parsed.rawText.trim();
        let photoUrls = [];
        if (files.length && isLiveStore(store)) {
            photoUrls = await store.uploadPhotos(userId, files);
        }
        else if (files.length) {
            photoUrls = files.map((file) => `mock://${file.originalname}`);
        }
        if (files.length) {
            const transcription = parsed.transcribedText?.trim()
                ? {
                    transcript: parsed.transcribedText.trim(),
                    anySucceeded: true,
                    failedCount: 0,
                }
                : await transcribeJournalPhotosWithStatus(files);
            if (!transcription.anySucceeded && !rawText.trim()) {
                response.status(400).json({
                    error: 'The app could not read those images well enough to create a trustworthy entry. Try JPG/PNG, or add a little typed context before submitting.',
                });
                return;
            }
            rawText = rawText ? `${rawText}\n\n---\n\n${transcription.transcript}` : transcription.transcript;
        }
        const analysisInput = buildAnalysisInput(rawText) || rawText;
        const tags = inferTags(analysisInput);
        const analysis = await generateAnalysis(analysisInput, tags, {
            memoryDoc: bootstrap.memoryDoc,
            recentEntries: bootstrap.patternEntries.slice(0, 5),
            relevantHighlights: bootstrap.highlights.slice(0, 3),
        });
        const entry = await store.createEntry({
            rawText,
            source: files.length ? 'photo' : parsed.source,
            title: analysis.title || buildEntryTitle(analysisInput, tags),
            tags,
            summary: analysis.summary || buildSummary(analysisInput),
            photoUrls,
            userId,
            analysis,
        });
        response.status(201).json(entry);
        triggerDerivedRefresh(userId);
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/transcribe-photos', upload.array('photos', 12), async (request, response, next) => {
    try {
        const files = request.files ?? [];
        if (!files.length) {
            response.status(400).json({ error: 'Add at least one image to transcribe.' });
            return;
        }
        const result = await transcribeJournalPhotosWithStatus(files);
        response.json({
            transcript: result.transcript,
            anySucceeded: result.anySucceeded,
            failedCount: result.failedCount,
            imageCount: files.length,
        });
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/conversations', async (request, response, next) => {
    try {
        const parsed = createConversationSchema.parse(request.body);
        const { store } = getStore();
        const userId = parsed.userId ?? config.demoUserId;
        const bootstrap = await store.getBootstrap(userId);
        const entry = bootstrap.selectedEntry && bootstrap.selectedEntry.id === parsed.entryId
            ? bootstrap.selectedEntry
            : await store.getEntryView(parsed.entryId, userId);
        if (!entry) {
            response.status(404).json({ error: 'Entry not found' });
            return;
        }
        const assistantContent = await generateReply(entry, parsed.content, {
            memoryDoc: bootstrap.memoryDoc,
            recentEntries: bootstrap.patternEntries.slice(0, 5),
            relevantHighlights: bootstrap.highlights.slice(0, 3),
        });
        const updatedEntry = await store.appendConversation(parsed.entryId, userId, parsed.content, assistantContent);
        response.json(updatedEntry);
        triggerDerivedRefresh(userId);
    }
    catch (error) {
        next(error);
    }
});
app.patch('/api/entries/:entryId', async (request, response, next) => {
    try {
        const parsed = updateEntrySchema.parse(request.body);
        const { store } = getStore();
        const userId = parsed.userId ?? config.demoUserId;
        const bootstrap = await store.getBootstrap(userId);
        const entry = bootstrap.selectedEntry && bootstrap.selectedEntry.id === request.params.entryId
            ? bootstrap.selectedEntry
            : await store.getEntryView(request.params.entryId, userId);
        if (!entry) {
            response.status(404).json({ error: 'Entry not found' });
            return;
        }
        const analysisInput = buildAnalysisInput(parsed.rawText) || parsed.rawText;
        const tags = inferTags(analysisInput);
        const analysis = await generateAnalysis(analysisInput, tags, {
            memoryDoc: bootstrap.memoryDoc,
            recentEntries: bootstrap.patternEntries.filter((item) => item.id !== entry.id).slice(0, 5),
            relevantHighlights: bootstrap.highlights.slice(0, 3),
        });
        const updatedEntry = await store.updateEntry({
            entryId: entry.id,
            userId,
            rawText: parsed.rawText,
            title: analysis.title || buildEntryTitle(analysisInput, tags),
            tags,
            summary: analysis.summary || buildSummary(analysisInput),
            analysis,
        });
        response.json(updatedEntry);
        triggerDerivedRefresh(userId);
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/entries/:entryId/reanalyze', async (request, response, next) => {
    try {
        const userId = typeof request.body?.userId === 'string' ? request.body.userId : config.demoUserId;
        const { store } = getStore();
        const bootstrap = await store.getBootstrap(userId);
        const entry = bootstrap.selectedEntry && bootstrap.selectedEntry.id === request.params.entryId
            ? bootstrap.selectedEntry
            : await store.getEntryView(request.params.entryId, userId);
        if (!entry) {
            response.status(404).json({ error: 'Entry not found' });
            return;
        }
        const analysisInput = buildAnalysisInput(entry.rawText) || entry.rawText;
        const tags = inferTags(analysisInput);
        const analysis = await generateAnalysis(analysisInput, tags, {
            memoryDoc: bootstrap.memoryDoc,
            recentEntries: bootstrap.patternEntries.filter((item) => item.id !== entry.id).slice(0, 5),
            relevantHighlights: bootstrap.highlights.slice(0, 3),
        });
        const updatedEntry = await store.updateEntry({
            entryId: entry.id,
            userId,
            rawText: entry.rawText,
            title: analysis.title || buildEntryTitle(analysisInput, tags),
            tags,
            summary: analysis.summary || buildSummary(analysisInput),
            analysis,
        });
        response.json(updatedEntry);
        triggerDerivedRefresh(userId);
    }
    catch (error) {
        next(error);
    }
});
app.get('/api/entries/:entryId', async (request, response, next) => {
    try {
        const userId = typeof request.query.userId === 'string' ? request.query.userId : config.demoUserId;
        const { store } = getStore();
        const entry = await withTransientRetry(() => store.getEntryView(request.params.entryId, userId));
        response.json(entry);
    }
    catch (error) {
        next(error);
    }
});
app.delete('/api/entries/:entryId', async (request, response, next) => {
    try {
        const userId = typeof request.query.userId === 'string' ? request.query.userId : config.demoUserId;
        const { store } = getStore();
        await store.deleteEntry(request.params.entryId, userId);
        response.status(204).send();
        triggerDerivedRefresh(userId);
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/patterns/reply', async (request, response, next) => {
    try {
        const parsed = patternReplySchema.parse(request.body);
        const userId = parsed.userId ?? config.demoUserId;
        const { store } = getStore();
        const bootstrap = await store.getBootstrap(userId);
        const relatedEntries = bootstrap.entries
            .filter((entry) => parsed.pattern.entryIds.includes(entry.id));
        const relatedEntryDetails = await Promise.all(relatedEntries.map((entry) => store.getEntryView(entry.id, userId)));
        const relatedPatternEntries = relatedEntryDetails.map((entryView) => {
            const { conversation, ...item } = entryView;
            void conversation;
            return item;
        });
        const answer = await generatePatternReply({
            ...parsed.pattern,
            status: parsed.pattern.status ?? 'active',
            entryCount: parsed.pattern.entryCount ?? parsed.pattern.entryIds.length,
            updatedAt: parsed.pattern.updatedAt ?? new Date().toISOString(),
        }, relatedPatternEntries, bootstrap.memoryDoc, parsed.content);
        response.json({ answer });
        triggerPatternRefreshAfterReply(userId, parsed.pattern, parsed.content, answer);
    }
    catch (error) {
        next(error);
    }
});
app.use((error, _request, response, next) => {
    void next;
    const message = error instanceof Error ? error.message : 'Something went wrong';
    response.status(500).json({ error: message });
});
if (existsSync(frontendDistPath)) {
    app.use(express.static(frontendDistPath));
    app.get(/^(?!\/api).*/, (_request, response) => {
        response.sendFile(join(frontendDistPath, 'index.html'));
    });
}
app.listen(config.port, () => {
    console.log(`Personal AI Journal server listening on http://localhost:${config.port}`);
});
