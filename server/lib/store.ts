import { randomUUID } from 'node:crypto'

import { createClient, SupabaseClient } from '@supabase/supabase-js'

import { config, hasSupabaseConfig } from '../config.js'
import { deriveDisplaySummary, deriveDisplayTitle, simplifyPatternTitle } from './ai.js'
import { demoConversations, demoEntries, demoHighlights, demoMemoryDoc } from './demo-data.js'
import type {
  AnalysisPayload,
  ConversationMessageRecord,
  EntryListRecord,
  HighlightRecord,
  JournalEntry,
  JournalBootstrapRecord,
  JournalView,
  PatternSection,
} from '../types.js'

type SupabaseConversationRow = {
  id: string
  entry_id: string
  role: ConversationMessageRecord['role']
  content: string
  created_at: string
}

type SupabaseEntryRow = {
  id: string
  user_id: string
  created_at: string
  raw_text: string
  source: JournalEntry['source']
  summary: string
  tags: string[] | null
  photo_url: string | string[] | null
  has_open_threads: boolean | null
  ai_response: unknown
}

type CreateEntryInput = {
  rawText: string
  source: JournalEntry['source']
  title: string
  tags: string[]
  summary: string
  photoUrls: string[]
  userId: string
  analysis: AnalysisPayload
}

type UpdateEntryInput = {
  entryId: string
  userId: string
  rawText: string
  title: string
  tags: string[]
  summary: string
  analysis: AnalysisPayload
}

type StoreMode = 'demo' | 'live'

function parseLegacyAnalysis(value: unknown, rawText: string): AnalysisPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as {
    title?: string
    summary?: string
    sections?: Array<{ id?: string; title?: string; content?: string }>
    exploreOptions?: string[]
    feedLabels?: string[]
    restate?: string
    underneath?: string
    challenge?: string
    followUp?: string
  }

  if (Array.isArray(candidate.sections)) {
    return {
      title: deriveDisplayTitle(candidate.title ?? candidate.summary, rawText, []),
      summary: deriveDisplaySummary(candidate.summary, rawText),
      contextBullets: [],
      sections: candidate.sections
        .filter((section) => section.title && section.content)
        .map((section, index) => ({
          id: section.id ?? `section-${index + 1}`,
          title: section.title!,
          content: section.content!,
        })),
      exploreOptions: candidate.exploreOptions ?? [],
      feedLabels:
        candidate.feedLabels ??
        candidate.sections
          .map((section) => section.title)
          .filter((title): title is string => Boolean(title))
          .slice(0, 3),
    }
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
      content: content as string,
    }))

  if (!legacySections.length) {
    return null
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
  }
}

class DemoStore {
  entries = [...demoEntries]
  conversations = [...demoConversations]
  memory = { ...demoMemoryDoc }
  highlights = [...demoHighlights]
  patterns: PatternSection[] = []

  private mapEntryList(entry: JournalEntry): EntryListRecord {
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
      conversationCount: Math.max(
        this.conversations.filter((message) => message.entryId === entry.id).length - 1,
        0,
      ),
    }
  }

  async getBootstrap(userId: string, selectedEntryId?: string | null): Promise<JournalBootstrapRecord> {
    const entries = this.entries
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    return {
      entries: entries.map((entry) => this.mapEntryList(entry)),
      selectedEntry: selectedEntryId && entries.length ? await this.getEntryView(selectedEntryId) : null,
      patternEntries: entries,
      memoryDoc: this.memory.userId === userId ? this.memory : null,
      highlights: this.highlights.filter((highlight) => highlight.userId === userId),
      patterns: this.patterns,
    }
  }

  async createEntry(input: CreateEntryInput) {
    const entry: JournalEntry = {
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
    }

    this.entries.unshift(entry)
    this.conversations.unshift({
      id: randomUUID(),
      entryId: entry.id,
      role: 'assistant',
      content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
      createdAt: new Date().toISOString(),
    })

    return this.getEntryView(entry.id)
  }

  async updateEntry(input: UpdateEntryInput) {
    this.entries = this.entries.map((entry) =>
      entry.id === input.entryId
        ? {
            ...entry,
            rawText: input.rawText,
            title: input.title,
            tags: input.tags,
            summary: input.summary,
            analysis: input.analysis,
          }
        : entry,
    )

    const firstAssistantIndex = this.conversations.findIndex(
      (message) => message.entryId === input.entryId && message.role === 'assistant',
    )

    if (firstAssistantIndex >= 0) {
      this.conversations[firstAssistantIndex] = {
        ...this.conversations[firstAssistantIndex],
        content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
      }
    }

    return this.getEntryView(input.entryId)
  }

  async deleteEntry(entryId: string, userId?: string) {
    void userId
    this.entries = this.entries.filter((entry) => entry.id !== entryId)
    this.conversations = this.conversations.filter((message) => message.entryId !== entryId)
  }

  async appendConversation(entryId: string, userContent: string, assistantContent: string) {
    const createdAt = new Date().toISOString()
    this.conversations.push({
      id: randomUUID(),
      entryId,
      role: 'user',
      content: userContent,
      createdAt,
    })
    this.conversations.push({
      id: randomUUID(),
      entryId,
      role: 'assistant',
      content: assistantContent,
      createdAt: new Date().toISOString(),
    })
    return this.getEntryView(entryId)
  }

  async updateMemory(userId: string, content: string) {
    this.memory = {
      id: this.memory.id,
      userId,
      content,
      updatedAt: new Date().toISOString(),
    }
    return this.memory
  }

  async updatePatterns(userId: string, patterns: PatternSection[]) {
    void userId
    this.patterns = patterns
    return this.patterns
  }

  async getEntryView(entryId: string, userId?: string): Promise<JournalView> {
    void userId
    const entry = this.entries.find((item) => item.id === entryId)
    if (!entry) {
      throw new Error('Entry not found')
    }

    return {
      ...entry,
      conversation: this.conversations
        .filter((message) => message.entryId === entryId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    }
  }
}

