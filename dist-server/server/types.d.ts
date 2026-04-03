import type { ConversationRole, EntrySource } from '../src/types.js';
export type AnalysisSection = {
    id: string;
    title: string;
    content: string;
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
};
export type JournalEntry = {
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
};
export type EntryListRecord = {
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
export type ConversationMessageRecord = {
    id: string;
    entryId: string;
    role: ConversationRole;
    content: string;
    createdAt: string;
};
export type MemoryDocumentRecord = {
    id: string;
    userId: string;
    content: string;
    updatedAt: string;
};
export type HighlightRecord = {
    id: string;
    userId: string;
    source: 'kindle' | 'snipd';
    content: string;
    bookTitle: string | null;
    author: string | null;
    highlightDate: string | null;
};
export type JournalView = JournalEntry & {
    conversation: ConversationMessageRecord[];
};
export type ResurfacingCard = {
    title: string;
    description: string;
    type: 'thread' | 'insight' | 'highlight';
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
    }>;
    entryIds: string[];
    entryCount: number;
    updatedAt: string;
};
export type JournalBootstrapRecord = {
    entries: EntryListRecord[];
    selectedEntry: JournalView | null;
    patternEntries: JournalEntry[];
    memoryDoc: MemoryDocumentRecord | null;
    highlights: HighlightRecord[];
    patterns: PatternSection[];
};
