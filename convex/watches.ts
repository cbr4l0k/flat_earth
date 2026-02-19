import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'

export const toggle = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
  },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    const existing = await ctx.db
      .query('watches')
      .withIndex('by_user_card', (q) => q.eq('userId', user._id).eq('cardId', cardId))
      .unique()

    if (!existing) {
      await ctx.db.insert('watches', {
        accountId,
        cardId,
        userId: user._id,
        watching: true,
      })
      return { watching: true }
    }

    await ctx.db.patch("watches", existing._id, { watching: !existing.watching })
    return { watching: !existing.watching }
  },
})

export const isWatching = query({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
  },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const watch = await ctx.db
      .query('watches')
      .withIndex('by_user_card', (q) => q.eq('userId', user._id).eq('cardId', cardId))
      .unique()

    return Boolean(watch?.watching)
  },
})
