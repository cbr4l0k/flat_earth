# Module 08 — Permissions & Access Control

> **What you'll see running:** Role-based UI where admins see management options that members don't, board access control with grant/revoke, public board sharing via URL, and a member management panel.
>
> **Reference:** [docs/fizzy-analysis/04-permissions-and-access-control.md](../fizzy-analysis/04-permissions-and-access-control.md)

## Fizzy's Permission Model

Three layers of access control:
1. **Account-level roles** — owner > admin > member
2. **Board-level access** — all_access boards vs. selective (explicit grants)
3. **Public boards** — read-only access via shareable key

## Permission Helpers (Backend)

```typescript
// convex/lib/permissions.ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

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
  if (currentUser.role === "owner" && currentUser._id !== targetUser._id) {
    return true;
  }
  if (currentUser.role === "admin" && targetUser.role === "member") {
    return true;
  }
  return false;
}

export async function requireBoardAccess(
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users">,
  boardId: Id<"boards">,
): Promise<Doc<"boards">> {
  const board = await ctx.db.get(boardId);
  if (!board || board.accountId !== user.accountId) {
    throw new ConvexError("Board not found");
  }

  if (isAdmin(user)) return board;

  const access = await ctx.db
    .query("accesses")
    .withIndex("by_board_user", (q) =>
      q.eq("boardId", boardId).eq("userId", user._id)
    )
    .unique();

  if (!access) throw new ConvexError("No access to this board");
  return board;
}
```

### Permission Matrix

| Action | Owner | Admin | Member |
|--------|-------|-------|--------|
| Manage account settings | Yes | Yes | No |
| Invite/deactivate users | Yes | Yes (not owner) | No |
| Change user roles | Yes | No | No |
| Create boards | Yes | Yes | Yes |
| Delete any board | Yes | Yes | Own only |
| Create cards | Yes | Yes | Yes (accessible boards) |
| Delete any card | Yes | Yes | Own only |

## Board-Level Access Control

### Grant and Revoke Access

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
    if (!board || board.accountId !== accountId) throw new ConvexError("Board not found");
    if (!canAdministerBoard(currentUser, board)) throw new ConvexError("Not authorized");

    for (const userId of userIds) {
      const targetUser = await ctx.db.get(userId);
      if (!targetUser || targetUser.accountId !== accountId) continue;

      const existing = await ctx.db
        .query("accesses")
        .withIndex("by_board_user", (q) =>
          q.eq("boardId", boardId).eq("userId", userId)
        )
        .unique();

      if (!existing) {
        await ctx.db.insert("accesses", {
          accountId, boardId, userId, involvement: "access_only",
        });
      }
    }
  },
});

