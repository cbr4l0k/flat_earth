import { ConvexError } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type Ctx = QueryCtx | MutationCtx

export function isAdmin(user: Doc<'users'>): boolean {
  return user.role === 'owner' || user.role === 'admin'
}

export function isOwner(user: Doc<'users'>): boolean {
  return user.role === 'owner'
}

export function canAdministerBoard(user: Doc<'users'>, board: Doc<'boards'>): boolean {
  return isAdmin(user) || board.creatorId === user._id
}

export function canAdministerCard(user: Doc<'users'>, card: Doc<'cards'>): boolean {
  return isAdmin(user) || card.creatorId === user._id
}

export function canManageUser(currentUser: Doc<'users'>, targetUser: Doc<'users'>): boolean {
  if (currentUser.role === 'owner' && currentUser._id !== targetUser._id) {
    return true
  }

  if (currentUser.role === 'admin' && targetUser.role === 'member') {
    return true
  }

  return false
}

export async function requireBoardAccess(
  ctx: Ctx,
  user: Doc<'users'>,
  boardId: Id<'boards'>,
): Promise<Doc<'boards'>> {
  const board = await ctx.db.get("boards", boardId)
  if (!board || board.accountId !== user.accountId) {
    throw new ConvexError('Board not found')
  }

  if (isAdmin(user)) {
    return board
  }

  if (board.allAccess) {
    return board
  }

  const access = await ctx.db
    .query('accesses')
    .withIndex('by_board_user', (q) => q.eq('boardId', boardId).eq('userId', user._id))
    .unique()

  if (!access) {
    throw new ConvexError('No access to this board')
  }

  return board
}
