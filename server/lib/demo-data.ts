import type {
  JournalEntry,
  ConversationMessageRecord,
  HighlightRecord,
  MemoryDocumentRecord,
} from '../types.js'

const now = new Date()

export const demoMemoryDoc: MemoryDocumentRecord = {
  id: 'memory-demo',
  userId: 'demo-user',
  updatedAt: now.toISOString(),
  content: `## Open Threads
- [Today] Whether to keep optimizing for certainty before making a visible move

## Recurring Themes
- Reaching for over-analysis when a decision would create more clarity than more thinking
- Friction between ambition and the fear of choosing a path too early

## Questions Worth Revisiting
- What decision would create more clarity than another week of thinking?
- Where are you still calling self-protection discernment?`,
}

export const demoEntries: JournalEntry[] = [
  {
    id: 'entry-demo-1',
    userId: 'demo-user',
    createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
    rawText:
      'I keep saying I want to move faster, but I still spend most of my energy trying to avoid visible mistakes. The tradeoff is starting to feel dishonest.',
    source: 'typed',
    title: 'Speed versus self-protection',
    tags: ['Decisions', 'Identity', 'Work'],
    photoUrls: [],
    summary: 'Wants speed, still organizes life around avoiding visible mistakes.',
    hasOpenThreads: true,
    analysis: {
      title: 'Speed versus self-protection',
      summary: 'You want momentum, but your behavior is still optimized around avoiding visible mistakes.',
      contextBullets: [
        'Wants to move faster but keeps organizing behavior around avoiding visible mistakes',
        'The tradeoff is starting to feel dishonest rather than prudent',
      ],
      sections: [
        {
          id: 'main-read',
          title: 'Main read',
          content:
            'You are not confused about what you want. You want momentum, but you keep structuring your behavior around self-protection instead.',
        },
        {
          id: 'underneath',
          title: 'What seems active underneath',
          content:
            'The hidden move is treating caution as sophistication. That lets you postpone embarrassment while still feeling serious.',
        },
      ],
      exploreOptions: [
        'Trace where caution is pretending to be wisdom',
        'Find the one delayed decision that matters most',
        'Turn this into a concrete move for the next week',
      ],
      feedLabels: ['Visible risk', 'Self-protection', 'Decision avoidance'],
    },
  },
]

export const demoConversations: ConversationMessageRecord[] = [
  {
    id: 'conv-demo-1',
    entryId: 'entry-demo-1',
    role: 'assistant',
    content:
      'You keep framing the bottleneck as incomplete thinking, but the entry reads like you already know the answer and dislike the exposure that comes with acting on it.',
    createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 5 + 1000 * 60).toISOString(),
  },
]

export const demoHighlights: HighlightRecord[] = [
  {
    id: 'highlight-demo-1',
    userId: 'demo-user',
    source: 'kindle',
    content: 'Between stimulus and response there is a space. In that space is our power to choose.',
    bookTitle: 'Man’s Search for Meaning',
    author: 'Viktor Frankl',
    highlightDate: now.toISOString(),
  },
]
