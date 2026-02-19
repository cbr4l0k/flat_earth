import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { MAX_ASSIGNMENTS_BY_CARD } from './constants'
import { requireAccountAccess } from './lib/auth'

export const toggle = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
    assigneeId: v.id('users'),
  },
  handler: async (ctx, { accountId, cardId, assigneeId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    const assignee = await ctx.db.get("users", assigneeId)
    if (!assignee || assignee.accountId !== accountId || !assignee.active) {
      throw new ConvexError('Assignee not found')
    }

    const existing = await ctx.db
      .query('assignments')
      .withIndex('by_card_assignee', (q) => q.eq('cardId', cardId).eq('assigneeId', assigneeId))
      .unique()

    if (existing) {
      await ctx.db.delete("assignments", existing._id)
      return { assigned: false }
    }

    const assignments = await ctx.db
      .query('assignments')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()

    if (assignments.length >= MAX_ASSIGNMENTS_BY_CARD) {
      throw new ConvexError(`Card cannot have more than ${MAX_ASSIGNMENTS_BY_CARD} assignees`)
    }

    await ctx.db.insert('assignments', {
      accountId,
      cardId,
      assigneeId,
      assignerId: user._id,
    })

    return { assigned: true }
  },
})

export const listByCard = query({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId)

    const assignments = await ctx.db
      .query('assignments')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()

    return Promise.all(
      assignments.map(async (a) => {
        const assignee = await ctx.db.get("users", a.assigneeId)
        return {
          ...a,
          assigneeName: assignee?.name ?? 'Unknown',
        }
      }),
    )
  },
})
