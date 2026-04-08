export type EntrySource = 'typed' | 'paste' | 'photo';
export type ConversationRole = 'user' | 'assistant';
export type ConversationMessage = {
    id: string;
    entryId: string;
    role: ConversationRole;
    content: string;
    createdAt: string;
};
export type AnalysisSection = {
    id: string;
    title: string;
    content: string;
};
export type ThreadSnippet = {
    text: string;
    sourceType: 'raw_quote' | 'analysis_quote' | 'summary_fallback';
    sectionTitle?: string;
};
export type EntryThread = {
    entryId: string;
    entryTitle: string;
    label: string;
    claim: string;
    snippets: ThreadSnippet[];
    whyItMatters: string;
    confidence: number;
    salience: number;
    tags: string[];
    createdAt: string;
};
export type AnalysisPayload = {
    title: string;
    summary: string;
    entryDigest: string[];
    contextBullets: string[];
    sections: AnalysisSection[];
    exploreOptions: string[];
    feedLabels: string[];
    patternSignals?: string[];
    entryThreads?: EntryThread[];
};
export type EntryRecord = {
    id: string;
    userId: string;
    createdAt: string;
    rawText: string;
    source: EntrySource;
    title: string;
    tags: string[];
    photoUrls: string[];
    summary: string;
    hasOpenThreads: boolean;
    analysis: AnalysisPayload | null;
    conversation: ConversationMessage[];
};
export type EntryListItem = {
    id: string;
    userId: string;
    createdAt: string;
    source: EntrySource;
    title: string;
    tags: string[];
    summary: string;
    hasOpenThreads: boolean;
    feedLabels: string[];
    conversationCount: number;
};
export type MemoryDocument = {
    id: string;
    userId: string;
    content: string;
    updatedAt: string;
};
export type PatternSection = {
    id: string;
    title: string;
    overview: string;
    status: 'emerging' | 'active' | 'deepening';
    prominence?: 'dominant' | 'supporting' | 'quiet';
    dimensions: string[];
    questions: string[];
    exploreOptions: string[];
    supportingEvidence?: Array<{
        entryId: string;
        entryTitle: string;
        snippet: string;
        sourceType?: 'raw_quote' | 'analysis_quote' | 'summary_fallback';
        sectionTitle?: string;
        threadLabel?: string;
        claim?: string;
        whyItMatters?: string;
        confidence?: number;
        salience?: number;
        tags?: string[];
        createdAt?: string;
    }>;
    rankScore?: number;
    rankFactors?: {
        recurrence: number;
        coherence: number;
        weight: number;
        freshness: number;
    };
    rankRationale?: string;
    themeSummary?: string[];
    detailNarrative?: string[];
    changeSummary?: string[];
    entryIds: string[];
    entryCount: number;
    updatedAt: string;
};
export type PatternsBrief = {
    title: string;
    bullets: string[];
    expandedOverview?: {
        summary: string;
        sections: Array<{
            title: string;
            lines: string[];
        }>;
    } | null;
    prompt?: {
        patternId: string;
        text: string;
    } | null;
};
export type PatternReplyPayload = {
    answer: string;
    memoryDoc?: MemoryDocument | null;
    patterns?: PatternSection[];
};
export type ResurfacingCard = {
    title: string;
    description: string;
    type: 'thread' | 'insight' | 'highlight';
};
export type JournalBootstrap = {
    entries: EntryListItem[];
    selectedEntry: EntryRecord | null;
    memoryDoc: MemoryDocument | null;
    resurfacing: ResurfacingCard | null;
    patterns: PatternSection[];
    patternsBrief: PatternsBrief | null;
    mode: 'demo' | 'live';
};
export type CreateEntryPayload = {
    rawText: string;
    source: EntrySource;
    userId?: string;
    photos?: File[];
    transcribedText?: string;
};
export type PhotoTranscriptionPayload = {
    transcript: string;
    anySucceeded: boolean;
    failedCount: number;
    imageCount: number;
};
export type CreateConversationPayload = {
    entryId: string;
    content: string;
    userId?: string;
};
