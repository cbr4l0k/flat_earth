import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { MAX_COLUMNS_BY_BOARD } from './constants'
import { requireAccountAccess } from './lib/auth'
import { canAdministerBoard, requireBoardAccess } from './lib/permissions'

export const listByBoard = query({
  args: { accountId: v.id('accounts'), boardId: v.id('boards') },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    await requireBoardAccess(ctx, user, boardId)

    return ctx.db
      .query('columns')
      .withIndex('by_board_position', (q) => q.eq('boardId', boardId))
      .collect()
  },
})

export const create = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, { accountId, boardId, name, color }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await requireBoardAccess(ctx, user, boardId)

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }

    const columns = await ctx.db
      .query('columns')
      .withIndex('by_board_position', (q) => q.eq('boardId', boardId))
      .collect()

    if (columns.length >= MAX_COLUMNS_BY_BOARD) {
      throw new ConvexError(`Cannot create more than ${MAX_COLUMNS_BY_BOARD} columns`)
    }

    const position = columns.length === 0 ? 0 : Math.max(...columns.map((c) => c.position)) + 1

    return ctx.db.insert('columns', {
      accountId,
      boardId,
      name: name.trim(),
      color,
      position,
      protected: false,
    })
  },
})

export const reorder = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    columnIdsInOrder: v.array(v.id('columns')),
  },
  handler: async (ctx, { accountId, boardId, columnIdsInOrder }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await requireBoardAccess(ctx, user, boardId)

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }

    const columns = await ctx.db
      .query('columns')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    if (columns.length !== columnIdsInOrder.length) {
      throw new ConvexError('Invalid columns payload')
    }

    const knownIds = new Set(columns.map((c) => c._id))
    for (const id of columnIdsInOrder) {
      if (!knownIds.has(id)) {
        throw new ConvexError('Column does not belong to this board')
      }
    }

    for (const [index, columnId] of columnIdsInOrder.entries()) {
      await ctx.db.patch("columns", columnId, { position: index })
    }
  },
})

export const remove = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    columnId: v.id('columns'),
  },
  handler: async (ctx, { accountId, boardId, columnId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const board = await requireBoardAccess(ctx, user, boardId)

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }

    const column = await ctx.db.get("columns", columnId)
    if (!column || column.boardId !== boardId || column.accountId !== accountId) {
      throw new ConvexError('Column not found')
    }

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_column', (q) => q.eq('columnId', columnId))
      .collect()

    for (const card of cards) {
      await ctx.db.patch("cards", card._id, { columnId: null, lastActiveAt: Date.now() })
    }

    await ctx.db.delete("columns", columnId)

    const remaining = await ctx.db
      .query('columns')
      .withIndex('by_board_position', (q) => q.eq('boardId', boardId))
      .collect()

    for (const [index, col] of remaining.entries()) {
      if (col.position !== index) {
        await ctx.db.patch("columns", col._id, { position: index })
      }
    }
  },
})
