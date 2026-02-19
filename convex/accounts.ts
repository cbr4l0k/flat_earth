import { ConvexError, v } from 'convex/values'
import { ACCOUNT_JOIN_CODE_TTL_MS } from './constants'
import { requireAccountAccess, requireAuth } from './lib/auth'
import { canManageUser, isAdmin, isOwner } from './lib/permissions'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

function makeJoinCode() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
}

async function generateUniqueJoinCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeJoinCode()
    const existing = await ctx.db
      .query('accountJoinCodes')
      .withIndex('by_code', (q) => q.eq('code', code))
      .unique()

    if (!existing) {
      return code
    }
  }

  throw new ConvexError('Failed to generate a unique join code')
}

async function grantAllAccessBoards(
  ctx: MutationCtx,
  accountId: Id<'accounts'>,
  userId: Id<'users'>,
) {
  const boards = await ctx.db
    .query('boards')
    .withIndex('by_account', (q) => q.eq('accountId', accountId))
    .collect()

  for (const board of boards.filter((candidate) => candidate.allAccess)) {
    const existingAccess = await ctx.db
      .query('accesses')
      .withIndex('by_board_user', (q) => q.eq('boardId', board._id).eq('userId', userId))
      .unique()

    if (!existingAccess) {
      await ctx.db.insert('accesses', {
        accountId,
        boardId: board._id,
        userId,
        involvement: 'access_only',
      })
    }
  }
}

export const createWithOwner = mutation({
  args: {
    accountName: v.string(),
    installerSecret: v.optional(v.string()),
  },
  handler: async (ctx, { accountName, installerSecret }) => {
    const identity = await requireAuth(ctx)
    const existingAccounts = await ctx.db.query('accounts').take(1)

    if (existingAccounts.length === 0) {
      const expectedInstallerSecret = process.env.INSTALLER_SECRET?.trim()
      if (!expectedInstallerSecret) {
        throw new ConvexError('Installer secret is not configured')
      }

      if ((installerSecret ?? '').trim() !== expectedInstallerSecret) {
        throw new ConvexError('Invalid installer secret')
      }
    }

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
      { name: 'Next', color: '#2563eb', position: 0, protected: false },
      { name: 'In Progress', color: '#d97706', position: 1, protected: false },
      { name: 'Not Now', color: '#334155', position: 900, protected: true },
      { name: 'Done', color: '#15803d', position: 1000, protected: true },
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

export const canBootstrapFirstOwner = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return false

    const existingAccounts = await ctx.db.query('accounts').take(1)
    return existingAccounts.length === 0
  },
})

export const createJoinCode = mutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId)

    if (!isAdmin(user)) {
      throw new ConvexError('Only admins can create join codes')
    }

    const now = Date.now()
    const code = await generateUniqueJoinCode(ctx)
    const expiresAt = now + ACCOUNT_JOIN_CODE_TTL_MS

    const joinCodeId = await ctx.db.insert('accountJoinCodes', {
      accountId,
      code,
      createdByUserId: user._id,
      createdAt: now,
      expiresAt,
    })

    return { joinCodeId, code, expiresAt }
  },
})

export const redeemJoinCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const identity = await requireAuth(ctx)
    const normalizedCode = code.trim().toUpperCase()

    if (!normalizedCode) {
      throw new ConvexError('Join code is required')
    }

    const joinCode = await ctx.db
      .query('accountJoinCodes')
      .withIndex('by_code', (q) => q.eq('code', normalizedCode))
      .unique()

    if (!joinCode) {
      throw new ConvexError('Join code not found')
    }

    const now = Date.now()
    if (joinCode.usedAt !== undefined) {
      throw new ConvexError('Join code has already been used')
    }
    if (joinCode.disabledAt !== undefined) {
      throw new ConvexError('Join code has been revoked')
    }
    if (joinCode.expiresAt <= now) {
      throw new ConvexError('Join code has expired')
    }

    const account = await ctx.db.get("accounts", joinCode.accountId)
    if (!account) {
      throw new ConvexError('Account not found')
    }

    const existingUser = await ctx.db
      .query('users')
      .withIndex('by_account_clerk', (q) =>
        q.eq('accountId', joinCode.accountId).eq('clerkId', identity.subject),
      )
      .unique()

    let userId = existingUser?._id
    if (existingUser) {
      if (existingUser.active) {
        throw new ConvexError('You are already a member of this account')
      }

      await ctx.db.patch("users", existingUser._id, { active: true })
    } else {
      userId = await ctx.db.insert('users', {
        accountId: joinCode.accountId,
        clerkId: identity.subject,
        name: identity.name ?? identity.email ?? 'New User',
        role: 'member',
        active: true,
      })
    }

    if (!userId) {
      throw new ConvexError('Failed to resolve account membership')
    }

    await grantAllAccessBoards(ctx, joinCode.accountId, userId)

    await ctx.db.patch("accountJoinCodes", joinCode._id, {
      usedAt: now,
      usedByUserId: userId,
    })

    return { accountId: account._id, userId }
  },
})

export const listJoinCodes = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    if (!isAdmin(user)) {
      throw new ConvexError('Only admins can list join codes')
    }

    const now = Date.now()
    const joinCodes = await ctx.db
      .query('accountJoinCodes')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect()

    return joinCodes
      .filter(
        (joinCode) =>
          joinCode.expiresAt > now &&
          joinCode.usedAt === undefined &&
          joinCode.disabledAt === undefined,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  },
})

export const revokeJoinCode = mutation({
  args: {
    accountId: v.id('accounts'),
    joinCodeId: v.id('accountJoinCodes'),
  },
  handler: async (ctx, { accountId, joinCodeId }) => {
    const user = await requireAccountAccess(ctx, accountId)
    if (!isAdmin(user)) {
      throw new ConvexError('Only admins can revoke join codes')
    }

    const joinCode = await ctx.db.get("accountJoinCodes", joinCodeId)
    if (!joinCode || joinCode.accountId !== accountId) {
      throw new ConvexError('Join code not found')
    }

    await ctx.db.patch("accountJoinCodes", joinCodeId, { disabledAt: Date.now() })
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
