import type { Doc } from '../_generated/dataModel'

export type EffectiveStatus = 'drafted' | 'active' | 'closed' | 'not_now' | 'triage'

export function getEffectiveStatus(card: Doc<'cards'>): EffectiveStatus {
  if (card.status === 'drafted') return 'drafted'
  if (card.closedAt) return 'closed'
  if (card.postponedAt) return 'not_now'
  if (card.columnId === null) return 'triage'
  return 'active'
}
