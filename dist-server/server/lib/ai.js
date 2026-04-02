import Anthropic from '@anthropic-ai/sdk';
import convertHeic from 'heic-convert';
import sharp from 'sharp';
import { config, hasAnthropicConfig } from '../config.js';
const anthropic = hasAnthropicConfig ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
function clip(text, maxLength = 220) {
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
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
function cleanTruncatedEnding(text) {
    const normalized = text.trim().replace(/[.…]+\s*$/, '').trim();
    if (!normalized)
        return '';
    const lastSentenceBoundary = Math.max(normalized.lastIndexOf('. '), normalized.lastIndexOf('? '), normalized.lastIndexOf('! '));
    if (lastSentenceBoundary >= 0 && normalized.length - lastSentenceBoundary > 140) {
        return normalized.slice(0, lastSentenceBoundary + 1).trim();
    }
    return normalized;
}
function stripMarkdown(text) {
    return text
        .replace(/[*_`>#-]+/g, ' ')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1');
}
export function sanitizeJournalText(text) {
    return text
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
        .map((line) => cleanTruncatedEnding(line))
        .filter(Boolean)
        .filter((line) => !looksAbstractDigestLine(line));
    const sourceLines = buildEntryDigest(rawText);
    const merged = [...aiLines, ...sourceLines];
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
async function repairPatternJson(malformedResponse, memoryDoc, entries, previousPatterns) {
    if (!anthropic)
        return null;
    const prompt = `Convert the following malformed theme synthesis into strict JSON only.
Use this exact shape:
[
  {
    "title": "theme title",
    "overview": "state of affairs",
    "dimensions": ["distinct way the theme shows up"],
    "questions": ["useful unresolved question"],
    "exploreOptions": ["one way to engage this theme"],
    "entryIds": ["entry id"]
  }
]

Rules:
- Keep the real distinct themes. Do not collapse them unnecessarily.
- Preserve continuity with existing themes when appropriate.
- Use only entry IDs from the provided entries.

Memory:
${memoryForPrompt(memoryDoc, 1400)}

Entries:
${patternEntriesForPrompt(entries, 18)}

Existing themes:
${previousPatternsForPrompt(previousPatterns)}

Malformed theme synthesis:
${malformedResponse}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 1600,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    const parsed = parseJsonFromText(text);
    if (!parsed)
        return null;
    return parsed
        .filter((item) => item.title && item.overview)
        .map((item) => ({
        title: simplifyPatternTitle(item.title.trim()),
        overview: cleanTruncatedEnding(item.overview),
        dimensions: (item.dimensions ?? []).map((signal) => cleanTruncatedEnding(signal)).filter(Boolean),
        questions: (item.questions ?? []).map((question) => cleanTruncatedEnding(question)).filter(Boolean),
        exploreOptions: (item.exploreOptions ?? []).map((option) => cleanTruncatedEnding(option)).filter(Boolean).slice(0, 4),
        entryIds: (item.entryIds ?? []).filter(Boolean),
    }));
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
- Separate distinct threads when they are not actually one thing.
- Keep entryDigest concrete and source-grounded.
- Mention real names, projects, and decisions when they materially appear.
- Use short paragraphs and bullets when useful.
- Do not end sections with ellipses or fragments.
- Do not use generic headings like Overview unless truly necessary.
- Account for the full spread of the entry, not just the beginning.
- Keep every field concise. No entryDigest or context bullet should be a pasted paragraph.
- patternSignals should be 2 to 4 short mechanism-level phrases that may recur across entries.

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
async function repairAnalysisJson(malformedResponse, rawText, tags) {
    if (!anthropic)
        return null;
    const repairPrompt = `Convert the following malformed analysis into strict JSON only.
Use this exact shape:
{
  "title": "a short durable title",
  "summary": "1 or 2 sentence feed summary",
  "entryDigest": ["short bullet capturing a distinct thing that came up"],
  "contextBullets": ["short source-context bullet"],
  "sections": [{ "title": "string", "content": "markdown string" }],
  "exploreOptions": ["string"],
  "feedLabels": ["string"],
  "patternSignals": ["short recurring mechanism or live thread"]
}

Rules:
- Keep 2 to 5 sections.
- Preserve depth and specificity from the original content.
- Do not introduce upload scaffolding, OCR notes, or image markers into the title or summary.

Original entry:
${rawText}

Malformed analysis:
${malformedResponse}`;
    const repairResponse = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: 1200,
        messages: [{ role: 'user', content: repairPrompt }],
    });
    const repairText = repairResponse.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    const parsed = parseJsonFromText(repairText);
    if (!parsed)
        return null;
    const sections = (parsed.sections ?? [])
        .filter((section) => section.title && section.content)
        .map((section, index) => ({
        id: `repair-section-${index + 1}`,
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
export async function generateAnalysis(rawText, tags, context) {
    const cleanedRaw = sanitizeJournalText(rawText) || rawText;
    const analysisEntryText = clipLongEntryForAnalysis(cleanedRaw, 8000);
    const isLongEntry = cleanedRaw.length > 9000;
    if (!anthropic) {
        return fallbackAnalysis(cleanedRaw, tags);
    }
    const recentEntryLines = recentEntriesForPrompt(context.recentEntries, isLongEntry ? 1 : 4, isLongEntry ? 100 : 180);
    const highlightLines = highlightsForPrompt(context.relevantHighlights, isLongEntry ? 1 : 2, isLongEntry ? 80 : 150);
    const prompt = `You are a direct, highly useful thinking partner with cumulative memory.
Never congratulate the user for journaling.
Do not force a fixed structure if the entry does not need it.
Return JSON only with this shape:
{
  "title": "a short durable title for the entry feed",
  "summary": "one concise but informative summary for the entry feed",
  "entryDigest": ["3 to 5 short bullets capturing distinct things that came up in the entry"],
  "contextBullets": ["2 to 3 short bullets capturing what the user was actually describing"],
  "sections": [
    { "title": "string", "content": "markdown string" }
  ],
  "exploreOptions": ["3 to 5 clickable directions to explore next"],
  "feedLabels": ["2 to 3 compact thematic labels for the entry list"],
  "patternSignals": ["2 to 4 short recurring mechanisms or live threads"]
}

Rules:
- Produce between 2 and 5 sections depending on what the entry needs.
- Section lengths can vary a lot.
- Avoid template-sounding headings like always using the same 4 labels.
- Optimize for usefulness and specificity.
- Use complete thoughts. Do not end sections with ellipses or sentence fragments.
- The title should sound like the real center of gravity of the entry, not the first sentence and not "Claude's analysis..."
- The summary should help the user recognize what this entry is actually about later, in 1 or 2 sentences max.
- The entryDigest should be the fastest honest answer to "what came up here?" Use it for distinct topics, scenes, decisions, or people mentioned.
- Keep entryDigest concrete and source-grounded. Mention real names, projects, places, or decisions when they appear.
- Every entryDigest bullet must stand alone as a short summary bullet, not copied prose from the entry.
- Do not use abstract bullets like "the tension" or "the mechanism" when a more concrete bullet is possible.
- Context bullets should be short, concrete, and source-oriented. Think "what was happening / what was being wrestled with", not interpretation.
- No context bullet should exceed one sentence.
- Do not simply restate the first section in shorter form.
- Explore options should feel like meaningful next angles, not generic prompts.
- Feed labels should be short and useful, not broad buckets unless those are genuinely the right level.
- patternSignals should name recurring mechanisms or active live threads in 2 to 6 words each.
- If the entry is long, account for the whole thing. Do not analyze only the beginning and ignore later turns.
- If you notice a change between the beginning, middle, and end, include that movement in the analysis.
- If the entry contains multiple unrelated or loosely related threads, separate them. Do not force them into one coherent narrative unless the relationship is actually clear.
- Use section titles that reflect distinct threads, not generic therapy headings.
- Inside sections, prefer short paragraphs and bullets when that makes the thinking easier to scan without losing depth.
- Never end any field with ellipses.

Memory doc:
${memoryForPrompt(context.memoryDoc, isLongEntry ? 800 : 2400)}

Recent entries:
${recentEntryLines}

Relevant highlights:
${highlightLines}

Tags:
${tags.join(', ') || 'None'}

New entry:
${analysisEntryText}

Concrete source moments:
${buildSourceMoments(cleanedRaw, 7).map((item) => `- ${item}`).join('\n') || 'None'}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: isLongEntry ? 1100 : 1500,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    const parsed = parseJsonFromText(text);
    if (parsed) {
        const sections = (parsed.sections ?? [])
            .filter((section) => section.title && section.content)
            .map((section, index) => ({
            id: `section-${index + 1}`,
            title: section.title.trim(),
            content: cleanTruncatedEnding(section.content),
        }));
        if (sections.length && !analysisLooksThin({ ...parsed, sections }, cleanedRaw)) {
            const feedLabels = (parsed.feedLabels ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 3);
            return {
                title: deriveDisplayTitle(parsed.title?.trim() || parsed.summary?.trim(), cleanedRaw, tags),
                summary: deriveDisplaySummary(parsed.summary?.trim(), cleanedRaw),
                entryDigest: finalizeEntryDigest(parsed.entryDigest, cleanedRaw),
                contextBullets: (parsed.contextBullets ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean).slice(0, 3),
                sections,
                exploreOptions: (parsed.exploreOptions ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean).slice(0, 5),
                feedLabels: feedLabels.length ? feedLabels : buildFeedLabels(tags, cleanedRaw, sections),
                patternSignals: (parsed.patternSignals ?? []).map((item) => cleanTruncatedEnding(item)).filter(Boolean).slice(0, 4),
            };
        }
    }
    const repaired = await repairAnalysisJson(text, cleanedRaw, tags);
    if (repaired && !analysisLooksThin(repaired, cleanedRaw))
        return repaired;
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
    if (/authoriz|permission|ask|capable|qualified/.test(lower))
        return 'Waiting for permission';
    if (/admired|idealiz|validation|recognized|borrow/.test(lower))
        return 'Looking outward for proof';
    if (/jealous|envy|mimetic/.test(lower))
        return 'Jealousy as direction';
    if (/alignment|surrender|distance|spiritual/.test(lower))
        return 'Distance from alignment';
    if (/delay|waiting|certainty|clarity|avoid/.test(lower))
        return 'Waiting for certainty';
    if (/timing|missed window|too late|late/.test(lower))
        return 'The missed-window story';
    const shortened = clean.split(/[:(,-]/)[0]?.trim() ?? clean;
    return clip(shortened, 42);
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
        if (seedText && overlap(line, seedText) > 0.5)
            continue;
        if (kept.some((existing) => overlap(existing, line) > 0.58))
            continue;
        kept.push(line);
    }
    return kept;
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
function patternCoverageRatio(patterns, entries) {
    if (!entries.length)
        return 0;
    const coveredIds = new Set(patterns.flatMap((pattern) => pattern.entryIds));
    return coveredIds.size / entries.length;
}
function looksTruncatedPatternText(text) {
    return /(?:\.{3,}|…)\s*$/.test(text.trim());
}
function shouldForcePatternExpansion(patterns, entries, candidateCount = 0) {
    if (!entries.length)
        return false;
    if (entries.length >= 10 && patterns.length <= 3)
        return true;
    if (candidateCount >= 8 && patterns.length <= 4)
        return true;
    if (entries.length >= 12 && patternCoverageRatio(patterns, entries) < 0.72)
        return true;
    return patterns.some((pattern) => looksTruncatedPatternText(pattern.overview) ||
        pattern.dimensions.some(looksTruncatedPatternText) ||
        pattern.questions.some(looksTruncatedPatternText));
}
async function synthesizePatternsWithModel(memoryDoc, recentEntries, previousPatterns, patternCandidates, options) {
    if (!anthropic || !recentEntries.length)
        return null;
    const continuityPatterns = options?.expandAggressively && previousPatterns.length <= 3 && recentEntries.length >= 10
        ? []
        : previousPatterns;
    const prompt = `Build a set of clickable theme threads from this journal history.
Return JSON only:
[
  {
    "title": "theme title",
    "overview": "state of affairs: the mechanism, why it matters now, and what seems true at this moment",
    "dimensions": ["distinct way the theme shows up", "distinct way the theme shows up"],
    "questions": ["useful unresolved question"],
    "exploreOptions": ["one way to engage this theme"],
    "entryIds": ["entry id"]
  }
]

Rules:
- Return the real set of important themes. Do not target a number for its own sake.
- For 10+ entries, prefer a richer map. Usually 5 to 9 themes is better than 2 or 3 giant umbrellas if the material supports it.
- If there are 13+ entries and the material clearly supports it, returning only 2 or 3 themes is usually too collapsed.
- Titles must be plain-English and understandable at a glance: 2 to 6 words, concrete, not academic, not overly abstract.
- Good title examples: "Waiting for permission", "Jealousy as direction", "Distance from alignment".
- Bad title examples: "Self-authorizing collapse in aspirational triangulation", "Identity disturbance across relational mirrors".
- Preserve continuity in major themes when still active, but do not keep stale collapsed umbrellas just because they already exist.
- Create a theme when it seems genuinely important, durable, or central to the user's thinking, even if it is newly emerging.
- Do not inflate the list with weak themes just to have more themes.
- Do not output overlapping themes that describe the same mechanism with slightly different wording. Merge overlap into the clearest single theme.
- If there are multiple distinct strands, separate them cleanly rather than collapsing everything into one broad theme.
- It is okay to include smaller, more specific emerging themes if they reveal an important live thread.
- The same entry can support multiple themes. Shared supporting entries are allowed when distinct mechanisms are present.
- Distinguish mechanism from domain. "Work" or "relationships" alone is usually not a theme; the theme is the recurring pattern inside those domains.
- Prefer the title that best captures the mechanism, not the most impressive-sounding phrase.
- Themes can vary in depth.
- Use only entry IDs that are provided below.
- Do not just repeat entry text. Synthesize.
- Prefer psychological or decision-making patterns over broad topic tags.
- If a broad domain like work appears, refine it into the actual thread inside the writing.
- Prefer more granularity when a single broad theme hides multiple different mechanisms.
- The overview, dimensions, and questions must do different jobs:
  - overview = the mechanism and why it matters now
  - dimensions = observable ways this pattern shows up, concrete tensions, or recurring situations
  - questions = genuinely open lines of inquiry that are not already implied by the overview
- Do not repeat the same sentence or paraphrase across overview, dimensions, and questions.
- Do not just restate one recent entry in all three places.
- If a line belongs in overview, do not repeat it in dimensions.
- If a line is already an observation, do not rewrite it as a fake question.
- Make dimensions and questions specific enough that clicking into the theme would feel different depending on which one the user followed.
- Use the full spread of entries below. Do not anchor only on the dominant repeated theme if other meaningful threads are present.
- Treat entry digests and section titles as evidence of distinct subthreads. Use them to split apart different live mechanisms instead of over-collapsing.
- Keep overviews to 1 or 2 complete sentences max.
- Keep each dimension and question to one sentence max.
- Never use ellipses.
${options?.expandAggressively ? '- The current map is too collapsed. Replace stale umbrella themes with a fuller map if the evidence supports it.' : ''}

Memory:
${memoryForPrompt(memoryDoc, options?.expandAggressively ? 1400 : 1800)}

Entries:
${patternEntriesForPrompt(recentEntries, 18)}

Candidate recurring threads:
${patternCandidates.length
        ? patternCandidates
            .map((candidate) => `- ${candidate.title} | entries: ${candidate.entryIds.join(', ')} | evidence: ${candidate.evidence.join(' / ')}`)
            .join('\n')
        : 'None'}

Existing themes to preserve when still active:
${previousPatternsForPrompt(continuityPatterns)}`;
    const response = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: options?.expandAggressively ? 2100 : 1800,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
    const parsed = parseJsonFromText(text);
    return {
        rawText: text,
        patterns: (parsed ?? [])
            .filter((item) => item.title && item.overview)
            .map((item) => ({
            title: simplifyPatternTitle(item.title.trim()),
            overview: cleanTruncatedEnding(item.overview),
            dimensions: (item.dimensions ?? []).map((signal) => cleanTruncatedEnding(signal)).filter(Boolean),
            questions: (item.questions ?? []).map((question) => cleanTruncatedEnding(question)).filter(Boolean),
            exploreOptions: (item.exploreOptions ?? []).map((option) => cleanTruncatedEnding(option)).filter(Boolean).slice(0, 4),
            entryIds: (item.entryIds ?? []).filter(Boolean),
        })),
    };
}
async function extractPatternCandidates(memoryDoc, recentEntries) {
    if (!anthropic || !recentEntries.length)
        return [];
    const prompt = `Extract candidate recurring threads from this journal history.
Return JSON only:
[
  {
    "title": "short mechanism or live thread",
    "entryIds": ["entry id"],
    "evidence": ["concrete observation from the journal"]
  }
]

Rules:
- Return 8 to 14 candidate threads when the material supports it.
- Prefer concrete recurring mechanisms, tensions, or active live threads.
- Avoid umbrella categories like "work" or "relationships" by themselves.
- A candidate can be emerging and only have 1 or 2 entries if it feels clearly alive.
- Do not collapse distinct threads into one broad title.
- Titles should be 2 to 6 words, plain English.
- Evidence lines should be concrete, short, and not end with ellipses.
- Use only the entry IDs provided below.

Memory:
${memoryForPrompt(memoryDoc, 1200)}

Entries:
${patternEntriesForPrompt(recentEntries, 18)}`;
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
    return (parsed ?? [])
        .filter((item) => item.title && item.entryIds?.length)
        .map((item) => ({
        title: simplifyPatternTitle(item.title.trim()),
        entryIds: (item.entryIds ?? []).filter(Boolean),
        evidence: (item.evidence ?? []).map((line) => cleanTruncatedEnding(line)).filter(Boolean).slice(0, 3),
    }));
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
        const status = !matched || nextCount <= 2
            ? 'emerging'
            : nextCount > previousCount
                ? 'deepening'
                : 'active';
        return {
            ...pattern,
            id: matched?.id ?? `pattern-${slugify(pattern.title) || Math.random().toString(36).slice(2, 8)}`,
            status,
            entryCount: pattern.entryIds.length,
            updatedAt: timestamp,
        };
    });
}
export async function buildPatterns(memoryDoc, entries, previousPatterns = []) {
    const recentEntries = entries.slice(0, 18);
    const heuristics = [
        {
            id: 'pattern-validation',
            test: /validation|qualified|admired|capable|authoriz|chosen|recognized|idealiz/i,
            title: 'Borrowing certainty from admired people',
            question: 'Where are you still using another person as proof of your own worth or direction?',
        },
        {
            id: 'pattern-delay',
            test: /stuck|delay|avoid|waiting|certainty|clarity|analysis/i,
            title: 'Waiting for certainty before visible action',
            question: 'What real move would create more information than more reflection?',
        },
        {
            id: 'pattern-alignment',
            test: /alignment|surrender|spiritual|meaning|distance/i,
            title: 'Drift from alignment and how you notice it',
            question: 'What conditions seem to bring you closer to alignment, and which pull you away?',
        },
    ];
    const heuristicMatches = heuristics
        .map((heuristic) => {
        const matched = recentEntries.filter((entry) => heuristic.test.test(`${entry.summary} ${entry.rawText}`));
        return { heuristic, matched };
    })
        .filter((item) => item.matched.length);
    const heuristicPatterns = heuristicMatches.slice(0, 6).map(({ heuristic, matched }) => ({
        title: heuristic.title,
        overview: matched[0]?.summary ?? buildSummary(matched[0]?.rawText ?? ''),
        dimensions: matched.slice(0, 4).map((entry) => entry.summary),
        questions: [heuristic.question],
        exploreOptions: [`Trace how "${heuristic.title.toLowerCase()}" has evolved across entries`],
        entryIds: matched.map((entry) => entry.id),
    }));
    if (anthropic && entries.length) {
        let rawPatternText = '';
        try {
            const patternCandidates = await extractPatternCandidates(memoryDoc, recentEntries);
            const synthesized = await synthesizePatternsWithModel(memoryDoc, recentEntries, previousPatterns, patternCandidates);
            rawPatternText = synthesized?.rawText ?? '';
            if (synthesized?.patterns.length) {
                let paddedPatterns = dedupeAndRefinePatterns(synthesized.patterns);
                if (shouldForcePatternExpansion(paddedPatterns, recentEntries, patternCandidates.length)) {
                    const expanded = await synthesizePatternsWithModel(memoryDoc, recentEntries, previousPatterns, patternCandidates, {
                        expandAggressively: true,
                    }).catch(() => null);
                    if (expanded?.patterns.length) {
                        rawPatternText = expanded.rawText;
                        paddedPatterns = dedupeAndRefinePatterns(expanded.patterns);
                    }
                }
                for (const heuristicPattern of heuristicPatterns) {
                    const overlapsExisting = paddedPatterns.some((pattern) => normalizePatternTitle(pattern.title) === normalizePatternTitle(heuristicPattern.title) ||
                        heuristicPattern.entryIds.some((entryId) => pattern.entryIds.includes(entryId)));
                    if (!overlapsExisting && paddedPatterns.length < 6) {
                        paddedPatterns.push(heuristicPattern);
                    }
                }
                const reconciled = reconcilePatterns(previousPatterns, dedupeAndRefinePatterns(paddedPatterns));
                return reconciled
                    .sort((left, right) => {
                    const rightScore = right.entryCount * 3 + (right.status === 'deepening' ? 2 : right.status === 'active' ? 1 : 0);
                    const leftScore = left.entryCount * 3 + (left.status === 'deepening' ? 2 : left.status === 'active' ? 1 : 0);
                    return rightScore - leftScore;
                })
                    .slice(0, 9);
            }
            if (rawPatternText) {
                throw new Error('Pattern synthesis returned no usable themes');
            }
        }
        catch {
            const repaired = await repairPatternJson(rawPatternText, memoryDoc, recentEntries, previousPatterns).catch(() => null);
            if (repaired?.length) {
                const paddedPatterns = dedupeAndRefinePatterns(repaired);
                const reconciled = reconcilePatterns(previousPatterns, dedupeAndRefinePatterns(paddedPatterns));
                return reconciled
                    .sort((left, right) => {
                    const rightScore = right.entryCount * 3 + (right.status === 'deepening' ? 2 : right.status === 'active' ? 1 : 0);
                    const leftScore = left.entryCount * 3 + (left.status === 'deepening' ? 2 : left.status === 'active' ? 1 : 0);
                    return rightScore - leftScore;
                })
                    .slice(0, 9);
            }
        }
    }
    return reconcilePatterns(previousPatterns, heuristicPatterns).slice(0, 9);
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

Dimensions:
${pattern.dimensions.map((item) => `- ${item}`).join('\n')}

Questions:
${pattern.questions.map((item) => `- ${item}`).join('\n')}

Memory:
${memoryForPrompt(memoryDoc, 1500)}

Related entries:
${recentEntriesForPrompt(relatedEntries.map((entry) => ({ ...entry, summary: `${entry.title}: ${entry.summary}` })), 5, 220)}

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
        return { transcript: '', anySucceeded: false, failedCount: 0 };
    }
    if (!anthropic) {
        return {
            transcript: files
                .map((file, index) => `Image ${index + 1} - ${file.originalname}\n[OCR unavailable right now]`)
                .join('\n\n---\n\n'),
            anySucceeded: false,
            failedCount: files.length,
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
                    section: `Image ${index + 1} - ${file.originalname}\n[OCR unavailable for this image]`,
                };
            }
            const cleaned = await cleanTranscription(text);
            return {
                success: true,
                section: `Page ${index + 1}\n${cleaned || text}`,
            };
        }
        catch {
            return {
                success: false,
                section: `Page ${index + 1}\n[OCR unavailable for this image]`,
            };
        }
    }));
    const sections = pageResults.map((result) => result.section);
    const anySucceeded = pageResults.some((result) => result.success);
    const failedCount = pageResults.filter((result) => !result.success).length;
    return {
        transcript: sections.join('\n\n---\n\n'),
        anySucceeded,
        failedCount,
    };
}
