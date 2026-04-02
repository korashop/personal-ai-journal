import type { AnalysisPayload, HighlightRecord, JournalEntry, MemoryDocumentRecord, PatternSection, ResurfacingCard } from '../types.js';
type Context = {
    memoryDoc: MemoryDocumentRecord | null;
    recentEntries: JournalEntry[];
    relevantHighlights: HighlightRecord[];
};
type UploadedPhoto = {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
};
type TranscriptionResult = {
    transcript: string;
    anySucceeded: boolean;
    failedCount: number;
};
export declare function sanitizeJournalText(text: string): string;
export declare function buildAnalysisInput(text: string): string;
export declare function deriveDisplayTitle(candidate: string | undefined, rawText: string, tags: string[]): string;
export declare function deriveDisplaySummary(candidate: string | undefined, rawText: string): string;
export declare function inferTags(rawText: string): string[];
export declare function buildSummary(rawText: string): string;
export declare function buildEntryTitle(rawText: string, tags: string[]): string;
export declare function generateAnalysis(rawText: string, tags: string[], context: Context): Promise<AnalysisPayload>;
export declare function rewriteMemoryDoc(currentMemory: MemoryDocumentRecord | null, recentEntries: JournalEntry[]): Promise<string>;
export declare function simplifyPatternTitle(title: string): string;
export declare function chooseResurfacingCard(memoryDoc: MemoryDocumentRecord | null, entries: JournalEntry[], highlights: HighlightRecord[]): ResurfacingCard | null;
export declare function buildPatterns(memoryDoc: MemoryDocumentRecord | null, entries: JournalEntry[], previousPatterns?: PatternSection[]): Promise<PatternSection[]>;
export declare function buildPatternDebugReport(entries: JournalEntry[]): {
    clusterId: string;
    title: string;
    familyKey: string;
    entryIds: string[];
    evidenceByEntry: {
        entryId: string;
        entryTitle: string;
        evidence: string;
        weight: number;
    }[];
    fallbackPattern: {
        title: string;
        overview: string;
        dimensions: string[];
        questions: string[];
        exploreOptions: string[];
        entryIds: string[];
    };
}[];
export declare function generateReply(entry: JournalEntry, userReply: string, context: Context): Promise<string>;
export declare function generatePatternReply(pattern: PatternSection, relatedEntries: JournalEntry[], memoryDoc: MemoryDocumentRecord | null, userMessage: string): Promise<string>;
export declare function integratePatternReplyIntoMemory(currentMemory: MemoryDocumentRecord | null, pattern: PatternSection, userMessage: string, answer: string): Promise<string>;
export declare function transcribeJournalPhotos(files: UploadedPhoto[]): Promise<string>;
export declare function transcribeJournalPhotosWithStatus(files: UploadedPhoto[]): Promise<TranscriptionResult>;
export {};
