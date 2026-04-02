import type {
  CreateConversationPayload,
  CreateEntryPayload,
  EntryRecord,
  JournalBootstrap,
  PhotoTranscriptionPayload,
  PatternReplyPayload,
  PatternSection,
} from '../types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? 'Request failed')
  }

  return response.json() as Promise<T>
}

function shouldRetry(response: Response) {
  return response.status >= 500
}

export async function fetchBootstrap(entryId?: string | null): Promise<JournalBootstrap> {
  const params = new URLSearchParams()
  if (entryId) {
    params.set('entryId', entryId)
  }
  const query = params.size ? `?${params.toString()}` : ''
  const response = await fetch(apiUrl(`/api/bootstrap${query}`))
  return parseResponse<JournalBootstrap>(response)
}

export async function fetchEntry(entryId: string): Promise<EntryRecord> {
  const url = apiUrl(`/api/entries/${encodeURIComponent(entryId)}`)
  let response = await fetch(url)
  if (shouldRetry(response)) {
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    response = await fetch(url)
  }
  return parseResponse<EntryRecord>(response)
}

export async function createEntry(payload: CreateEntryPayload): Promise<EntryRecord> {
  const formData = new FormData()
  formData.append('rawText', payload.rawText)
  formData.append('source', payload.source)
  if (payload.transcribedText) {
    formData.append('transcribedText', payload.transcribedText)
  }

  if (payload.userId) {
    formData.append('userId', payload.userId)
  }

  for (const photo of payload.photos ?? []) {
    formData.append('photos', photo)
  }

  const response = await fetch(apiUrl('/api/entries'), {
    method: 'POST',
    body: formData,
  })

  return parseResponse<EntryRecord>(response)
}

export async function createConversationMessage(
  payload: CreateConversationPayload,
): Promise<EntryRecord> {
  const response = await fetch(apiUrl('/api/conversations'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseResponse<EntryRecord>(response)
}

export async function updateEntry(entryId: string, rawText: string): Promise<EntryRecord> {
  const response = await fetch(apiUrl(`/api/entries/${entryId}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rawText }),
  })

  return parseResponse<EntryRecord>(response)
}

export async function reanalyzeEntry(entryId: string): Promise<EntryRecord> {
  const response = await fetch(apiUrl(`/api/entries/${entryId}/reanalyze`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  return parseResponse<EntryRecord>(response)
}

export async function deleteEntry(entryId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/entries/${entryId}`), {
    method: 'DELETE',
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? 'Could not delete entry')
  }
}

export async function createPatternReply(pattern: PatternSection, content: string): Promise<PatternReplyPayload> {
  const response = await fetch(apiUrl('/api/patterns/reply'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pattern, content }),
  })

  return parseResponse<PatternReplyPayload>(response)
}

export async function transcribePhotos(photos: File[]): Promise<PhotoTranscriptionPayload> {
  const formData = new FormData()

  for (const photo of photos) {
    formData.append('photos', photo)
  }

  const response = await fetch(apiUrl('/api/transcribe-photos'), {
    method: 'POST',
    body: formData,
  })

  return parseResponse<PhotoTranscriptionPayload>(response)
}
