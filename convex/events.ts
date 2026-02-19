import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'

export const listRecent = query({
  args: {
    accountId: v.id('accounts'),
    boardId: v.optional(v.id('boards')),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId)

    const events = await ctx.db
      .query('events')
      .withIndex('by_account_action', (q) => q.eq('accountId', accountId))
      .order('desc')
      .take(100)

    if (!boardId) return events
    return events.filter((event) => event.boardId === boardId)
  },
})
