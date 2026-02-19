import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { MAX_COLUMNS_BY_BOARD } from './constants'
import { requireAccountAccess } from './lib/auth'
import {
  isProtectedColumn,
  isReservedProtectedColumnName,
  normalizeColumnName,
} from './lib/protectedColumns'
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
    const normalizedName = normalizeColumnName(name)

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError('Not authorized')
    }
    if (!normalizedName) {
      throw new ConvexError('Column name is required')
    }
    if (isReservedProtectedColumnName(normalizedName)) {
      throw new ConvexError('Column name is reserved')
    }

    const columns = await ctx.db
      .query('columns')
      .withIndex('by_board_position', (q) => q.eq('boardId', boardId))
      .collect()

    if (columns.length >= MAX_COLUMNS_BY_BOARD) {
      throw new ConvexError(`Cannot create more than ${MAX_COLUMNS_BY_BOARD} columns`)
    }

    const customColumns = columns.filter((column) => !isProtectedColumn(column))
    const position =
      customColumns.length === 0 ? 0 : Math.max(...customColumns.map((column) => column.position)) + 1

    return ctx.db.insert('columns', {
      accountId,
      boardId,
      name: normalizedName,
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
      .withIndex('by_board_position', (q) => q.eq('boardId', boardId))
      .collect()

    const knownIds = new Set(columns.map((c) => c._id))
    for (const id of columnIdsInOrder) {
      if (!knownIds.has(id)) {
        throw new ConvexError('Column does not belong to this board')
      }
    }

    const protectedColumns = columns.filter((column) => isProtectedColumn(column))
    const customColumns = columns.filter((column) => !isProtectedColumn(column))

    if (columnIdsInOrder.length !== customColumns.length) {
      throw new ConvexError('Reorder payload must include only custom columns')
    }

    for (const id of columnIdsInOrder) {
      const column = columns.find((candidate) => candidate._id === id)
      if (!column || isProtectedColumn(column)) {
        throw new ConvexError('Protected columns cannot be reordered')
      }
    }

    for (const [index, columnId] of columnIdsInOrder.entries()) {
      await ctx.db.patch("columns", columnId, { position: index })
    }

    const anchored = [...protectedColumns].sort((a, b) => a.position - b.position)
    for (const [index, column] of anchored.entries()) {
      const anchorPosition = 900 + index * 100
      if (column.position !== anchorPosition) {
        await ctx.db.patch("columns", column._id, { position: anchorPosition })
      }
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
    if (isProtectedColumn(column)) {
      throw new ConvexError(`Cannot remove protected column "${column.name}"`)
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

    const customColumns = remaining.filter((candidate) => !isProtectedColumn(candidate))
    for (const [index, customColumn] of customColumns.entries()) {
      if (customColumn.position !== index) {
        await ctx.db.patch("columns", customColumn._id, { position: index })
      }
    }

    const protectedColumns = remaining
      .filter((candidate) => isProtectedColumn(candidate))
      .sort((a, b) => a.position - b.position)
    for (const [index, protectedColumn] of protectedColumns.entries()) {
      const anchorPosition = 900 + index * 100
      if (protectedColumn.position !== anchorPosition) {
        await ctx.db.patch("columns", protectedColumn._id, { position: anchorPosition })
      }
    }
  },
})
