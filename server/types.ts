import type { ConversationRole, EntrySource } from '../src/types.js'

export type AnalysisSection = {
  id: string
  title: string
  content: string
}

export type ThreadSnippet = {
  text: string
  sourceType: 'raw_quote' | 'analysis_quote' | 'summary_fallback'
  sectionTitle?: string
}

export type EntryThread = {
  entryId: string
  entryTitle: string
  label: string
  claim: string
  snippets: ThreadSnippet[]
  whyItMatters: string
  confidence: number
  salience: number
  tags: string[]
  createdAt: string
}

export type AnalysisPayload = {
  title: string
  summary: string
  entryDigest: string[]
  contextBullets: string[]
  sections: AnalysisSection[]
  exploreOptions: string[]
  feedLabels: string[]
  patternSignals?: string[]
  entryThreads?: EntryThread[]
}

export type JournalEntry = {
  id: string
  userId: string
  createdAt: string
  rawText: string
  source: EntrySource
  title: string
  tags: string[]
  photoUrls: string[]
  summary: string
  hasOpenThreads: boolean
  analysis: AnalysisPayload | null
}

export type EntryListRecord = {
  id: string
  userId: string
  createdAt: string
  source: EntrySource
  title: string
  tags: string[]
  summary: string
  hasOpenThreads: boolean
  feedLabels: string[]
  conversationCount: number
}

export type ConversationMessageRecord = {
  id: string
  entryId: string
  role: ConversationRole
  content: string
  createdAt: string
}

export type MemoryDocumentRecord = {
  id: string
  userId: string
  content: string
  updatedAt: string
}

export type HighlightRecord = {
  id: string
  userId: string
  source: 'kindle' | 'snipd'
  content: string
  bookTitle: string | null
  author: string | null
  highlightDate: string | null
}

export type JournalView = JournalEntry & {
  conversation: ConversationMessageRecord[]
}

export type ResurfacingCard = {
  title: string
  description: string
  type: 'thread' | 'insight' | 'highlight'
}

export type PatternSection = {
  id: string
  title: string
  overview: string
  status: 'emerging' | 'active' | 'deepening'
  prominence?: 'dominant' | 'supporting' | 'quiet'
  dimensions: string[]
  questions: string[]
  exploreOptions: string[]
  supportingEvidence?: Array<{
    entryId: string
    entryTitle: string
    snippet: string
    sourceType?: 'raw_quote' | 'analysis_quote' | 'summary_fallback'
    sectionTitle?: string
    threadLabel?: string
    claim?: string
    whyItMatters?: string
    confidence?: number
    salience?: number
    tags?: string[]
    createdAt?: string
  }>
  rankScore?: number
  rankFactors?: {
    recurrence: number
    coherence: number
    weight: number
    freshness: number
  }
  rankRationale?: string
  themeSummary?: string[]
  detailNarrative?: string[]
  changeSummary?: string[]
  entryIds: string[]
  entryCount: number
  updatedAt: string
}

export type PatternsBrief = {
  title: string
  bullets: Array<{
    kind: 'durable' | 'recent' | 'next'
    text: string
  }>
  expandedOverview?: {
    summary: string
    sections: Array<{
      title: string
      lines: string[]
    }>
  } | null
  prompt?: {
    patternId: string
    text: string
  } | null
}

export type JournalBootstrapRecord = {
  entries: EntryListRecord[]
  selectedEntry: JournalView | null
  patternEntries: JournalEntry[]
  memoryDoc: MemoryDocumentRecord | null
  highlights: HighlightRecord[]
  patterns: PatternSection[]
  patternsBrief?: PatternsBrief | null
}
