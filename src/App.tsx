import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookMarked, BrainCircuit, PenLine, RefreshCw, TriangleAlert } from 'lucide-react'

import { EntryComposer } from './components/EntryComposer'
import { EntryDetail } from './components/EntryDetail'
import { EntryFeed } from './components/EntryFeed'
import { PatternsView } from './components/PatternsView'
import {
  createConversationMessage,
  createEntry,
  deleteEntry,
  fetchEntry,
  fetchBootstrap,
  reanalyzeEntry,
  updateEntry,
} from './lib/api'
import type { EntryListItem, EntryRecord, JournalBootstrap } from './types'

type ViewMode = 'capture' | 'entries' | 'patterns'

function sortEntries(entries: EntryListItem[]) {
  return [...entries].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<JournalBootstrap | null>(null)
  const [view, setView] = useState<ViewMode>('capture')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<EntryRecord | null>(null)

  const loadBootstrap = useCallback(async (preferredEntryId?: string | null, options?: { preserveSelection?: boolean }) => {
    try {
      setError(null)
      const response = await fetchBootstrap(preferredEntryId)
      setBootstrap(response)
      const nextSelectedId =
        options?.preserveSelection
          ? preferredEntryId ?? selectedEntryId ?? response.selectedEntry?.id ?? null
          : preferredEntryId ?? response.selectedEntry?.id ?? null
      setSelectedEntryId(nextSelectedId)
      setSelectedEntry(response.selectedEntry)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the journal')
    }
  }, [selectedEntryId])

  useEffect(() => {
    void loadBootstrap()
  }, [loadBootstrap])

  const entries = useMemo(() => sortEntries(bootstrap?.entries ?? []), [bootstrap?.entries])

  useEffect(() => {
    if (!selectedEntryId || view !== 'entries') {
      setSelectedEntry(null)
      return
    }

    if (selectedEntry?.id === selectedEntryId) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const entry = await fetchEntry(selectedEntryId)
        if (!cancelled) {
          setSelectedEntry(entry)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load entry')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedEntryId, selectedEntry?.id, view])

  async function handleCreateEntry(payload: {
    rawText: string
    source: 'typed' | 'paste' | 'photo'
    photos: File[]
    transcribedText?: string
  }) {
    try {
      setBusy(true)
      setError(null)
      const entry = await createEntry(payload)
      await loadBootstrap(entry.id)
      setView('entries')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit entry')
    } finally {
      setBusy(false)
    }
  }

  async function handleReply(content: string) {
    if (!selectedEntry) return
    try {
      setBusy(true)
      setError(null)
      const updatedEntry = await createConversationMessage({ entryId: selectedEntry.id, content })
      await loadBootstrap(updatedEntry.id)
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Could not send reply')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveEdit(rawText: string) {
    if (!selectedEntry) return
    try {
      setBusy(true)
      setError(null)
      const updatedEntry = await updateEntry(selectedEntry.id, rawText)
      await loadBootstrap(updatedEntry.id)
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'Could not update entry')
    } finally {
      setBusy(false)
    }
  }

  async function handleReanalyze() {
    if (!selectedEntry) return
    try {
      setBusy(true)
      setError(null)
      const updatedEntry = await reanalyzeEntry(selectedEntry.id)
      await loadBootstrap(updatedEntry.id)
    } catch (reanalyzeError) {
      setError(reanalyzeError instanceof Error ? reanalyzeError.message : 'Could not re-analyze entry')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!selectedEntry) return
    try {
      setBusy(true)
      setError(null)
      await deleteEntry(selectedEntry.id)
      await loadBootstrap(entries.find((entry) => entry.id !== selectedEntry.id)?.id ?? null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete entry')
    } finally {
      setBusy(false)
    }
  }

  async function handleRefresh() {
    try {
      setBusy(true)
      setError(null)
      await loadBootstrap(view === 'entries' ? selectedEntryId : null)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh the journal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="backdrop" />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">Journal</span>
          <span className="brand-state">{bootstrap?.mode === 'live' ? 'Live' : 'Demo'}</span>
        </div>

        <nav className="nav-pills">
          <button className={view === 'capture' ? 'active' : ''} onClick={() => setView('capture')} type="button">
            <PenLine size={16} />
            Capture
          </button>
          <button className={view === 'entries' ? 'active' : ''} onClick={() => setView('entries')} type="button">
            <BookMarked size={16} />
            Entries
          </button>
          <button className={view === 'patterns' ? 'active' : ''} onClick={() => setView('patterns')} type="button">
            <BrainCircuit size={16} />
            Patterns
          </button>
        </nav>

        <button className="ghost-button" disabled={busy} onClick={() => void handleRefresh()} type="button">
          <RefreshCw size={14} />
          {busy ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {bootstrap ? (
        <main className="app-main">
          {error ? (
            <section className="error-banner">
              <TriangleAlert size={16} />
              <span>{error}</span>
            </section>
          ) : null}

          {view === 'capture' ? <EntryComposer busy={busy} onSubmit={handleCreateEntry} /> : null}

          {view === 'entries' ? (
            <section className={`entries-layout ${selectedEntry ? 'detail-open' : 'list-open'}`}>
              <EntryFeed
                entries={entries}
                mode={selectedEntry ? 'detail' : 'list'}
                onSelect={(entryId) => {
                  setSelectedEntryId(entryId)
                  setSelectedEntry(null)
                }}
                selectedEntryId={selectedEntryId}
              />
              <EntryDetail
                busy={busy}
                entry={selectedEntry}
                key={selectedEntry?.id ?? 'empty-entry'}
                onBack={() => {
                  setSelectedEntryId(null)
                  setSelectedEntry(null)
                }}
                onDelete={handleDelete}
                onReanalyze={handleReanalyze}
                onReply={handleReply}
                onSaveEdit={handleSaveEdit}
              />
            </section>
          ) : null}

          {view === 'patterns' ? (
            <PatternsView
              entries={entries}
              memoryDoc={bootstrap.memoryDoc}
              onOpenEntry={(entryId) => {
                setSelectedEntryId(entryId)
                setSelectedEntry(null)
                setView('entries')
              }}
              onRefreshAfterThemeReply={async () => {
                await loadBootstrap(null, { preserveSelection: true })
              }}
              patterns={bootstrap.patterns}
            />
          ) : null}
        </main>
      ) : (
        <main className="loading-screen">
          <RefreshCw className="spin" size={18} />
          <p>Loading your memory layer...</p>
        </main>
      )}
    </div>
  )
}
