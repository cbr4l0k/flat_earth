import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'
import { isAdmin } from './lib/permissions'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

const DEFAULT_ENTROPY_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

type Ctx = QueryCtx | MutationCtx

async function getPeriodForBoard(
  ctx: Ctx,
  accountId: Id<'accounts'>,
  boardId: Id<'boards'>,
) {
  const entropies = await ctx.db
    .query('entropies')
    .withIndex('by_account', (q) => q.eq('accountId', accountId))
    .collect()

  const boardEntropy = entropies.find((e) => e.container.type === 'board' && e.container.id === boardId)
  if (boardEntropy) return boardEntropy.autoPostponePeriod

  const accountEntropy = entropies.find(
    (e) => e.container.type === 'account' && e.container.id === accountId,
  )
  if (accountEntropy) return accountEntropy.autoPostponePeriod

  return DEFAULT_ENTROPY_PERIOD_MS
}

export const getEffectivePeriod = query({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId)
    return getPeriodForBoard(ctx, accountId, boardId)
  },
})

export const setPeriod = mutation({
  args: {
    accountId: v.id('accounts'),
    containerId: v.union(v.id('accounts'), v.id('boards')),
    containerType: v.union(v.literal('account'), v.literal('board')),
    periodMs: v.number(),
  },
  handler: async (ctx, { accountId, containerId, containerType, periodMs }) => {
    const user = await requireAccountAccess(ctx, accountId)

    if (!isAdmin(user)) {
      throw new ConvexError('Only admins can configure entropy')
    }

    if (periodMs <= 0) {
      throw new ConvexError('Period must be greater than zero')
    }

    const entropies = await ctx.db
      .query('entropies')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect()

    const existing = entropies.find(
      (e) => e.container.type === containerType && e.container.id === containerId,
    )

    if (existing) {
      await ctx.db.patch("entropies", existing._id, { autoPostponePeriod: periodMs })
      return existing._id
    }

    if (containerType === 'account') {
      return ctx.db.insert('entropies', {
        accountId,
        container: { type: 'account', id: containerId as Id<'accounts'> },
        autoPostponePeriod: periodMs,
      })
    }

    return ctx.db.insert('entropies', {
      accountId,
      container: { type: 'board', id: containerId as Id<'boards'> },
      autoPostponePeriod: periodMs,
    })
  },
})

export const autoPostponeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const accounts = await ctx.db.query('accounts').collect()

    for (const account of accounts) {
      const boards = await ctx.db
        .query('boards')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .collect()

      for (const board of boards) {
        const period = await getPeriodForBoard(ctx, account._id, board._id)
        const deadline = now - period

        const boardCards = await ctx.db
          .query('cards')
          .withIndex('by_board', (q) => q.eq('boardId', board._id))
          .collect()

        for (const card of boardCards) {
          if (card.status !== 'published') continue
          if (card.closedAt || card.postponedAt) continue
          if (card.lastActiveAt > deadline) continue

          const actor = await ctx.db.get("users", card.creatorId)
          if (!actor) continue

          await ctx.db.patch("cards", card._id, {
            postponedAt: now,
            postponedBy: actor._id,
            columnId: null,
            activitySpikeAt: undefined,
            lastActiveAt: now,
          })

          await ctx.db.insert('events', {
            accountId: account._id,
            boardId: board._id,
            creatorId: actor._id,
            action: 'card_auto_postponed',
            eventable: { type: 'card', id: card._id },
            particulars: { reason: 'entropy' },
          })
        }
      }
    }
  },
})

export const listPostponingSoon = query({
  args: {
    accountId: v.id('accounts'),
    boardId: v.id('boards'),
    withinMs: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, boardId, withinMs }) => {
    await requireAccountAccess(ctx, accountId)

    const period = await getPeriodForBoard(ctx, accountId, boardId)
    const margin = withinMs ?? 24 * 60 * 60 * 1000
    const now = Date.now()

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()

    return cards.filter((card) => {
      if (card.status !== 'published' || card.closedAt || card.postponedAt) return false
      const timeToDeadline = card.lastActiveAt + period - now
      return timeToDeadline > 0 && timeToDeadline <= margin
    })
  },
})
