import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAccountAccess, requireAuth } from './lib/auth'
import { canManageUser, isOwner } from './lib/permissions'

export const createWithOwner = mutation({
  args: { accountName: v.string() },
  handler: async (ctx, { accountName }) => {
    const identity = await requireAuth(ctx)

    const accountId = await ctx.db.insert('accounts', {
      name: accountName.trim(),
      cardsCount: 0,
    })

    const userId = await ctx.db.insert('users', {
      accountId,
      clerkId: identity.subject,
      name: identity.name ?? identity.email ?? 'New User',
      role: 'owner',
      active: true,
    })

    const boardId = await ctx.db.insert('boards', {
      accountId,
      name: 'First Plane',
      creatorId: userId,
      allAccess: true,
    })

    const defaultColumns = [
      { name: 'Later', color: '#00272b', position: 0, protected: true },
      { name: 'Done', color: '#e0ff4f', position: 9, protected: true },
    ]

    for (const col of defaultColumns) {
      await ctx.db.insert('columns', { accountId, boardId, ...col })
    }

    await ctx.db.insert('accesses', {
      accountId,
      boardId,
      userId,
      involvement: 'watching',
    })

    return { accountId, userId, boardId }
  },
})

export const listMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const users = await ctx.db
      .query('users')
      .withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
      .collect()

    const activeUsers = users.filter((u) => u.active)

    const accounts = await Promise.all(
      activeUsers.map(async (user) => {
        const account = await ctx.db.get("accounts", user.accountId)
        if (!account) return null
        return { ...account, role: user.role, userId: user._id }
      }),
    )

    return accounts.filter((a) => a !== null)
  },
})

export const listMembers = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    await requireAccountAccess(ctx, accountId)

    return ctx.db
      .query('users')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect()
  },
})

export const updateMemberRole = mutation({
  args: {
    accountId: v.id('accounts'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, { accountId, userId, role }) => {
    const currentUser = await requireAccountAccess(ctx, accountId)
    const targetUser = await ctx.db.get("users", userId)

    if (!targetUser || targetUser.accountId !== accountId) {
      throw new ConvexError('User not found')
    }

    if (!isOwner(currentUser)) {
      throw new ConvexError('Only account owners can change roles')
    }

    if (targetUser.role === 'owner' && role !== 'owner') {
      const owners = await ctx.db
        .query('users')
        .withIndex('by_account_role', (q) => q.eq('accountId', accountId).eq('role', 'owner'))
        .collect()
      const activeOwners = owners.filter((u) => u.active)
      if (activeOwners.length <= 1) {
        throw new ConvexError('Account must keep at least one active owner')
      }
    }

    await ctx.db.patch("users", userId, { role })
  },
})

export const deactivateMember = mutation({
  args: {
    accountId: v.id('accounts'),
    userId: v.id('users'),
  },
  handler: async (ctx, { accountId, userId }) => {
    const currentUser = await requireAccountAccess(ctx, accountId)
    const targetUser = await ctx.db.get("users", userId)

    if (!targetUser || targetUser.accountId !== accountId) {
      throw new ConvexError('User not found')
    }

    if (!canManageUser(currentUser, targetUser)) {
      throw new ConvexError('Not authorized')
    }

    if (targetUser.role === 'owner') {
      const owners = await ctx.db
        .query('users')
        .withIndex('by_account_role', (q) => q.eq('accountId', accountId).eq('role', 'owner'))
        .collect()
      const activeOwners = owners.filter((u) => u.active)
      if (activeOwners.length <= 1) {
        throw new ConvexError('Account must keep at least one active owner')
      }
    }

    await ctx.db.patch("users", userId, { active: false })
  },
})
