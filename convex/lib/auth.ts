import { ConvexError } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type Ctx = QueryCtx | MutationCtx

export async function requireAuth(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throw new ConvexError('Not authenticated')
  }
  return identity
}

export async function requireAccountAccess(
  ctx: Ctx,
  accountId: Id<'accounts'>,
): Promise<Doc<'users'>> {
  const identity = await requireAuth(ctx)

  const account = await ctx.db.get("accounts", accountId)
  if (!account) {
    throw new ConvexError('Account not found')
  }

  const user = await ctx.db
    .query('users')
    .withIndex('by_account_clerk', (q) =>
      q.eq('accountId', accountId).eq('clerkId', identity.subject),
    )
    .unique()

  if (!user) {
    throw new ConvexError('Not a member of this account')
  }

  if (!user.active) {
    throw new ConvexError('User is deactivated')
  }

  return user
}
