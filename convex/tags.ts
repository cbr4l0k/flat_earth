import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'

export const toggleOnCard = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
    title: v.string(),
  },
  handler: async (ctx, { accountId, cardId, title }) => {
    await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    const normalized = title.trim().toLowerCase()
    if (!normalized) {
      throw new ConvexError('Tag title is required')
    }

    let tag = await ctx.db
      .query('tags')
      .withIndex('by_account_title', (q) => q.eq('accountId', accountId).eq('title', normalized))
      .unique()

    if (!tag) {
      const tagId = await ctx.db.insert('tags', {
        accountId,
        title: normalized,
      })
      tag = await ctx.db.get("tags", tagId)
    }

    if (!tag) {
      throw new ConvexError('Unable to create tag')
    }

    const existing = await ctx.db
      .query('taggings')
      .withIndex('by_card_tag', (q) => q.eq('cardId', cardId).eq('tagId', tag._id))
      .unique()

    if (existing) {
      await ctx.db.delete("taggings", existing._id)
      return { tagged: false, tagId: tag._id }
    }

    await ctx.db.insert('taggings', {
      accountId,
      cardId,
      tagId: tag._id,
    })

    return { tagged: true, tagId: tag._id }
  },
})

export const listByCard = query({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId)

    const taggings = await ctx.db
      .query('taggings')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()

    const tags = await Promise.all(taggings.map((tagging) => ctx.db.get("tags", tagging.tagId)))
    return tags.filter((tag) => tag !== null)
  },
})

export const listByAccount = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    await requireAccountAccess(ctx, accountId)

    return ctx.db
      .query('tags')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect()
  },
})

export const deleteUnused = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db.query('tags').collect()

    for (const tag of tags) {
      const used = await ctx.db
        .query('taggings')
        .withIndex('by_tag', (q) => q.eq('tagId', tag._id))
        .first()

      if (!used) {
        await ctx.db.delete("tags", tag._id)
      }
    }
  },
})