export const revoke = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { accountId, boardId, userIds }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);
    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) throw new ConvexError("Board not found");
    if (!canAdministerBoard(currentUser, board)) throw new ConvexError("Not authorized");
    if (board.allAccess) throw new ConvexError("Cannot revoke on all-access boards");

    for (const userId of userIds) {
      if (userId === board.creatorId) continue;

      const access = await ctx.db
        .query("accesses")
        .withIndex("by_board_user", (q) =>
          q.eq("boardId", boardId).eq("userId", userId)
        )
        .unique();

      if (access) {
        await ctx.db.delete(access._id);

        // Clean up watches on this board's cards
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

## Public Boards

### Publish and Unpublish

```typescript
// convex/boards.ts (add to existing file)
export const publish = mutation({
  args: { accountId: v.id("accounts"), boardId: v.id("boards") },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) throw new ConvexError("Board not found");
    if (!canAdministerBoard(user, board)) throw new ConvexError("Not authorized");

    const key = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(36)).join("").slice(0, 32);
    await ctx.db.patch(boardId, { publicKey: key });
    return key;
  },
});

export const unpublish = mutation({
  args: { accountId: v.id("accounts"), boardId: v.id("boards") },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) throw new ConvexError("Board not found");
    if (!canAdministerBoard(user, board)) throw new ConvexError("Not authorized");
    await ctx.db.patch(boardId, { publicKey: undefined, publicDescription: undefined });
  },
});

export const getPublic = query({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }) => {
    const board = await ctx.db
      .query("boards")
      .withIndex("by_public_key", (q) => q.eq("publicKey", publicKey))
      .unique();
    if (!board) return null;

    const columns = await ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", board._id))
      .collect();

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .collect();

    const activeCards = cards.filter(
      (c) => c.status === "published" && !c.closedAt && !c.postponedAt
    );

    return {
      board: { name: board.name, publicDescription: board.publicDescription },
      columns,
      cards: activeCards,
    };
  },
});
```

## Member Management

```typescript
// convex/accounts.ts (add to existing file)
export const listMembers = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireAccountAccess(ctx, accountId);
    return ctx.db
      .query("users")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
  },
});

export const updateMemberRole = mutation({
  args: {
    accountId: v.id("accounts"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { accountId, userId, role }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);
    if (currentUser.role !== "owner") throw new ConvexError("Only owners can change roles");

    const targetUser = await ctx.db.get(userId);
    if (!targetUser || targetUser.accountId !== accountId) throw new ConvexError("User not found");
    if (targetUser.role === "owner") throw new ConvexError("Cannot change owner role");

    await ctx.db.patch(userId, { role });
  },
});

export const deactivateMember = mutation({
  args: { accountId: v.id("accounts"), userId: v.id("users") },
  handler: async (ctx, { accountId, userId }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);
    if (!isAdmin(currentUser)) throw new ConvexError("Only admins can deactivate");

    const targetUser = await ctx.db.get(userId);
    if (!targetUser || targetUser.accountId !== accountId) throw new ConvexError("User not found");
    if (targetUser.role === "owner") throw new ConvexError("Cannot deactivate owner");

    await ctx.db.patch(userId, { active: false });
  },
});
```

## Frontend: Conditional UI Based on Permissions

```tsx
// src/components/BoardSettings.tsx
function BoardSettings({ accountId, board, currentUser }) {
  const isAdmin = currentUser.role === "owner" || currentUser.role === "admin";
  const canAdmin = isAdmin || board.creatorId === currentUser._id;

  if (!canAdmin) return null;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Board Settings</h3>
      {/* Only show if user can administer */}
      <PublishToggle accountId={accountId} board={board} />
      <AccessManager accountId={accountId} boardId={board._id} />
    </div>
  );
}
```

```tsx
// src/components/MemberList.tsx
function MemberList({ accountId }) {
  const members = useQuery(api.accounts.listMembers, { accountId });
  const updateRole = useMutation(api.accounts.updateMemberRole);
  const deactivate = useMutation(api.accounts.deactivateMember);

  if (!members) return <p>Loading...</p>;

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <div key={member._id} className="flex items-center justify-between rounded border p-3">
          <div>
            <p className="font-medium">{member.name}</p>
            <p className="text-xs text-gray-500">{member.role}</p>
          </div>
          {member.role !== "owner" && (
            <div className="flex gap-2">
              <select
                value={member.role}
                onChange={(e) =>
                  updateRole({
                    accountId,
                    userId: member._id,
                    role: e.target.value as "admin" | "member",
                  })
                }
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deactivate({ accountId, userId: member._id })}
              >
                Deactivate
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Frontend: Public Board Route

```tsx
// src/routes/public/boards/$publicKey.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export const Route = createFileRoute("/public/boards/$publicKey")({
  component: PublicBoardPage,
});

function PublicBoardPage() {
  const { publicKey } = Route.useParams();
  const data = useQuery(api.boards.getPublic, { publicKey });

  if (data === undefined) return <p>Loading...</p>;
  if (!data) return <p>Board not found or no longer public.</p>;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-2 text-2xl font-bold">{data.board.name}</h1>
      {data.board.publicDescription && (
        <p className="mb-6 text-gray-600">{data.board.publicDescription}</p>
      )}
      <div className="flex gap-4 overflow-x-auto">
        {data.columns.map((col) => (
          <div key={col._id} className="w-72 shrink-0 rounded-lg bg-gray-100 p-4">
            <h3 className="mb-3 font-semibold" style={{ color: col.color }}>
              {col.name}
            </h3>
            {data.cards
              .filter((c) => c.columnId === col._id)
              .map((card) => (
                <div key={card._id} className="mb-2 rounded bg-white p-3 shadow-sm">
                  <span className="text-xs text-gray-400">#{card.number}</span>
                  <p className="text-sm font-medium">{card.title}</p>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Exercise

1. Create `convex/lib/permissions.ts` with all helper functions
2. Implement access management in `convex/accesses.ts`: `grant`, `revoke`
3. Implement board publishing: `publish`, `unpublish`, `getPublic`
4. Add member management: `listMembers`, `updateMemberRole`, `deactivateMember`
5. Build conditional UI: show admin controls only to admins
6. Build the public board route at `/public/boards/$publicKey`
7. Test: member tries to delete admin's card (fails), admin deletes any card (succeeds)
8. Test: publish a board, view it at the public URL without signing in

**Result:** Role-based UI, board access control, public board sharing, and member management.

---

Next: [Module 09 — Collaboration Features](./09-collaboration.md)
