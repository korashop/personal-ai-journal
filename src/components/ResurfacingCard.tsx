import { Sparkles } from 'lucide-react'

import type { ResurfacingCard as ResurfacingCardType } from '../types'

type Props = {
  card: ResurfacingCardType | null
}

export function ResurfacingCard({ card }: Props) {
  if (!card) {
    return null
  }

  return (
    <section className="resurface-card">
      <div className="resurface-icon">
        <Sparkles size={16} />
      </div>
      <div>
        <p className="eyebrow">One thing worth engaging today</p>
        <h2>{card.title}</h2>
        <p>{card.description}</p>
      </div>
    </section>
  )
}
