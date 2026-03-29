import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, LoaderCircle, Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { FormEvent } from 'react'

import { createPatternReply } from '../lib/api'
import type { EntryListItem, MemoryDocument, PatternSection } from '../types'

function clip(text: string, maxLength = 180) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function statusLabel(status: PatternSection['status']) {
  if (status === 'deepening') return 'Deepening'
  if (status === 'emerging') return 'Emerging'
  return 'Active'
}

function statusNote(pattern: PatternSection) {
  if (pattern.status === 'deepening') {
    return 'This theme is gaining weight in the recent journal.'
  }
  if (pattern.status === 'emerging') {
    return 'This theme is present, but still early. It may sharpen or disappear.'
  }
  return 'This theme seems durable enough to keep tracking over time.'
}

type PatternsViewProps = {
  entries: EntryListItem[]
  memoryDoc: MemoryDocument | null
  patterns: PatternSection[]
  onOpenEntry: (entryId: string) => void
  onRefreshAfterThemeReply: () => Promise<void>
}

type ThemeMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function PatternsView({ entries, memoryDoc, onOpenEntry, onRefreshAfterThemeReply, patterns }: PatternsViewProps) {
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null)
  const [showMemoryInspector, setShowMemoryInspector] = useState(false)
  const [message, setMessage] = useState('')
  const [themeThreads, setThemeThreads] = useState<Record<string, ThemeMessage[]>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!patterns.length) {
      setSelectedPatternId(null)
      return
    }
    if (!selectedPatternId) return
    if (!patterns.some((pattern) => pattern.id === selectedPatternId)) {
      setSelectedPatternId(null)
    }
  }, [patterns, selectedPatternId])

  const selectedPattern = useMemo(
    () => (selectedPatternId ? patterns.find((pattern) => pattern.id === selectedPatternId) ?? null : null),
    [patterns, selectedPatternId],
  )

  const supportingEntries = useMemo(
    () => entries.filter((entry) => selectedPattern?.entryIds.includes(entry.id)),
    [entries, selectedPattern],
  )

  const selectedThread = useMemo(
    () => (selectedPattern ? themeThreads[selectedPattern.id] ?? [] : []),
    [selectedPattern, themeThreads],
  )

  const latestSupportingEntry = useMemo(() => {
    return [...supportingEntries].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )[0] ?? null
  }, [supportingEntries])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPattern || !message.trim()) return
    const question = message.trim()
    try {
      setBusy(true)
      setThemeThreads((current) => ({
        ...current,
        [selectedPattern.id]: [
          ...(current[selectedPattern.id] ?? []),
          {
            id: `${selectedPattern.id}-user-${Date.now()}`,
            role: 'user',
            content: question,
          },
        ],
      }))
      setMessage('')
      const response = await createPatternReply(selectedPattern, question)
      setThemeThreads((current) => ({
        ...current,
        [selectedPattern.id]: [
          ...(current[selectedPattern.id] ?? []),
          {
            id: `${selectedPattern.id}-assistant-${Date.now()}`,
            role: 'assistant',
            content: response.answer,
          },
        ],
      }))
      await onRefreshAfterThemeReply()
    } finally {
      setBusy(false)
    }
  }

  if (!patterns.length) {
    return (
      <section className="panel">
        <p className="muted">Patterns will start becoming useful once a few entries accumulate.</p>
      </section>
    )
  }

  return (
    <section className={`patterns-shell ${selectedPattern ? 'detail-mode' : 'home-mode'}`}>
      {selectedPattern ? (
        <aside className="panel patterns-list compact">
          {patterns.map((pattern) => (
            <button
              className={`pattern-nav-item compact ${selectedPattern.id === pattern.id ? 'selected' : ''}`}
              key={pattern.id}
              onClick={() => setSelectedPatternId(pattern.id)}
              type="button"
            >
              <span className="pattern-nav-title">{pattern.title}</span>
            </button>
          ))}
        </aside>
      ) : null}

      <div className="patterns-detail">
        {!selectedPattern ? (
          <div className="panel pattern-focus">
            <div className="pattern-home-list">
              {patterns.map((pattern) => (
                <button className="pattern-home-card" key={pattern.id} onClick={() => setSelectedPatternId(pattern.id)} type="button">
                  <div className="pattern-home-meta">
                    <strong>{pattern.title}</strong>
                    <span className={`pattern-status ${pattern.status}`}>{statusLabel(pattern.status)}</span>
                  </div>
                  <span>{clip(pattern.overview, 190)}</span>
                  <small>{pattern.entryCount} related entr{pattern.entryCount === 1 ? 'y' : 'ies'}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedPattern ? (
          <div className="panel pattern-focus">
            <div className="pattern-focus-header">
              <div>
                <p className="subtle-label">Theme</p>
                <h2>{selectedPattern.title}</h2>
                <div className="pattern-detail-meta">
                  <span className={`pattern-status ${selectedPattern.status}`}>{statusLabel(selectedPattern.status)}</span>
                  <span className="pattern-timestamp">{selectedPattern.entryCount} supporting entr{selectedPattern.entryCount === 1 ? 'y' : 'ies'}</span>
                </div>
                <p className="pattern-status-note">{statusNote(selectedPattern)}</p>
              </div>
              <div className="pattern-focus-actions">
                <button className="ghost-button" onClick={() => setSelectedPatternId(null)} type="button">
                  Back to themes
                </button>
                <button className="ghost-button" onClick={() => setShowMemoryInspector((current) => !current)} type="button">
                  {showMemoryInspector ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {showMemoryInspector ? 'Hide memory' : 'Inspect memory'}
                </button>
              </div>
            </div>

            {showMemoryInspector ? (
              <div className="memory-inline-drawer">
                <p className="subtle-label">Internal memory document</p>
                <div className="memory-doc">
                  {memoryDoc ? <ReactMarkdown>{memoryDoc.content}</ReactMarkdown> : <p className="muted">Memory will grow as you use the journal.</p>}
                </div>
              </div>
            ) : null}

            <article className="pattern-overview">
              <p className="subtle-label">State of affairs</p>
              <ReactMarkdown>{selectedPattern.overview}</ReactMarkdown>
            </article>

            {latestSupportingEntry ? (
              <div className="pattern-recent-note">
                <p className="subtle-label">Recently activated by</p>
                <div className="pattern-recent-body">
                  <strong>{latestSupportingEntry.title}</strong>
                  <span>{clip(latestSupportingEntry.summary, 180)}</span>
                  <button className="ghost-button" onClick={() => onOpenEntry(latestSupportingEntry.id)} type="button">
                    Open entry
                  </button>
                </div>
              </div>
            ) : null}

            <div className="pattern-detail-grid">
              <div className="pattern-column wide">
                <p className="subtle-label">Important dimensions</p>
                <ul className="pattern-list">
                  {selectedPattern.dimensions.map((dimension) => (
                    <li className="pattern-list-item" key={dimension}>
                      <ReactMarkdown>{dimension}</ReactMarkdown>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pattern-column wide">
                <p className="subtle-label">Questions in play</p>
                <ul className="pattern-list">
                  {selectedPattern.questions.map((question) => (
                    <li className="pattern-list-item" key={question}>
                      <ReactMarkdown>{question}</ReactMarkdown>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {selectedPattern.exploreOptions.length ? (
              <div className="pattern-explore">
                <p className="subtle-label">Ways to explore this</p>
                <div className="explore-options stacked">
                  {selectedPattern.exploreOptions.map((option) => (
                    <button className="option-chip" key={option} onClick={() => setMessage(option)} type="button">
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="pattern-entry-links">
              <p className="subtle-label">Related entries</p>
              <div className="related-entry-list">
                {supportingEntries.map((entry) => (
                  <button className="related-entry-card" key={entry.id} onClick={() => onOpenEntry(entry.id)} type="button">
                    <strong>{entry.title}</strong>
                    <span>{entry.summary}</span>
                  </button>
                ))}
              </div>
            </div>

            <form className="reply-form pattern-chat" onSubmit={handleSubmit}>
              <textarea
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ask about this theme, test an interpretation, or go deeper on one strand."
                rows={4}
                value={message}
              />
              <button className="primary-button" disabled={busy || !message.trim()} type="submit">
                {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                {busy ? 'Thinking...' : 'Ask this theme'}
              </button>
            </form>

            {selectedThread.length ? (
              <div className="conversation-list pattern-thread">
                {selectedThread.map((threadMessage) => (
                  <article className={`message ${threadMessage.role}`} key={threadMessage.id}>
                    <div className="message-meta">
                      <span>{threadMessage.role === 'user' ? 'You' : 'Theme'}</span>
                    </div>
                    <ReactMarkdown>{threadMessage.content}</ReactMarkdown>
                  </article>
                ))}
                <p className="muted pattern-reply-note">This exchange has been folded back into the living memory and theme state.</p>
              </div>
            ) : null}

          </div>
        ) : null}
      </div>
    </section>
  )
}
