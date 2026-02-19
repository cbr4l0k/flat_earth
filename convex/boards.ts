import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { MAX_COLUMNS_BY_BOARD } from './constants'
import { requireAccountAccess } from './lib/auth'
import { canAdministerBoard } from './lib/permissions'

function makePublicKey() {
  return crypto.randomUUID().replace(/-/g, '')
}

export const list = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    if (user.role === 'owner' || user.role === 'admin') {
      return ctx.db
        .query('boards')
        .withIndex('by_account', (q) => q.eq('accountId', accountId))
        .collect()
    }

    const accessRecords = await ctx.db
      .query('accesses')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const boards = await Promise.all(accessRecords.map((access) => ctx.db.get("boards", access.boardId)))
    return boards.filter((board) => board !== null && board.accountId === accountId)
  },
})

export const get = query({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await ctx.db.get("boards", boardId)
    if (!board || board.accountId !== accountId) return null

    if (board.allAccess || user.role === 'owner' || user.role === 'admin') {
      return board
    }

    const access = await ctx.db
      .query('accesses')
      .withIndex('by_board_user', (q) => q.eq('boardId', boardId).eq('userId', user._id))
      .unique()

    return access ? board : null
  },
})

export const create = mutation({
  args: {
    accountId: v.id('accounts'),
    name: v.string(),
    allAccess: v.boolean(),
  },
  handler: async (ctx, { accountId, name, allAccess }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const boardId = await ctx.db.insert('boards', {
      accountId,
      name: name.trim(),
      creatorId: user._id,
      allAccess,
    })

    const defaultColumns = [
      { name: 'To Do', color: '#6366f1', position: 0, protected: false },
      { name: 'In Progress', color: '#f59e0b', position: 1, protected: false },
      { name: 'Done', color: '#22c55e', position: 2, protected: false },
    ]

    for (const col of defaultColumns) {
      await ctx.db.insert('columns', { accountId, boardId, ...col })
    }

    await ctx.db.insert('accesses', {
      accountId,
      boardId,
      userId: user._id,
      involvement: 'watching',
    })

    if (allAccess) {
      const users = await ctx.db
        .query('users')
        .withIndex('by_account', (q) => q.eq('accountId', accountId))
        .collect()

      for (const member of users.filter((candidate) => candidate.active && candidate._id !== user._id)) {
        const existing = await ctx.db
          .query('accesses')
          .withIndex('by_board_user', (q) => q.eq('boardId', boardId).eq('userId', member._id))
          .unique()

        if (!existing) {
          await ctx.db.insert('accesses', {
            accountId,
            boardId,
            userId: member._id,
            involvement: 'access_only',
          })
        }
      }
    }

    return boardId
  },
})

export const update = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    name: v.optional(v.string()),
    allAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, { accountId, boardId, name, allAccess }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await ctx.db.get("boards", boardId)

    if (!board || board.accountId !== accountId) {
      throw new ConvexError('Board not found')
    }

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }

    const updates: { name?: string; allAccess?: boolean } = {}

    if (name !== undefined) {
      updates.name = name.trim()
    }

    if (allAccess !== undefined) {
      updates.allAccess = allAccess
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch("boards", boardId, updates)
    }

    if (allAccess === true) {
      const users = await ctx.db
        .query('users')
        .withIndex('by_account', (q) => q.eq('accountId', accountId))
        .collect()

      for (const member of users.filter((candidate) => candidate.active)) {
        const existing = await ctx.db
          .query('accesses')
          .withIndex('by_board_user', (q) => q.eq('boardId', boardId).eq('userId', member._id))
          .unique()

        if (!existing) {
          await ctx.db.insert('accesses', {
            accountId,
            boardId,
            userId: member._id,
            involvement: member._id === user._id ? 'watching' : 'access_only',
          })
        }
      }
    }
  },
})

export const remove = mutation({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await ctx.db.get("boards", boardId)

    if (!board || board.accountId !== accountId) {
      throw new ConvexError('Board not found')
    }

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }

    const columns = await ctx.db
      .query('columns')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    for (const column of columns) {
      await ctx.db.delete("columns", column._id)
    }

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    for (const card of cards) {
      await ctx.db.delete("cards", card._id)
    }

    const accesses = await ctx.db
      .query('accesses')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    for (const access of accesses) {
      await ctx.db.delete("accesses", access._id)
    }

    await ctx.db.delete("boards", boardId)
  },
})

export const publish = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, boardId, description }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await ctx.db.get("boards", boardId)

    if (!board || board.accountId !== accountId) {
      throw new ConvexError('Board not found')
    }

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }

    await ctx.db.patch("boards", boardId, {
      publicKey: board.publicKey ?? makePublicKey(),
      publicDescription: description,
    })
  },
})

export const unpublish = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
  },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await ctx.db.get("boards", boardId)

    if (!board || board.accountId !== accountId) {
      throw new ConvexError('Board not found')
    }

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }

    await ctx.db.patch("boards", boardId, {
      publicKey: undefined,
      publicDescription: undefined,
    })
  },
})

export const getPublic = query({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }) => {
    const board = await ctx.db
      .query('boards')
      .withIndex('by_public_key', (q) => q.eq('publicKey', publicKey))
      .unique()

    if (!board) return null

    const columns = await ctx.db
      .query('columns')
      .withIndex('by_board_position', (q) => q.eq('boardId', board._id))
      .collect()

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', board._id))
      .collect()

    const activeCards = cards.filter((c) => c.status === 'published' && !c.closedAt && !c.postponedAt)

    return {
      board,
      columns,
      cards: activeCards,
    }
  },
})

export const canCreateColumn = query({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId)
    const count = await ctx.db
      .query('columns')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()
    return count.length < MAX_COLUMNS_BY_BOARD
  },
})
