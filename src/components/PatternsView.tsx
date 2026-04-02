import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, LoaderCircle, MessageSquareText, Send, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { FormEvent } from 'react'

import { createPatternReply } from '../lib/api'
import type { EntryListItem, MemoryDocument, PatternSection } from '../types'

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

function prominenceLabel(pattern: PatternSection, index: number) {
  if (pattern.prominence === 'dominant' || index < 2) return 'Dominant right now'
  if (pattern.prominence === 'quiet' || pattern.entryCount <= 1) return 'Quiet signal'
  return 'Active thread'
}

function patternLooksPlaceholder(pattern: PatternSection) {
  return (
    /\bis present in this entry, but the underlying shape is still emerging\b/i.test(pattern.overview) ||
    /\bkeeps recurring across \d+ entries, but the underlying shape is still emerging\b/i.test(pattern.overview)
  )
}

function normalizeForComparison(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function overlapScore(left: string, right: string) {
  const leftTokens = new Set(normalizeForComparison(left).split(' ').filter((token) => token.length > 3))
  const rightTokens = new Set(normalizeForComparison(right).split(' ').filter((token) => token.length > 3))
  if (!leftTokens.size || !rightTokens.size) return 0
  let shared = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1
  }
  return shared / Math.max(leftTokens.size, rightTokens.size)
}

function filterDistinctLines(lines: string[], seedText: string) {
  const kept: string[] = []
  for (const line of lines) {
    if (overlapScore(line, seedText) > 0.45) continue
    if (kept.some((existing) => overlapScore(existing, line) > 0.55)) continue
    kept.push(line)
  }
  return kept
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
  state?: 'pending' | 'complete'
}

