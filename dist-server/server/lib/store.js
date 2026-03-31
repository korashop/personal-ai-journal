import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config, hasSupabaseConfig } from '../config.js';
import { deriveDisplaySummary, deriveDisplayTitle, simplifyPatternTitle } from './ai.js';
import { demoConversations, demoEntries, demoHighlights, demoMemoryDoc } from './demo-data.js';
function parseLegacyAnalysis(value, rawText) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
    if (Array.isArray(candidate.sections)) {
        return {
            title: deriveDisplayTitle(candidate.title ?? candidate.summary, rawText, []),
            summary: deriveDisplaySummary(candidate.summary, rawText),
            contextBullets: [],
            sections: candidate.sections
                .filter((section) => section.title && section.content)
                .map((section, index) => ({
                id: section.id ?? `section-${index + 1}`,
                title: section.title,
                content: section.content,
            })),
            exploreOptions: candidate.exploreOptions ?? [],
            feedLabels: candidate.feedLabels ??
                candidate.sections
                    .map((section) => section.title)
                    .filter((title) => Boolean(title))
                    .slice(0, 3),
        };
    }
    const legacySections = [
        ['overview', 'Overview', candidate.restate],
        ['core-tension', 'Core tension', candidate.underneath ?? candidate.challenge],
        ['question', 'Question to sit with', candidate.followUp ?? candidate.challenge],
    ]
        .filter(([, , content]) => typeof content === 'string' && content.trim())
        .map(([id, title, content]) => ({
        id,
        title,
        content: content,
    }));
    if (!legacySections.length) {
        return null;
    }
    return {
        title: deriveDisplayTitle(candidate.title ?? candidate.summary ?? candidate.restate, rawText, []),
        summary: deriveDisplaySummary(candidate.summary ?? candidate.restate, rawText),
        contextBullets: [],
        sections: legacySections,
        exploreOptions: [
            'Go deeper on the main tension here',
            'Look for the pattern underneath this entry',
            'Turn this into one concrete next question',
        ],
        feedLabels: legacySections.map((section) => section.title).slice(0, 3),
    };
}
class DemoStore {
    entries = [...demoEntries];
    conversations = [...demoConversations];
    memory = { ...demoMemoryDoc };
    highlights = [...demoHighlights];
    patterns = [];
    mapEntryList(entry) {
        return {
            id: entry.id,
            userId: entry.userId,
            createdAt: entry.createdAt,
            source: entry.source,
            title: entry.title,
            tags: entry.tags,
            summary: entry.summary,
            hasOpenThreads: entry.hasOpenThreads,
            feedLabels: entry.analysis?.feedLabels ?? entry.tags.slice(0, 3),
            conversationCount: Math.max(this.conversations.filter((message) => message.entryId === entry.id).length - 1, 0),
        };
    }
    async getBootstrap(userId, selectedEntryId) {
        const entries = this.entries
            .filter((entry) => entry.userId === userId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return {
            entries: entries.map((entry) => this.mapEntryList(entry)),
            selectedEntry: selectedEntryId && entries.length ? await this.getEntryView(selectedEntryId) : null,
            patternEntries: entries,
            memoryDoc: this.memory.userId === userId ? this.memory : null,
            highlights: this.highlights.filter((highlight) => highlight.userId === userId),
            patterns: this.patterns,
        };
    }
    async createEntry(input) {
        const entry = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            rawText: input.rawText,
            source: input.source,
            title: input.title,
            tags: input.tags,
            photoUrls: input.photoUrls,
            summary: input.summary,
            userId: input.userId,
            hasOpenThreads: true,
            analysis: input.analysis,
        };
        this.entries.unshift(entry);
        this.conversations.unshift({
            id: randomUUID(),
            entryId: entry.id,
            role: 'assistant',
            content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
            createdAt: new Date().toISOString(),
        });
        return this.getEntryView(entry.id);
    }
    async updateEntry(input) {
        this.entries = this.entries.map((entry) => entry.id === input.entryId
            ? {
                ...entry,
                rawText: input.rawText,
                title: input.title,
                tags: input.tags,
                summary: input.summary,
                analysis: input.analysis,
            }
            : entry);
        const firstAssistantIndex = this.conversations.findIndex((message) => message.entryId === input.entryId && message.role === 'assistant');
        if (firstAssistantIndex >= 0) {
            this.conversations[firstAssistantIndex] = {
                ...this.conversations[firstAssistantIndex],
                content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
            };
        }
        return this.getEntryView(input.entryId);
    }
    async deleteEntry(entryId, userId) {
        void userId;
        this.entries = this.entries.filter((entry) => entry.id !== entryId);
        this.conversations = this.conversations.filter((message) => message.entryId !== entryId);
    }
    async appendConversation(entryId, userContent, assistantContent) {
        const createdAt = new Date().toISOString();
        this.conversations.push({
            id: randomUUID(),
            entryId,
            role: 'user',
            content: userContent,
            createdAt,
        });
        this.conversations.push({
            id: randomUUID(),
            entryId,
            role: 'assistant',
            content: assistantContent,
            createdAt: new Date().toISOString(),
        });
        return this.getEntryView(entryId);
    }
    async updateMemory(userId, content) {
        this.memory = {
            id: this.memory.id,
            userId,
            content,
            updatedAt: new Date().toISOString(),
        };
        return this.memory;
    }
    async updatePatterns(userId, patterns) {
        void userId;
        this.patterns = patterns;
        return this.patterns;
    }
    async getEntryView(entryId, userId) {
        void userId;
        const entry = this.entries.find((item) => item.id === entryId);
        if (!entry) {
            throw new Error('Entry not found');
        }
        return {
            ...entry,
            conversation: this.conversations
                .filter((message) => message.entryId === entryId)
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
        };
    }
}
class SupabaseStore {
    client;
    constructor(client) {
        this.client = client;
    }
    parseStoredPhotoUrls(value) {
        if (Array.isArray(value)) {
            return value.filter((item) => typeof item === 'string');
        }
        if (typeof value !== 'string' || !value.trim()) {
            return [];
        }
        if (value.startsWith('[')) {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
            }
            catch {
                return [];
            }
        }
        return [value];
    }
    async createSignedPhotoUrl(path) {
        if (!path)
            return null;
        const signedUrlResponse = await this.client.storage.from(config.storageBucket).createSignedUrl(path, 60 * 60);
        if (signedUrlResponse.error)
            throw signedUrlResponse.error;
        return signedUrlResponse.data.signedUrl;
    }
    async createSignedPhotoUrls(paths) {
        const signedUrls = await Promise.all(paths.map((path) => this.createSignedPhotoUrl(path)));
        return signedUrls.filter((item) => Boolean(item));
    }
    mapConversation(message) {
        return {
            id: message.id,
            entryId: message.entry_id,
            role: message.role,
            content: message.content,
            createdAt: message.created_at,
        };
    }
    async mapEntry(entry, conversations) {
        const analysis = parseLegacyAnalysis(entry.ai_response, entry.raw_text);
        const derivedSummary = deriveDisplaySummary(analysis?.summary?.trim() || entry.summary, entry.raw_text);
        return {
            id: entry.id,
            userId: entry.user_id,
            createdAt: entry.created_at,
            rawText: entry.raw_text,
            source: entry.source,
            title: deriveDisplayTitle(analysis?.title?.trim() || analysis?.summary || entry.summary, entry.raw_text, entry.tags ?? []),
            tags: entry.tags ?? [],
            photoUrls: await this.createSignedPhotoUrls(this.parseStoredPhotoUrls(entry.photo_url)),
            summary: derivedSummary,
            hasOpenThreads: entry.has_open_threads ?? false,
            analysis,
            conversation: conversations.filter((message) => message.entry_id === entry.id).map((message) => this.mapConversation(message)),
        };
    }
    mapEntryList(entry, conversationCount) {
        const analysis = parseLegacyAnalysis(entry.ai_response, entry.raw_text);
        const derivedSummary = deriveDisplaySummary(analysis?.summary?.trim() || entry.summary, entry.raw_text);
        return {
            id: entry.id,
            userId: entry.user_id,
            createdAt: entry.created_at,
            source: entry.source,
            title: deriveDisplayTitle(analysis?.title?.trim() || analysis?.summary || entry.summary, entry.raw_text, entry.tags ?? []),
            tags: entry.tags ?? [],
            summary: derivedSummary,
            hasOpenThreads: entry.has_open_threads ?? false,
            feedLabels: analysis?.feedLabels?.length ? analysis.feedLabels : (entry.tags ?? []).slice(0, 3),
            conversationCount: Math.max(conversationCount - 1, 0),
        };
    }
    async getBootstrap(userId, selectedEntryId) {
        const [entriesResponse, conversationsResponse, memoryResponse, highlightsResponse] = await Promise.all([
            this.client.from('entries').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
            this.client.from('conversations').select('*').eq('user_id', userId).order('created_at'),
            this.client.from('memory_doc').select('*').eq('user_id', userId).single(),
            this.client.from('highlights').select('*').eq('user_id', userId).limit(5),
        ]);
        if (entriesResponse.error)
            throw entriesResponse.error;
        if (conversationsResponse.error)
            throw conversationsResponse.error;
        if (memoryResponse.error && memoryResponse.status !== 406)
            throw memoryResponse.error;
        if (highlightsResponse.error)
            throw highlightsResponse.error;
        const conversationCounts = conversationsResponse.data.reduce((accumulator, message) => {
            accumulator[message.entry_id] = (accumulator[message.entry_id] ?? 0) + 1;
            return accumulator;
        }, {});
        const selectedId = selectedEntryId ?? null;
        return {
            entries: entriesResponse.data.map((entry) => this.mapEntryList(entry, conversationCounts[entry.id] ?? 0)),
            selectedEntry: selectedId ? await this.getEntryView(selectedId, userId) : null,
            patternEntries: entriesResponse.data.map((entry) => ({
                id: entry.id,
                userId: entry.user_id,
                createdAt: entry.created_at,
                rawText: entry.raw_text,
                source: entry.source,
                title: this.mapEntryList(entry, conversationCounts[entry.id] ?? 0).title,
                tags: entry.tags ?? [],
                photoUrls: [],
                summary: this.mapEntryList(entry, conversationCounts[entry.id] ?? 0).summary,
                hasOpenThreads: entry.has_open_threads ?? false,
                analysis: parseLegacyAnalysis(entry.ai_response, entry.raw_text),
            })),
            memoryDoc: memoryResponse.data
                ? {
                    id: memoryResponse.data.id,
                    userId: memoryResponse.data.user_id,
                    content: memoryResponse.data.content,
                    updatedAt: memoryResponse.data.updated_at,
                }
                : null,
            highlights: highlightsResponse.data.map((highlight) => ({
                id: highlight.id,
                userId: highlight.user_id,
                source: highlight.source,
                content: highlight.content,
                bookTitle: highlight.book_title,
                author: highlight.author,
                highlightDate: highlight.highlight_date,
            })),
            patterns: await this.getPatterns(userId),
        };
    }
    async createEntry(input) {
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const insertResponse = await this.client.from('entries').insert({
            id,
            user_id: input.userId,
            created_at: createdAt,
            raw_text: input.rawText,
            source: input.source,
            tags: input.tags,
            photo_url: input.photoUrls.length ? JSON.stringify(input.photoUrls) : null,
            summary: input.summary,
            has_open_threads: true,
            ai_response: input.analysis,
        });
        if (insertResponse.error)
            throw insertResponse.error;
        const conversationResponse = await this.client.from('conversations').insert({
            id: randomUUID(),
            user_id: input.userId,
            entry_id: id,
            role: 'assistant',
            content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
            created_at: new Date().toISOString(),
        });
        if (conversationResponse.error)
            throw conversationResponse.error;
        return this.getEntryView(id, input.userId);
    }
    async updateEntry(input) {
        const updateResponse = await this.client
            .from('entries')
            .update({
            raw_text: input.rawText,
            tags: input.tags,
            summary: input.summary,
            ai_response: input.analysis,
        })
            .eq('id', input.entryId)
            .eq('user_id', input.userId);
        if (updateResponse.error)
            throw updateResponse.error;
        const firstAssistant = await this.client
            .from('conversations')
            .select('*')
            .eq('entry_id', input.entryId)
            .eq('user_id', input.userId)
            .eq('role', 'assistant')
            .order('created_at')
            .limit(1)
            .single();
        if (!firstAssistant.error) {
            const conversationUpdate = await this.client
                .from('conversations')
                .update({
                content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
            })
                .eq('id', firstAssistant.data.id);
            if (conversationUpdate.error)
                throw conversationUpdate.error;
        }
        return this.getEntryView(input.entryId, input.userId);
    }
    async deleteEntry(entryId, userId) {
        const response = await this.client.from('entries').delete().eq('id', entryId).eq('user_id', userId);
        if (response.error)
            throw response.error;
    }
    async appendConversation(entryId, userId, userContent, assistantContent) {
        const insertResponse = await this.client.from('conversations').insert([
            {
                id: randomUUID(),
                user_id: userId,
                entry_id: entryId,
                role: 'user',
                content: userContent,
                created_at: new Date().toISOString(),
            },
            {
                id: randomUUID(),
                user_id: userId,
                entry_id: entryId,
                role: 'assistant',
                content: assistantContent,
                created_at: new Date().toISOString(),
            },
        ]);
        if (insertResponse.error)
            throw insertResponse.error;
        return this.getEntryView(entryId, userId);
    }
    async updateMemory(userId, content) {
        const response = await this.client
            .from('memory_doc')
            .upsert({ id: randomUUID(), user_id: userId, content, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (response.error)
            throw response.error;
        const memoryResponse = await this.client.from('memory_doc').select('*').eq('user_id', userId).single();
        if (memoryResponse.error)
            throw memoryResponse.error;
        return {
            id: memoryResponse.data.id,
            userId,
            content: memoryResponse.data.content,
            updatedAt: memoryResponse.data.updated_at,
        };
    }
    async updatePatterns(userId, patterns) {
        const tableExists = await this.hasPatternThreadTable();
        if (!tableExists) {
            return [];
        }
        const deleteResponse = await this.client.from('pattern_threads').delete().eq('user_id', userId);
        if (deleteResponse.error)
            throw deleteResponse.error;
        if (!patterns.length) {
            return [];
        }
        const insertResponse = await this.client.from('pattern_threads').insert(patterns.map((pattern) => ({
            id: pattern.id,
            user_id: userId,
            title: simplifyPatternTitle(pattern.title),
            overview: pattern.overview,
            status: pattern.status,
            dimensions: pattern.dimensions,
            questions: pattern.questions,
            explore_options: pattern.exploreOptions,
            entry_ids: pattern.entryIds,
            entry_count: pattern.entryCount,
            updated_at: pattern.updatedAt,
        })));
        if (insertResponse.error)
            throw insertResponse.error;
        return patterns;
    }
    async getEntryView(entryId, userId) {
        const [entryResponse, conversationResponse] = await Promise.all([
            this.client.from('entries').select('*').eq('id', entryId).eq('user_id', userId).single(),
            this.client.from('conversations').select('*').eq('entry_id', entryId).order('created_at'),
        ]);
        if (entryResponse.error)
            throw entryResponse.error;
        if (conversationResponse.error)
            throw conversationResponse.error;
        return this.mapEntry(entryResponse.data, conversationResponse.data);
    }
    async uploadPhotos(userId, files) {
        const paths = [];
        for (const file of files) {
            const path = `${userId}/${Date.now()}-${file.originalname}`;
            const response = await this.client.storage
                .from(config.storageBucket)
                .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
            if (response.error)
                throw response.error;
            paths.push(path);
        }
        return paths;
    }
    async hasPatternThreadTable() {
        const response = await this.client.from('pattern_threads').select('id').limit(1);
        return !response.error;
    }
    async getPatterns(userId) {
        const tableExists = await this.hasPatternThreadTable();
        if (!tableExists) {
            return [];
        }
        const response = await this.client
            .from('pattern_threads')
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        if (response.error)
            throw response.error;
        return response.data.map((pattern) => ({
            id: pattern.id,
            title: simplifyPatternTitle(pattern.title),
            overview: pattern.overview,
            status: pattern.status ?? 'active',
            dimensions: pattern.dimensions ?? [],
            questions: pattern.questions ?? [],
            exploreOptions: pattern.explore_options ?? [],
            entryIds: pattern.entry_ids ?? [],
            entryCount: pattern.entry_count ?? (pattern.entry_ids ?? []).length,
            updatedAt: pattern.updated_at ?? new Date().toISOString(),
        }));
    }
}
const demoStore = new DemoStore();
const liveStore = hasSupabaseConfig
    ? new SupabaseStore(createClient(config.supabaseUrl, config.supabaseServiceRoleKey))
    : null;
export function getStore() {
    if (liveStore)
        return { mode: 'live', store: liveStore };
    return { mode: 'demo', store: demoStore };
}
export function isLiveStore(store) {
    return store instanceof SupabaseStore;
}
