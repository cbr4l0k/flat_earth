import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

async function ensureWatching(
  ctx: MutationCtx,
  accountId: Id<'accounts'>,
  cardId: Id<'cards'>,
  userId: Id<'users'>,
) {
  const existing = await ctx.db
    .query('watches')
    .withIndex('by_user_card', (q) => q.eq('userId', userId).eq('cardId', cardId))
    .unique()

  if (!existing) {
    await ctx.db.insert('watches', { accountId, cardId, userId, watching: true })
  } else if (!existing.watching) {
    await ctx.db.patch("watches", existing._id, { watching: true })
  }
}

export const create = mutation({
  args: {
    accountId: v.id('accounts'),
    cardId: v.id('cards'),
    body: v.string(),
  },
  handler: async (ctx, { accountId, cardId, body }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const card = await ctx.db.get("cards", cardId)

    if (!card || card.accountId !== accountId) {
      throw new ConvexError('Card not found')
    }

    const commentId = await ctx.db.insert('comments', {
      accountId,
      cardId,
      creatorId: user._id,
      body: body.trim(),
      isSystem: false,
    })

    await ctx.db.patch("cards", cardId, { lastActiveAt: Date.now() })
    await ensureWatching(ctx, accountId, cardId, user._id)

    await ctx.db.insert('events', {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: 'comment_created',
      eventable: { type: 'comment', id: commentId },
    })

    return commentId
  },
})

export const listByCard = query({
  args: { accountId: v.id('accounts'), cardId: v.id('cards') },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId)

    const comments = await ctx.db
      .query('comments')
      .withIndex('by_card', (q) => q.eq('cardId', cardId))
      .collect()

    const withCreators = await Promise.all(
      comments.map(async (comment) => {
        const creator = await ctx.db.get("users", comment.creatorId)
        return {
          ...comment,
          creatorName: creator?.name ?? 'Unknown',
        }
      }),
    )

    return withCreators.sort((a, b) => a._creationTime - b._creationTime)
  },
})

export const remove = mutation({
  args: { accountId: v.id('accounts'), commentId: v.id('comments') },
  handler: async (ctx, { accountId, commentId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const comment = await ctx.db.get("comments", commentId)

    if (!comment || comment.accountId !== accountId) {
      throw new ConvexError('Comment not found')
    }

    const isAdmin = user.role === 'owner' || user.role === 'admin'
    if (!isAdmin && comment.creatorId !== user._id) {
      throw new ConvexError('Not authorized')
    }

    const reactions = await ctx.db
      .query('reactions')
      .withIndex('by_comment', (q) => q.eq('commentId', commentId))
      .collect()

    for (const reaction of reactions) {
      await ctx.db.delete("reactions", reaction._id)
    }

    await ctx.db.delete("comments", commentId)
  },
})