class SupabaseStore {
  constructor(private readonly client: SupabaseClient) {}

  private parseStoredPhotoUrls(value: unknown) {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string')
    }
    if (typeof value !== 'string' || !value.trim()) {
      return []
    }
    if (value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
      } catch {
        return []
      }
    }
    return [value]
  }

  private async createSignedPhotoUrl(path: string | null) {
    if (!path) return null
    const signedUrlResponse = await this.client.storage.from(config.storageBucket).createSignedUrl(path, 60 * 60)
    if (signedUrlResponse.error) throw signedUrlResponse.error
    return signedUrlResponse.data.signedUrl
  }

  private async createSignedPhotoUrls(paths: string[]) {
    const signedUrls = await Promise.all(paths.map((path) => this.createSignedPhotoUrl(path)))
    return signedUrls.filter((item): item is string => Boolean(item))
  }

  private mapConversation(message: SupabaseConversationRow): ConversationMessageRecord {
    return {
      id: message.id,
      entryId: message.entry_id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    }
  }

  private async mapEntry(entry: SupabaseEntryRow, conversations: SupabaseConversationRow[]): Promise<JournalView> {
    const analysis = parseLegacyAnalysis(entry.ai_response, entry.raw_text)
    const derivedSummary = deriveDisplaySummary(analysis?.summary?.trim() || entry.summary, entry.raw_text)

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
    }
  }

  private mapEntryList(entry: SupabaseEntryRow, conversationCount: number): EntryListRecord {
    const analysis = parseLegacyAnalysis(entry.ai_response, entry.raw_text)
    const derivedSummary = deriveDisplaySummary(analysis?.summary?.trim() || entry.summary, entry.raw_text)

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
    }
  }

  async getBootstrap(userId: string, selectedEntryId?: string | null) {
    const [entriesResponse, conversationsResponse, memoryResponse, highlightsResponse] = await Promise.all([
      this.client.from('entries').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      this.client.from('conversations').select('*').eq('user_id', userId).order('created_at'),
      this.client.from('memory_doc').select('*').eq('user_id', userId).single(),
      this.client.from('highlights').select('*').eq('user_id', userId).limit(5),
    ])

    if (entriesResponse.error) throw entriesResponse.error
    if (conversationsResponse.error) throw conversationsResponse.error
    if (memoryResponse.error && memoryResponse.status !== 406) throw memoryResponse.error
    if (highlightsResponse.error) throw highlightsResponse.error

    const conversationCounts = conversationsResponse.data.reduce<Record<string, number>>((accumulator, message) => {
      accumulator[message.entry_id] = (accumulator[message.entry_id] ?? 0) + 1
      return accumulator
    }, {})
    const selectedId = selectedEntryId ?? null

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
      highlights: highlightsResponse.data.map(
        (highlight): HighlightRecord => ({
          id: highlight.id,
          userId: highlight.user_id,
          source: highlight.source,
          content: highlight.content,
          bookTitle: highlight.book_title,
          author: highlight.author,
          highlightDate: highlight.highlight_date,
        }),
      ),
      patterns: await this.getPatterns(userId),
    }
  }

  async createEntry(input: CreateEntryInput) {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
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
    })
    if (insertResponse.error) throw insertResponse.error

    const conversationResponse = await this.client.from('conversations').insert({
      id: randomUUID(),
      user_id: input.userId,
      entry_id: id,
      role: 'assistant',
      content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
      created_at: new Date().toISOString(),
    })
    if (conversationResponse.error) throw conversationResponse.error

    return this.getEntryView(id, input.userId)
  }

  async updateEntry(input: UpdateEntryInput) {
    const updateResponse = await this.client
      .from('entries')
      .update({
        raw_text: input.rawText,
        tags: input.tags,
        summary: input.summary,
        ai_response: input.analysis,
      })
      .eq('id', input.entryId)
      .eq('user_id', input.userId)
    if (updateResponse.error) throw updateResponse.error

    const firstAssistant = await this.client
      .from('conversations')
      .select('*')
      .eq('entry_id', input.entryId)
      .eq('user_id', input.userId)
      .eq('role', 'assistant')
      .order('created_at')
      .limit(1)
      .single()

    if (!firstAssistant.error) {
      const conversationUpdate = await this.client
        .from('conversations')
        .update({
          content: input.analysis.sections.map((section) => `### ${section.title}\n${section.content}`).join('\n\n'),
        })
        .eq('id', firstAssistant.data.id)
      if (conversationUpdate.error) throw conversationUpdate.error
    }

    return this.getEntryView(input.entryId, input.userId)
  }

  async deleteEntry(entryId: string, userId: string) {
    const response = await this.client.from('entries').delete().eq('id', entryId).eq('user_id', userId)
    if (response.error) throw response.error
  }

  async appendConversation(entryId: string, userId: string, userContent: string, assistantContent: string) {
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
    ])
    if (insertResponse.error) throw insertResponse.error

    return this.getEntryView(entryId, userId)
  }

  async updateMemory(userId: string, content: string) {
    const response = await this.client
      .from('memory_doc')
      .upsert({ id: randomUUID(), user_id: userId, content, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (response.error) throw response.error

    const memoryResponse = await this.client.from('memory_doc').select('*').eq('user_id', userId).single()
    if (memoryResponse.error) throw memoryResponse.error

    return {
      id: memoryResponse.data.id,
      userId,
      content: memoryResponse.data.content,
      updatedAt: memoryResponse.data.updated_at,
    }
  }

  async updatePatterns(userId: string, patterns: PatternSection[]) {
    const tableExists = await this.hasPatternThreadTable()
    if (!tableExists) {
      return []
    }

    const deleteResponse = await this.client.from('pattern_threads').delete().eq('user_id', userId)
    if (deleteResponse.error) throw deleteResponse.error

    if (!patterns.length) {
      return []
    }

    const insertResponse = await this.client.from('pattern_threads').insert(
      patterns.map((pattern) => ({
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
      })),
    )
    if (insertResponse.error) throw insertResponse.error
    return patterns
  }

  async getEntryView(entryId: string, userId: string): Promise<JournalView> {
    const [entryResponse, conversationResponse] = await Promise.all([
      this.client.from('entries').select('*').eq('id', entryId).eq('user_id', userId).single(),
      this.client.from('conversations').select('*').eq('entry_id', entryId).order('created_at'),
    ])
    if (entryResponse.error) throw entryResponse.error
    if (conversationResponse.error) throw conversationResponse.error
    return this.mapEntry(entryResponse.data, conversationResponse.data)
  }

  async uploadPhotos(userId: string, files: Express.Multer.File[]) {
    const paths: string[] = []
    for (const file of files) {
      const path = `${userId}/${Date.now()}-${file.originalname}`
      const response = await this.client.storage
        .from(config.storageBucket)
        .upload(path, file.buffer, { contentType: file.mimetype, upsert: false })
      if (response.error) throw response.error
      paths.push(path)
    }
    return paths
  }

  private async hasPatternThreadTable() {
    const response = await this.client.from('pattern_threads').select('id').limit(1)
    return !response.error
  }

  private async getPatterns(userId: string) {
    const tableExists = await this.hasPatternThreadTable()
    if (!tableExists) {
      return []
    }

    const response = await this.client
      .from('pattern_threads')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (response.error) throw response.error

    return response.data.map(
      (pattern): PatternSection => ({
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
      }),
    )
  }
}

const demoStore = new DemoStore()
const liveStore = hasSupabaseConfig
  ? new SupabaseStore(createClient(config.supabaseUrl!, config.supabaseServiceRoleKey!))
  : null

type Store = DemoStore | SupabaseStore

export function getStore(): { mode: StoreMode; store: Store } {
  if (liveStore) return { mode: 'live', store: liveStore }
  return { mode: 'demo', store: demoStore }
}

export function isLiveStore(store: Store): store is SupabaseStore {
  return store instanceof SupabaseStore
}
