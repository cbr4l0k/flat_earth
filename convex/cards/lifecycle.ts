import { ConvexError, v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireAccountAccess } from '../lib/auth'

export const publish = mutation({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    if (card.status !== 'drafted') {
      throw new ConvexError('Only drafted cards can be published')
    }

    const title = card.title.trim() || `Card #${card.number}`

    await ctx.db.patch("cards", cardId, {
      status: 'published',
      title,
      lastActiveAt: Date.now(),
    })

    await ctx.db.insert('events', {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: 'card_published',
      eventable: { type: 'card', id: cardId },
    })
  },
})

export const close = mutation({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    if (card.status !== 'published') {
      throw new ConvexError('Can only close published cards')
    }

    if (card.closedAt) {
      throw new ConvexError('Already closed')
    }

    await ctx.db.patch("cards", cardId, {
      closedAt: Date.now(),
      closedBy: user._id,
      postponedAt: undefined,
      postponedBy: undefined,
      lastActiveAt: Date.now(),
    })

    await ctx.db.insert('events', {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: 'card_closed',
      eventable: { type: 'card', id: cardId },
    })
  },
})

export const reopen = mutation({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    if (!card.closedAt) {
      throw new ConvexError('Card is not closed')
    }

    await ctx.db.patch("cards", cardId, {
      closedAt: undefined,
      closedBy: undefined,
      lastActiveAt: Date.now(),
    })

    await ctx.db.insert('events', {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: 'card_reopened',
      eventable: { type: 'card', id: cardId },
    })
  },
})

export const postpone = mutation({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    if (card.status !== 'published') {
      throw new ConvexError('Can only postpone published cards')
    }

    if (card.postponedAt) {
      throw new ConvexError('Already postponed')
    }

    await ctx.db.patch("cards", cardId, {
      postponedAt: Date.now(),
      postponedBy: user._id,
      columnId: null,
      closedAt: undefined,
      closedBy: undefined,
      activitySpikeAt: undefined,
      lastActiveAt: Date.now(),
    })

    await ctx.db.insert('events', {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: 'card_postponed',
      eventable: { type: 'card', id: cardId },
    })
  },
})

export const resume = mutation({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    if (!card.postponedAt) {
      throw new ConvexError('Card is not postponed')
    }

    await ctx.db.patch("cards", cardId, {
      postponedAt: undefined,
      postponedBy: undefined,
      closedAt: undefined,
      closedBy: undefined,
      activitySpikeAt: undefined,
      lastActiveAt: Date.now(),
    })

    await ctx.db.insert('events', {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: 'card_resumed',
      eventable: { type: 'card', id: cardId },
    })
  },
})

export const triageInto = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
    columnId: v.id('columns'),
  },
  handler: async (ctx, { accountId, cardId, columnId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    const column = await ctx.db.get("columns", columnId)
    if (!column || column.boardId !== card.boardId || column.accountId !== accountId) {
      throw new ConvexError('Column not on this board')
    }

    await ctx.db.patch("cards", cardId, {
      columnId,
      postponedAt: undefined,
      postponedBy: undefined,
      activitySpikeAt: undefined,
      lastActiveAt: Date.now(),
    })

    await ctx.db.insert('events', {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: 'card_triaged',
      eventable: { type: 'card', id: cardId },
      particulars: { column: column.name },
    })
  },
})

export const sendToTriage = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
  },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    await ctx.db.patch("cards", cardId, {
      columnId: null,
      postponedAt: undefined,
      postponedBy: undefined,
      closedAt: undefined,
      closedBy: undefined,
      lastActiveAt: Date.now(),
    })
  },
})

export const toggleGolden = mutation({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    await ctx.db.patch("cards", cardId, { isGolden: !card.isGolden })
  },
})
