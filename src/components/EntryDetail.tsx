import { useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronUp, LoaderCircle, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { format } from 'date-fns'
import type { FormEvent } from 'react'

import type { EntryRecord } from '../types'

function cleanDigestBullet(text: string) {
  return text
    .replace(/[*_`#]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/:\s*-\s*[A-Za-z0-9]{0,2}\s*$/g, '')
    .replace(/\s*-\s*[A-Za-z0-9]{1,2}\s*$/g, '')
    .trim()
}

type EntryDetailProps = {
  busy: boolean
  entry: EntryRecord | null
  loadingEntry: boolean
  onBack: () => void
  onDelete: () => Promise<void>
  onReanalyze: () => Promise<void>
  onReply: (content: string) => Promise<void>
  onSaveEdit: (rawText: string) => Promise<void>
}

export function EntryDetail({ busy, entry, loadingEntry, onBack, onDelete, onReanalyze, onReply, onSaveEdit }: EntryDetailProps) {
  const [reply, setReply] = useState('')
  const [showRawEntry, setShowRawEntry] = useState(false)
  const [showDeeperOptions, setShowDeeperOptions] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => entry?.rawText ?? '')

  const conversation = useMemo(() => {
    if (!entry) return []
    if (entry.conversation[0]?.role === 'assistant') {
      return entry.conversation.slice(1)
    }
    return entry.conversation
  }, [entry])

  const hasPendingPhotoOcr = useMemo(
    () => Boolean(entry?.rawText.includes('[OCR unavailable for this image]') || entry?.rawText.includes('[OCR unavailable right now]')),
    [entry?.rawText],
  )

  const visibleSections = (() => {
    if (!entry?.analysis?.sections) return []
    const summaryBaseline = entry.analysis.summary.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160)

    return entry.analysis.sections.filter((section, index, sections) => {
      const current = section.content.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!current) return false
      if (section.title === 'Overview' && current.startsWith('the center of gravity here is:')) return false
      if (/^[-–]?\s*\d[\d./-]*\.?$/.test(current)) return false

      const previous = sections[index - 1]?.content.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
      const currentPrefix = current.slice(0, 160)
      const previousPrefix = previous.slice(0, 160)

      if (currentPrefix === summaryBaseline || currentPrefix.startsWith(summaryBaseline) || summaryBaseline.startsWith(currentPrefix)) {
        return false
      }

      if (index === 0) return true

      return currentPrefix !== previousPrefix && !currentPrefix.startsWith(previousPrefix) && !previousPrefix.startsWith(currentPrefix)
    })
  })()

  if (!entry) {
    return (
      <section className="panel detail-panel empty-state">
        <h2>{loadingEntry ? 'Opening entry...' : 'Select an entry to open it.'}</h2>
        <p className="muted">
          {loadingEntry
            ? 'The entry is loading now.'
            : 'The list is the home base here. Open one when you want to go deep.'}
        </p>
      </section>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reply.trim()) {
      return
    }

    await onReply(reply.trim())
    setReply('')
  }

  async function handleSaveEdit() {
    if (!draft.trim()) return
    await onSaveEdit(draft.trim())
    setEditing(false)
  }

  return (
    <section className="detail-panel">
      <div className="panel detail-surface">
        <div className="detail-header-row">
          <div>
            <button className="ghost-button back-button" onClick={onBack} type="button">
              <ChevronLeft size={16} />
              All entries
            </button>
            <p className="detail-date">{format(new Date(entry.createdAt), 'MMMM d, yyyy')}</p>
            <h2>{entry.title}</h2>
          </div>
          <div className="detail-actions">
            <button className="ghost-button" onClick={() => setShowRawEntry((current) => !current)} type="button">
              {showRawEntry ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showRawEntry ? 'Hide source' : 'Show source'}
            </button>
            <button className="ghost-button" onClick={() => setEditing((current) => !current)} type="button">
              <Pencil size={16} />
              {editing ? 'Cancel edit' : 'Edit'}
            </button>
            <button className="ghost-button" onClick={() => void onReanalyze()} type="button">
              <RotateCcw size={16} />
              Re-analyze
            </button>
            <button className="ghost-button danger-button" onClick={() => void onDelete()} type="button">
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>

        {entry.analysis?.entryDigest.length ? (
          <div className="entry-digest">
            <p className="subtle-label">At a glance</p>
            <ul className="entry-digest-list">
              {entry.analysis.entryDigest.map((bullet) => (
                <li key={bullet}>{cleanDigestBullet(bullet)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {entry.analysis?.contextBullets.length ? (
          <div className="entry-context-brief">
            <p className="subtle-label">Context from the raw entry</p>
            <ul className="entry-context-list">
              {entry.analysis.contextBullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {showRawEntry ? (
          <div className="raw-entry-shell">
            {hasPendingPhotoOcr ? (
              <div className="source-note">
                <p className="subtle-label">Photo status</p>
                <p className="muted">These images were uploaded and stored, but OCR could not be read from one or more attachments. Any insight here may be partial unless you add typed context too.</p>
              </div>
            ) : null}
            {editing ? (
              <div className="edit-shell">
                <textarea className="entry-textarea" onChange={(event) => setDraft(event.target.value)} rows={12} value={draft} />
                <div className="edit-actions">
                  <button className="primary-button" disabled={busy || !draft.trim()} onClick={() => void handleSaveEdit()} type="button">
                    Save and refresh analysis
                  </button>
                </div>
              </div>
            ) : (
              <div className="raw-entry">
                {entry.rawText.split('\n').map((line, index) => (
                  <p key={`${entry.id}-${index}`}>{line}</p>
                ))}
              </div>
            )}
            {entry.photoUrls.length ? (
              <div className="attached-images">
                {entry.photoUrls.map((photoUrl, index) => (
                  <a className="image-link" href={photoUrl} key={`${photoUrl}-${index}`} rel="noreferrer" target="_blank">
                    Attachment {index + 1}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="detail-reading-column">
          <div className="analysis-stack">
          {visibleSections.map((section) => (
            <article className="analysis-card flowing" key={section.id}>
              {section.title !== 'Overview' ? <h3>{section.title}</h3> : null}
              <ReactMarkdown>{section.content}</ReactMarkdown>
            </article>
          ))}
          </div>

          {entry.analysis?.exploreOptions.length ? (
            <section className="explore-shell">
              <button className="ghost-button" onClick={() => setShowDeeperOptions((current) => !current)} type="button">
                {showDeeperOptions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showDeeperOptions ? 'Hide deeper directions' : 'Go deeper'}
              </button>
              {showDeeperOptions ? (
                <div className="explore-options stacked">
                  {entry.analysis.exploreOptions.map((option) => (
                    <button
                      className="option-chip"
                      key={option}
                      onClick={() => setReply(option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      <div className="panel conversation-panel">
        <div className="conversation-header">
          <p className="subtle-label">Conversation</p>
        </div>
        <div className="conversation-list">
          {conversation.length ? (
            conversation.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-meta">
                  <span>{message.role === 'assistant' ? 'Journal AI' : 'You'}</span>
                  <span>{format(new Date(message.createdAt), 'MMM d, HH:mm')}</span>
                </div>
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </article>
            ))
          ) : (
            <p className="muted">No follow-up thread yet.</p>
          )}
        </div>

        <form className="reply-form" onSubmit={handleSubmit}>
          <textarea
            onChange={(event) => setReply(event.target.value)}
            placeholder="Reply, push on a theme, or choose one of the deeper directions above."
            rows={4}
            value={reply}
          />
          <button className="primary-button" disabled={busy || !reply.trim()} type="submit">
            {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            {busy ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </section>
  )
}
