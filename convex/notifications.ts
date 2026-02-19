import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireAccountAccess } from './lib/auth'
import { internal } from './_generated/api'

const BUNDLE_WINDOW_MS = 30 * 60 * 1000

export const create = mutation({
  args: {
    accountId: v.id('accounts'),
    userId: v.id('users'),
    creatorId: v.optional(v.id('users')),
    source: v.union(
      v.object({ type: v.literal('event'), id: v.id('events') }),
      v.object({ type: v.literal('mention'), id: v.id('mentions') }),
    ),
  },
  handler: async (ctx, { accountId, userId, creatorId, source }) => {
    await requireAccountAccess(ctx, accountId)

    const notificationId = await ctx.db.insert('notifications', {
      accountId,
      userId,
      creatorId,
      source,
    })

    const now = Date.now()

    const pendingBundle = await ctx.db
      .query('notificationBundles')
      .withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', 'pending'))
      .filter((q) => q.gt(q.field('endsAt'), now))
      .first()

    if (!pendingBundle) {
      const bundleId = await ctx.db.insert('notificationBundles', {
        accountId,
        userId,
        startsAt: now,
        endsAt: now + BUNDLE_WINDOW_MS,
        status: 'pending',
      })

      await ctx.scheduler.runAfter(BUNDLE_WINDOW_MS, internal.notifications.deliverBundle, { bundleId })
    }

    return notificationId
  },
})

export const deliverBundle = internalMutation({
  args: { bundleId: v.id('notificationBundles') },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get("notificationBundles", bundleId)
    if (!bundle || bundle.status !== 'pending') return

    await ctx.db.patch("notificationBundles", bundleId, { status: 'processing' })

    // Stub for external email/telegram delivery integration.
    await ctx.db.patch("notificationBundles", bundleId, { status: 'delivered' })
  },
})

export const deliverAllBundles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()

    const dueBundles = await ctx.db
      .query('notificationBundles')
      .withIndex('by_ends_status', (q) => q.lte('endsAt', now))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect()

    for (const bundle of dueBundles) {
      await ctx.db.patch("notificationBundles", bundle._id, { status: 'processing' })
      await ctx.db.patch("notificationBundles", bundle._id, { status: 'delivered' })
    }
  },
})

export const list = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    return ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(100)
  },
})

export const unreadCount = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', user._id).eq('readAt', undefined))
      .collect()

    return unread.length
  },
})

export const markRead = mutation({
  args: {
    accountId: v.id('accounts'),
    notificationId: v.id('notifications'),
  },
  handler: async (ctx, { accountId, notificationId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const notification = await ctx.db.get("notifications", notificationId)
    if (!notification || notification.userId !== user._id) return

    await ctx.db.patch("notifications", notificationId, { readAt: Date.now() })
  },
})

export const markAllRead = mutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const now = Date.now()

    for (const n of notifications) {
      if (!n.readAt) {
        await ctx.db.patch("notifications", n._id, { readAt: now })
      }
    }
  },
})