export function PatternsView({ entries, memoryDoc, onOpenEntry, onRefreshAfterThemeReply, patterns }: PatternsViewProps) {
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null)
  const [showMemoryInspector, setShowMemoryInspector] = useState(false)
  const [showChatPanel, setShowChatPanel] = useState(true)
  const [message, setMessage] = useState('')
  const [themeThreads, setThemeThreads] = useState<Record<string, ThemeMessage[]>>({})
  const [busy, setBusy] = useState(false)
  const [refreshingThread, setRefreshingThread] = useState(false)
  const [staleSyncAttempts, setStaleSyncAttempts] = useState(0)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('journal-theme-threads')
      if (stored) {
        setThemeThreads(JSON.parse(stored) as Record<string, ThemeMessage[]>)
      }
    } catch {
      // Ignore local storage issues and keep the thread in-memory only.
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('journal-theme-threads', JSON.stringify(themeThreads))
    } catch {
      // Ignore local storage issues and keep the thread in-memory only.
    }
  }, [themeThreads])

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

  useEffect(() => {
    setShowChatPanel(true)
  }, [selectedPatternId])

  useEffect(() => {
    if ((patterns.length > 5 && !patterns.some(patternLooksPlaceholder)) || entries.length < 10) {
      setStaleSyncAttempts(0)
      return
    }
    if (staleSyncAttempts >= 2) return

    const timeoutId = window.setTimeout(() => {
      void onRefreshAfterThemeReply()
      setStaleSyncAttempts((current) => current + 1)
    }, staleSyncAttempts === 0 ? 1800 : 4200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [entries.length, onRefreshAfterThemeReply, patterns, staleSyncAttempts])

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

  const distinctDimensions = useMemo(
    () => filterDistinctLines(selectedPattern?.dimensions ?? [], selectedPattern?.overview ?? ''),
    [selectedPattern],
  )

  const distinctQuestions = useMemo(
    () =>
      filterDistinctLines(
        selectedPattern?.questions ?? [],
        `${selectedPattern?.overview ?? ''}\n${(selectedPattern?.dimensions ?? []).join('\n')}`,
      ),
    [selectedPattern],
  )

  const patternGroups = useMemo(() => {
    const dominant = patterns.slice(0, 2)
    const supporting = patterns.slice(2).filter((pattern) => (pattern.prominence ?? (pattern.entryCount <= 1 ? 'quiet' : 'supporting')) === 'supporting')
    const quiet = patterns.slice(2).filter((pattern) => (pattern.prominence ?? (pattern.entryCount <= 1 ? 'quiet' : 'supporting')) === 'quiet')

    return [
      {
        id: 'dominant',
        title: 'Dominant right now',
        summary: 'The themes with the strongest mix of recurrence, coherence, and live charge.',
        patterns: dominant,
      },
      {
        id: 'supporting',
        title: 'Active undercurrents',
        summary: 'Meaningful threads that are present, but not carrying the whole dashboard.',
        patterns: supporting,
      },
      {
        id: 'quiet',
        title: 'Quiet signals',
        summary: 'Early or more specific themes worth keeping in the map without over-promoting them.',
        patterns: quiet,
      },
    ].filter((group) => group.patterns.length)
  }, [patterns])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPattern || !message.trim()) return
    const question = message.trim()
    const patternId = selectedPattern.id
    const pendingAssistantId = `${patternId}-assistant-pending-${Date.now()}`
    try {
      setBusy(true)
      setThemeThreads((current) => ({
        ...current,
        [patternId]: [
          ...(current[patternId] ?? []),
          {
            id: `${patternId}-user-${Date.now()}`,
            role: 'user',
            content: question,
          },
          {
            id: pendingAssistantId,
            role: 'assistant',
            content: 'Thinking through this theme...',
            state: 'pending',
          },
        ],
      }))
      setMessage('')
      const response = await createPatternReply(selectedPattern, question)
      setThemeThreads((current) => ({
        ...current,
        [patternId]: (current[patternId] ?? []).map((threadMessage) =>
          threadMessage.id === pendingAssistantId
            ? {
                ...threadMessage,
                content: response.answer,
                state: 'complete',
              }
            : threadMessage,
        ),
      }))
      setRefreshingThread(true)
      void onRefreshAfterThemeReply().finally(() => {
        setRefreshingThread(false)
      })
    } catch {
      setThemeThreads((current) => ({
        ...current,
        [patternId]: (current[patternId] ?? []).map((threadMessage) =>
          threadMessage.id === pendingAssistantId
            ? {
                ...threadMessage,
                content: 'That reply failed to come through. Try sending it again.',
                state: 'complete',
              }
            : threadMessage,
        ),
      }))
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
            <div className="pattern-home-stack">
              {patternGroups.map((group) => (
                <section className="pattern-tier-section" key={group.id}>
                  <div className="pattern-tier-header">
                    <p className="subtle-label">{group.title}</p>
                    <p className="pattern-tier-summary">{group.summary}</p>
                  </div>
                  <div className="pattern-home-list">
                    {group.patterns.map((pattern) => {
                      const globalIndex = patterns.findIndex((candidate) => candidate.id === pattern.id)
                      return (
                        <button
                          className={`pattern-home-card ${globalIndex < 2 ? 'dominant' : ''}`}
                          key={pattern.id}
                          onClick={() => setSelectedPatternId(pattern.id)}
                          type="button"
                        >
                          <div className="pattern-home-meta">
                            <strong>{pattern.title}</strong>
                            <span className={`pattern-status ${pattern.status}`}>{statusLabel(pattern.status)}</span>
                          </div>
                          <p className="pattern-prominence-copy">{prominenceLabel(pattern, globalIndex)}</p>
                          <p className="pattern-home-preview">{pattern.overview}</p>
                          <small>{pattern.entryCount} related entr{pattern.entryCount === 1 ? 'y' : 'ies'}</small>
                        </button>
                      )
                    })}
                  </div>
                </section>
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

            <article className="pattern-overview expanded">
              <p className="subtle-label">State of affairs</p>
              <ReactMarkdown>{selectedPattern.overview}</ReactMarkdown>
            </article>

            <div className="pattern-detail-grid simplified">
              {distinctDimensions.length ? (
                <div className="pattern-column wide">
                  <p className="subtle-label">How it shows up</p>
                  <ul className="pattern-list compact">
                    {distinctDimensions.map((dimension) => (
                      <li className="pattern-list-item relaxed" key={dimension}>
                        <ReactMarkdown>{dimension}</ReactMarkdown>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {distinctQuestions.length ? (
                <div className="pattern-column wide">
                  <p className="subtle-label">Questions worth testing</p>
                  <ul className="pattern-list compact">
                    {distinctQuestions.map((question) => (
                      <li className="pattern-list-item relaxed" key={question}>
                        <ReactMarkdown>{question}</ReactMarkdown>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="pattern-entry-links">
              <p className="subtle-label">Where this shows up</p>
              <div className="related-entry-list">
                {supportingEntries.map((entry) => (
                  <button className="related-entry-card" key={entry.id} onClick={() => onOpenEntry(entry.id)} type="button">
                    <strong>{entry.title}</strong>
                    <span>{entry.summary}</span>
                    {entry.feedLabels.length ? (
                      <div className="entry-bullets compact">
                        {entry.feedLabels.slice(0, 3).map((label) => (
                          <span className="bullet-pill" key={`${entry.id}-${label}`}>
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <section className="pattern-thread-shell">
              <div className="conversation-header pattern-thread-header">
                <div>
                  <p className="subtle-label">Theme chat</p>
                  <p className="pattern-thread-summary">Open this when you want an ongoing back-and-forth with the theme.</p>
                </div>
                <div className="pattern-thread-actions">
                  {refreshingThread ? (
                    <span className="thread-sync-indicator">
                      <LoaderCircle className="spin" size={14} />
                      Refreshing patterns
                    </span>
                  ) : null}
                  <button className="ghost-button" onClick={() => setShowChatPanel((current) => !current)} type="button">
                    {showChatPanel ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {showChatPanel ? 'Collapse chat' : 'Open chat'}
                  </button>
                </div>
              </div>

              {showChatPanel ? (
                <>
                  {selectedPattern.exploreOptions.length ? (
                    <div className="pattern-explore">
                      <p className="subtle-label">Starter questions</p>
                      <p className="hint">Tap one to drop it into the chat box, then edit or send it.</p>
                      <div className="explore-options stacked">
                        {selectedPattern.exploreOptions.map((option) => (
                          <button className="option-chip" key={option} onClick={() => setMessage(option)} type="button">
                            <Sparkles size={14} />
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="conversation-list pattern-thread">
                    {selectedThread.length ? (
                      selectedThread.map((threadMessage) => (
                        <article className={`message ${threadMessage.role} ${threadMessage.state === 'pending' ? 'pending' : ''}`} key={threadMessage.id}>
                          <div className="message-meta">
                            <span>{threadMessage.role === 'user' ? 'You' : 'Theme'}</span>
                            {threadMessage.state === 'pending' ? <span>Writing...</span> : null}
                          </div>
                          <ReactMarkdown>{threadMessage.content}</ReactMarkdown>
                        </article>
                      ))
                    ) : (
                      <div className="pattern-thread-empty">
                        <MessageSquareText size={18} />
                        <div>
                          <strong>No messages yet.</strong>
                          <p className="muted">Ask what is actually driving this theme, what changed recently, or what evidence would challenge your current read.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <form className="reply-form pattern-chat" onSubmit={handleSubmit}>
                    <textarea
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Ask about this theme, test an interpretation, or follow one strand further."
                      rows={4}
                      value={message}
                    />
                    <button className="primary-button" disabled={busy || !message.trim()} type="submit">
                      {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                      {busy ? 'Thinking...' : 'Send'}
                    </button>
                  </form>

                  {selectedThread.length ? (
                    <p className="muted pattern-reply-note">
                      This thread is saved on this device and its ideas are folded back into the living memory and theme state.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted">Chat is collapsed. Open it when you want to ask a follow-up question.</p>
              )}
            </section>

          </div>
        ) : null}
      </div>
    </section>
  )
}
