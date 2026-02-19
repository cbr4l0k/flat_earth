import { ConvexError, v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { mutation, query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'
import { canAdministerCard, requireBoardAccess } from './lib/permissions'

export const create = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, boardId, title }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    const account = await ctx.db.get("accounts", accountId)
    if (!account) {
      throw new ConvexError('Account not found')
    }

    const nextNumber = account.cardsCount + 1

    const cardId = await ctx.db.insert('cards', {
      accountId,
      boardId,
      columnId: null,
      creatorId: user._id,
      title: title?.trim() ?? '',
      number: nextNumber,
      status: 'drafted',
      lastActiveAt: Date.now(),
      isGolden: false,
    })

    await ctx.db.patch("accounts", accountId, { cardsCount: nextNumber })
    return cardId
  },
})

export const get = query({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) return null

    await requireBoardAccess(ctx, user, card.boardId)

    const creator = await ctx.db.get("users", card.creatorId)
    return { ...card, creatorName: creator?.name ?? 'Unknown' }
  },
})

export const getByNumber = query({
  args: { accountId: v.id('accounts'), number: v.number() },
  handler: async (ctx, { accountId, number }) => {
    await requireAccountAccess(ctx, accountId)

    return ctx.db
      .query('cards')
      .withIndex('by_account_number', (q) => q.eq('accountId', accountId).eq('number', number))
      .unique()
  },
})

export const listByBoard = query({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    return ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()
  },
})

export const listByColumn = query({
  args: { accountId: v.id('accounts'), columnId: v.id('columns') },
  handler: async (ctx, { accountId, columnId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const column = await ctx.db.get("columns", columnId)
    if (!column || column.accountId !== accountId) return []

    await requireBoardAccess(ctx, user, column.boardId)

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_column', (q) => q.eq('columnId', columnId))
      .collect()

    return cards.filter((c) => c.status === 'published' && !c.closedAt && !c.postponedAt)
  },
})

export const listTriage = query({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    return cards.filter(
      (c) => c.status === 'published' && c.columnId === null && !c.closedAt && !c.postponedAt,
    )
  },
})

export const update = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    dueOn: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { accountId, cardId, title, description, dueOn }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    await requireBoardAccess(ctx, user, card.boardId)

    const patch: {
      lastActiveAt: number
      title?: string
      description?: string
      dueOn?: string | undefined
    } = {
      lastActiveAt: Date.now(),
    }

    if (title !== undefined) patch.title = title.trim()
    if (description !== undefined) patch.description = description
    if (dueOn !== undefined) patch.dueOn = dueOn ?? undefined

    await ctx.db.patch("cards", cardId, patch)
  },
})

export const moveToColumn = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
    columnId: v.union(v.id('columns'), v.null()),
  },
  handler: async (ctx, { accountId, cardId, columnId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    await requireBoardAccess(ctx, user, card.boardId)

    if (columnId !== null) {
      const column = await ctx.db.get("columns", columnId)
      if (!column || column.boardId !== card.boardId || column.accountId !== accountId) {
        throw new ConvexError('Column not on this board')
      }
    }

    await ctx.db.patch("cards", cardId, { columnId, lastActiveAt: Date.now() })
  },
})

export const moveToBoard = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
    newBoardId: v.id('boards'),
  },
  handler: async (ctx, { accountId, cardId, newBoardId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    await requireBoardAccess(ctx, user, card.boardId)
    await requireBoardAccess(ctx, user, newBoardId)

    const newBoard = await ctx.db.get("boards", newBoardId)
    if (!newBoard || newBoard.accountId !== accountId) {
      throw new ConvexError('Board not found')
    }

    await ctx.db.patch("cards", cardId, {
      boardId: newBoardId,
      columnId: null,
      lastActiveAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const card = await ctx.db.get("cards", cardId)
    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    await requireBoardAccess(ctx, user, card.boardId)

    if (!canAdministerCard(user, card)) {
      throw new ConvexError('Not authorized')
    }

    const comments = await ctx.db
      .query('comments')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()
    for (const comment of comments) {
      await ctx.db.delete('comments', comment._id)
    }

    const assignments = await ctx.db
      .query('assignments')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()
    for (const assignment of assignments) {
      await ctx.db.delete('assignments', assignment._id)
    }

    const taggings = await ctx.db
      .query('taggings')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()
    for (const tagging of taggings) {
      await ctx.db.delete('taggings', tagging._id)
    }

    const watches = await ctx.db
      .query('watches')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()
    for (const watch of watches) {
      await ctx.db.delete('watches', watch._id)
    }

    const pins = await ctx.db
      .query('pins')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()
    for (const pin of pins) {
      await ctx.db.delete('pins', pin._id)
    }

    await ctx.db.delete("cards", cardId)
  },
})

export const listActive = query({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    return cards.filter((c) => c.status === 'published' && !c.closedAt && !c.postponedAt)
  },
})

export const listClosed = query({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    return cards
      .filter((c) => c.closedAt !== undefined)
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  },
})

export const listPostponed = query({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    return cards.filter((c) => c.postponedAt !== undefined)
  },
})

export const listClosedPaginated = query({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { accountId, boardId, paginationOpts }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    return ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .filter((q) => q.neq(q.field('closedAt'), undefined))
      .order('desc')
      .paginate(paginationOpts)
  },
})

export const search = query({
  args: {
    accountId: v.id('accounts'),
    boardId: v.optional(v.id('boards')),
    query: v.string(),
  },
  handler: async (ctx, { accountId, boardId, query: searchQuery }) => {
    await requireAccountAccess(ctx, accountId)

    const normalized = searchQuery.trim()
    if (!normalized) return []

    if (boardId) {
      return ctx.db
        .query('cards')
        .withSearchIndex('search_cards', (q) =>
          q.search('title', normalized).eq('accountId', accountId).eq('boardId', boardId),
        )
        .take(25)
    }

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect()

    const lower = normalized.toLowerCase()
    return cards.filter((card) => card.title.toLowerCase().includes(lower)).slice(0, 25)
  },
})
