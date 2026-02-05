# Module 09 — Permissions

> **Goal:** Implement the role hierarchy, board-level access control, and public boards — mirroring Fizzy's layered permission system.
>
> **Reference:** [docs/fizzy-analysis/04-permissions-and-access-control.md](../fizzy-analysis/04-permissions-and-access-control.md)

## Fizzy's Permission Model

Fizzy has three layers of access control:

1. **Account-level roles** — owner > admin > member > system
2. **Board-level access** — all_access boards vs. selective (explicit grants)
3. **Public boards** — read-only access via shareable key

We'll replicate all three.

## Role Hierarchy

### Roles

From the schema (Module 03), users have a `role` field:

```typescript
role: v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
)
```

(We omit "system" — Convex scheduled functions don't need a user role. If you need system-initiated actions, pass a sentinel value or skip the user check.)

### Permission Helper Functions

```typescript
// convex/lib/permissions.ts
import { Doc } from "../_generated/dataModel";

export function isAdmin(user: Doc<"users">): boolean {
  return user.role === "owner" || user.role === "admin";
}

export function isOwner(user: Doc<"users">): boolean {
  return user.role === "owner";
}

export function canAdministerBoard(
  user: Doc<"users">,
  board: Doc<"boards">,
): boolean {
  return isAdmin(user) || board.creatorId === user._id;
}

export function canAdministerCard(
  user: Doc<"users">,
  card: Doc<"cards">,
): boolean {
  return isAdmin(user) || card.creatorId === user._id;
}

export function canManageUser(
  currentUser: Doc<"users">,
  targetUser: Doc<"users">,
): boolean {
  // Owners can manage anyone except themselves
  if (currentUser.role === "owner" && currentUser._id !== targetUser._id) {
    return true;
  }
  // Admins can manage members (not owners or other admins)
  if (currentUser.role === "admin" && targetUser.role === "member") {
    return true;
  }
  return false;
}
```

### Permission Matrix

| Action | Owner | Admin | Member |
|--------|-------|-------|--------|
| Manage account settings | Yes | Yes | No |
| Invite/deactivate users | Yes | Yes (except owner) | No |
| Change user roles | Yes | No | No |
| Create boards | Yes | Yes | Yes |
| Delete any board | Yes | Yes | Own only |
| Manage board access | Yes | Yes | Own boards only |
| Create cards | Yes | Yes | Yes (on accessible boards) |
| Delete any card | Yes | Yes | Own cards only |
| Manage webhooks | Yes | Yes | Board creator only |
| Configure entropy | Yes | Yes | No |

## Board-Level Access Control

### Two Modes

**All Access** (`allAccess: true`):
- Every active user in the account automatically has access
- Access records are created when the board is created or when a new user joins
- Cannot revoke individual access

**Selective** (`allAccess: false`):
- Only users with explicit `accesses` records can view/interact
- Access is granted/revoked manually
- Board creator always has access

### Require Board Access

The helper that checks if a user can access a specific board:

```typescript
// convex/lib/permissions.ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

export async function requireBoardAccess(
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users">,
  boardId: Id<"boards">,
): Promise<Doc<"boards">> {
  const board = await ctx.db.get(boardId);
  if (!board || board.accountId !== user.accountId) {
    throw new ConvexError("Board not found");
  }

  // Admins can access all boards in their account
  if (isAdmin(user)) {
    return board;
  }

  // Check for an access record
  const access = await ctx.db
    .query("accesses")
    .withIndex("by_board_user", (q) =>
      q.eq("boardId", boardId).eq("userId", user._id)
    )
    .unique();

  if (!access) {
    throw new ConvexError("No access to this board");
  }

  return board;
}
```

### Granting Access

```typescript
// convex/accesses.ts
import { mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";
import { canAdministerBoard } from "./lib/permissions";

export const grant = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { accountId, boardId, userIds }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);

    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) {
      throw new ConvexError("Board not found");
    }

    if (!canAdministerBoard(currentUser, board)) {
      throw new ConvexError("Not authorized to manage board access");
    }

    for (const userId of userIds) {
      // Check user exists in this account
      const targetUser = await ctx.db.get(userId);
      if (!targetUser || targetUser.accountId !== accountId) continue;

      // Check not already granted
      const existing = await ctx.db
        .query("accesses")
        .withIndex("by_board_user", (q) =>
          q.eq("boardId", boardId).eq("userId", userId)
        )
        .unique();

      if (!existing) {
        await ctx.db.insert("accesses", {
          accountId,
          boardId,
          userId,
          involvement: "access_only",
        });
      }
    }
  },
});
```

### Revoking Access

When access is revoked, clean up related data (like Fizzy's `Board::CleanInaccessibleDataJob`):

```typescript
export const revoke = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { accountId, boardId, userIds }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);

    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) {
      throw new ConvexError("Board not found");
    }

    if (!canAdministerBoard(currentUser, board)) {
      throw new ConvexError("Not authorized to manage board access");
    }

    // Can't revoke access on all_access boards
    if (board.allAccess) {
      throw new ConvexError("Cannot revoke access on all-access boards");
    }

    for (const userId of userIds) {
      // Can't revoke creator's access
      if (userId === board.creatorId) continue;

      const access = await ctx.db
        .query("accesses")
        .withIndex("by_board_user", (q) =>
          q.eq("boardId", boardId).eq("userId", userId)
        )
        .unique();

      if (access) {
        await ctx.db.delete(access._id);

        // Clean up: remove watches on this board's cards
        const boardCards = await ctx.db
          .query("cards")
          .withIndex("by_board", (q) => q.eq("boardId", boardId))
          .collect();

        for (const card of boardCards) {
          const watch = await ctx.db
            .query("watches")
            .withIndex("by_user_card", (q) =>
              q.eq("userId", userId).eq("cardId", card._id)
            )
            .unique();

          if (watch) await ctx.db.delete(watch._id);
        }
      }
    }
  },
});
```

### Board Watching

Users can subscribe to board-level notifications:

```typescript
export const toggleWatching = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const access = await ctx.db
      .query("accesses")
      .withIndex("by_board_user", (q) =>
        q.eq("boardId", boardId).eq("userId", user._id)
      )
      .unique();

    if (!access) {
      throw new ConvexError("No access to this board");
    }

    const newInvolvement =
      access.involvement === "watching" ? "access_only" : "watching";

    await ctx.db.patch(access._id, { involvement: newInvolvement });
  },
});
```

## Public Boards

### Publishing a Board

Generates a random key for public access:

```typescript
// convex/boards.ts
export const publish = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) {
      throw new ConvexError("Board not found");
    }

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError("Not authorized");
    }

    // Generate a random public key
    const key = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(36))
      .join("")
      .slice(0, 32);

    await ctx.db.patch(boardId, { publicKey: key });

    return key;
  },
});
```

### Unpublishing

```typescript
export const unpublish = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) {
      throw new ConvexError("Board not found");
    }

    if (!canAdministerBoard(user, board)) {
      throw new ConvexError("Not authorized");
    }

    await ctx.db.patch(boardId, {
      publicKey: undefined,
      publicDescription: undefined,
    });
  },
});
```

### Public Board Queries

These functions don't require authentication — they use the public key:

```typescript
export const getPublic = query({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }) => {
    // No auth required
    const board = await ctx.db
      .query("boards")
      .withIndex("by_public_key", (q) => q.eq("publicKey", publicKey))
      .unique();

    if (!board) return null;

    // Get columns
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", board._id))
      .collect();

    // Get published, active cards
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .collect();

    const activeCards = cards.filter(
      (c) => c.status === "published" && !c.closedAt && !c.postponedAt
    );

    return {
      board: {
        name: board.name,
        publicDescription: board.publicDescription,
      },
      columns,
      cards: activeCards,
    };
  },
});
```

Public board queries are read-only. There are no public mutations.

## Using Permissions in Mutations

Here's how all the layers come together in a typical mutation:

```typescript
export const deleteCard = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    // Layer 1: Account access (is user a member of this account?)
    const user = await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    // Layer 2: Board access (does user have access to this board?)
    await requireBoardAccess(ctx, user, card.boardId);

    // Layer 3: Action permission (can this user delete this card?)
    if (!canAdministerCard(user, card)) {
      throw new ConvexError("Not authorized to delete this card");
    }

    await ctx.db.delete(cardId);
  },
});
```

Three checks, in order:
1. Is the user in this account? (`requireAccountAccess`)
2. Can the user see this board? (`requireBoardAccess`)
3. Can the user perform this specific action? (`canAdministerCard`)

## Access Decision Flowchart

```
Function called with (accountId, resourceId)
    │
    ▼
Is user authenticated (Clerk JWT)?
    │── No → "Not authenticated"
    │── Yes
    ▼
Does user have active membership in this account?
    │── No → "Not a member of this account"
    │── Yes
    ▼
Is the resource in this account? (accountId check)
    │── No → "Not found"
    │── Yes
    ▼
Does the operation need board access?
    │── No → Allow (account-level operations)
    │── Yes
    ▼
Is user admin/owner?
    │── Yes → Allow (admins access all boards)
    │── No
    ▼
Does user have an access record for this board?
    │── No → "No access to this board"
    │── Yes
    ▼
Does the action require admin/creator permissions?
    │── No → Allow (member-level operations)
    │── Yes
    ▼
Is user admin OR resource creator?
    │── No → "Not authorized"
    │── Yes → Allow
```

## Exercise: Implement Permissions

1. **Create `convex/lib/permissions.ts`** with all helper functions: `isAdmin`, `isOwner`, `canAdministerBoard`, `canAdministerCard`, `canManageUser`, `requireBoardAccess`

2. **Implement access management** in `convex/accesses.ts`: `grant`, `revoke`, `toggleWatching`

3. **Implement board publishing** in `convex/boards.ts`: `publish`, `unpublish`, `getPublic`

4. **Add permission checks to existing mutations**:
   - Board update/delete: require `canAdministerBoard`
   - Card delete: require `canAdministerCard`
   - Member management: require `canManageUser`

5. **Test scenarios**:
   - Member tries to delete another user's card → should fail
   - Admin deletes any card → should succeed
   - Member tries to access a selective board without access → should fail
   - Generate a public key, query the public board without auth → should succeed
   - Revoke access, verify cleanup of watches

---

Next: [Module 10 — Advanced Features](./10-advanced-features.md)
