import Anthropic from '@anthropic-ai/sdk';
import convertHeic from 'heic-convert';
import sharp from 'sharp';
import { config, hasAnthropicConfig } from '../config.js';
const anthropic = hasAnthropicConfig ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
function clip(text, maxLength = 220) {
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}
function clipAtWord(text, maxLength = 220) {
    if (text.length <= maxLength)
        return text;
    const sliced = text.slice(0, maxLength);
    const lastSpace = sliced.lastIndexOf(' ');
    const clipped = lastSpace > 30 ? sliced.slice(0, lastSpace) : sliced;
    return clipped.trim();
}
function clipForPrompt(text, maxLength) {
    const cleaned = normalizeWhitespace(text);
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}...` : cleaned;
}
function clipLongEntryForAnalysis(text, maxLength = 8000) {
    const cleaned = sanitizeJournalText(text);
    if (cleaned.length <= maxLength)
        return cleaned;
    const paragraphs = cleaned
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (!paragraphs.length) {
        return clipForPrompt(cleaned, maxLength);
    }
    const segmentCount = Math.min(Math.max(Math.ceil(paragraphs.length / 8), 4), 7);
    const segments = [];
    const budgetPerSegment = Math.max(Math.floor(maxLength / segmentCount) - 40, 220);
    for (let index = 0; index < segmentCount; index += 1) {
        const center = segmentCount === 1 ? 0 : Math.round((index / (segmentCount - 1)) * (paragraphs.length - 1));
        const start = Math.max(center - 2, 0);
        const segmentParagraphs = paragraphs.slice(start, Math.min(start + 4, paragraphs.length));
        const label = index === 0
            ? '[Beginning]'
            : index === segmentCount - 1
                ? '[End]'
                : `[Section ${index + 1}]`;
        segments.push(label);
        segments.push(clipForPrompt(segmentParagraphs.join('\n'), budgetPerSegment));
        segments.push('');
    }
    return segments.join('\n').trim();
}
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}
function normalizeWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function repairKnownTextArtifacts(text) {
    return text.replace(/\bkyli\b/gi, 'skills');
}
const DANGLING_ENDING_PATTERN = /\s+\b(?:about|after|and|around|as|at|because|before|being|but|despite|for|from|if|in|into|like|of|on|or|over|rather|so|than|that|the|to|versus|we|while|which|who|with|without)\b\s*$/i;
const SUSPICIOUS_SHORT_FINAL_WORDS = new Set([
    'sy',
    'rejec',
    'statin',
    'compliment',
    'mentability',
    'doriousness',
]);
function cleanTruncatedEnding(text) {
    let normalized = repairKnownTextArtifacts(text)
        .trim()
        .replace(/[.…]+\s*$/, '')
        .trim()
        .replace(DANGLING_ENDING_PATTERN, '')
        .trim();
    if (!normalized)
        return '';
    while (DANGLING_ENDING_PATTERN.test(normalized)) {
        normalized = normalized
            .replace(DANGLING_ENDING_PATTERN, '')
            .trim();
    }
    if (!/[.!?]"?$/.test(normalized)) {
        const boundary = Math.max(normalized.lastIndexOf('. '), normalized.lastIndexOf('? '), normalized.lastIndexOf('! '));
        if (boundary >= 0) {
            return normalized.slice(0, boundary + 1).trim();
        }
    }
    const lastSentenceBoundary = Math.max(normalized.lastIndexOf('. '), normalized.lastIndexOf('? '), normalized.lastIndexOf('! '));
    if (lastSentenceBoundary >= 0 && normalized.length - lastSentenceBoundary > 140) {
        return normalized.slice(0, lastSentenceBoundary + 1).trim();
    }
    return normalized;
}
function lowerCaseFirst(text) {
    return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}
function stripMarkdown(text) {
    return repairKnownTextArtifacts(text)
        .replace(/[*_`>#-]+/g, ' ')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1');
}
export function sanitizeJournalText(text) {
    return repairKnownTextArtifacts(text)
        .split('\n')
        .map((line) => normalizeWhitespace(stripMarkdown(line)))
        .filter((line) => line && line !== '---')
        .map((line) => line.replace(/^image\s+\d+\b(?:\s*[-–:]\s*[\d./-]+)?\s*/i, ''))
        .map((line) => line.replace(/^(left|right|top|bottom)\s*:?\s*/i, ''))
        .map((line) => line.replace(/^\[?\s*ocr review pending\s*\]?$/i, ''))
        .map((line) => line.replace(/^transcription first\.?$/i, ''))
        .map((line) => line.replace(/^[-–]\s*\d[\d./-]*\.?\s*$/i, ''))
        .map((line) => line.replace(/^\d[\d./-]*\.?\s*$/i, ''))
        .map((line) => line.replace(/^[-–:.,\s]+$/, ''))
        .filter(Boolean)
        .join('\n');
}
export function buildAnalysisInput(text) {
    return sanitizeJournalText(text)
        .split('\n')
        .map((line) => line.replace(/^page\s+\d+\s*$/i, ''))
        .map((line) => line.replace(/^image\s+\d+\s*[-–]\s*.+$/i, ''))
        .map((line) => line.replace(/\[unclear\]/gi, ''))
        .map((line) => line.replace(/\s{2,}/g, ' ').trim())
        .filter((line) => line && !/^\[ocr unavailable.*\]$/i.test(line))
        .join('\n');
}
function looksLikeScaffolding(text) {
    const lower = stripBoilerplate(text).toLowerCase();
    return (!lower ||
        /^image\s+\d+/.test(lower) ||
        lower.startsWith('transcription first') ||
        lower === 'ocr review pending' ||
        /^[-–]?\s*\d[\d./-]*\.?$/.test(lower));
}
export function deriveDisplayTitle(candidate, rawText, tags) {
    const sanitized = sanitizeJournalText(rawText);
    if (!candidate || looksLikeScaffolding(candidate)) {
        return buildEntryTitle(sanitized || rawText, tags);
    }
    return buildEntryTitle(candidate, tags);
}
export function deriveDisplaySummary(candidate, rawText) {
    const sanitized = sanitizeJournalText(rawText);
    if (!candidate || looksLikeScaffolding(candidate)) {
        return buildSummary(sanitized || rawText);
    }
    return buildSummary(candidate);
}
function stripBoilerplate(text) {
    return normalizeWhitespace(stripMarkdown(sanitizeJournalText(text)))
        .replace(/^this is an analysis from claude about /i, '')
        .replace(/^you're presenting claude's analysis of your journal entry about /i, '')
        .replace(/^claude'?s analysis (reframes|shows|argues|suggests|cuts through to)\s*/i, '')
        .replace(/^the analysis (reframes|shows|argues|suggests)\s*/i, '')
        .replace(/^transcription first\.?/i, '')
        .trim();
}
function parseJsonFromText(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```([\s\S]*?)```/i);
        if (fencedMatch) {
            try {
                return JSON.parse(fencedMatch[1]);
            }
            catch {
                return null;
            }
        }
        const arrayStart = text.indexOf('[');
        const arrayEnd = text.lastIndexOf(']');
        if (arrayStart >= 0 && arrayEnd > arrayStart) {
            try {
                return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
            }
            catch {
                return null;
            }
        }
        const objectStart = text.indexOf('{');
        const objectEnd = text.lastIndexOf('}');
        if (objectStart >= 0 && objectEnd > objectStart) {
            try {
                return JSON.parse(text.slice(objectStart, objectEnd + 1));
            }
            catch {
                return null;
            }
        }
        return null;
    }
}
export function inferTags(rawText) {
    const lower = rawText.toLowerCase();
    const tags = new Set();
    if (/(ship|build|product|client|startup|project|career|work)/.test(lower))
        tags.add('Work');
    if (/(relationship|friend|family|partner|love|elie|dani|yoni)/.test(lower))
        tags.add('Relationships');
    if (/(decision|choose|stuck|uncertain|option)/.test(lower))
        tags.add('Decisions');
    if (/(identity|self|becoming|fear|avoid)/.test(lower))
        tags.add('Identity');
    if (/(venture|company|business|revenue|startup)/.test(lower))
        tags.add('Ventures');
    if (/(spiritual|alignment|surrender|meaning|practice)/.test(lower))
        tags.add('Meaning');
    return tags.size ? [...tags] : ['General'];
}
export function buildSummary(rawText) {
    const cleaned = stripBoilerplate(buildAnalysisInput(rawText) || rawText);
    const firstTwoSentences = cleaned.match(/(.+?[.!?](?:\s+.+?[.!?])?)/)?.[1]?.trim() ?? cleaned;
    return clip(firstTwoSentences, 180);
}
function buildContextBullets(rawText) {
    return buildSourceMoments(rawText, 6)
        .slice(0, 3)
        .map((line) => clip(line, 120));
}
function splitIntoCandidateSentences(rawText) {
    return buildAnalysisInput(rawText)
        .replace(/\n+/g, ' ')
        .split(/(?<=[.!?])\s+|\s+(?=\d+\)\s)|\s+(?=[-•]\s)/)
        .map((line) => normalizeWhitespace(line))
        .map((line) => line.replace(/^\d+\)\s*/, ''))
        .map((line) => line.replace(/^[-•]\s*/, ''))
        .filter(Boolean)
        .filter((line) => !looksLikeScaffolding(line))
        .filter((line) => line.length > 18);
}
function buildSourceMoments(rawText, maxItems = 5) {
    const sentences = splitIntoCandidateSentences(rawText);
    if (!sentences.length)
        return [];
    if (sentences.length <= maxItems) {
        return sentences.map((line) => clip(line, 130));
    }
    const selected = [];
    for (let index = 0; index < maxItems; index += 1) {
        const position = Math.round((index / Math.max(maxItems - 1, 1)) * (sentences.length - 1));
        const sentence = sentences[position];
        if (!sentence)
            continue;
        if (selected.some((existing) => normalizeWhitespace(existing).toLowerCase() === normalizeWhitespace(sentence).toLowerCase())) {
            continue;
        }
        selected.push(clip(sentence, 130));
    }
    return selected;
}
function buildEntryDigest(rawText) {
    return buildSourceMoments(rawText, 5).map((line) => clip(line, 140));
}
function looksAbstractDigestLine(line) {
    const normalized = normalizeWhitespace(stripMarkdown(cleanTruncatedEnding(line))).toLowerCase();
    return (/^the\s+\w+\s+that\s+\w+/.test(normalized) ||
        normalized.includes('tension') ||
        normalized.includes('thread') ||
        normalized.includes('mechanism') ||
        normalized.includes('dynamic'));
}
function finalizeEntryDigest(candidateLines, rawText) {
    const aiLines = (candidateLines ?? [])
        .map((line) => normalizeDigestBullet(line))
        .filter(Boolean)
        .filter((line) => !looksAbstractDigestLine(line));
    if (aiLines.length >= 3) {
        return aiLines.slice(0, 5);
    }
    const sourceLines = buildEntryDigest(rawText);
    const merged = [...sourceLines, ...aiLines];
    const deduped = [];
    for (const line of merged) {
        const normalized = normalizeWhitespace(line).toLowerCase();
        if (!normalized)
            continue;
        if (deduped.some((existing) => normalizeWhitespace(existing).toLowerCase() === normalized))
            continue;
        deduped.push(line);
    }
    return deduped.slice(0, 5);
}
function normalizeDigestBullet(text) {
    return cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(text)))
        .replace(/:\s*-\s*[A-Za-z0-9]{0,2}\s*$/g, '')
        .replace(/\s*-\s*[A-Za-z0-9]{1,2}\s*$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
function isGenericSectionTitle(title) {
    const normalized = normalizeWhitespace(stripMarkdown(title)).toLowerCase();
    return [
        'overview',
        'state of affairs',
        'core tension',
        'question to sit with',
        'what seems active underneath',
        'main',
        'under surface',
        'under-surface',
        'the lab',
    ].includes(normalized);
}
function firstSentence(text, maxLength = 140) {
    const cleaned = cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(text)));
    if (!cleaned)
        return '';
    const sentence = (cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned)
        .replace(/:\s*-\s*[A-Za-z]?$/g, '')
        .replace(/\s*-\s*[A-Za-z]$/g, '')
        .trim();
    return clipAtWord(sentence, maxLength);
}
function buildEntryDigestFromSections(sections, rawText) {
    const derived = sections
        .filter((section) => !isGenericSectionTitle(section.title))
        .map((section) => {
        const title = cleanTruncatedEnding(section.title);
        const sentence = normalizeDigestBullet(firstSentence(section.content, 110));
        if (!title && !sentence)
            return '';
        if (!sentence)
            return title;
        if (!title)
            return sentence;
        if (sentence.toLowerCase().startsWith(title.toLowerCase()))
            return sentence;
        return normalizeDigestBullet(clip(`${title}: ${sentence}`, 150));
    })
        .filter(Boolean);
    if (derived.length >= 3) {
        return dedupePatternLines(derived).slice(0, 5);
    }
    return finalizeEntryDigest(undefined, rawText);
}
function buildSummaryLayerFromSections(rawText, tags, sections) {
    const meaningfulSections = sections.filter((section) => !isGenericSectionTitle(section.title));
    const summarySource = meaningfulSections
        .slice(0, 2)
        .map((section) => firstSentence(section.content, 170))
        .filter(Boolean)
        .join(' ') || buildSummary(rawText);
    return {
        title: deriveDisplayTitle(meaningfulSections[0]?.title || summarySource, rawText, tags),
        summary: deriveDisplaySummary(summarySource, rawText),
        entryDigest: buildEntryDigestFromSections(meaningfulSections.length ? meaningfulSections : sections, rawText),
        contextBullets: buildContextBullets(rawText),
        feedLabels: buildFeedLabels(tags, rawText, sections),
        patternSignals: meaningfulSections
            .map((section) => cleanTruncatedEnding(section.title))
            .filter(Boolean)
            .slice(0, 4),
    };
}
async function retryAnalysisWithTighterPrompt(rawText, tags) {
    if (!anthropic)
        return null;
    const prompt = `Analyze this journal entry.
Return JSON only with this shape:
{
  "title": "short durable title",
  "summary": "1 or 2 sentence summary",
  "entryDigest": ["concrete thing that came up in the entry"],
  "contextBullets": ["short source-context bullet"],
  "sections": [{ "title": "string", "content": "markdown string" }],
  "exploreOptions": ["string"],
  "feedLabels": ["string"],
  "patternSignals": ["short recurring mechanism or live thread"]
}

Rules:
- Treat entryDigest and contextBullets as the scan layer.
- Treat sections as the analysis layer.
- Separate distinct threads when they are not actually one thing.
- Keep entryDigest concrete and source-grounded.
- Mention real names, projects, and decisions when they materially appear.
- Use short paragraphs and bullets when useful.
- Do not end sections with ellipses or fragments.
- Do not use generic headings like Overview unless truly necessary.
- Account for the full spread of the entry, not just the beginning.
- Keep every field concise. No entryDigest or context bullet should be a pasted paragraph.
- patternSignals should be 2 to 4 short mechanism-level phrases that may recur across entries.
- In sections, do more than recap. Add interpretation, implications, or structural reading.

Entry:
${clipLongEntryForAnalysis(rawText, 7000)}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    const parsed = parseJsonFromText(text);
    if (!parsed)
        return null;
    const sections = (parsed.sections ?? [])
        .filter((section) => section.title && section.content)
        .map((section, index) => ({
        id: `retry-section-${index + 1}`,
        title: section.title.trim(),
        content: cleanTruncatedEnding(section.content),
    }));
    if (!sections.length)
        return null;
    const feedLabels = (parsed.feedLabels ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 3);
    return {
        title: deriveDisplayTitle(parsed.title?.trim() || parsed.summary?.trim(), rawText, tags),
        summary: deriveDisplaySummary(parsed.summary?.trim(), rawText),
        entryDigest: finalizeEntryDigest(parsed.entryDigest, rawText),
        contextBullets: (parsed.contextBullets ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean).slice(0, 3),
        sections,
        exploreOptions: (parsed.exploreOptions ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean).slice(0, 5),
        feedLabels: feedLabels.length ? feedLabels : buildFeedLabels(tags, rawText, sections),
        patternSignals: (parsed.patternSignals ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean).slice(0, 4),
    };
}
async function generateAnalysisLayer(rawText, tags, context, summaryLayer) {
    if (!anthropic)
        return null;
    const isLongEntry = rawText.length > 9000;
    const recentEntryLines = recentEntriesForPrompt(context.recentEntries, isLongEntry ? 1 : 4, isLongEntry ? 100 : 180);
    const highlightLines = highlightsForPrompt(context.relevantHighlights, isLongEntry ? 1 : 2, isLongEntry ? 80 : 150);
    const prompt = `Write the analysis layer for a journal entry.
The summary layer is already done. Do not repeat it. Add interpretation, pattern-reading, and useful distinctions.
Return JSON only with this shape:
{
  "sections": [{ "title": "string", "content": "markdown string" }],
  "exploreOptions": ["string"]
}

Rules:
- This layer should feel more analytical than descriptive.
- Do not mostly summarize what happened. Assume the user can already see the summary layer.
- Separate distinct threads when they are actually distinct.
- Produce 2 to 5 sections.
- Section titles should name the real thread, not generic therapy headings.
- Go beyond recap: identify patterns, conflicts, implications, or what seems structurally true.
- Use complete thoughts. No ellipses.
- Avoid fluffy abstraction. Stay grounded in the source material.
- If a thread deserves direct interpretation, say what you think.
- Explore options should be specific and useful, not generic.

Summary layer already shown to user:
Summary: ${summaryLayer.summary}
At a glance:
${summaryLayer.entryDigest.map((item) => `- ${item}`).join('\n') || 'None'}

Context from the raw entry:
${summaryLayer.contextBullets.map((item) => `- ${item}`).join('\n') || 'None'}

Pattern signals:
${summaryLayer.patternSignals.map((item) => `- ${item}`).join('\n') || 'None'}

Memory doc:
${memoryForPrompt(context.memoryDoc, isLongEntry ? 800 : 2400)}

Recent entries:
${recentEntryLines}

Relevant highlights:
${highlightLines}

Entry:
${clipLongEntryForAnalysis(rawText, 7000)}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: isLongEntry ? 1400 : 1500,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    const parsed = parseJsonFromText(text);
    if (!parsed)
        return null;
    const sections = (parsed.sections ?? [])
        .filter((section) => section.title && section.content)
        .map((section, index) => ({
        id: `section-${index + 1}`,
        title: section.title.trim(),
        content: cleanTruncatedEnding(section.content),
    }));
    if (!sections.length)
        return null;
    return {
        sections,
        exploreOptions: (parsed.exploreOptions ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean).slice(0, 5),
    };
}
function memoryForPrompt(memoryDoc, maxLength = 2400) {
    return memoryDoc?.content ? clipForPrompt(memoryDoc.content, maxLength) : 'No memory document yet.';
}
function recentEntriesForPrompt(entries, maxEntries = 4, maxLength = 180) {
    return entries
        .slice(0, maxEntries)
        .map((entry) => `- ${clipForPrompt(entry.summary, maxLength)}`)
        .join('\n') || 'None';
}
function highlightsForPrompt(highlights, maxEntries = 2, maxLength = 150) {
    return highlights
        .slice(0, maxEntries)
        .map((highlight) => `- ${clipForPrompt(highlight.content, maxLength)}`)
        .join('\n') || 'None';
}
function patternEntriesForPrompt(entries, maxEntries = 8) {
    return entries
        .slice(0, maxEntries)
        .map((entry) => {
        const digest = buildEntryDigest(entry.rawText).slice(0, 3).join(' / ');
        const moments = buildSourceMoments(entry.rawText, 4).join(' / ');
        const sectionTitles = entry.analysis?.sections?.map((section) => section.title).slice(0, 4).join(', ') ?? '';
        const patternSignals = entry.analysis?.patternSignals?.slice(0, 4).join(', ') ?? '';
        return `- ${entry.id} | ${clipForPrompt(entry.title, 70)} | ${clipForPrompt(entry.summary, 170)} | moments: ${clipForPrompt(moments || 'None', 260)} | digest: ${clipForPrompt(digest || 'None', 220)} | sections: ${clipForPrompt(sectionTitles || 'None', 120)} | signals: ${clipForPrompt(patternSignals || 'None', 160)} | tags: ${entry.tags.join(', ')}`;
    })
        .join('\n');
}
function previousPatternsForPrompt(patterns, maxEntries = 6) {
    return patterns
        .slice(0, maxEntries)
        .map((pattern) => `- ${pattern.id} | ${clipForPrompt(pattern.title, 50)} | ${clipForPrompt(pattern.overview, 220)}`)
        .join('\n') || 'None';
}
function buildFeedLabels(tags, rawText, sections) {
    const labels = [
        ...sections
            .map((section) => section.title)
            .filter((title) => !['Overview', 'Question to sit with', 'Core tension', 'State of affairs'].includes(title)),
        ...tags,
    ]
        .map((item) => item.trim())
        .filter(Boolean);
    return [...new Set(labels)].slice(0, 3);
}
export function buildEntryTitle(rawText, tags) {
    const clean = normalizeWhitespace(buildAnalysisInput(rawText) || rawText);
    const base = stripBoilerplate(clean) || clean;
    if (!base) {
        return tags[0] ? `${tags[0]} thread` : 'Untitled entry';
    }
    const lower = base.toLowerCase();
    if (/self-authorization|permission|ask|capable|qualified/.test(lower)) {
        return 'Self-authorization gap';
    }
    if (/admired|idealiz|validation|recognized/.test(lower)) {
        return 'Borrowed authority from admired people';
    }
    if (/alignment|surrender|distance/.test(lower)) {
        return 'Distance from alignment';
    }
    if (/jealous|envy|mimetic/.test(lower)) {
        return 'Jealousy as misread direction';
    }
    const firstSentence = base.split(/[.!?]\s/)[0]?.trim() ?? base;
    if (firstSentence.length <= 56) {
        return firstSentence;
    }
    if (tags.length) {
        return `${tags[0]}: ${clip(firstSentence, 42)}`;
    }
    return clip(firstSentence, 56);
}
function fallbackAnalysis(rawText, tags) {
    const cleanedRaw = buildAnalysisInput(rawText);
    const summary = buildSummary(cleanedRaw || rawText);
    const hasOnlyScaffolding = !cleanedRaw.trim();
    const sections = [
        {
            id: 'main',
            title: 'Overview',
            content: hasOnlyScaffolding
                ? 'This entry is mostly image/transcription scaffolding right now. It needs a cleaner text pass before the analysis can say anything trustworthy.'
                : `The center of gravity here is: ${clip(cleanedRaw || rawText, 240)}`,
        },
        {
            id: 'under-surface',
            title: 'What seems active underneath',
            content: hasOnlyScaffolding
                ? 'Once the actual text is cleaned up, the useful move is to re-run analysis so the app is responding to what you wrote rather than the upload structure.'
                :
                    'There is probably a protection strategy or avoided decision hiding under the surface description. The useful move is to name what action would make this feel more real.',
        },
    ];
    return {
        title: deriveDisplayTitle(cleanedRaw || rawText, cleanedRaw || rawText, tags),
        summary: deriveDisplaySummary(summary, cleanedRaw || rawText),
        entryDigest: buildEntryDigest(cleanedRaw || rawText),
        contextBullets: buildContextBullets(cleanedRaw || rawText),
        sections,
        exploreOptions: [
            `Go deeper on the ${tags[0] ?? 'main'} thread`,
            'Find the repeated pattern underneath this entry',
            'Turn this into one concrete next question',
        ],
        feedLabels: buildFeedLabels(tags, rawText, sections),
        patternSignals: tags.slice(0, 3),
    };
}
function analysisLooksThin(candidate, rawText) {
    const totalSectionLength = candidate.sections.reduce((sum, section) => sum + section.content.length, 0);
    const longEntry = rawText.length > 7000;
    const hasTruncation = candidate.sections.some((section) => /(?:\.{3,}|…)\s*$/.test(section.content.trim()));
    const digestCount = (candidate.entryDigest ?? []).filter(Boolean).length;
    const contextCount = (candidate.contextBullets ?? []).filter(Boolean).length;
    if (hasTruncation)
        return true;
    if (!candidate.summary?.trim())
        return true;
    if (digestCount < 3)
        return true;
    if (longEntry && totalSectionLength < 900)
        return true;
    if (longEntry && contextCount < 2)
        return true;
    if (!longEntry && totalSectionLength < 280)
        return true;
    return false;
}
export async function generateAnalysis(rawText, tags, context) {
    const cleanedRaw = sanitizeJournalText(rawText) || rawText;
    if (!anthropic) {
        return fallbackAnalysis(cleanedRaw, tags);
    }
    const provisionalSummary = buildSummaryLayerFromSections(cleanedRaw, tags, []);
    const analysisLayer = await generateAnalysisLayer(cleanedRaw, tags, context, provisionalSummary).catch(() => null);
    if (analysisLayer) {
        const summaryLayer = buildSummaryLayerFromSections(cleanedRaw, tags, analysisLayer.sections);
        if (!analysisLooksThin({ ...summaryLayer, sections: analysisLayer.sections }, cleanedRaw)) {
            return {
                title: summaryLayer.title,
                summary: summaryLayer.summary,
                entryDigest: summaryLayer.entryDigest,
                contextBullets: summaryLayer.contextBullets,
                sections: analysisLayer.sections,
                exploreOptions: analysisLayer.exploreOptions,
                feedLabels: summaryLayer.feedLabels.length
                    ? summaryLayer.feedLabels
                    : buildFeedLabels(tags, cleanedRaw, analysisLayer.sections),
                patternSignals: summaryLayer.patternSignals,
            };
        }
    }
    const retried = await retryAnalysisWithTighterPrompt(cleanedRaw, tags);
    if (retried && !analysisLooksThin(retried, cleanedRaw))
        return retried;
    return fallbackAnalysis(cleanedRaw, tags);
}
export async function rewriteMemoryDoc(currentMemory, recentEntries) {
    if (!anthropic) {
        return `## Open Threads
- Decision pressure keeps turning into more reflection instead of commitment.

## Recurring Themes
- Momentum versus self-protection
- Wanting clarity before action

## Questions Worth Revisiting
- What real move would create more information than more thinking?`;
    }
    const recentEntryLines = recentEntries
        .slice(0, 8)
        .map((entry) => `- ${entry.createdAt}: ${clipForPrompt(entry.summary, 170)}`)
        .join('\n');
    const prompt = `Update this memory document so future analysis can use cumulative context.
Keep it grounded in the user's actual writing. Avoid inflated abstractions.
Treat the memory as a living map, not a task tracker.
In ## Open Threads, keep only threads that still look genuinely active across the recent journal or clearly recur from current memory into the latest entries.
Drop one-off action reminders, specific outreach drafts, or stale named to-dos unless they clearly represent a broader recurring mechanism that is still present now.
Phrase open threads as durable tensions or live questions, not as literal chores to complete.
Return markdown only using exactly these sections:
## Open Threads
## Recurring Themes
## Questions Worth Revisiting

Current memory:
${memoryForPrompt(currentMemory, 2400)}

Recent entries:
${recentEntryLines}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
}
export function simplifyPatternTitle(title) {
    const clean = normalizeWhitespace(stripMarkdown(title))
        .replace(/^pattern:\s*/i, '')
        .replace(/^theme:\s*/i, '')
        .trim();
    const lower = clean.toLowerCase();
    if (/^waiting for permission$/.test(lower))
        return 'Waiting for permission';
    if (/^looking outward for proof$/.test(lower))
        return 'Looking outward for proof';
    if (/^jealousy as direction$/.test(lower))
        return 'Jealousy as direction';
    if (/^distance from alignment$/.test(lower))
        return 'Distance from alignment';
    if (/^waiting for certainty$/.test(lower))
        return 'Waiting for certainty';
    if (/^the missed window story$/.test(lower))
        return 'The missed-window story';
    const shortened = clean.split(/[:(,-]/)[0]?.trim() ?? clean;
    return shortened.slice(0, 72).trim();
}
export function chooseResurfacingCard(memoryDoc, entries, highlights) {
    const latestEntry = entries[0];
    if (memoryDoc?.content.includes('Open Threads') && latestEntry) {
        return {
            title: latestEntry.title,
            description: latestEntry.summary,
            type: 'thread',
        };
    }
    if (highlights[0]) {
        return {
            title: 'A relevant reading connection',
            description: highlights[0].content,
            type: 'highlight',
        };
    }
    return null;
}
function normalizePatternTitle(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function scorePatternMatch(left, right) {
    const leftTitle = normalizePatternTitle(left.title);
    const rightTitle = normalizePatternTitle(right.title);
    const titleOverlap = leftTitle === rightTitle || leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle);
    const sharedEntryIds = right.entryIds.filter((entryId) => left.entryIds.includes(entryId)).length;
    const sharedDimension = right.dimensions.some((dimension) => left.dimensions.some((existing) => normalizePatternTitle(existing) === normalizePatternTitle(dimension)));
    return (titleOverlap ? 3 : 0) + sharedEntryIds * 2 + (sharedDimension ? 1 : 0);
}
function dedupePatternLines(lines, seedText = '') {
    const kept = [];
    const normalize = (text) => text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const overlap = (left, right) => {
        const leftTokens = new Set(normalize(left).split(' ').filter((token) => token.length > 3));
        const rightTokens = new Set(normalize(right).split(' ').filter((token) => token.length > 3));
        if (!leftTokens.size || !rightTokens.size)
            return 0;
        let shared = 0;
        for (const token of leftTokens) {
            if (rightTokens.has(token))
                shared += 1;
        }
        return shared / Math.max(leftTokens.size, rightTokens.size);
    };
    for (const line of lines) {
        if (!normalizeWhitespace(line))
            continue;
        if (seedText && overlap(line, seedText) > 0.5)
            continue;
        if (kept.some((existing) => overlap(existing, line) > 0.58))
            continue;
        kept.push(line);
    }
    return kept;
}
function textOverlapScore(left, right) {
    const normalize = (text) => text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const leftTokens = new Set(normalize(left).split(' ').filter((token) => token.length > 3));
    const rightTokens = new Set(normalize(right).split(' ').filter((token) => token.length > 3));
    if (!leftTokens.size || !rightTokens.size)
        return 0;
    let shared = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token))
            shared += 1;
    }
    return shared / Math.max(leftTokens.size, rightTokens.size);
}
function dedupeAndRefinePatterns(patterns) {
    const merged = [];
    for (const pattern of patterns) {
        const existing = merged.find((candidate) => {
            const titleScore = normalizePatternTitle(candidate.title) === normalizePatternTitle(pattern.title);
            const sharedEntries = pattern.entryIds.filter((entryId) => candidate.entryIds.includes(entryId)).length;
            const sharedDimension = pattern.dimensions.some((dimension) => candidate.dimensions.some((existingDimension) => normalizePatternTitle(existingDimension) === normalizePatternTitle(dimension)));
            return titleScore || (sharedEntries >= 2 && sharedDimension);
        });
        if (!existing) {
            merged.push({
                ...pattern,
                overview: cleanTruncatedEnding(pattern.overview),
                dimensions: dedupePatternLines(pattern.dimensions.map(cleanTruncatedEnding), pattern.overview).slice(0, 4),
                questions: dedupePatternLines(pattern.questions.map(cleanTruncatedEnding), `${pattern.overview}\n${pattern.dimensions.join('\n')}`).slice(0, 3),
                exploreOptions: dedupePatternLines(pattern.exploreOptions.map(cleanTruncatedEnding)).slice(0, 3),
            });
            continue;
        }
        existing.entryIds = [...new Set([...existing.entryIds, ...pattern.entryIds])];
        existing.dimensions = dedupePatternLines([...existing.dimensions, ...pattern.dimensions], existing.overview).slice(0, 4);
        existing.questions = dedupePatternLines([...existing.questions, ...pattern.questions], `${existing.overview}\n${existing.dimensions.join('\n')}`).slice(0, 3);
        existing.exploreOptions = dedupePatternLines([...existing.exploreOptions, ...pattern.exploreOptions]).slice(0, 3);
        if (pattern.overview.length > existing.overview.length) {
            existing.overview = cleanTruncatedEnding(pattern.overview);
            existing.title = simplifyPatternTitle(pattern.title);
        }
    }
    return merged;
}
const THEME_FAMILIES = [
    {
        key: 'physical-pull',
        title: 'Pull toward physical creation',
        test: /physical project|physical projects|collage|collages|sports with people|coach(?:es)?|tactile/i,
        questions: [
            'What feels different about the kinds of making that involve your body or the physical world?',
            'What small physical project would test whether this pull is real?',
        ],
    },
    {
        key: 'relationship-attunement',
        title: 'Attunement as requirement',
        test: /attun|expressive love|felt love|want a partner who|relationship reflection|(?=.*\bdani\b)(?=.*\b(love|felt|attun|partner|relationship)\b)/i,
        questions: [
            'What does this reveal about the kind of attunement you actually need?',
            'Where do you keep translating that need into something smaller or safer?',
        ],
    },
    {
        key: 'collaboration-threshold',
        title: 'Who not how as threshold',
        test: /who not how|collaborat|small team|hire|ownership|find collaborators|who'?s/i,
        questions: [
            'What kind of collaborator would actually unlock this, not just theoretically help?',
            'What would make the vision compelling enough for someone else to join?',
        ],
    },
    {
        key: 'family-mission',
        title: 'Family as mission',
        test: /\bbuild(?:ing)? (?:a )?family\b|\bprioritize (?:building )?(?:a )?family\b|\bfamily as mission\b|\bmission of my life\b|\bbuild(?:ing)? toward family\b/i,
        questions: [
            'What would building toward family require now, not someday?',
            'How does this aspiration change the way you want to organize your life?',
        ],
    },
    {
        key: 'alignment-drift',
        title: 'Distance from alignment',
        test: /\balignment\b|\bsurrender\b|\bmisalign(?:ment|ed)?\b|\bdistance from (?:alignment|that early surrender)\b|\bsurrender period\b/i,
        questions: [
            'What conditions seem to move you closer to alignment in practice?',
            'What keeps pulling you into a mode that feels misaligned?',
        ],
    },
    {
        key: 'depth-craft',
        title: 'Wanting depth and craft',
        test: /depth|craft|shallow|deep focus|passion|broad curiosity/i,
        questions: [
            'What kind of depth are you actually hungry for here?',
            'What would make depth feel lived rather than admired from a distance?',
        ],
    },
    {
        key: 'output-anchor',
        title: 'Output as anchor',
        test: /\boutput\b|\bproduc(?:e|ing|tion)\b|\bconsum(?:e|ing|ption)\b|\bship(?:s|ped|ping)?\b|\bdeliver(?:ed|ing)?\b|\bsomething to ship\b/i,
        questions: [
            'What kind of output would make the day feel real to you?',
            'Where are you substituting motion or consumption for something shippable?',
        ],
    },
    {
        key: 'self-authorization',
        title: 'Pre-authorization before asking',
        test: /authori[sz]|permission|qualified|capable|capability|skill audit|clarify what (?:you|i am) good at|entitled|imposter/i,
        questions: [
            'What would you ask for if you did not need to justify your right to ask first?',
            'Where are you still trying to earn permission before naming the want?',
        ],
    },
    {
        key: 'outward-proof',
        title: 'Looking outward for proof',
        test: /\badmired\b|\bproof\b|\bvalidation\b|\brecognized\b|\bsomeone else want\b|\bborrow(?:ing)? certainty\b|\bchecking outward\b|\bexternal validation\b|\bidealiz(?:e|ed|ation)\b/i,
        questions: [
            'Where are you still treating another person as evidence that your desire is legitimate?',
            'What would shift if you stopped outsourcing conviction here?',
        ],
    },
    {
        key: 'certainty-delay',
        title: 'Waiting for certainty',
        test: /\bwait(?:ing)?\b|\bhesitat(?:e|ion|ing)?\b|\bdelay(?:ed|ing)?\b|\bbefore visible action\b|\bwhy did i wait\b|\blegitimi[sz]e\b|\bneed clarity before\b|\bwaiting for certainty\b/i,
        questions: [
            'What concrete move would create more information than more reflection?',
            'What are you hoping certainty will spare you from feeling?',
        ],
    },
    {
        key: 'missed-window',
        title: 'The missed-window story',
        test: /\bregret\b|\bmissed\b|\bearlier\b|\btiming\b|\bwindow\b|\b8 years\b|\b5 years\b|\bnot acting earlier\b|\bclosed opportunities\b/i,
        questions: [
            'How much of this story is useful learning, and how much is self-punishment?',
            'What present-day move would keep this from becoming the next missed window?',
        ],
    },
];
function keywordHitCount(text, patterns) {
    const cleaned = normalizeWhitespace(stripMarkdown(text)).toLowerCase();
    return patterns.reduce((count, pattern) => count + (pattern.test(cleaned) ? 1 : 0), 0);
}
function familyCueScore(familyKey, text) {
    const cueSets = {
        'self-authorization': [/\bpermission\b/, /\ballowed\b/, /\bentitled\b/, /\bask(?:ing)?\b/, /\breach out\b/, /\bjustify\b/, /\bqualified\b/, /\bcapab/i],
        'outward-proof': [/\badmired\b/, /\bvalidation\b/, /\bproof\b/, /\bauthority\b/, /\bsomeone else\b/, /\brecognized\b/, /\bstatus\b/, /\battention\b/],
        'certainty-delay': [/\bwait(?:ing)?\b/, /\bdelay(?:ed|ing)?\b/, /\bhesitat/i, /\breadiness\b/, /\bclarity\b/, /\bbefore\b/, /\blater\b/, /\bcertainty\b/],
        'missed-window': [/\bregret\b/, /\bmissed\b/, /\bearlier\b/, /\bwindow\b/, /\b8 years?\b/, /\b5 years?\b/, /\btoo long\b/, /\btiming\b/],
        'collaboration-threshold': [/\bcollaborat/i, /\bhire\b/, /\bteam\b/, /\bpartner\b/, /\bownership\b/, /\bwho not how\b/, /\bincentivize\b/, /\bshared\b/],
        'output-anchor': [/\boutput\b/, /\bship(?:ping|ped)?\b/, /\bproduce|producing|production\b/, /\bconsum(?:e|ing|ption)\b/, /\bshow for them\b/, /\bshow for it\b/, /\bmake the day feel\b/, /\bday feel real\b/],
        'depth-craft': [/\bdepth\b/, /\bcraft\b/, /\bshallow\b/, /\bimmers/i, /\bbroad\b/, /\bpassion\b/, /\btaste\b/, /\bcuration\b/],
        'family-mission': [/\bfamily\b/, /\bmission\b/, /\borganize your life\b/, /\bbuild toward\b/, /\blife orient/i, /\bsurrender\b/],
        'alignment-drift': [/\balignment\b/, /\bsurrender\b/, /\bmisaligned?\b/, /\bdeliberately\b/, /\bhonest\b/],
        'relationship-attunement': [/\battun/i, /\bseen\b/, /\blove\b/, /\bpartner\b/, /\bcloseness\b/, /\brelationship\b/],
        'physical-pull': [/\bphysical\b/, /\bbody\b/, /\bembodied\b/, /\bcollage\b/, /\bsport\b/, /\bcoach\b/],
    };
    const matches = keywordHitCount(text, cueSets[familyKey] ?? []);
    if (familyKey === 'certainty-delay') {
        const permissionCount = keywordHitCount(text, [/\bpermission\b/, /\ballowed\b/, /\bentitled\b/, /\bjustify\b/]);
        const regretCount = keywordHitCount(text, [/\bregret\b/, /\bmissed\b/, /\bearlier\b/, /\bwindow\b/]);
        return matches - permissionCount * 0.8 - regretCount * 0.6;
    }
    if (familyKey === 'self-authorization') {
        const outwardCount = keywordHitCount(text, [/\badmired\b/, /\bvalidation\b/, /\bauthority\b/, /\bsomeone else\b/]);
        return matches - outwardCount * 0.7;
    }
    if (familyKey === 'outward-proof') {
        const permissionCount = keywordHitCount(text, [/\bpermission\b/, /\ballowed\b/, /\bentitled\b/]);
        return matches - permissionCount * 0.5;
    }
    if (familyKey === 'missed-window') {
        const certaintyCount = keywordHitCount(text, [/\bwait(?:ing)?\b/, /\bcertainty\b/, /\breadiness\b/]);
        return matches + certaintyCount * 0.2;
    }
    return matches;
}
function familiesConflict(leftKey, rightKey) {
    if (!leftKey || !rightKey || leftKey === rightKey)
        return false;
    const conflictPairs = new Set([
        'self-authorization|certainty-delay',
        'certainty-delay|self-authorization',
        'self-authorization|outward-proof',
        'outward-proof|self-authorization',
        'certainty-delay|missed-window',
        'missed-window|certainty-delay',
        'depth-craft|output-anchor',
        'output-anchor|depth-craft',
    ]);
    return conflictPairs.has(`${leftKey}|${rightKey}`);
}
function themeFamilyForText(text) {
    const cleaned = `${text}`.trim();
    if (!cleaned)
        return null;
    const normalizedTokens = semanticTokenSet(cleaned);
    const scoredFamilies = THEME_FAMILIES
        .map((family) => {
        let score = 0;
        if (family.test.test(cleaned))
            score += 5;
        score += familyCueScore(family.key, cleaned) * 1.6;
        if (normalizedTokens.size) {
            const semanticTokenHits = [...normalizedTokens].reduce((sum, token) => {
                const familyKey = token === 'authorization' ? 'self-authorization' :
                    token === 'proof' ? 'outward-proof' :
                        token === 'certainty' ? 'certainty-delay' :
                            token === 'alignment' ? 'alignment-drift' :
                                token === 'family' ? 'family-mission' :
                                    token === 'depth' ? 'depth-craft' :
                                        token === 'output' ? 'output-anchor' :
                                            token === 'relationship' ? 'relationship-attunement' :
                                                token === 'collaboration' ? 'collaboration-threshold' :
                                                    token === 'timing' ? 'missed-window' :
                                                        token === 'physical' ? 'physical-pull' :
                                                            '';
                return sum + (familyKey === family.key ? 1 : 0);
            }, 0);
            score += semanticTokenHits * 1.3;
        }
        const familyAnchor = `${family.title} ${family.questions.join(' ')}`;
        score += semanticSimilarity(cleaned, familyAnchor) * 4;
        return { family, score };
    })
        .sort((left, right) => right.score - left.score);
    const best = scoredFamilies[0];
    const second = scoredFamilies[1];
    if (!best || best.score < 2.4)
        return null;
    if (second && best.score - second.score < 0.55 && familiesConflict(best.family.key, second.family.key)) {
        const bestCue = familyCueScore(best.family.key, cleaned);
        const secondCue = familyCueScore(second.family.key, cleaned);
        if (secondCue > bestCue)
            return second.family;
    }
    return best.family;
}
function themeCandidateIsSelfConsistent(title, evidence) {
    const titleFamily = themeFamilyForText(title);
    if (!titleFamily)
        return true;
    const evidenceFamily = themeFamilyForText(evidence);
    return evidenceFamily?.key === titleFamily.key;
}
function uncategorizedThemeTitleLooksTooGeneric(title) {
    const cleaned = simplifyPatternTitle(title);
    const normalized = normalizePatternTitle(cleaned);
    const tokens = normalized
        .split(' ')
        .filter(Boolean)
        .filter((token) => !['the', 'and', 'with', 'from', 'into', 'your', 'that', 'this', 'about', 'how'].includes(token));
    return (!cleaned ||
        tokens.length <= 1 ||
        /^(?:the )?(?:lab|exercise|prompt|notes?|practice|reflection|draft|sketch|idea|question|experiment)$/i.test(cleaned) ||
        /^(?:the )?(?:lab|exercise|prompt|notes?|practice|reflection|draft|sketch|idea|question|experiment)\b/i.test(cleaned));
}
function evidenceLooksFragmentary(line) {
    const clean = normalizeWhitespace(stripMarkdown(cleanTruncatedEnding(line)));
    const words = clean.split(' ').filter(Boolean);
    const lastWord = words[words.length - 1]?.toLowerCase() ?? '';
    return (!clean ||
        words.length < 5 ||
        /(?:^not like\b|^on [A-Z][a-z]+\b|^through\b)/i.test(clean) ||
        /\b(?:which|who|we|i)\s*$/i.test(clean) ||
        /\b(?:would|could|will|to|for|from|about|before|after|because|with|without|into|than)\s*$/i.test(clean) ||
        SUSPICIOUS_SHORT_FINAL_WORDS.has(lastWord) ||
        (/^[a-z]{2,4}$/.test(lastWord) && !['want', 'need', 'work', 'love', 'team', 'ship', 'real', 'path', 'life'].includes(lastWord)) ||
        /\b(?:img|heic|transcribed journal page)\b/i.test(clean) ||
        DANGLING_ENDING_PATTERN.test(clean));
}
function scoreEvidenceLine(line, family) {
    const clean = normalizeWhitespace(stripMarkdown(cleanTruncatedEnding(line)));
    if (!clean || !family.test.test(clean) || evidenceLooksFragmentary(clean))
        return -1;
    let score = 0;
    const wordCount = clean.split(' ').filter(Boolean).length;
    if (wordCount >= 8 && wordCount <= 32)
        score += 3;
    if (wordCount < 6)
        score -= 4;
    if (/[.!?]$/.test(clean))
        score += 2;
    else
        score -= 1;
    if (/^(what|why|how)\b/i.test(clean))
        score -= 1;
    if (/\b(i want|i needed|i feel|the pattern|not asking|reaching out|self authorization|external validation|surrender)\b/i.test(clean)) {
        score += 2;
    }
    if (/\b(?:through authentic alignment|same pattern|same idea)\b/i.test(clean))
        score -= 4;
    return score;
}
function bestFamilyEvidenceLine(sourceLines, family) {
    return sourceLines
        .map((line) => ({
        line: cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(line))),
        score: scoreEvidenceLine(line, family),
    }))
        .filter((item) => item.line && item.score >= 2)
        .sort((left, right) => right.score - left.score || right.line.length - left.line.length)[0]?.line ?? '';
}
function bestOpenThemeEvidenceLine(sourceLines) {
    return sourceLines
        .map((line) => cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(line))))
        .filter((line) => line && !evidenceLooksFragmentary(line))
        .map((line) => {
        const wordCount = line.split(' ').filter(Boolean).length;
        let score = 0;
        if (wordCount >= 8 && wordCount <= 42)
            score += 3;
        if (/[.!?]$/.test(line))
            score += 2;
        if (/\b(i want|i feel|i need|you want|you feel|the pattern|because|rather than|instead of)\b/i.test(line))
            score += 2;
        if (/^(what|why|how)\b/i.test(line))
            score -= 1;
        if (/\b(?:the journal|this theme|same pattern|same idea)\b/i.test(line))
            score -= 2;
        return { line, score };
    })
        .filter((item) => item.score >= 2)
        .sort((left, right) => right.score - left.score || right.line.length - left.line.length)[0]?.line ?? '';
}
function sourceLinesForPatternEvidence(entry) {
    return [
        ...splitIntoCandidateSentences(entry.rawText),
        entry.summary,
        ...(entry.analysis?.entryDigest ?? []),
        ...(entry.analysis?.patternSignals ?? []),
        ...(entry.analysis?.sections ?? []).flatMap((section) => [
            section.title,
            ...splitIntoCandidateSentences(section.content),
        ]),
    ]
        .map((line) => cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(line))))
        .filter((line) => line && !evidenceLooksFragmentary(line));
}
function rawQuoteCandidatesForEntry(entry) {
    return dedupePatternLines(splitIntoCandidateSentences(entry.rawText)
        .map((line) => cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(line))))
        .filter((line) => line && !evidenceLooksFragmentary(line))).map((text) => ({
        text,
        sourceType: 'raw_quote',
    }));
}
function analysisQuoteCandidatesForEntry(entry) {
    const candidates = (entry.analysis?.sections ?? [])
        .filter((section) => !isGenericSectionTitle(section.title))
        .flatMap((section) => splitIntoCandidateSentences(section.content)
        .map((line) => cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(line))))
        .filter((line) => line && !evidenceLooksFragmentary(line))
        .map((text) => ({
        text,
        sourceType: 'analysis_quote',
        sectionTitle: section.title,
    })));
    const seen = new Set();
    return candidates.filter((item) => {
        const key = normalizePatternTitle(item.text);
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function scoreThreadSnippetCandidate(snippet, label, claim, family, preferredSectionTitle) {
    const text = snippet.text;
    if (!text || evidenceLooksFragmentary(text))
        return -1;
    let score = 0;
    if (snippet.sourceType === 'raw_quote')
        score += 7;
    if (snippet.sourceType === 'analysis_quote')
        score += 3;
    if (snippet.sourceType === 'summary_fallback')
        score -= 2;
    if (family?.test.test(text))
        score += 4;
    score += semanticSimilarity(`${label} ${claim}`, text) * 8;
    if (preferredSectionTitle && snippet.sectionTitle === preferredSectionTitle)
        score += 2;
    if (/[.!?]$/.test(text))
        score += 1;
    if (text.split(' ').filter(Boolean).length >= 8)
        score += 1;
    return score;
}
function selectThreadSnippets(entry, label, claim, preferredSectionTitle) {
    const family = themeFamilyForText(`${label} ${claim}`);
    const ranked = [...rawQuoteCandidatesForEntry(entry), ...analysisQuoteCandidatesForEntry(entry)]
        .map((snippet) => ({
        snippet,
        score: scoreThreadSnippetCandidate(snippet, label, claim, family, preferredSectionTitle),
    }))
        .filter((item) => item.score >= 2)
        .sort((left, right) => right.score - left.score);
    const selected = [];
    for (const { snippet } of ranked) {
        if (selected.some((existing) => textOverlapScore(existing.text, snippet.text) > 0.58))
            continue;
        selected.push(snippet);
        if (selected.length >= 2 && selected.some((item) => item.sourceType === 'raw_quote')) {
            break;
        }
    }
    if (selected.length) {
        return selected.slice(0, 2);
    }
    const fallback = cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(entry.summary)));
    return fallback
        ? [{
                text: fallback,
                sourceType: 'summary_fallback',
            }]
        : [];
}
function selectPatternEvidenceSnippet(pattern, entry) {
    const sourceLines = sourceLinesForPatternEvidence(entry);
    const family = themeFamilyForText(pattern.title);
    const familyEvidence = family ? bestFamilyEvidenceLine(sourceLines, family) : '';
    const openEvidence = bestOpenThemeEvidenceLine([
        ...sourceLines,
        entry.summary,
        pattern.overview,
    ]);
    return cleanTruncatedEnding(familyEvidence || openEvidence || entry.summary || '');
}
function scoreThreadMatchToPattern(pattern, thread) {
    const patternFamily = themeFamilyForText(`${pattern.title} ${pattern.overview}`);
    const threadFamily = themeFamilyForText(`${thread.label} ${thread.claim} ${thread.snippets.map((item) => item.text).join(' ')}`);
    const titleScore = Math.max(themeTitleSimilarity(pattern.title, thread.label), semanticSimilarity(`${pattern.title} ${pattern.overview}`, `${thread.label} ${thread.claim}`));
    const claimScore = semanticSimilarity(`${pattern.overview} ${pattern.dimensions.join(' ')}`, `${thread.claim} ${thread.whyItMatters}`);
    const familyPenalty = patternFamily?.key && threadFamily?.key && familiesConflict(patternFamily.key, threadFamily.key)
        ? 0.38
        : patternFamily?.key && threadFamily?.key && patternFamily.key !== threadFamily.key
            ? 0.18
            : 0;
    return titleScore * 0.58 + claimScore * 0.34 + thread.salience * 0.12 - familyPenalty;
}
function selectPatternEvidenceDetail(pattern, entry) {
    const matchingThread = buildEntryThreads(entry)
        .map((thread) => ({ thread, score: scoreThreadMatchToPattern(pattern, thread) }))
        .sort((left, right) => right.score - left.score)[0];
    if (matchingThread && matchingThread.score >= 0.42) {
        const snippet = matchingThread.thread.snippets[0];
        if (snippet?.text && !evidenceLooksFragmentary(snippet.text)) {
            return {
                entryId: entry.id,
                entryTitle: entry.title,
                snippet: cleanTruncatedEnding(snippet.text),
                sourceType: snippet.sourceType,
                sectionTitle: snippet.sectionTitle,
                threadLabel: matchingThread.thread.label,
                claim: matchingThread.thread.claim,
                whyItMatters: matchingThread.thread.whyItMatters,
                confidence: matchingThread.thread.confidence,
                salience: matchingThread.thread.salience,
                tags: matchingThread.thread.tags,
                createdAt: matchingThread.thread.createdAt,
            };
        }
    }
    const snippet = selectPatternEvidenceSnippet(pattern, entry);
    if (!snippet || evidenceLooksFragmentary(snippet))
        return null;
    return {
        entryId: entry.id,
        entryTitle: entry.title,
        snippet,
        sourceType: 'summary_fallback',
        threadLabel: pattern.title,
        claim: pattern.dimensions[0] ?? pattern.overview,
        whyItMatters: pattern.overview,
        confidence: 0.5,
        salience: 0.5,
        tags: entry.tags,
        createdAt: entry.createdAt,
    };
}
function buildThreadWhyItMatters(label, claim, familyKey) {
    const familyReasons = {
        'self-authorization': 'This matters because it can quietly delay direct asks until you feel overqualified enough to deserve them.',
        'outward-proof': 'This matters because borrowed certainty can make another person’s attention or approval feel like the gate to your own desire.',
        'alignment-drift': 'This matters because the cost is living farther from a state you already recognize as more honest or surrendered.',
        'output-anchor': 'This matters because output is functioning as a reality anchor, not just productivity, so the pattern affects whether days feel real.',
        'relationship-attunement': 'This matters because generic closeness is not enough here; you seem to be tracking whether love feels specifically attuned.',
        'collaboration-threshold': 'This matters because staying in lone effort can cap both ambition and joy if the real unlock is finding the right collaborators.',
        'family-mission': 'This matters because family is showing up as a life-organizing direction, not just a someday preference.',
        'depth-craft': 'This matters because shallow motion seems to leave a residue, while real craft/depth carries a stronger sense of aliveness.',
        'certainty-delay': 'This matters because waiting for certainty can become the mechanism that creates the very regret or stuckness you are trying to avoid.',
        'physical-pull': 'This matters because embodied making seems to carry a different kind of energy than staying only in abstract thought.',
        'missed-window': 'This matters because old timing stories can become self-punishing if they are not translated into present-day signal and action.',
    };
    const reason = familyKey ? familyReasons[familyKey] : '';
    if (reason)
        return reason;
    const cleanedClaim = cleanTruncatedEnding(claim);
    const cleanedLabel = simplifyPatternTitle(label);
    return cleanedClaim
        ? `This matters because ${cleanedClaim.charAt(0).toLowerCase()}${cleanedClaim.slice(1)}`
        : `This matters because ${cleanedLabel.toLowerCase()} is carrying enough charge to recur or shape decisions.`;
}
function clampScore(value, min = 0.35, max = 0.98) {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}
function buildThreadClaim(label, snippet, summary, sectionContent = '') {
    const anchor = firstSentence(sectionContent || snippet || summary, 180);
    const family = themeFamilyForText(`${label} ${anchor}`);
    const cleanedLabel = simplifyPatternTitle(label);
    const lowerAnchor = anchor.toLowerCase();
    const quotedAnchor = cleanTruncatedEnding(anchor);
    if (family?.key === 'self-authorization') {
        if (/ask|reach out|permission|allowed|entitled/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is not just wanting something, but needing permission or legitimacy to feel settled before asking for it');
        }
        if (/capab|qualified|authority|good at/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is trying to settle whether you are qualified enough before letting desire move into action');
        }
        return formatPatternSentence('The recurring move is needing legitimacy or capability to feel established before asking directly for what you want');
    }
    if (family?.key === 'outward-proof') {
        if (/admired|authority|someone else|proof|validation/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is treating another person’s desire, status, or authority as proof that your own wanting is legitimate');
        }
        return formatPatternSentence('The thread is checking outward for proof or borrowed conviction before trusting your own desire');
    }
    if (family?.key === 'alignment-drift') {
        if (/surrender|alignment|misaligned/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is asking how to build deliberately without moving farther from surrender or alignment');
        }
        return formatPatternSentence('The thread is tracking the distance between an aligned/surrendered state and the mode daily life is actually rewarding');
    }
    if (family?.key === 'certainty-delay') {
        if (/wait|later|delay|readiness|certainty/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is waiting for enough certainty or readiness before making a move that would actually create more information');
        }
        if (/why did i wait|too long|later than/i.test(lowerAnchor)) {
            return formatPatternSentence('The thread is using delay itself as evidence that you should have been more certain before acting');
        }
        return formatPatternSentence('The thread is postponing visible movement until more certainty appears, then feeling the cost of that delay');
    }
    if (family?.key === 'relationship-attunement') {
        if (/love|attun|seen|partner|relationship/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is clarifying that closeness only feels real when it is expressive, attuned, and specifically felt');
        }
        return formatPatternSentence('The thread is testing whether closeness feels specifically attuned and expressive enough to count as real love');
    }
    if (family?.key === 'collaboration-threshold') {
        if (/solo|alone|collaborator|partner|team|who not how/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is moving from solo effort toward the question of who would actually make the work larger or more real');
        }
        if (/hire|incentivize|ownership|shared/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is getting concrete about what kind of hire, ownership, or shared structure would turn this into a real collaboration problem');
        }
        return formatPatternSentence('The thread is moving from solo effort toward the question of who would actually make the work larger or more real');
    }
    if (family?.key === 'family-mission') {
        if (/family|mission|surrender|organize|life/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is treating family as a life-orienting mission and asking what present-day choices should serve it');
        }
        return formatPatternSentence('The thread is treating family as a life-orienting mission and asking what present-day choices should serve that');
    }
    if (family?.key === 'depth-craft') {
        if (/depth|craft|shallow|broad|immers/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is pulling toward deeper craft and sustained immersion rather than broad but shallow motion');
        }
        if (/taste|curation|design|space|experience/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is not just wanting depth in general, but wanting to exercise taste and craft in a more authored way');
        }
        return formatPatternSentence('The thread is wanting deeper craft or sustained immersion instead of a broad-but-shallow mode');
    }
    if (family?.key === 'output-anchor') {
        if (/consum|consumed|show for|ship|output|produce/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is using concrete output as a way to make time feel real rather than consumed by circling or intake');
        }
        if (/day feel real|meaning to show/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is measuring whether the day counted by whether there is something real to point to at the end of it');
        }
        return formatPatternSentence('The thread is using concrete output as a way to make time feel real rather than consumed by circling or intake');
    }
    if (family?.key === 'physical-pull') {
        if (/physical|body|embodied|collage|sport|coach/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is pointing toward embodied forms of making that feel more alive than staying only in abstraction');
        }
        return formatPatternSentence('The thread is being pulled toward tactile or physical forms of making that feel more embodied than pure abstraction');
    }
    if (family?.key === 'missed-window') {
        if (/earlier|window|missed|timing|late/.test(lowerAnchor)) {
            return formatPatternSentence('The thread is revisiting an older timing decision and asking what is signal versus self-punishment');
        }
        return formatPatternSentence('The thread is replaying old timing windows and trying to extract usable signal without turning that into self-punishment');
    }
    if (quotedAnchor && semanticSimilarity(quotedAnchor, cleanedLabel) < 0.85) {
        return formatPatternSentence(`${cleanedLabel}: ${lowerCaseFirst(quotedAnchor)}`);
    }
    return formatPatternSentence(cleanedLabel || summary || 'A live thread in this entry');
}
function normalizeEntryThreadCandidate(candidate, entry) {
    const label = simplifyPatternTitle(candidate.label);
    const claim = cleanTruncatedEnding(candidate.claim);
    const snippets = candidate.snippets
        .map((item) => ({
        text: cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(item.text))),
        sourceType: item.sourceType,
        sectionTitle: item.sectionTitle ? cleanTruncatedEnding(item.sectionTitle) : undefined,
    }))
        .filter((item) => item.text && !evidenceLooksFragmentary(item.text))
        .filter((item, index, items) => items.findIndex((other) => normalizePatternTitle(other.text) === normalizePatternTitle(item.text)) === index)
        .slice(0, 3);
    const whyItMatters = cleanTruncatedEnding(candidate.whyItMatters);
    if (!label || !claim || !snippets.length)
        return null;
    return {
        entryId: entry.id,
        entryTitle: simplifyPatternTitle(entry.title) || 'Untitled entry',
        label,
        claim,
        snippets,
        whyItMatters: whyItMatters || buildThreadWhyItMatters(label, claim, themeFamilyForText(`${label} ${claim}`)?.key),
        confidence: clampScore(candidate.confidence),
        salience: clampScore(candidate.salience),
        tags: [...new Set([...(candidate.tags ?? []), ...entry.tags].map((item) => item.trim()).filter(Boolean))].slice(0, 6),
        createdAt: entry.createdAt,
    };
}
function dedupeEntryThreads(threads) {
    const kept = [];
    for (const thread of threads.sort((left, right) => (right.salience * right.confidence) - (left.salience * left.confidence))) {
        const duplicate = kept.find((existing) => {
            const sameLabel = normalizePatternTitle(existing.label) === normalizePatternTitle(thread.label);
            const relatedLabel = themeTitleSimilarity(existing.label, thread.label) >= 0.8 ||
                semanticSimilarity(existing.label, thread.label) >= 0.82;
            const sameClaim = semanticSimilarity(`${existing.claim} ${existing.snippets[0]?.text ?? ''}`, `${thread.claim} ${thread.snippets[0]?.text ?? ''}`) >= 0.8;
            return sameLabel || (relatedLabel && sameClaim);
        });
        if (!duplicate) {
            kept.push(thread);
            continue;
        }
        const combinedSnippets = [...thread.snippets, ...duplicate.snippets];
        duplicate.snippets = combinedSnippets
            .filter((item, index, items) => items.findIndex((other) => normalizePatternTitle(other.text) === normalizePatternTitle(item.text)) === index)
            .sort((left, right) => {
            const sourcePriority = (item) => item.sourceType === 'raw_quote' ? 3 : item.sourceType === 'analysis_quote' ? 2 : 1;
            return sourcePriority(right) - sourcePriority(left);
        })
            .slice(0, 3);
        duplicate.confidence = clampScore(Math.max(duplicate.confidence, thread.confidence));
        duplicate.salience = clampScore(Math.max(duplicate.salience, thread.salience));
        duplicate.tags = [...new Set([...duplicate.tags, ...thread.tags])].slice(0, 6);
    }
    return kept.slice(0, 8);
}
export function buildEntryThreads(entry) {
    const sourceLines = sourceLinesForPatternEvidence(entry);
    const storedThreads = (entry.analysis?.entryThreads ?? [])
        .map((thread) => normalizeEntryThreadCandidate({
        label: thread.label,
        claim: thread.claim,
        snippets: thread.snippets?.length ? thread.snippets : selectThreadSnippets(entry, thread.label, thread.claim),
        whyItMatters: thread.whyItMatters,
        confidence: thread.confidence,
        salience: thread.salience,
        tags: thread.tags,
    }, entry))
        .filter((thread) => Boolean(thread));
    if (storedThreads.length) {
        return dedupeEntryThreads(storedThreads);
    }
    const threadCandidates = new Map();
    for (const family of THEME_FAMILIES) {
        const snippet = bestFamilyEvidenceLine(sourceLines, family);
        if (!snippet)
            continue;
        const label = family.title;
        const claim = buildThreadClaim(label, snippet, entry.summary);
        const confidence = 0.78 + Math.min(scoreEvidenceLine(snippet, family), 5) * 0.03;
        const salience = 0.62 +
            Math.min(scoreThemeCharge(`${claim} ${snippet}`), 5) * 0.05 +
            (entry.hasOpenThreads ? 0.08 : 0);
        threadCandidates.set(normalizePatternTitle(label), {
            label,
            claim,
            snippets: selectThreadSnippets(entry, label, claim),
            whyItMatters: buildThreadWhyItMatters(label, claim, family.key),
            confidence,
            salience,
            tags: [family.title, ...entry.tags],
        });
    }
    for (const section of entry.analysis?.sections ?? []) {
        if (isGenericSectionTitle(section.title))
            continue;
        const sectionLabel = simplifyPatternTitle(section.title);
        const family = themeFamilyForText(`${sectionLabel} ${section.content}`);
        const label = family?.title ?? sectionLabel;
        if (!label || (!family && uncategorizedThemeTitleLooksTooGeneric(label)))
            continue;
        const snippetSource = family
            ? bestFamilyEvidenceLine(sourceLines, family)
            : bestOpenThemeEvidenceLine([
                ...splitIntoCandidateSentences(entry.rawText),
                ...splitIntoCandidateSentences(section.content),
                entry.summary,
            ]);
        const snippets = selectThreadSnippets(entry, label, section.content || snippetSource, section.title);
        const claim = buildThreadClaim(label, snippetSource || snippets[0]?.text || section.content, entry.summary, section.content);
        if (!snippets.length || !claim)
            continue;
        const key = normalizePatternTitle(label);
        const existing = threadCandidates.get(key);
        const candidate = {
            label,
            claim,
            snippets,
            whyItMatters: buildThreadWhyItMatters(label, claim, family?.key),
            confidence: family ? 0.78 : 0.64,
            salience: 0.56 +
                Math.min(scoreThemeCharge(`${section.title} ${section.content}`), 5) * 0.05 +
                (scoreTextSpecificity(section.content) > 2 ? 0.06 : 0),
            tags: [sectionLabel, ...(family ? [family.title] : []), ...entry.tags],
        };
        if (!existing || candidate.salience * candidate.confidence > existing.salience * existing.confidence) {
            threadCandidates.set(key, candidate);
        }
    }
    for (const signal of entry.analysis?.patternSignals ?? []) {
        const label = simplifyPatternTitle(signal);
        if (!label)
            continue;
        const family = themeFamilyForText(label);
        if (!family && uncategorizedThemeTitleLooksTooGeneric(label))
            continue;
        const normalizedLabel = family?.title ?? label;
        const claim = buildThreadClaim(normalizedLabel, entry.summary, entry.summary);
        const snippets = selectThreadSnippets(entry, normalizedLabel, claim);
        if (!snippets.length)
            continue;
        const key = normalizePatternTitle(normalizedLabel);
        if (!threadCandidates.has(key)) {
            threadCandidates.set(key, {
                label: normalizedLabel,
                claim,
                snippets,
                whyItMatters: buildThreadWhyItMatters(normalizedLabel, claim, family?.key),
                confidence: family ? 0.72 : 0.6,
                salience: 0.54 + Math.min(scoreThemeCharge(`${claim} ${snippets[0]?.text ?? ''}`), 5) * 0.04,
                tags: [label, ...(family ? [family.title] : []), ...entry.tags],
            });
        }
    }
    if (!threadCandidates.size && entry.summary) {
        threadCandidates.set(normalizePatternTitle(entry.title || entry.summary), {
            label: simplifyPatternTitle(entry.title || entry.summary || 'Journal thread'),
            claim: buildThreadClaim(entry.title || 'Journal thread', entry.summary, entry.summary),
            snippets: selectThreadSnippets(entry, entry.title || 'Journal thread', entry.summary),
            whyItMatters: `This matters because the entry’s main signal appears to be ${entry.summary.charAt(0).toLowerCase()}${entry.summary.slice(1)}`,
            confidence: 0.52,
            salience: 0.5,
            tags: entry.tags,
        });
    }
    return dedupeEntryThreads([...threadCandidates.values()]
        .map((candidate) => normalizeEntryThreadCandidate(candidate, entry))
        .filter((thread) => Boolean(thread)));
}
function semanticToken(token) {
    if (!token)
        return '';
    if (/^(authoriz|authoris|permiss|qualif|capab|skill|impost|entitl)/.test(token))
        return 'authorization';
    if (/^(proof|valid|recogn|admir|yoni|elie)/.test(token))
        return 'proof';
    if (/^(certain|clarit|wait|delay|hesit|stuck|legitim)/.test(token))
        return 'certainty';
    if (/^(align|surrend|mean|mission)/.test(token))
        return 'alignment';
    if (/^(family)/.test(token))
        return 'family';
    if (/^(depth|craft|shallow|focus|passion|curios)/.test(token))
        return 'depth';
    if (/^(output|produc|consum|ship|deliver|trace)/.test(token))
        return 'output';
    if (/^(dani|attun|love|close|closeness)/.test(token))
        return 'relationship';
    if (/^(collabor|team|hire|owner|who|partner)/.test(token))
        return 'collaboration';
    if (/^(regret|miss|tim|window|earlier|late)/.test(token))
        return 'timing';
    if (/^(physic|collage|sport|coach|tactile)/.test(token))
        return 'physical';
    return token;
}
function semanticTokenSet(text) {
    return new Set(normalizePatternTitle(stripMarkdown(text))
        .split(' ')
        .map((token) => semanticToken(token))
        .filter((token) => token.length > 2)
        .filter((token) => !['the', 'and', 'with', 'from', 'into', 'your', 'that', 'this', 'about'].includes(token)));
}
function semanticSimilarity(left, right) {
    const leftTokens = semanticTokenSet(left);
    const rightTokens = semanticTokenSet(right);
    if (!leftTokens.size || !rightTokens.size)
        return 0;
    let shared = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token))
            shared += 1;
    }
    return shared / Math.max(leftTokens.size, rightTokens.size);
}
function titleQualityScore(title) {
    const cleaned = simplifyPatternTitle(title);
    const words = normalizePatternTitle(cleaned).split(' ').filter(Boolean);
    let score = 0;
    if (words.length >= 2 && words.length <= 6)
        score += 3;
    if (words.length === 1 || words.length > 8)
        score -= 2;
    if (/^(this|that|what|the)$/.test(words[0] ?? ''))
        score -= 2;
    if (cleaned.length > 56)
        score -= 1;
    return score;
}
function chooseBestClusterTitle(cluster) {
    const family = cluster.familyKey ? THEME_FAMILIES.find((item) => item.key === cluster.familyKey) : null;
    if (family)
        return family.title;
    const rankedTitles = [...cluster.titleWeights.entries()]
        .sort((left, right) => {
        const rightScore = right[1] + titleQualityScore(right[0]);
        const leftScore = left[1] + titleQualityScore(left[0]);
        if (rightScore !== leftScore)
            return rightScore - leftScore;
        return left[0].length - right[0].length;
    })
        .map(([title]) => title);
    return simplifyPatternTitle(rankedTitles[0] ?? 'Recurring thread');
}
function buildOverviewFromCluster(title, entryCount, familyKey, evidence) {
    void evidence;
    const familyOverviews = {
        'self-authorization': 'A recurring threshold is feeling like you need to prove capability, clarify credentials, or pre-justify the ask before saying directly what you want.',
        'outward-proof': 'You keep outsourcing conviction to admired people or external signs, then using their choices, attention, or status as evidence for whether your own desire is legitimate.',
        'alignment-drift': 'You keep tracking a gap between the life-state that feels aligned or surrendered and the ways daily choices, work modes, or relationships pull you away from that state.',
        'output-anchor': 'Shipped output keeps appearing as an anchor for meaning: you want days to feel defined by making something real, and you notice how consuming or circling ideas can become a substitute.',
        'relationship-attunement': 'The recurring need here is not just closeness, but felt attunement: love has to feel expressive, specific, and deeply seen, and the Dani reflections seem to crystallize that standard.',
        'collaboration-threshold': 'The live move here is from lone effort into the “who not how” question: what kind of collaborators, partners, or team structure would actually let the work become bigger and more real.',
        'family-mission': 'Family shows up as more than a generic future goal—it reads like a life-orienting mission, with a live question about how to build toward that deliberately while staying in surrender.',
        'depth-craft': 'You keep contrasting broad, shallow motion with a hunger for depth, craft, and sustained immersion in something you can really follow all the way through.',
        'certainty-delay': 'You keep waiting for more certainty, legitimacy, or readiness before visible action, and then feeling the cost of that delay once the desire becomes clearer.',
        'physical-pull': 'There is a repeated pull toward physical, tactile, embodied forms of making—projects, sport, coaching, or collage—that seem to carry a different kind of energy than abstract thinking alone.',
        'missed-window': 'A recurring story here is about missed timing: replaying earlier moments when you did not act, and trying to separate useful signal from a self-punishing sense that a window has already closed.',
    };
    const intro = (familyKey ? familyOverviews[familyKey] : '') ||
        (entryCount >= 2
            ? `${title} keeps recurring across ${entryCount} entries, but the underlying shape is still emerging.`
            : `${title} is present in this entry, but the underlying shape is still emerging.`);
    return cleanTruncatedEnding(intro) || title;
}
export function sanitizePatternOverviewText(text) {
    const cleaned = cleanTruncatedEnding(text)
        .replace(/\bRecent evidence:\s*.+$/i, '')
        .replace(/\bExample:\s*.+$/i, '')
        .replace(/\bThe question this raises:\s*.+$/i, '')
        .replace(/^This theme is about\s+/i, '')
        .replace(/^This theme\s+/i, '')
        .trim();
    if (!cleaned)
        return '';
    const normalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return cleanTruncatedEnding(normalized);
}
function formatPatternSentence(text) {
    const cleaned = cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(text)));
    if (!cleaned)
        return '';
    const sentence = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return /[.!?]"?$/.test(sentence) ? sentence : `${sentence}.`;
}
function dimensionLeadForCluster(cluster, index) {
    const familyLeads = {
        'self-authorization': [
            'The ask gets delayed by a need to establish legitimacy first.',
            'One version of the pattern is translating desire into a case for why you are allowed to ask.',
            'The journal keeps circling the gap between wanting contact and feeling entitled to initiate it.',
        ],
        'outward-proof': [
            'Another person’s desire, status, or attention becomes a proxy for trusting your own want.',
            'Instead of moving from internal conviction, the journal keeps checking outward for permission or proof.',
            'Idealizing someone else can become a way to avoid standing plainly inside your own desire.',
        ],
        'alignment-drift': [
            'Alignment is being tracked as a felt state, and the journal notices when daily choices stop matching it.',
            'The recurring question is whether the current mode is genuinely aligned or just easier to stay inside.',
            'Surrender shows up as a standard, and the entry tests where life feels close to or far from that standard.',
        ],
        'output-anchor': [
            'Producing something concrete is standing in for a deeper need to make the day feel traceable and real.',
            'Shipping reads less like productivity theater and more like proof that the day became something.',
            'The contrast is between consuming or circling ideas and ending the day with output you can point to.',
        ],
        'relationship-attunement': [
            'The relationship standard is not generic closeness, but visibly felt and expressive attunement.',
            'What hurts is not just distance, but the absence of love that feels specifically tuned to who you are.',
            'The Dani material seems to name a bar for being deeply seen rather than merely accompanied.',
        ],
        'collaboration-threshold': [
            'The desire is to move out of solo striving and into a team or partner structure that changes what becomes possible.',
            'The “who not how” question shows up as wanting complementary collaborators, not just more solitary effort.',
            'The entry imagines a working structure where shared ownership and taste make the work bigger and more enjoyable.',
        ],
        'family-mission': [
            'Family appears as an organizing life direction, and the journal tests how to build toward it deliberately without losing surrender.',
            'This is less a someday wish than a question about what kind of present-day operating mode would actually serve that mission.',
            'The entry treats family as a real axis for life design, not just one future preference among many.',
        ],
        'depth-craft': [
            'The thread is a pull toward deeper craft and sustained immersion, especially where life still feels broad or shallow.',
            'The journal keeps contrasting surface-level motion with wanting to follow a craft or passion all the way through.',
            'Depth seems to matter not abstractly, but as a way to feel genuinely claimed by what you are making or learning.',
        ],
        'certainty-delay': [
            'Visible action gets postponed until enough certainty or legitimacy appears, and the delay itself becomes part of the pain.',
            'The pattern is not only uncertainty; it is waiting for readiness before moving, then feeling the cost of that pause.',
            'The entry keeps asking what would happen if action came before full certainty rather than after it.',
        ],
        'physical-pull': [
            'Embodied or physical forms of making carry a distinct charge here.',
            'The pull is toward work and play you can feel in the body, not only think about from a distance.',
            'Physical projects, sport, or collage seem to offer a more direct kind of aliveness than abstract ideation alone.',
        ],
        'missed-window': [
            'The entry revisits an earlier moment of non-action and asks whether that delay has become a lasting story of missed timing.',
            'The pattern is replaying old windows you did not step through and trying to decide what signal is still useful now.',
            'There is a grief thread here: not just what happened, but what feels foreclosed because you waited.',
        ],
    };
    const leads = cluster.familyKey ? familyLeads[cluster.familyKey] : null;
    return leads?.[index % leads.length] ?? '';
}
function normalizeEvidenceExample(text) {
    const cleaned = cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(text)));
    if (!cleaned || evidenceLooksFragmentary(cleaned))
        return '';
    return cleaned;
}
function buildThemeDimensionText(cluster, evidence, index) {
    const cleaned = normalizeEvidenceExample(evidence);
    if (!cleaned || evidenceLooksFragmentary(cleaned))
        return '';
    const lead = dimensionLeadForCluster(cluster, index);
    if (lead) {
        return formatPatternSentence(`${lead} ${lowerCaseFirst(cleaned)}`);
    }
    const lower = cleaned.toLowerCase();
    if (cluster.familyKey === 'self-authorization') {
        if (/self authorization|capab|qualified|entitled|imposter|clarify|permission/.test(lower)) {
            return formatPatternSentence(`The ask gets delayed by a need to establish legitimacy first: ${cleaned}`);
        }
    }
    if (cluster.familyKey === 'outward-proof') {
        if (/external proof|see someone else|idealiz|checking outward|can't define my own wants|admired/.test(lower)) {
            return formatPatternSentence(`You look to someone else’s desire, authority, or status to validate your own: ${cleaned}`);
        }
    }
    if (cluster.familyKey === 'alignment-drift') {
        return formatPatternSentence(`Alignment is being tracked as a felt state, and the journal keeps noticing where the current mode does or doesn't match that: ${cleaned}`);
    }
    if (cluster.familyKey === 'output-anchor') {
        return formatPatternSentence(`Producing something concrete is standing in for a deeper need to make the day feel traceable and real: ${cleaned}`);
    }
    if (cluster.familyKey === 'relationship-attunement') {
        if (/dani|attun|expressive love|felt/.test(lower)) {
            return formatPatternSentence(`The relationship standard is not generic closeness, but visibly felt and expressive attunement: ${cleaned}`);
        }
    }
    if (cluster.familyKey === 'collaboration-threshold') {
        return formatPatternSentence(`The desire is to move out of solo striving and into a team or partner structure that changes what becomes possible: ${cleaned}`);
    }
    if (cluster.familyKey === 'family-mission') {
        return formatPatternSentence(`Family appears as an organizing life direction, and you're testing how to build toward it deliberately without losing surrender: ${cleaned}`);
    }
    if (cluster.familyKey === 'depth-craft') {
        return formatPatternSentence(`The thread is a pull toward deeper craft and sustained immersion, especially where current life still feels broad or shallow: ${cleaned}`);
    }
    if (cluster.familyKey === 'certainty-delay') {
        return formatPatternSentence(`Visible action gets postponed until enough certainty or legitimacy appears, and the delay itself becomes part of the pain: ${cleaned}`);
    }
    if (cluster.familyKey === 'physical-pull') {
        return formatPatternSentence(`Embodied or physical forms of making carry a distinct charge here: ${cleaned}`);
    }
    if (cluster.familyKey === 'missed-window') {
        return formatPatternSentence(`The entry revisits an earlier moment of non-action and asks whether that delay has become a lasting story of missed timing: ${cleaned}`);
    }
    return formatPatternSentence(cleaned);
}
function buildClusterDimensionLines(cluster) {
    const lines = dedupePatternLines(cluster.evidenceByEntry
        .filter((item) => evidenceBelongsToCluster(cluster, item.evidence))
        .map((item, index) => buildThemeDimensionText(cluster, item.evidence, index))
        .filter(Boolean));
    if (lines.length)
        return lines.slice(0, 4);
    return dedupePatternLines(cluster.evidenceByEntry
        .map((item) => formatPatternSentence(item.evidence))
        .filter(Boolean)
        .filter((item) => !evidenceLooksFragmentary(item))).slice(0, 4);
}
function patternHasEnoughThemeEvidence(pattern) {
    if (!pattern.entryIds.length || !pattern.dimensions.length)
        return false;
    if (pattern.dimensions.some((line) => evidenceLooksFragmentary(line)))
        return false;
    if (pattern.entryIds.length === 1) {
        const rawQuoteEvidenceCount = (pattern.supportingEvidence ?? []).filter((item) => item.sourceType === 'raw_quote').length;
        const strongDimensions = dedupePatternLines(pattern.dimensions, pattern.overview).length;
        return rawQuoteEvidenceCount >= 1 && strongDimensions >= 2 && scoreThemeSignal(pattern) >= 14;
    }
    return scoreThemeSignal(pattern) >= 7;
}
function scoreTextSpecificity(text) {
    const clean = normalizeWhitespace(stripMarkdown(cleanTruncatedEnding(text)));
    const words = clean.split(' ').filter(Boolean);
    let score = 0;
    if (words.length >= 8 && words.length <= 30)
        score += 2;
    if (/[.!?]$/.test(clean))
        score += 1;
    if (/\b(i want|i need|i feel|you want|you need|you feel|because|but|rather than|instead of)\b/i.test(clean))
        score += 1;
    if (/\b(dani|yoni|elie|family|shipping|output|alignment|attunement|authorization|surrender|collaborators?)\b/i.test(clean)) {
        score += 1;
    }
    if (/\b(?:this theme|the journal|the entry|recent evidence|example)\b/i.test(clean))
        score -= 1;
    return score;
}
function scoreThemeCoherence(title, overview, dimensions) {
    const anchor = `${title} ${overview}`.trim();
    const anchorScores = dimensions
        .map((dimension) => semanticSimilarity(anchor, dimension))
        .filter((score) => score > 0);
    const averageAnchorScore = anchorScores.length
        ? anchorScores.reduce((sum, score) => sum + score, 0) / anchorScores.length
        : 0;
    const pairScores = [];
    dimensions.forEach((left, leftIndex) => {
        dimensions.slice(leftIndex + 1).forEach((right) => {
            const score = semanticSimilarity(left, right);
            if (score > 0)
                pairScores.push(score);
        });
    });
    const averagePairScore = pairScores.length
        ? pairScores.reduce((sum, score) => sum + score, 0) / pairScores.length
        : 0;
    const coherence = Math.max(averageAnchorScore, averagePairScore);
    if (coherence >= 0.45)
        return 5;
    if (coherence >= 0.3)
        return 3;
    if (coherence >= 0.18)
        return 1;
    return 0;
}
function scoreThemeCharge(text) {
    const clean = normalizeWhitespace(stripMarkdown(cleanTruncatedEnding(text)));
    let score = 0;
    if (/\b(want|need|desire|longing|mission|meaning|alignment|surrender|attunement|love|family|build|ship|create|ask)\b/i.test(clean)) {
        score += 2;
    }
    if (/\b(fear|shame|jealous|regret|stuck|avoid|defense|prove|permission|imposter|risk|uncertain|tension)\b/i.test(clean)) {
        score += 2;
    }
    if (/\b(decision|question|what would|how to|test|move|toward|change|cost)\b/i.test(clean)) {
        score += 1;
    }
    return score;
}
function scoreQuestionUsefulness(questions) {
    return questions.reduce((sum, question) => {
        let score = 0;
        if (/\bwhat|how|where\b/i.test(question))
            score += 1;
        if (/\btest|move|shift|require|reveal|cost|different|concrete\b/i.test(question))
            score += 1;
        if (!/what keeps this theme in place right now|what concrete move would test a different way/i.test(question)) {
            score += 1;
        }
        return sum + score;
    }, 0);
}
function scoreThemeStatus(status) {
    return status === 'deepening' ? 2 : status === 'active' ? 1 : 0;
}
function scoreThemeSignal(pattern) {
    const distinctDimensions = dedupePatternLines(pattern.dimensions, pattern.overview);
    const entryCount = pattern.entryIds.length;
    const dimensionScore = distinctDimensions.reduce((sum, dimension) => sum + scoreTextSpecificity(dimension), 0);
    const titleScore = titleQualityScore(pattern.title);
    const recurrenceScore = entryCount >= 5 ? 8 :
        entryCount >= 3 ? 5 :
            entryCount === 2 ? 3 :
                1;
    const evidenceBreadthScore = distinctDimensions.length >= 3 ? 4 :
        distinctDimensions.length === 2 ? 2 :
            0;
    const overviewScore = Math.max(0, scoreTextSpecificity(pattern.overview));
    const coherenceScore = scoreThemeCoherence(pattern.title, pattern.overview, distinctDimensions);
    const chargeScore = Math.min(8, scoreThemeCharge(pattern.overview) +
        distinctDimensions.reduce((sum, dimension) => sum + scoreThemeCharge(dimension), 0));
    const questionScore = Math.min(4, scoreQuestionUsefulness(pattern.questions));
    const singletonPenalty = entryCount === 1 && distinctDimensions.length < 2 ? 2 : 0;
    return (recurrenceScore +
        evidenceBreadthScore +
        dimensionScore +
        titleScore +
        overviewScore +
        coherenceScore +
        chargeScore +
        questionScore -
        singletonPenalty);
}
function scoreThemeFreshness(pattern) {
    const newestEvidenceAt = (pattern.supportingEvidence ?? [])
        .map((item) => item.createdAt)
        .filter((item) => Boolean(item))
        .sort((left, right) => right.localeCompare(left))[0];
    if (!newestEvidenceAt)
        return 1;
    const ageDays = Math.max(0, (Date.now() - new Date(newestEvidenceAt).getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays <= 2)
        return 10;
    if (ageDays <= 7)
        return 8;
    if (ageDays <= 21)
        return 6;
    if (ageDays <= 60)
        return 4;
    return 2;
}
function scoreThemeWeightFromEvidence(pattern) {
    const evidence = pattern.supportingEvidence ?? [];
    if (!evidence.length) {
        return Math.min(10, scoreThemeCharge(pattern.overview) + pattern.dimensions.reduce((sum, item) => sum + scoreThemeCharge(item), 0));
    }
    const average = evidence.reduce((sum, item) => {
        const confidence = item.confidence ?? 0.6;
        const salience = item.salience ?? 0.6;
        return sum + confidence * salience;
    }, 0) / evidence.length;
    const chargeBoost = Math.min(4, Math.max(0, scoreThemeCharge(pattern.overview)) +
        pattern.dimensions.reduce((sum, item) => sum + Math.max(0, scoreThemeCharge(item)), 0));
    return Math.min(10, Math.round(average * 10 + chargeBoost));
}
function buildThemeRankMetadata(pattern) {
    const overview = sanitizePatternOverviewText(pattern.overview);
    const recurrence = pattern.entryIds.length >= 6 ? 10 :
        pattern.entryIds.length >= 4 ? 8 :
            pattern.entryIds.length >= 2 ? 6 :
                2;
    const coherence = Math.max(2, scoreThemeCoherence(pattern.title, overview, pattern.dimensions) * 2);
    const weight = scoreThemeWeightFromEvidence(pattern);
    const freshness = scoreThemeFreshness(pattern);
    const rankScore = Number((recurrence * 0.34 + coherence * 0.2 + weight * 0.28 + freshness * 0.18).toFixed(2));
    const prominence = rankScore >= 7.6 && pattern.entryIds.length >= 2
        ? 'dominant'
        : pattern.entryIds.length <= 1 || rankScore < 5.4
            ? 'quiet'
            : 'supporting';
    const evidenceCount = pattern.supportingEvidence?.length ?? pattern.entryIds.length;
    const freshestSnippet = pattern.supportingEvidence?.[0]?.snippet;
    const rankRationale = [
        `${pattern.entryIds.length} entr${pattern.entryIds.length === 1 ? 'y' : 'ies'} and ${evidenceCount} supporting thread snippet${evidenceCount === 1 ? '' : 's'}.`,
        `Ranking blend: recurrence ${recurrence}/10, coherence ${coherence}/10, weight ${weight}/10, freshness ${freshness}/10.`,
        freshestSnippet ? `Most recent strong snippet: ${formatPatternSentence(freshestSnippet)}` : '',
    ]
        .filter(Boolean)
        .join(' ');
    const themeSummary = dedupePatternLines([
        pattern.supportingEvidence?.[0]?.claim ?? '',
        pattern.supportingEvidence?.[1]?.claim ?? '',
        pattern.supportingEvidence?.[0]?.whyItMatters ?? '',
    ].filter(Boolean), overview).slice(0, 3);
    const detailNarrative = dedupePatternLines([
        pattern.supportingEvidence?.[0]?.claim ?? '',
        pattern.supportingEvidence?.[1]?.claim ?? '',
        pattern.supportingEvidence?.[0]?.whyItMatters ?? '',
        pattern.supportingEvidence?.[1]?.whyItMatters ?? '',
    ].filter(Boolean), overview).slice(0, 3);
    return {
        ...pattern,
        overview,
        prominence,
        rankScore,
        rankFactors: {
            recurrence,
            coherence,
            weight,
            freshness,
        },
        rankRationale,
        themeSummary,
        detailNarrative,
        changeSummary: pattern.changeSummary ?? [],
    };
}
export function decoratePatternRanking(pattern) {
    return buildThemeRankMetadata(pattern);
}
function buildBriefWhyNow(pattern) {
    const candidate = [
        pattern.changeSummary?.[0] ?? '',
        pattern.detailNarrative?.[0] ?? '',
        pattern.themeSummary?.[0] ?? '',
        pattern.dimensions[0] ?? '',
        pattern.overview,
    ].find((item) => item && item.trim());
    return clipAtWord(sanitizePatternOverviewText(candidate || pattern.overview), 150);
}
function buildBriefPrompt(pattern) {
    const candidate = dedupePatternLines([
        ...(pattern.questions ?? []),
        ...(pattern.exploreOptions ?? []),
    ], pattern.overview)[0];
    if (candidate) {
        return clipAtWord(cleanTruncatedEnding(candidate), 140);
    }
    return pattern.changeSummary?.length
        ? 'What changed recently here?'
        : 'What feels most worth testing here right now?';
}
function patternFamilyKey(pattern) {
    return themeFamilyForText(`${pattern.title} ${pattern.overview} ${(pattern.dimensions ?? []).join(' ')}`)?.key ?? null;
}
function patternRankFactor(pattern, key, fallback) {
    return pattern.rankFactors?.[key] ?? fallback;
}
function scoreBriefDurability(pattern) {
    return (patternRankFactor(pattern, 'recurrence', Math.min(10, pattern.entryCount * 2)) * 0.5 +
        patternRankFactor(pattern, 'weight', 5) * 0.25 +
        patternRankFactor(pattern, 'coherence', 5) * 0.25);
}
function scoreBriefRecency(pattern) {
    return (patternRankFactor(pattern, 'freshness', scoreThemeFreshness(pattern)) * 0.55 +
        patternRankFactor(pattern, 'weight', 5) * 0.2 +
        patternRankFactor(pattern, 'recurrence', Math.min(10, pattern.entryCount * 2)) * 0.15 +
        (pattern.status === 'deepening' ? 1 : pattern.status === 'active' ? 0.4 : 0));
}
function scoreBriefBridge(pattern) {
    return (patternRankFactor(pattern, 'weight', 5) * 0.35 +
        patternRankFactor(pattern, 'coherence', 5) * 0.25 +
        patternRankFactor(pattern, 'recurrence', Math.min(10, pattern.entryCount * 2)) * 0.25 +
        patternRankFactor(pattern, 'freshness', scoreThemeFreshness(pattern)) * 0.15);
}
function pickBriefPattern(patterns, scorer, excludeIds = [], avoidFamilyKeys = []) {
    return [...patterns]
        .filter((pattern) => !excludeIds.includes(pattern.id))
        .sort((left, right) => scorer(right) - scorer(left))
        .find((pattern) => {
        const familyKey = patternFamilyKey(pattern);
        return !familyKey || !avoidFamilyKeys.includes(familyKey);
    }) ?? null;
}
function buildStateOfAffairsLine(pattern) {
    const familyKey = patternFamilyKey(pattern);
    if (familyKey === 'outward-proof') {
        return 'You keep checking other people\'s desire, attention, or status for proof that your own desire is legitimate';
    }
    if (familyKey === 'output-anchor') {
        return 'Making something concrete is carrying more than productivity here; it is tied to whether the day feels real or merely consumed';
    }
    if (familyKey === 'collaboration-threshold') {
        return 'The next stretch seems less about pushing harder alone and more about finding the right collaborator, structure, or shared ownership';
    }
    if (familyKey === 'depth-craft') {
        return 'Broad motion still seems to be competing with a stronger wish for depth, craft, and sustained immersion';
    }
    if (familyKey === 'certainty-delay') {
        return 'Visible movement still waits for more certainty than the situation can probably provide in advance';
    }
    if (familyKey === 'self-authorization') {
        return 'Naming what you want still seems tangled up with needing to feel justified, capable, or allowed first';
    }
    if (familyKey === 'family-mission') {
        return 'Family is showing up less as a someday wish and more as a direction that could organize present-day choices';
    }
    if (familyKey === 'alignment-drift') {
        return 'You seem to be measuring life against a more aligned way of living and noticing the gap with unusual clarity';
    }
    if (familyKey === 'relationship-attunement') {
        return 'Generic closeness does not seem sufficient; you want something more specifically felt, expressive, and attuned';
    }
    if (familyKey === 'physical-pull') {
        return 'There is a real pull toward more embodied or physical forms of making, not just more thinking';
    }
    if (familyKey === 'missed-window') {
        return 'Some energy is still caught in older timing decisions and what they seem to say about your life now';
    }
    return clipAtWord(lowerCaseFirst(buildBriefWhyNow(pattern)), 150);
}
function buildRecentStateLine(pattern) {
    const familyKey = patternFamilyKey(pattern);
    const recentSignal = pattern.changeSummary?.[0] ?? buildBriefWhyNow(pattern);
    if (familyKey === 'outward-proof') {
        return 'Recent entries keep returning to the problem of borrowed conviction, where desire still feels easiest to trust after some outside signal appears';
    }
    if (familyKey === 'output-anchor') {
        return 'Recently, the journal keeps tying output to whether time felt real, which makes shipping feel emotionally heavier than ordinary productivity';
    }
    if (familyKey === 'collaboration-threshold') {
        return 'Recent movement points less toward solo effort and more toward the question of what kind of collaborator or structure would change what is possible';
    }
    if (familyKey === 'depth-craft') {
        return 'Lately, the gap between broad motion and deeper craft seems especially alive, not just as an idea but as a felt dissatisfaction with shallower modes';
    }
    if (familyKey === 'certainty-delay') {
        return 'Recent entries suggest the cost of waiting for certainty is becoming easier to see in real time, not only in retrospect';
    }
    return clipAtWord(recentSignal, 160);
}
function buildLifeLevelInteraction(patterns) {
    const lead = patterns[0];
    const second = patterns[1];
    if (!lead)
        return '';
    if (!second)
        return '';
    const leadKey = patternFamilyKey(lead);
    const secondKey = patternFamilyKey(second);
    const pair = `${leadKey}|${secondKey}`;
    if (pair === 'output-anchor|certainty-delay' || pair === 'certainty-delay|output-anchor') {
        return 'You want days to feel real through concrete movement, but visible movement keeps waiting for more certainty first';
    }
    if (pair === 'outward-proof|certainty-delay' || pair === 'certainty-delay|outward-proof') {
        return 'Borrowed conviction and waiting for certainty are reinforcing each other, so action keeps getting postponed until the path feels externally confirmed';
    }
    if (pair === 'outward-proof|self-authorization' || pair === 'self-authorization|outward-proof') {
        return 'External proof and internal permission are feeding the same loop, where desire feels hardest to trust without some outside signal';
    }
    if (pair === 'depth-craft|output-anchor' || pair === 'output-anchor|depth-craft') {
        return 'There is a real pull toward shipping and visible output, but also a refusal to let shallow production masquerade as deeper craft';
    }
    if (pair === 'collaboration-threshold|output-anchor' || pair === 'output-anchor|collaboration-threshold') {
        return 'The wish to make something real is colliding with a live question about who else would make the work larger, stronger, or more sustainable';
    }
    if (pair === 'family-mission|alignment-drift' || pair === 'alignment-drift|family-mission') {
        return 'Family is showing up less as an abstract future wish and more as an organizing direction, while the journal keeps testing how to build toward it without losing alignment';
    }
    return '';
}
function buildExpandedBriefOverview(durablePattern, recentPattern, bridgePattern) {
    const interactionLine = buildLifeLevelInteraction([durablePattern, recentPattern].filter((pattern) => Boolean(pattern)));
    const firstParagraph = dedupePatternLines([
        interactionLine,
        recentPattern ? buildRecentStateLine(recentPattern) : '',
        durablePattern && durablePattern.id !== recentPattern?.id ? buildStateOfAffairsLine(durablePattern) : '',
    ])
        .slice(0, interactionLine ? 2 : 3)
        .map((line) => formatPatternSentence(line))
        .join(' ');
    const secondParagraph = dedupePatternLines([
        bridgePattern ? buildStateOfAffairsLine(bridgePattern) : '',
        bridgePattern?.changeSummary?.[0] ?? '',
        recentPattern?.changeSummary?.[0] ?? '',
        recentPattern?.supportingEvidence?.[0]?.whyItMatters ?? '',
    ], firstParagraph)
        .slice(0, 2)
        .map((line) => formatPatternSentence(line))
        .join(' ');
    const paragraphs = [firstParagraph, secondParagraph].filter(Boolean);
    if (!paragraphs.length)
        return null;
    return {
        paragraphs,
    };
}
function recentEntryScore(index) {
    return Math.max(0.3, 1.4 - index * 0.18);
}
function buildCurrentFrontSummary(entries, lines) {
    const summary = dedupePatternLines(lines).slice(0, 2).join(' ');
    return clipAtWord(summary, 190);
}
function buildCurrentFronts(entries, patterns) {
    const recentEntries = [...entries]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 8);
    if (!recentEntries.length)
        return [];
    const specs = [
        {
            id: 'relationship',
            title: 'Relationship / attunement',
            keywords: ['relationship', 'love', 'partner', 'attunement', 'dani', 'eve', 'romance', 'dating', 'closeness'],
            summary: (items) => buildCurrentFrontSummary(items, [
                'Recent entries keep returning to relationship as a live front, especially around whether closeness feels specific, expressive, and genuinely attuned.',
                items[0]?.summary ?? '',
            ]),
        },
        {
            id: 'home',
            title: 'Apartment / place decision',
            keywords: ['apartment', 'move', 'moving', 'lease', 'home', 'nordau', 'israel', 'stay', 'leave', 'place', 'relocate'],
            summary: (items) => buildCurrentFrontSummary(items, [
                'The apartment / place decision looks actively live, with recent entries treating it as a real near-term choice rather than background logistics.',
                items[0]?.summary ?? '',
            ]),
        },
        {
            id: 'collaboration',
            title: 'Collaboration / reach-outs',
            keywords: ['collabor', 'partner', 'who not how', 'hire', 'team', 'reach out', 'shared ownership', 'elie', 'toby'],
            summary: (items) => buildCurrentFrontSummary(items, [
                'Collaboration is showing up as a current front, not just a general idea, especially around who to involve and what contact has not happened yet.',
                items[0]?.summary ?? '',
            ]),
        },
        {
            id: 'work-direction',
            title: 'Work direction / output',
            keywords: ['work', 'project', 'business', 'build', 'ship', 'output', 'studio', 'deck', 'creation'],
            summary: (items) => buildCurrentFrontSummary(items, [
                'Work direction still looks live, especially where output, direction, and what to actually build are getting tested against each other.',
                items[0]?.summary ?? '',
            ]),
        },
        {
            id: 'family',
            title: 'Family / future life',
            keywords: ['family', 'kids', 'marriage', 'wife', 'husband', 'future family'],
            summary: (items) => buildCurrentFrontSummary(items, [
                'Family is not just a distant idea here; recent entries treat it more like a live reference point for present choices.',
                items[0]?.summary ?? '',
            ]),
        },
    ];
    const fronts = specs
        .map((spec) => {
        const matchedEntries = recentEntries.filter((entry) => {
            const haystack = normalizeWhitespace(`${entry.title} ${entry.summary} ${entry.rawText}`).toLowerCase();
            return spec.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
        });
        if (!matchedEntries.length)
            return null;
        const score = matchedEntries.reduce((total, entry) => {
            const recentIndex = recentEntries.findIndex((candidate) => candidate.id === entry.id);
            return total + recentEntryScore(recentIndex);
        }, 0);
        return {
            spec,
            matchedEntries,
            score,
        };
    })
        .filter((item) => Boolean(item))
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map(({ spec, matchedEntries }) => ({
        id: spec.id,
        title: spec.title,
        summary: spec.summary(matchedEntries),
        entryIds: matchedEntries.map((entry) => entry.id),
        updatedAt: matchedEntries[0]?.createdAt ?? new Date().toISOString(),
    }));
    const relationshipPattern = patterns.find((pattern) => patternFamilyKey(pattern) === 'relationship-attunement');
    if (relationshipPattern && !fronts.some((front) => front.id === 'relationship')) {
        fronts.push({
            id: 'relationship',
            title: 'Relationship / attunement',
            summary: clipAtWord(relationshipPattern.changeSummary?.[0] ||
                relationshipPattern.overview ||
                'Relationship seems live right now, especially around whether closeness feels deeply attuned rather than merely available.', 190),
            entryIds: relationshipPattern.entryIds,
            updatedAt: relationshipPattern.updatedAt,
        });
    }
    return fronts
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, 3);
}
export function buildPatternsBrief(patterns, entries = []) {
    if (!patterns.length)
        return null;
    const sorted = [...patterns].sort(compareThemePriority);
    const surfacedPatterns = sorted.filter((pattern) => pattern.prominence !== 'quiet');
    const candidatePatterns = surfacedPatterns.length ? surfacedPatterns : sorted.slice(0, 5);
    if (!candidatePatterns.length)
        return null;
    const currentFronts = buildCurrentFronts(entries, sorted);
    const durablePattern = pickBriefPattern(candidatePatterns, scoreBriefDurability);
    const recentPattern = pickBriefPattern(candidatePatterns, scoreBriefRecency, durablePattern ? [durablePattern.id] : [], durablePattern ? [patternFamilyKey(durablePattern) ?? ''] : []) ?? durablePattern;
    const bridgePattern = pickBriefPattern(candidatePatterns, scoreBriefBridge, [durablePattern?.id, recentPattern?.id].filter((item) => Boolean(item)), [patternFamilyKey(durablePattern ?? candidatePatterns[0]) ?? '', patternFamilyKey(recentPattern ?? candidatePatterns[0]) ?? ''].filter(Boolean)) ?? pickBriefPattern(candidatePatterns, scoreBriefDurability, [durablePattern?.id, recentPattern?.id].filter((item) => Boolean(item)));
    const sourcePatterns = [durablePattern, recentPattern, bridgePattern].filter((pattern) => Boolean(pattern));
    const prompts = sourcePatterns
        .map((pattern) => ({
        patternId: pattern.id,
        text: buildBriefPrompt(pattern),
    }))
        .filter((prompt, index, items) => items.findIndex((candidate) => normalizeWhitespace(candidate.text).toLowerCase() === normalizeWhitespace(prompt.text).toLowerCase()) === index)
        .slice(0, 1);
    const rawBullets = [
        {
            kind: 'durable',
            text: durablePattern ? buildStateOfAffairsLine(durablePattern) : '',
        },
        {
            kind: 'recent',
            text: recentPattern ? buildRecentStateLine(recentPattern) : '',
        },
        {
            kind: 'next',
            text: buildLifeLevelInteraction([durablePattern, recentPattern].filter((pattern) => Boolean(pattern))) ||
                (bridgePattern ? buildStateOfAffairsLine(bridgePattern) : ''),
        },
    ];
    const dedupedTexts = dedupePatternLines(rawBullets.map((bullet) => bullet.text)).slice(0, 3);
    const bullets = dedupedTexts.map((text) => rawBullets.find((bullet) => bullet.text === text) ?? {
        kind: 'durable',
        text,
    });
    const prompt = prompts[0] ?? null;
    const expandedOverview = buildExpandedBriefOverview(durablePattern, recentPattern, bridgePattern);
    return {
        title: 'State of affairs',
        currentFronts,
        bullets,
        expandedOverview: expandedOverview ?? {
            paragraphs: dedupePatternLines(bullets.map((bullet) => bullet.text))
                .slice(0, 2)
                .map((line) => formatPatternSentence(line)),
        },
        prompt,
    };
}
function compareThemePriority(left, right) {
    const rightScore = ('rankScore' in right && right.rankScore ? right.rankScore * 3 : scoreThemeSignal(right)) +
        scoreThemeStatus('status' in right ? right.status : undefined);
    const leftScore = ('rankScore' in left && left.rankScore ? left.rankScore * 3 : scoreThemeSignal(left)) +
        scoreThemeStatus('status' in left ? left.status : undefined);
    if (rightScore !== leftScore)
        return rightScore - leftScore;
    const rightCount = right.entryIds.length;
    const leftCount = left.entryIds.length;
    if (rightCount !== leftCount)
        return rightCount - leftCount;
    return left.title.localeCompare(right.title);
}
function themeTokenSet(title) {
    return new Set(normalizePatternTitle(title)
        .split(' ')
        .filter((token) => token.length > 2)
        .filter((token) => !['how', 'and', 'with', 'from', 'into', 'your', 'that', 'this'].includes(token)));
}
function themeTitleSimilarity(left, right) {
    const leftTokens = themeTokenSet(left);
    const rightTokens = themeTokenSet(right);
    if (!leftTokens.size || !rightTokens.size)
        return 0;
    let shared = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token))
            shared += 1;
    }
    return shared / Math.max(leftTokens.size, rightTokens.size);
}
function buildLocalThemeCandidates(entries) {
    const candidates = [];
    for (const entry of entries) {
        const entryThreads = buildEntryThreads(entry);
        const familyBuckets = new Map();
        const uncategorized = [];
        for (const thread of entryThreads) {
            const family = themeFamilyForText(`${thread.label} ${thread.claim} ${thread.snippets.map((item) => item.text).join(' ')}`);
            if (!family) {
                uncategorized.push(thread);
                continue;
            }
            const existing = familyBuckets.get(family.key);
            if (!existing || thread.salience * thread.confidence > existing.salience * existing.confidence) {
                familyBuckets.set(family.key, {
                    ...thread,
                    label: family.title,
                });
            }
        }
        const distinctUncategorized = uncategorized.filter((thread, index) => uncategorized.findIndex((other) => normalizePatternTitle(other.label) === normalizePatternTitle(thread.label) ||
            semanticSimilarity(`${other.label} ${other.claim}`, `${thread.label} ${thread.claim}`) >= 0.72) === index);
        for (const thread of [...familyBuckets.values(), ...distinctUncategorized.slice(0, 5)]) {
            const evidenceSnippet = thread.snippets[0];
            const evidence = evidenceSnippet?.text ?? thread.claim;
            if (!thread.label || !evidence || evidenceLooksFragmentary(evidence))
                continue;
            if (!themeCandidateIsSelfConsistent(thread.label, evidence))
                continue;
            const family = themeFamilyForText(`${thread.label} ${thread.claim} ${evidence}`);
            candidates.push({
                title: family?.title ?? thread.label,
                entryId: thread.entryId,
                entryTitle: thread.entryTitle,
                evidence,
                sourceType: evidenceSnippet?.sourceType ?? 'summary_fallback',
                sectionTitle: evidenceSnippet?.sectionTitle,
                claim: thread.claim,
                whyItMatters: thread.whyItMatters,
                createdAt: thread.createdAt,
                confidence: thread.confidence,
                salience: thread.salience,
                tags: thread.tags,
                weight: Math.max(2, Math.round(thread.confidence * thread.salience * 10)),
                familyKey: family?.key,
            });
        }
    }
    return candidates;
}
function buildPatternClusters(entries) {
    const localCandidates = buildLocalThemeCandidates(entries);
    const clusters = [];
    for (const candidate of localCandidates) {
        const existing = clusters.find((cluster) => {
            if (cluster.familyKey || candidate.familyKey) {
                return cluster.familyKey === candidate.familyKey;
            }
            if (candidate.familyKey && cluster.familyKey === candidate.familyKey)
                return true;
            const sameTitle = normalizePatternTitle(cluster.title) === normalizePatternTitle(candidate.title);
            const titleSimilar = themeTitleSimilarity(cluster.title, candidate.title) >= 0.78 ||
                semanticSimilarity(cluster.title, candidate.title) >= 0.78;
            return sameTitle || titleSimilar;
        });
        if (!existing) {
            clusters.push({
                title: candidate.title,
                titleWeights: new Map([[candidate.title, candidate.weight]]),
                familyKey: candidate.familyKey,
                entryIds: new Set([candidate.entryId]),
                evidenceByEntry: new Map([[candidate.entryId, [{
                                entryTitle: candidate.entryTitle,
                                evidence: candidate.evidence,
                                sourceType: candidate.sourceType,
                                sectionTitle: candidate.sectionTitle,
                                claim: candidate.claim,
                                whyItMatters: candidate.whyItMatters,
                                weight: candidate.weight,
                                confidence: candidate.confidence,
                                salience: candidate.salience,
                                tags: candidate.tags,
                                createdAt: candidate.createdAt,
                            }]]]),
                createdAt: candidate.createdAt,
                totalWeight: candidate.weight,
            });
            continue;
        }
        existing.entryIds.add(candidate.entryId);
        existing.totalWeight += candidate.weight;
        existing.familyKey = existing.familyKey ?? candidate.familyKey;
        existing.titleWeights.set(candidate.title, (existing.titleWeights.get(candidate.title) ?? 0) + candidate.weight);
        existing.title = chooseBestClusterTitle(existing);
        const entryEvidence = existing.evidenceByEntry.get(candidate.entryId) ?? [];
        if (!entryEvidence.some((item) => normalizePatternTitle(item.evidence) === normalizePatternTitle(candidate.evidence))) {
            entryEvidence.push({
                entryTitle: candidate.entryTitle,
                evidence: candidate.evidence,
                sourceType: candidate.sourceType,
                sectionTitle: candidate.sectionTitle,
                claim: candidate.claim,
                whyItMatters: candidate.whyItMatters,
                weight: candidate.weight,
                confidence: candidate.confidence,
                salience: candidate.salience,
                tags: candidate.tags,
                createdAt: candidate.createdAt,
            });
            existing.evidenceByEntry.set(candidate.entryId, entryEvidence);
        }
        if (candidate.createdAt > existing.createdAt) {
            existing.createdAt = candidate.createdAt;
        }
    }
    const scoredClusters = clusters
        .filter((cluster) => cluster.entryIds.size > 0)
        .sort((left, right) => {
        const rightScore = right.entryIds.size * 100 + right.totalWeight * 4;
        const leftScore = left.entryIds.size * 100 + left.totalWeight * 4;
        if (rightScore !== leftScore)
            return rightScore - leftScore;
        return right.createdAt.localeCompare(left.createdAt);
    });
    const recurringClusters = scoredClusters.filter((cluster) => cluster.entryIds.size >= 2);
    const singletonClusters = scoredClusters.filter((cluster) => cluster.entryIds.size === 1);
    const singletonBudget = Math.min(10, Math.max(4, Math.ceil(recurringClusters.length * 0.6)));
    const selectedClusters = [
        ...recurringClusters.slice(0, 20),
        ...singletonClusters.slice(0, singletonBudget),
    ].slice(0, 24);
    return selectedClusters.map((cluster, index) => {
        const evidenceByEntry = [...cluster.evidenceByEntry.entries()]
            .flatMap(([entryId, evidenceItems]) => evidenceItems
            .sort((left, right) => (right.weight + right.salience + right.confidence) - (left.weight + left.salience + left.confidence))
            .slice(0, 2)
            .flatMap((item) => {
            const evidence = cleanTruncatedEnding(item.evidence);
            if (evidenceLooksFragmentary(evidence))
                return [];
            return [{
                    entryId,
                    entryTitle: item.entryTitle || 'Untitled entry',
                    evidence,
                    sourceType: item.sourceType,
                    sectionTitle: item.sectionTitle,
                    claim: cleanTruncatedEnding(item.claim),
                    whyItMatters: cleanTruncatedEnding(item.whyItMatters),
                    weight: item.weight,
                    confidence: item.confidence,
                    salience: item.salience,
                    tags: item.tags,
                    createdAt: item.createdAt,
                }];
        }))
            .sort((left, right) => (right.weight + right.salience + right.confidence) - (left.weight + left.salience + left.confidence));
        return {
            clusterId: `cluster-${index + 1}`,
            title: chooseBestClusterTitle(cluster),
            familyKey: cluster.familyKey,
            entryIds: [...cluster.entryIds],
            evidenceByEntry,
            totalWeight: cluster.totalWeight,
            createdAt: cluster.createdAt,
        };
    });
}
function evidenceBelongsToCluster(cluster, evidence) {
    if (!cluster.familyKey)
        return true;
    const family = THEME_FAMILIES.find((item) => item.key === cluster.familyKey);
    return family ? family.test.test(evidence) : true;
}
function supportingEvidencePriority(item) {
    const sourceScore = item.sourceType === 'raw_quote' ? 4 :
        item.sourceType === 'analysis_quote' ? 2 :
            1;
    return sourceScore + (item.confidence ?? 0.6) + (item.salience ?? 0.6);
}
function selectSupportingEvidenceRows(items, maxItems = 8) {
    const selected = [];
    const usedEntryIds = new Set();
    for (const item of [...items].sort((left, right) => supportingEvidencePriority(right) - supportingEvidencePriority(left))) {
        if (!item.snippet || evidenceLooksFragmentary(item.snippet))
            continue;
        if (usedEntryIds.has(item.entryId))
            continue;
        if (selected.some((existing) => textOverlapScore(existing.snippet, item.snippet) >= 0.72))
            continue;
        selected.push(item);
        usedEntryIds.add(item.entryId);
        if (selected.length >= maxItems)
            break;
    }
    if (selected.length)
        return selected;
    return [...items]
        .sort((left, right) => supportingEvidencePriority(right) - supportingEvidencePriority(left))
        .slice(0, maxItems);
}
function buildDeterministicPatternFromCluster(cluster) {
    const evidence = buildClusterDimensionLines(cluster);
    return buildThemeRankMetadata({
        title: cluster.title,
        overview: buildOverviewFromCluster(cluster.title, cluster.entryIds.length, cluster.familyKey, evidence),
        dimensions: evidence,
        questions: buildQuestionsForTheme(cluster.title),
        exploreOptions: [
            `Trace how ${cluster.title.toLowerCase()} evolves across entries`,
            `Find the cost of ${cluster.title.toLowerCase()}`,
            `Look for the next concrete move inside ${cluster.title.toLowerCase()}`,
        ].map((item) => cleanTruncatedEnding(item)).slice(0, 3),
        supportingEvidence: selectSupportingEvidenceRows(cluster.evidenceByEntry
            .filter((item) => evidenceBelongsToCluster(cluster, item.evidence))
            .map((item) => ({
            entryId: item.entryId,
            entryTitle: item.entryTitle,
            snippet: cleanTruncatedEnding(item.evidence),
            sourceType: item.sourceType,
            sectionTitle: item.sectionTitle,
            threadLabel: cluster.title,
            claim: cleanTruncatedEnding(item.claim),
            whyItMatters: cleanTruncatedEnding(item.whyItMatters),
            confidence: item.confidence,
            salience: item.salience,
            tags: item.tags,
            createdAt: item.createdAt,
        }))
            .filter((item) => item.snippet && !evidenceLooksFragmentary(item.snippet)), 8),
        entryIds: cluster.entryIds,
    });
}
function buildQuestionsForTheme(title) {
    const family = themeFamilyForText(title);
    if (family) {
        return family.questions;
    }
    const lower = title.toLowerCase();
    if (/permission|certainty|proof|validation|qualified|admir/.test(lower)) {
        return [
            'What would this look like if outside proof were not required first?',
            'Which concrete move would test your own authority here?',
        ];
    }
    if (/alignment|mission|meaning|family/.test(lower)) {
        return [
            'What would living this theme more fully require in practice?',
            'Where are your stated values and daily behavior still diverging?',
        ];
    }
    if (/relationship|dani|love/.test(lower)) {
        return [
            'What is this theme revealing about what you actually need from closeness?',
            'What pattern keeps you adjusting to less than that?',
        ];
    }
    return [
        'What keeps this theme in place right now?',
        'What concrete move would test a different way of operating here?',
    ];
}
function buildDeterministicPatterns(entries, previousPatterns) {
    const deterministic = buildPatternClusters(entries)
        .map((cluster) => buildDeterministicPatternFromCluster(cluster))
        .filter((pattern) => patternHasEnoughThemeEvidence(pattern));
    return reconcilePatterns(previousPatterns, dedupeAndRefinePatterns(deterministic))
        .sort(compareThemePriority)
        .slice(0, 24);
}
function patternsLookWeak(patterns, entriesCount) {
    if (!patterns.length)
        return true;
    if (entriesCount >= 10 && patterns.length <= 4)
        return true;
    const singletonCount = patterns.filter((pattern) => pattern.entryCount <= 1).length;
    if (patterns.length >= 5 && singletonCount / patterns.length >= 0.6)
        return true;
    if (patterns.every((pattern) => pattern.status === 'emerging'))
        return true;
    const genericQuestionCount = patterns.filter((pattern) => pattern.questions.every((question) => /what keeps this theme in place right now|what concrete move would test a different way of operating here/i.test(question))).length;
    if (patterns.length >= 5 && genericQuestionCount / patterns.length >= 0.6)
        return true;
    if (patterns.some((pattern) => scoreThemeSignal(pattern) < 7))
        return true;
    return patterns.some((pattern) => /^this theme (?:shows up across|is emerging around)/i.test(pattern.overview) ||
        looksTruncatedPatternText(pattern.title) ||
        looksTruncatedPatternText(pattern.overview) ||
        pattern.dimensions.some(looksTruncatedPatternText));
}
function looksTruncatedPatternText(text) {
    const clean = text.trim();
    const words = normalizeWhitespace(stripMarkdown(clean)).split(' ').filter(Boolean);
    const lastWord = words[words.length - 1] ?? '';
    return (/(?:\.{3,}|…)\s*$/.test(clean) ||
        /\b(?:and|as|at|because|but|for|from|if|in|into|of|on|or|rather|so|than|that|the|to|versus|while|with|without)\s*$/i.test(clean) ||
        (/^[a-z]{2,4}$/.test(lastWord) && !['want', 'need', 'work', 'love', 'team', 'ship', 'real', 'path', 'life'].includes(lastWord)) ||
        (/^[A-Za-z]/.test(clean) && !/[.!?"]$/.test(clean) && clean.length > 80));
}
function patternTextLooksPlaceholder(text) {
    return (!text.trim() ||
        /^this theme\b/i.test(text.trim()) ||
        /\bkeeps showing up across \d+ entr/i.test(text) ||
        /\bis emerging around\b/i.test(text) ||
        /\bis present in this entry, but the underlying shape is still emerging\b/i.test(text) ||
        /\bkeeps recurring across \d+ entries, but the underlying shape is still emerging\b/i.test(text));
}
function enrichedPatternLooksWeak(pattern) {
    if (patternTextLooksPlaceholder(pattern.overview))
        return true;
    if (looksTruncatedPatternText(pattern.title) || looksTruncatedPatternText(pattern.overview))
        return true;
    if (pattern.dimensions.length < 1)
        return true;
    if (pattern.questions.length < 1)
        return true;
    if (pattern.dimensions.some((item) => looksTruncatedPatternText(item) || patternTextLooksPlaceholder(item)))
        return true;
    if (pattern.questions.some((item) => looksTruncatedPatternText(item)))
        return true;
    return false;
}
function stripPatternIdentity(pattern) {
    return {
        title: pattern.title,
        overview: pattern.overview,
        prominence: pattern.prominence,
        dimensions: pattern.dimensions,
        questions: pattern.questions,
        exploreOptions: pattern.exploreOptions,
        supportingEvidence: pattern.supportingEvidence,
        rankScore: pattern.rankScore,
        rankFactors: pattern.rankFactors,
        rankRationale: pattern.rankRationale,
        themeSummary: pattern.themeSummary,
        detailNarrative: pattern.detailNarrative,
        changeSummary: pattern.changeSummary,
        entryIds: pattern.entryIds,
    };
}
function patternsReferToSameTheme(left, right) {
    return (normalizePatternTitle(left.title) === normalizePatternTitle(right.title) ||
        themeTitleSimilarity(left.title, right.title) >= 0.62 ||
        semanticSimilarity(`${left.title} ${left.overview}`, `${right.title} ${right.overview}`) >= 0.72);
}
function mergeEnrichedWithFallbackPatterns(enrichedPatterns, fallbackPatterns) {
    const merged = [...enrichedPatterns];
    for (const fallback of fallbackPatterns.map((pattern) => stripPatternIdentity(pattern))) {
        const duplicateIndex = merged.findIndex((pattern) => patternsReferToSameTheme(pattern, fallback));
        if (duplicateIndex === -1) {
            merged.push(fallback);
            continue;
        }
        const existing = merged[duplicateIndex];
        if (scoreThemeSignal(fallback) > scoreThemeSignal(existing)) {
            merged[duplicateIndex] = {
                ...fallback,
                title: existing.title,
                questions: dedupePatternLines(existing.questions, fallback.questions.join('\n')).length
                    ? existing.questions
                    : fallback.questions,
                exploreOptions: dedupePatternLines([...existing.exploreOptions, ...fallback.exploreOptions]).slice(0, 3),
                supportingEvidence: fallback.supportingEvidence?.length
                    ? fallback.supportingEvidence
                    : existing.supportingEvidence,
            };
        }
        else if (fallback.entryIds.length > existing.entryIds.length) {
            merged[duplicateIndex] = {
                ...existing,
                entryIds: [...new Set([...existing.entryIds, ...fallback.entryIds])],
                supportingEvidence: existing.supportingEvidence?.length
                    ? existing.supportingEvidence
                    : fallback.supportingEvidence,
            };
        }
    }
    return dedupeAndRefinePatterns(merged).map((pattern) => buildThemeRankMetadata(pattern)).sort(compareThemePriority);
}
function matchEnrichedCluster(cluster, parsed, fallbackIndex) {
    return (parsed.find((item) => item.clusterId === cluster.clusterId) ??
        parsed.find((item) => item.title && normalizePatternTitle(item.title) === normalizePatternTitle(cluster.title)) ??
        parsed.find((item) => item.title && semanticSimilarity(item.title, cluster.title) >= 0.72) ??
        parsed[fallbackIndex] ??
        null);
}
function describeThemeChange(previousPattern, nextPattern) {
    if (!previousPattern) {
        return [
            'This is a newly surfaced theme in the current journal window.',
            nextPattern.supportingEvidence?.[0]?.snippet
                ? `It appears because a recent entry named it directly: ${formatPatternSentence(nextPattern.supportingEvidence[0].snippet)}`
                : '',
        ].filter(Boolean);
    }
    const previousEntries = new Set(previousPattern.entryIds);
    const newEntryIds = nextPattern.entryIds.filter((entryId) => !previousEntries.has(entryId));
    const previousEvidence = new Set((previousPattern.supportingEvidence ?? []).map((item) => normalizePatternTitle(item.snippet)));
    const freshEvidence = (nextPattern.supportingEvidence ?? []).filter((item) => !previousEvidence.has(normalizePatternTitle(item.snippet)));
    const notes = [];
    if (newEntryIds.length >= 2) {
        notes.push(`Support broadened into ${newEntryIds.length} new entries since the last refresh.`);
    }
    else if (newEntryIds.length === 1) {
        notes.push('A new entry reinforced this theme since the last refresh.');
    }
    else {
        notes.push('This theme is still holding across the same core set of entries.');
    }
    if (previousPattern.prominence !== nextPattern.prominence && nextPattern.prominence) {
        if (previousPattern.prominence === 'quiet' && nextPattern.prominence !== 'quiet') {
            notes.push('It has moved out of the background and is carrying more of the current map.');
        }
        else if (previousPattern.prominence !== 'quiet' && nextPattern.prominence === 'quiet') {
            notes.push('It is still real, but it is carrying less of the current dashboard than before.');
        }
    }
    if (freshEvidence[0]?.snippet) {
        notes.push(`Newest support: ${formatPatternSentence(freshEvidence[0].snippet)}`);
    }
    return notes.filter(Boolean).slice(0, 3);
}
async function enrichPatternClustersWithModel(memoryDoc, entries, previousPatterns, clusters) {
    if (!anthropic || !clusters.length)
        return null;
    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
    const prompt = `Turn these pre-grouped journal clusters into the final theme map.
Return JSON only:
[
  {
    "clusterId": "cluster id from input",
    "title": "theme title",
    "overview": "1 to 2 sentence state of affairs",
    "dimensions": ["distinct concrete way the theme shows up"],
    "questions": ["genuinely open question worth testing"],
    "exploreOptions": ["one useful way to explore the theme"]
  }
]

Critical rules:
- The clusters are already grouped. Do not merge clusters together. Do not split clusters apart.
- Preserve every input clusterId exactly.
- Use only the supporting entries attached to each cluster.
- The overview should explain the mechanism and why it matters now.
- Do not start overview with "This theme..." or "${'${title}'} keeps showing up..."
- Dimensions should be distinct from one another and grounded in the evidence lines.
- Dimensions should read like coherent observations, not pasted fragments from the journal.
- Questions should be specific to the cluster, not generic placeholders.
- Keep everything in plain English.
- Keep title to 2 to 6 words when possible.
- No ellipses. No cut-off text. Use complete sentences.
- Do not mention the number of entries unless it materially helps.
- Do not recycle the same sentence across overview, dimensions, and questions.

Memory:
${memoryForPrompt(memoryDoc, 1400)}

Recent entries:
${patternEntriesForPrompt(entries, 18)}

Existing themes for continuity:
${previousPatternsForPrompt(previousPatterns)}

Clusters:
${clusters
        .map((cluster) => {
        const evidenceLines = cluster.evidenceByEntry
            .slice(0, 8)
            .map((item) => {
            const entry = entryMap.get(item.entryId);
            return `  - ${item.entryId} | ${clipForPrompt(item.entryTitle, 60)} | ${clipForPrompt(entry?.summary ?? '', 130)} | evidence: ${clipForPrompt(item.evidence, 170)}`;
        })
            .join('\n');
        return [
            `Cluster ID: ${cluster.clusterId}`,
            `Tentative title: ${cluster.title}`,
            `Entry IDs: ${cluster.entryIds.join(', ')}`,
            `Suggested questions: ${buildQuestionsForTheme(cluster.title).join(' / ')}`,
            'Supporting evidence:',
            evidenceLines || '  - None',
        ].join('\n');
    })
        .join('\n\n')}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 2200,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    const parsed = parseJsonFromText(text);
    if (!parsed) {
        return { rawText: text, patterns: [] };
    }
    const patterns = clusters.flatMap((cluster, index) => {
        const enriched = matchEnrichedCluster(cluster, parsed, index);
        if (!enriched?.title || !enriched.overview)
            return [];
        const pattern = buildThemeRankMetadata({
            title: simplifyPatternTitle(enriched.title),
            overview: sanitizePatternOverviewText(enriched.overview),
            dimensions: dedupePatternLines((enriched.dimensions ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean), enriched.overview).slice(0, 4),
            questions: dedupePatternLines((enriched.questions ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean), `${enriched.overview}\n${(enriched.dimensions ?? []).join('\n')}`).slice(0, 3),
            exploreOptions: dedupePatternLines((enriched.exploreOptions ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean)).slice(0, 3),
            supportingEvidence: selectSupportingEvidenceRows(cluster.evidenceByEntry
                .filter((item) => evidenceBelongsToCluster(cluster, item.evidence))
                .map((item) => ({
                entryId: item.entryId,
                entryTitle: item.entryTitle,
                snippet: cleanTruncatedEnding(item.evidence),
                sourceType: item.sourceType,
                sectionTitle: item.sectionTitle,
                threadLabel: cluster.title,
                claim: cleanTruncatedEnding(item.claim),
                whyItMatters: cleanTruncatedEnding(item.whyItMatters),
                confidence: item.confidence,
                salience: item.salience,
                tags: item.tags,
                createdAt: item.createdAt,
            }))
                .filter((item) => item.snippet && !evidenceLooksFragmentary(item.snippet)), 8),
            entryIds: cluster.entryIds,
        });
        return enrichedPatternLooksWeak(pattern) || !patternHasEnoughThemeEvidence(pattern) ? [] : [pattern];
    });
    return { rawText: text, patterns };
}
function reconcilePatterns(previousPatterns, nextPatterns) {
    const timestamp = new Date().toISOString();
    const unusedPrevious = [...previousPatterns];
    return nextPatterns.map((pattern) => {
        const bestMatch = unusedPrevious
            .map((candidate) => ({ candidate, score: scorePatternMatch(candidate, pattern) }))
            .sort((left, right) => right.score - left.score)[0];
        const matched = bestMatch && bestMatch.score >= 3 ? bestMatch.candidate : null;
        if (matched) {
            unusedPrevious.splice(unusedPrevious.findIndex((item) => item.id === matched.id), 1);
        }
        const previousCount = matched?.entryCount ?? 0;
        const nextCount = pattern.entryIds.length;
        const status = !matched
            ? nextCount >= 3
                ? 'active'
                : 'emerging'
            : nextCount >= Math.max(previousCount + 2, 4)
                ? 'deepening'
                : nextCount >= 2 || previousCount >= 2
                    ? 'active'
                    : 'emerging';
        const prelim = buildThemeRankMetadata({
            ...pattern,
            changeSummary: [],
            detailNarrative: pattern.detailNarrative ?? [],
        });
        const changeSummary = describeThemeChange(matched, prelim);
        return buildThemeRankMetadata({
            ...prelim,
            changeSummary,
            id: matched?.id ?? `pattern-${slugify(pattern.title) || Math.random().toString(36).slice(2, 8)}`,
            status,
            entryCount: pattern.entryIds.length,
            updatedAt: timestamp,
        });
    });
}
export async function buildPatterns(memoryDoc, entries, previousPatterns = []) {
    const recentEntries = entries.slice(0, 36);
    const clusters = buildPatternClusters(recentEntries);
    const deterministicPatterns = buildDeterministicPatterns(recentEntries, previousPatterns);
    if (!anthropic || !clusters.length) {
        return deterministicPatterns;
    }
    const enriched = await enrichPatternClustersWithModel(memoryDoc, recentEntries, previousPatterns, clusters).catch(() => null);
    if (enriched?.patterns.length) {
        const mergedPatterns = mergeEnrichedWithFallbackPatterns(enriched.patterns, deterministicPatterns);
        const reconciled = reconcilePatterns(previousPatterns, mergedPatterns);
        if (!patternsLookWeak(reconciled, recentEntries.length)) {
            return reconciled.sort(compareThemePriority).slice(0, 24);
        }
    }
    return deterministicPatterns;
}
export function buildPatternDebugReport(entries) {
    return buildPatternClusters(entries.slice(0, 36)).map((cluster) => ({
        clusterId: cluster.clusterId,
        title: cluster.title,
        familyKey: cluster.familyKey ?? null,
        entryIds: cluster.entryIds,
        evidenceByEntry: cluster.evidenceByEntry,
        fallbackPattern: buildDeterministicPatternFromCluster(cluster),
    }));
}
export function attachPatternSupportingEvidence(patterns, entries) {
    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
    return patterns.map((pattern) => {
        const cleanedExisting = (pattern.supportingEvidence ?? [])
            .map((item) => ({
            entryId: item.entryId,
            entryTitle: simplifyPatternTitle(item.entryTitle),
            snippet: cleanTruncatedEnding(normalizeWhitespace(stripMarkdown(item.snippet))),
            sourceType: item.sourceType,
            sectionTitle: item.sectionTitle ? cleanTruncatedEnding(item.sectionTitle) : undefined,
            threadLabel: item.threadLabel ? simplifyPatternTitle(item.threadLabel) : pattern.title,
            claim: item.claim ? cleanTruncatedEnding(item.claim) : pattern.dimensions[0] ?? pattern.overview,
            whyItMatters: item.whyItMatters ? cleanTruncatedEnding(item.whyItMatters) : pattern.overview,
            confidence: item.confidence,
            salience: item.salience,
            tags: item.tags ?? [],
            createdAt: item.createdAt,
        }))
            .filter((item) => item.entryId && item.snippet && !evidenceLooksFragmentary(item.snippet));
        if (cleanedExisting.length >= Math.min(pattern.entryIds.length, 2)) {
            return buildThemeRankMetadata({
                ...pattern,
                supportingEvidence: selectSupportingEvidenceRows(cleanedExisting, 8),
            });
        }
        const derivedEvidence = pattern.entryIds.flatMap((entryId) => {
            const entry = entryMap.get(entryId);
            if (!entry)
                return [];
            const detail = selectPatternEvidenceDetail(pattern, entry);
            return detail ? [detail] : [];
        });
        const dedupedSnippets = dedupePatternLines(derivedEvidence.map((item) => item.snippet), pattern.overview);
        return buildThemeRankMetadata({
            ...pattern,
            supportingEvidence: selectSupportingEvidenceRows(dedupedSnippets
                .map((snippet) => derivedEvidence.find((item) => item.snippet === snippet))
                .filter((item) => Boolean(item)), 8),
        });
    });
}
export async function generateReply(entry, userReply, context) {
    if (!anthropic) {
        return `The useful next move is to stay with this specifically: ${clip(userReply, 180)}`;
    }
    const prompt = `You are replying inside an ongoing journal thread.
Be direct and useful. Do not repeat the whole original analysis.
Respond in plain markdown prose, around 1 to 3 short paragraphs.

Entry summary:
${entry.summary}

Current analysis summary:
${entry.analysis?.summary ?? 'No prior analysis summary.'}

Memory:
${context.memoryDoc?.content ?? 'No memory document yet.'}

Recent entries:
${context.recentEntries.map((item) => `- ${item.summary}`).join('\n') || 'None'}

User reply:
${userReply}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
        .trim();
}
export async function generatePatternReply(pattern, relatedEntries, memoryDoc, userMessage) {
    if (!anthropic) {
        return `The live question inside this theme seems to be: ${pattern.questions[0] ?? userMessage}`;
    }
    const prompt = `You are helping the user think inside an ongoing life theme.
Respond in plain, useful prose. Be specific and cumulative.

Style rules:
- 2 to 4 short paragraphs max, or a very short bullet list only if it truly helps.
- No giant headings.
- No numbered framework unless the user explicitly asked for steps.
- Sound like a sharp thinking partner, not a self-help article.
- Build on the current theme rather than restarting from zero.

Theme:
${pattern.title}

Overview:
${pattern.overview}

What seems most true here:
${(pattern.detailNarrative ?? pattern.themeSummary ?? []).map((item) => `- ${item}`).join('\n') || 'None yet'}

Recent shifts:
${(pattern.changeSummary ?? []).map((item) => `- ${item}`).join('\n') || 'No meaningful shift noted yet.'}

Dimensions:
${pattern.dimensions.map((item) => `- ${item}`).join('\n')}

Questions:
${pattern.questions.map((item) => `- ${item}`).join('\n')}

Memory:
${memoryForPrompt(memoryDoc, 1500)}

Related entries:
${recentEntriesForPrompt(relatedEntries.map((entry) => ({ ...entry, summary: `${entry.title}: ${entry.summary}` })), 5, 220)}

Supporting thread evidence:
${(pattern.supportingEvidence ?? [])
        .slice(0, 8)
        .map((item) => `- ${clipForPrompt(item.entryTitle, 60)} | ${clipForPrompt(item.claim ?? item.threadLabel ?? pattern.title, 120)} | ${clipForPrompt(item.snippet, 180)} | ${clipForPrompt(item.whyItMatters ?? '', 120)}`)
        .join('\n') || 'None'}

User message:
${clipForPrompt(userMessage, 600)}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
        .trim();
}
export async function generatePatternsUpdate(patterns, entries, memoryDoc, userMessage, thread = []) {
    const sortedPatterns = [...patterns].sort(compareThemePriority).slice(0, 8);
    const brief = buildPatternsBrief(sortedPatterns, entries);
    const defaultAsk = 'Knowing what you know about me from the journal, what is your take on where things stand right now and what questions matter most?';
    const effectiveMessage = userMessage?.trim() || defaultAsk;
    const lifeAreaSummary = summarizePatternLifeAreas(sortedPatterns);
    const currentFrontSummary = (brief?.currentFronts ?? [])
        .map((front) => `- ${front.title}: ${front.summary}`)
        .join('\n') || 'No concrete fronts extracted yet.';
    if (!anthropic) {
        const briefLines = [
            ...(brief?.currentFronts?.slice(0, 2).map((front) => formatPatternSentence(front.summary)) ?? []),
            ...(brief?.expandedOverview?.paragraphs?.length
                ? brief.expandedOverview.paragraphs
                : brief?.bullets.map((item) => formatPatternSentence(item.text)).slice(0, 2) ?? []),
        ].slice(0, 3);
        const questionLine = brief?.prompt?.text ? `\n\nQuestion worth pressure-testing: ${brief.prompt.text}` : '';
        return `${briefLines.join('\n\n')}${questionLine}`.trim() || 'The journal suggests a few live themes, but there is not enough context yet for a meaningful update.';
    }
    const prompt = `You are the user's reflective thought partner inside their journal product.
They have clicked a button that is basically asking: "Knowing what you know about me, what's your take on where things stand for me right now and what questions matter most?"

Your job:
- Give a short, fluid update that feels like a sharp companion's take, not a dashboard summary.
- Synthesize across the journal and current patterns into life-level language.
- Focus on what seems most alive, what tension matters most, and what questions seem worth sitting with.
- Distinguish between slower recurring themes and concrete current fronts.
- Do not force every live concern into one grand unifying theory if the evidence does not support that.
- If two things may be related but the link is still tentative, say so plainly instead of over-threading them.

Style rules:
- 2 to 4 short paragraphs max.
- You may end with 1 or 2 brief bullet questions if genuinely helpful.
- No headings unless the user explicitly asked for structure.
- Do not sound like a therapeutic template or self-help article.
- Do not repeat the same point in different wording.
- Do not list theme names unless truly necessary.
- Prefer concrete, human language over taxonomy words like "undercurrent", "pattern", or "signal".
- Do not over-center work/career unless it is clearly the dominant reality in the evidence.
- Check whether relationship, family, self-trust, embodiment, or life-direction themes are also active, and include them when they materially shape the picture.
- If the journal contains both work-like and non-work concerns, synthesize the broader life situation instead of narrowing to the easiest work framing.
- Prefer 2 or 3 clear live truths over one overly clever all-explaining thesis.
- It is good to keep some fronts separate if that is the honest read.

Living memory:
${memoryForPrompt(memoryDoc, 1800)}

Current themes:
${sortedPatterns.map((pattern) => `- ${pattern.title}: ${pattern.overview}`).join('\n') || 'None yet'}

Current concrete fronts from recent entries:
${currentFrontSummary}

Life areas currently represented:
${lifeAreaSummary}

Recent shifts:
${sortedPatterns.flatMap((pattern) => (pattern.changeSummary ?? []).slice(0, 1).map((item) => `- ${pattern.title}: ${item}`)).join('\n') || 'No explicit recent shift notes.'}

Recent entries:
${recentEntriesForPrompt(entries.map((entry) => ({ ...entry, summary: `${entry.title}: ${entry.summary}` })), 6, 220)}

Conversation so far:
${thread.slice(-6).map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${clipForPrompt(message.content, 500)}`).join('\n\n') || 'No prior messages.'}

User message:
${clipForPrompt(effectiveMessage, 700)}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
        .trim();
}
function summarizePatternLifeAreas(patterns) {
    const counts = new Map();
    for (const pattern of patterns) {
        const area = classifyPatternLifeArea(pattern);
        counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    if (!counts.size)
        return 'No clear area breakdown yet.';
    const labels = {
        work: 'Work / creation',
        relationships: 'Relationships / family',
        self: 'Self-trust / identity',
        embodiment: 'Embodiment / physical life',
        other: 'Other',
    };
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([area, count]) => `- ${labels[area] ?? area}: ${count}`)
        .join('\n');
}
function classifyPatternLifeArea(pattern) {
    const familyKey = patternFamilyKey(pattern);
    if (familyKey === 'output-anchor' || familyKey === 'collaboration-threshold' || familyKey === 'depth-craft') {
        return 'work';
    }
    if (familyKey === 'family-mission' || familyKey === 'relationship-attunement') {
        return 'relationships';
    }
    if (familyKey === 'physical-pull') {
        return 'embodiment';
    }
    if (familyKey === 'outward-proof' ||
        familyKey === 'certainty-delay' ||
        familyKey === 'self-authorization' ||
        familyKey === 'alignment-drift' ||
        familyKey === 'missed-window') {
        return 'self';
    }
    return 'other';
}
export async function integratePatternReplyIntoMemory(currentMemory, pattern, userMessage, answer) {
    if (!anthropic) {
        const existing = currentMemory?.content?.trim();
        const addition = `Theme update: ${pattern.title}\nUser explored: ${userMessage}\nWorking insight: ${clip(answer, 220)}`;
        return existing ? `${existing}\n\n${addition}` : addition;
    }
    const prompt = `Update the user's living memory document after a theme-level conversation.
Return markdown only.

Rules:
- Keep durable patterns stable unless this exchange meaningfully changes them.
- Fold in only the lasting insight from this exchange, not the whole transcript.
- Preserve continuity of major themes.
- If the exchange adds nothing durable, keep changes minimal.

Current memory document:
${memoryForPrompt(currentMemory, 1800)}

Theme being explored:
${pattern.title}

Theme overview:
${pattern.overview}

User message:
${clipForPrompt(userMessage, 500)}

Assistant response:
${clipForPrompt(answer, 900)}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
        .trim();
}
export async function integrateCompanionReplyIntoMemory(currentMemory, userMessage, answer) {
    if (!anthropic) {
        const existing = currentMemory?.content?.trim();
        const addition = `Companion chat\nUser explored: ${userMessage}\nWorking insight: ${clip(answer, 220)}`;
        return existing ? `${existing}\n\n${addition}` : addition;
    }
    const prompt = `Update the user's living memory document after an open-ended companion conversation.
Return markdown only.

Rules:
- Fold in only the durable insight from this exchange, not the whole transcript.
- Preserve continuity with the existing memory document.
- If the exchange adds little of lasting value, keep changes minimal.
- Prefer updating live tensions, desires, fears, or decisions over adding generic advice.

Current memory document:
${memoryForPrompt(currentMemory, 1800)}

User message:
${clipForPrompt(userMessage, 600)}

Assistant response:
${clipForPrompt(answer, 900)}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
        .trim();
}
export async function transcribeJournalPhotos(files) {
    const result = await transcribeJournalPhotosWithStatus(files);
    return result.transcript;
}
async function cleanTranscription(text) {
    if (!anthropic || !text.trim())
        return text.trim();
    const prompt = `Clean this OCR transcription lightly.

Rules:
- Return only the cleaned transcription.
- Remove generic headings like "Transcribed Journal Page".
- Do not add file names or page labels to the transcription.
- Preserve meaning, tone, and paragraph breaks.
- Fix obvious OCR mistakes only when highly confident.
- Keep [unclear] markers when a word is genuinely uncertain.
- Do not summarize, interpret, or rewrite for style.

OCR text:
${text}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 1400,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
        .trim();
}
async function preparePhotoForVision(file) {
    const isHeic = /heic|heif/i.test(file.mimetype) || /\.(heic|heif)$/i.test(file.originalname);
    if (!isHeic) {
        return file;
    }
    try {
        const jpegBuffer = Buffer.from(await convertHeic({
            buffer: file.buffer,
            format: 'JPEG',
            quality: 0.92,
        }));
        return {
            buffer: jpegBuffer,
            mimetype: 'image/jpeg',
            originalname: file.originalname.replace(/\.(heic|heif)$/i, '.jpeg'),
        };
    }
    catch {
        const jpegBuffer = await sharp(file.buffer).jpeg({ quality: 92 }).toBuffer();
        return {
            buffer: jpegBuffer,
            mimetype: 'image/jpeg',
            originalname: file.originalname.replace(/\.(heic|heif)$/i, '.jpeg'),
        };
    }
}
export async function transcribeJournalPhotosWithStatus(files) {
    if (!files.length) {
        return { transcript: '', anySucceeded: false, failedCount: 0, pageResults: [] };
    }
    if (!anthropic) {
        const pageResults = files.map((file, index) => ({
            pageNumber: index + 1,
            fileName: file.originalname,
            text: '[OCR unavailable right now]',
            success: false,
        }));
        return {
            transcript: pageResults
                .map((item) => `Page ${item.pageNumber}\n${item.text}`)
                .join('\n\n---\n\n'),
            anySucceeded: false,
            failedCount: files.length,
            pageResults,
        };
    }
    const pageResults = await Promise.all(files.map(async (file, index) => {
        try {
            const prepared = await preparePhotoForVision(file);
            const response = await anthropic.messages.create({
                model: config.anthropicModel,
                max_tokens: 1200,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Transcribe this journal page as faithfully as possible. Return only the transcribed text in markdown. Preserve line breaks where helpful. If a word is unclear, write [unclear]. Do not summarize or interpret.',
                            },
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: prepared.mimetype,
                                    data: prepared.buffer.toString('base64'),
                                },
                            },
                        ],
                    },
                ],
            });
            const text = response.content
                .filter((item) => item.type === 'text')
                .map((item) => item.text)
                .join('\n')
                .trim();
            if (!text) {
                return {
                    success: false,
                    pageNumber: index + 1,
                    fileName: file.originalname,
                    text: '[OCR unavailable for this image]',
                };
            }
            const cleaned = await cleanTranscription(text);
            return {
                success: true,
                pageNumber: index + 1,
                fileName: file.originalname,
                text: cleaned || text,
            };
        }
        catch {
            return {
                success: false,
                pageNumber: index + 1,
                fileName: file.originalname,
                text: '[OCR unavailable for this image]',
            };
        }
    }));
    const sections = pageResults.map((result) => `Page ${result.pageNumber}\n${result.text}`);
    const anySucceeded = pageResults.some((result) => result.success);
    const failedCount = pageResults.filter((result) => !result.success).length;
    return {
        transcript: sections.join('\n\n---\n\n'),
        anySucceeded,
        failedCount,
        pageResults,
    };
}
