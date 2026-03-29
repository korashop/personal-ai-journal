import { MessageSquareMore, PanelTopOpen } from 'lucide-react'
import { format } from 'date-fns'

import type { EntryListItem } from '../types'

type EntryFeedProps = {
  entries: EntryListItem[]
  selectedEntryId: string | null
  onSelect: (entryId: string) => void
  mode: 'list' | 'detail'
}

export function EntryFeed({ entries, mode, selectedEntryId, onSelect }: EntryFeedProps) {
  return (
    <section className={`entry-browser ${mode === 'detail' ? 'compact' : ''}`}>
      <div className="entry-browser-header">
        <span>Entries</span>
        <span>{entries.length}</span>
      </div>
      {entries.map((entry) => (
        <button
          className={`entry-row ${selectedEntryId === entry.id ? 'selected' : ''}`}
          key={entry.id}
          onClick={() => onSelect(entry.id)}
          type="button"
        >
          <div className="entry-row-date">
            <span className="entry-date">{format(new Date(entry.createdAt), 'MMM d')}</span>
          </div>
          <div className="entry-row-main">
            <h3>{entry.title}</h3>
            <p className={`entry-kicker ${mode === 'detail' ? 'compact' : ''}`}>{mode === 'detail' ? entry.summary : entry.summary}</p>
            {mode === 'detail' ? (
              <div className="entry-row-inline-meta">
                {entry.feedLabels[0] ? <span className="entry-inline-label">{entry.feedLabels[0]}</span> : null}
                <span className="conversation-count">
                  <MessageSquareMore size={14} />
                  {entry.conversationCount}
                </span>
              </div>
            ) : null}
          </div>
          <div className={`entry-row-meta ${mode === 'detail' ? 'desktop-only' : ''}`}>
            {entry.hasOpenThreads ? (
              <span className="thread-indicator">
                <PanelTopOpen size={14} />
                Open
              </span>
            ) : null}
            <span className="conversation-count">
              <MessageSquareMore size={14} />
              {entry.conversationCount}
            </span>
          </div>
        </button>
      ))}
    </section>
  )
}
