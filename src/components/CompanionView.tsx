import { LoaderCircle, MessageSquareText, Send, Sparkles, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { createCompanionReply } from '../lib/api'
import type { PatternsBrief } from '../types'

type CompanionMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  state?: 'pending' | 'complete'
}

type CompanionViewProps = {
  patternsBrief: PatternsBrief | null
  onRefreshAfterReply: () => Promise<void>
}

const DEFAULT_CURRENT_TAKE = 'Knowing what you know about me from the journal, what is your take on where things stand right now and what questions matter most?'

export function CompanionView({ onRefreshAfterReply, patternsBrief }: CompanionViewProps) {
  const [message, setMessage] = useState('')
  const [thread, setThread] = useState<CompanionMessage[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('journal-companion-thread')
      if (stored) {
        setThread(JSON.parse(stored) as CompanionMessage[])
      }
    } catch {
      // Ignore local storage issues and keep the thread in-memory only.
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('journal-companion-thread', JSON.stringify(thread))
    } catch {
      // Ignore local storage issues and keep the thread in-memory only.
    }
  }, [thread])

  async function sendMessage(content?: string) {
    const nextMessage = (content ?? message).trim()
    if (!nextMessage) return

    const isCurrentTake = nextMessage === DEFAULT_CURRENT_TAKE
    const pendingAssistantId = `companion-assistant-pending-${Date.now()}`

    try {
      setBusy(true)
      setThread((current) => [
        ...current,
        ...(!isCurrentTake ? [{
          id: `companion-user-${Date.now()}`,
          role: 'user' as const,
          content: nextMessage,
        }] : []),
        {
          id: pendingAssistantId,
          role: 'assistant',
          content: 'Thinking this through...',
          state: 'pending',
        },
      ])
      setMessage('')

      const response = await createCompanionReply({
        content: isCurrentTake ? undefined : nextMessage,
        thread: [
          ...thread.map((item) => ({
            role: item.role,
            content: item.content,
          })),
          ...(!isCurrentTake ? [{
            role: 'user' as const,
            content: nextMessage,
          }] : []),
        ],
      })

      setThread((current) =>
        current.map((threadMessage) =>
          threadMessage.id === pendingAssistantId
            ? {
                ...threadMessage,
                content: response.answer,
                state: 'complete',
              }
            : threadMessage,
        ),
      )
      if (!isCurrentTake) {
        void onRefreshAfterReply()
      }
    } catch {
      setThread((current) =>
        current.map((threadMessage) =>
          threadMessage.id === pendingAssistantId
            ? {
                ...threadMessage,
                content: 'That reply did not come through. Try sending it again.',
                state: 'complete',
              }
            : threadMessage,
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendMessage()
  }

  const starterPrompts = [
    DEFAULT_CURRENT_TAKE,
    'What seems most important beneath everything I have been writing lately?',
    'Where do you think I may be narrowing too quickly or telling myself the wrong story?',
    patternsBrief?.prompt?.text ?? '',
  ].filter((item, index, items) => item && items.indexOf(item) === index)

  return (
    <section className="companion-shell">
      <div className="panel conversation-panel companion-panel">
        <div className="conversation-header companion-header">
          <div>
            <p className="subtle-label">Companion</p>
            <p className="companion-summary">
              Open-ended conversation grounded in your journal, current themes, and recent entries.
            </p>
          </div>
          <div className="companion-actions">
            <button className="ghost-button" disabled={busy} onClick={() => void sendMessage(DEFAULT_CURRENT_TAKE)} type="button">
              {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
              {busy ? 'Thinking...' : 'Get current take'}
            </button>
            <button
              className="ghost-button"
              disabled={busy || !thread.length}
              onClick={() => {
                setThread([])
                setMessage('')
                try {
                  window.localStorage.removeItem('journal-companion-thread')
                } catch {
                  // Ignore local storage issues.
                }
              }}
              type="button"
            >
              <Trash2 size={16} />
              Clear chat
            </button>
          </div>
        </div>

        {!thread.length ? (
          <div className="companion-empty">
            <MessageSquareText size={18} />
            <div>
              <strong>No conversation yet.</strong>
              <p className="muted">Ask for a current take, pressure-test a story you are telling yourself, or bring a question you want to think through.</p>
            </div>
          </div>
        ) : null}

        {starterPrompts.length ? (
          <div className="pattern-explore companion-starters">
            <p className="subtle-label">Start with</p>
            <div className="explore-options stacked">
              {starterPrompts.map((prompt) => (
                <button className="option-chip" key={prompt} onClick={() => setMessage(prompt)} type="button">
                  <Sparkles size={14} />
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="conversation-list companion-thread chat-bubbles">
          {thread.map((threadMessage) => (
            <article className={`message ${threadMessage.role} ${threadMessage.state === 'pending' ? 'pending' : ''}`} key={threadMessage.id}>
              <div className="message-meta">
                <span>{threadMessage.role === 'user' ? 'You' : 'Companion'}</span>
                {threadMessage.state === 'pending' ? <span>Writing...</span> : null}
              </div>
              <ReactMarkdown>{threadMessage.content}</ReactMarkdown>
            </article>
          ))}
        </div>

        <form className="reply-form companion-chat" onSubmit={handleSubmit}>
          <textarea
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Bring a question, a decision, a fear, or ask for a clearer read on what is going on."
            rows={4}
            value={message}
          />
          <button className="primary-button" disabled={busy || !message.trim()} type="submit">
            {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            {busy ? 'Thinking...' : 'Send'}
          </button>
        </form>
      </div>
    </section>
  )
}
