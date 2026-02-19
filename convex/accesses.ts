import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import { requireAccountAccess } from './lib/auth'
import { canAdministerBoard } from './lib/permissions'

export const grant = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    userIds: v.array(v.id('users')),
  },
  handler: async (ctx, { accountId, boardId, userIds }) => {
    const currentUser = await requireAccountAccess(ctx, accountId)
    const board = await ctx.db.get("boards", boardId)

    if (!board || board.accountId !== accountId) {
      throw new ConvexError('Board not found')
    }

    if (!canAdministerBoard(currentUser, board)) {
      throw new ConvexError('Not authorized')
    }

    for (const userId of userIds) {
      const targetUser = await ctx.db.get("users", userId)
      if (!targetUser || targetUser.accountId !== accountId || !targetUser.active) {
        continue
      }

      const existing = await ctx.db
        .query('accesses')
        .withIndex('by_board_user', (q) => q.eq('boardId', boardId).eq('userId', userId))
        .unique()

      if (!existing) {
        await ctx.db.insert('accesses', {
          accountId,
          boardId,
          userId,
          involvement: 'access_only',
        })
      }
    }
  },
})

export const revoke = mutation({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    userIds: v.array(v.id('users')),
  },
  handler: async (ctx, { accountId, boardId, userIds }) => {
    const currentUser = await requireAccountAccess(ctx, accountId)
    const board = await ctx.db.get("boards", boardId)

    if (!board || board.accountId !== accountId) {
      throw new ConvexError('Board not found')
    }

    if (!canAdministerBoard(currentUser, board)) {
      throw new ConvexError('Not authorized')
    }

    if (board.allAccess) {
      throw new ConvexError('Cannot revoke access on all-access boards')
    }

    const boardCards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    for (const userId of userIds) {
      if (userId === board.creatorId) continue

      const access = await ctx.db
        .query('accesses')
        .withIndex('by_board_user', (q) => q.eq('boardId', boardId).eq('userId', userId))
        .unique()

      if (!access) continue

      await ctx.db.delete("accesses", access._id)

      for (const card of boardCards) {
        const watch = await ctx.db
          .query('watches')
          .withIndex('by_user_card', (q) => q.eq('userId', userId).eq('cardId', card._id))
          .unique()

        if (watch) {
          await ctx.db.delete("watches", watch._id)
        }
      }
    }
  },
})
