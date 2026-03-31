import { SupabaseClient } from '@supabase/supabase-js';
import type { AnalysisPayload, ConversationMessageRecord, EntryListRecord, HighlightRecord, JournalEntry, JournalBootstrapRecord, JournalView, PatternSection } from '../types.js';
type CreateEntryInput = {
    rawText: string;
    source: JournalEntry['source'];
    title: string;
    tags: string[];
    summary: string;
    photoUrls: string[];
    userId: string;
    analysis: AnalysisPayload;
};
type UpdateEntryInput = {
    entryId: string;
    userId: string;
    rawText: string;
    title: string;
    tags: string[];
    summary: string;
    analysis: AnalysisPayload;
};
type StoreMode = 'demo' | 'live';
declare class DemoStore {
    entries: JournalEntry[];
    conversations: ConversationMessageRecord[];
    memory: {
        id: string;
        userId: string;
        content: string;
        updatedAt: string;
    };
    highlights: HighlightRecord[];
    patterns: PatternSection[];
    private mapEntryList;
    getBootstrap(userId: string, selectedEntryId?: string | null): Promise<JournalBootstrapRecord>;
    createEntry(input: CreateEntryInput): Promise<JournalView>;
    updateEntry(input: UpdateEntryInput): Promise<JournalView>;
    deleteEntry(entryId: string, userId?: string): Promise<void>;
    appendConversation(entryId: string, userContent: string, assistantContent: string): Promise<JournalView>;
    updateMemory(userId: string, content: string): Promise<{
        id: string;
        userId: string;
        content: string;
        updatedAt: string;
    }>;
    updatePatterns(userId: string, patterns: PatternSection[]): Promise<PatternSection[]>;
    getEntryView(entryId: string, userId?: string): Promise<JournalView>;
}
declare class SupabaseStore {
    private readonly client;
    constructor(client: SupabaseClient);
    private parseStoredPhotoUrls;
    private createSignedPhotoUrl;
    private createSignedPhotoUrls;
    private mapConversation;
    private mapEntry;
    private mapEntryList;
    getBootstrap(userId: string, selectedEntryId?: string | null): Promise<{
        entries: EntryListRecord[];
        selectedEntry: JournalView;
        patternEntries: {
            id: any;
            userId: any;
            createdAt: any;
            rawText: any;
            source: any;
            title: string;
            tags: any;
            photoUrls: any[];
            summary: string;
            hasOpenThreads: any;
            analysis: AnalysisPayload;
        }[];
        memoryDoc: {
            id: any;
            userId: any;
            content: any;
            updatedAt: any;
        };
        highlights: HighlightRecord[];
        patterns: PatternSection[];
    }>;
    createEntry(input: CreateEntryInput): Promise<JournalView>;
    updateEntry(input: UpdateEntryInput): Promise<JournalView>;
    deleteEntry(entryId: string, userId: string): Promise<void>;
    appendConversation(entryId: string, userId: string, userContent: string, assistantContent: string): Promise<JournalView>;
    updateMemory(userId: string, content: string): Promise<{
        id: any;
        userId: string;
        content: any;
        updatedAt: any;
    }>;
    updatePatterns(userId: string, patterns: PatternSection[]): Promise<PatternSection[]>;
    getEntryView(entryId: string, userId: string): Promise<JournalView>;
    uploadPhotos(userId: string, files: Express.Multer.File[]): Promise<string[]>;
    private hasPatternThreadTable;
    private getPatterns;
}
type Store = DemoStore | SupabaseStore;
export declare function getStore(): {
    mode: StoreMode;
    store: Store;
};
export declare function isLiveStore(store: Store): store is SupabaseStore;
export {};
