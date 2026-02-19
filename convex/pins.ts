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
      .query('pins')
      .withIndex('by_card_user', (q) => q.eq('cardId', cardId).eq('userId', user._id))
      .unique()

    if (existing) {
      await ctx.db.delete("pins", existing._id)
      return { pinned: false }
    }

    await ctx.db.insert('pins', {
      accountId,
      cardId,
      userId: user._id,
    })

    return { pinned: true }
  },
})

export const listMy = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const pins = await ctx.db
      .query('pins')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const cards = await Promise.all(pins.map((pin) => ctx.db.get("cards", pin.cardId)))
    return cards.filter((card) => card !== null)
  },
})
