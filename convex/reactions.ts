import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'

export const toggle = mutation({
  args: {
    accountId: v.id('accounts'),
    commentId: v.id('comments'),
    emoji: v.string(),
  },
  handler: async (ctx, { accountId, commentId, emoji }) => {
    const user = await requireAccountAccess(ctx, accountId)
    const comment = await ctx.db.get("comments", commentId)

    if (!comment || comment.accountId !== accountId) {
      throw new ConvexError('Comment not found')
    }

    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_comment', (q) => q.eq('commentId', commentId))
      .filter((q) => q.and(q.eq(q.field('emoji'), emoji), q.eq(q.field('reacterId'), user._id)))
      .unique()

    if (existing) {
      await ctx.db.delete("reactions", existing._id)
      return { toggledOn: false }
    }

    await ctx.db.insert('reactions', {
      accountId,
      commentId,
      reacterId: user._id,
      emoji,
    })

    return { toggledOn: true }
  },
})

export const listByComment = query({
  args: { accountId: v.id('accounts'), commentId: v.id('comments') },
  handler: async (ctx, { accountId, commentId }) => {
    await requireAccountAccess(ctx, accountId)

    const reactions = await ctx.db
      .query('reactions')
      .withIndex('by_comment', (q) => q.eq('commentId', commentId))
      .collect()

    return reactions
  },
})
