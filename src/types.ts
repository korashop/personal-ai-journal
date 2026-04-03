export type EntrySource = 'typed' | 'paste' | 'photo'

export type ConversationRole = 'user' | 'assistant'

export type ConversationMessage = {
  id: string
  entryId: string
  role: ConversationRole
  content: string
  createdAt: string
}

export type AnalysisSection = {
  id: string
  title: string
  content: string
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
}

export type EntryRecord = {
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
  conversation: ConversationMessage[]
}

export type EntryListItem = {
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

export type MemoryDocument = {
  id: string
  userId: string
  content: string
  updatedAt: string
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
  }>
  entryIds: string[]
  entryCount: number
  updatedAt: string
}

export type PatternReplyPayload = {
  answer: string
  memoryDoc?: MemoryDocument | null
  patterns?: PatternSection[]
}

export type ResurfacingCard = {
  title: string
  description: string
  type: 'thread' | 'insight' | 'highlight'
}

export type JournalBootstrap = {
  entries: EntryListItem[]
  selectedEntry: EntryRecord | null
  memoryDoc: MemoryDocument | null
  resurfacing: ResurfacingCard | null
  patterns: PatternSection[]
  mode: 'demo' | 'live'
}

export type CreateEntryPayload = {
  rawText: string
  source: EntrySource
  userId?: string
  photos?: File[]
  transcribedText?: string
}

export type PhotoTranscriptionPayload = {
  transcript: string
  anySucceeded: boolean
  failedCount: number
  imageCount: number
}

export type CreateConversationPayload = {
  entryId: string
  content: string
  userId?: string
}
