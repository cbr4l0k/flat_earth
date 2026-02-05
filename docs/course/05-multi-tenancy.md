# Module 05 — Multi-Tenancy

> **Goal:** Implement account isolation so that users in one account never see data from another, understand the `accountId` pattern, and build the helper functions that enforce isolation.
>
> **Reference:** [docs/fizzy-analysis/05-multi-tenancy.md](../fizzy-analysis/05-multi-tenancy.md)

## How Fizzy Does It

Fizzy uses URL path-based tenanting with a Rack middleware trick:

1. URL `/0001234567/boards` hits the middleware
2. Middleware extracts `0001234567`, finds the Account, sets `Current.account`
3. Every controller scopes queries through `Current.account` or `Current.user`
4. Every model has `account_id`, and no `default_scope` is used — scoping is explicit

The key insight: **no magic**. Every query explicitly includes the account filter. This prevents accidental cross-tenant data leaks.

## How Convex Does It

Same principle, different mechanism:

1. Frontend sends `accountId` with every function call
2. Every Convex function receives `accountId` as an argument
3. Every query uses indexes starting with `accountId`
4. Helper functions enforce that the current user belongs to the requested account

### The `accountId` Is Everywhere

Look at the schema from Module 03. Almost every table has:

```typescript
someTable: defineTable({
  accountId: v.id("accounts"),
  // ... other fields
}).index("by_account", ["accountId"]),
```

And almost every query starts with:

```typescript
.withIndex("by_account", (q) => q.eq("accountId", accountId))
```

This is intentional. It's the Convex equivalent of Fizzy's explicit scoping through `Current.account`.

## The Core Isolation Helper

### `requireAccountAccess`

This function does two things: verifies the user is authenticated AND belongs to the specified account. It's the gatekeeper for every tenant-scoped operation:

```typescript
// convex/lib/auth.ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

export async function requireAccountAccess(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
): Promise<Doc<"users">> {
  // 1. Check Clerk authentication
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }

  // 2. Check account exists
  const account = await ctx.db.get(accountId);
  if (!account) {
    throw new ConvexError("Account not found");
  }

  // 3. Check user has membership in this account
  const user = await ctx.db
    .query("users")
    .withIndex("by_account_clerk", (q) =>
      q.eq("accountId", accountId).eq("clerkId", identity.subject)
    )
    .unique();

  if (!user) {
    throw new ConvexError("Not a member of this account");
  }

  if (!user.active) {
    throw new ConvexError("User is deactivated");
  }

  return user;
}
```

### Usage Pattern

Every tenant-scoped function follows this pattern:

```typescript
export const listBoards = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    // Step 1: Verify access (throws if unauthorized)
    const user = await requireAccountAccess(ctx, accountId);

    // Step 2: Query data scoped to this account
    const boards = await ctx.db
      .query("boards")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    return boards;
  },
});
```

Notice: `accountId` is a required argument, used for both access verification AND data scoping.

## Account CRUD

### Creating an Account

Already covered in Module 04's `createWithOwner` mutation. Key points:
- Creates the account document
- Creates the owner user document
- Seeds default data (board, columns)
- Grants access records

### Listing Account Members

```typescript
// convex/accounts.ts
export const listMembers = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    return ctx.db
      .query("users")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
  },
});
```

### Inviting Members

```typescript
// convex/accounts.ts
export const inviteMember = mutation({
  args: {
    accountId: v.id("accounts"),
    clerkId: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { accountId, clerkId, name, role }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);

    // Only admins/owners can invite
    if (currentUser.role !== "owner" && currentUser.role !== "admin") {
      throw new ConvexError("Only admins can invite members");
    }

    // Check not already a member
    const existing = await ctx.db
      .query("users")
      .withIndex("by_account_clerk", (q) =>
        q.eq("accountId", accountId).eq("clerkId", clerkId)
      )
      .unique();

    if (existing) {
      throw new ConvexError("Already a member");
    }

    // Create the user
    const userId = await ctx.db.insert("users", {
      accountId,
      clerkId,
      name,
      role,
      active: true,
    });

    // Auto-grant access to all_access boards
    const boards = await ctx.db
      .query("boards")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    for (const board of boards.filter((b) => b.allAccess)) {
      await ctx.db.insert("accesses", {
        accountId,
        boardId: board._id,
        userId,
        involvement: "access_only",
      });
    }

    return userId;
  },
});
```

### Updating Member Roles

```typescript
export const updateMemberRole = mutation({
  args: {
    accountId: v.id("accounts"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { accountId, userId, role }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);

    // Only owners can change roles
    if (currentUser.role !== "owner") {
      throw new ConvexError("Only the owner can change roles");
    }

    const targetUser = await ctx.db.get(userId);
    if (!targetUser || targetUser.accountId !== accountId) {
      throw new ConvexError("User not found in this account");
    }

    // Can't change the owner's role
    if (targetUser.role === "owner") {
      throw new ConvexError("Cannot change the owner's role");
    }

    await ctx.db.patch(userId, { role });
  },
});
```

### Deactivating Members

Fizzy soft-deletes users (sets `active: false`). We do the same:

```typescript
export const deactivateMember = mutation({
  args: {
    accountId: v.id("accounts"),
    userId: v.id("users"),
  },
  handler: async (ctx, { accountId, userId }) => {
    const currentUser = await requireAccountAccess(ctx, accountId);

    if (currentUser.role !== "owner" && currentUser.role !== "admin") {
      throw new ConvexError("Only admins can deactivate members");
    }

    const targetUser = await ctx.db.get(userId);
    if (!targetUser || targetUser.accountId !== accountId) {
      throw new ConvexError("User not found");
    }

    if (targetUser.role === "owner") {
      throw new ConvexError("Cannot deactivate the owner");
    }

    await ctx.db.patch(userId, { active: false });
  },
});
```

## Account Switching (Multi-Account Users)

A Clerk user can belong to multiple accounts. The frontend handles switching:

```
┌─ Account Picker ──────────────────────────────┐
│                                                │
│  Clerk Identity: alice@example.com             │
│                                                │
│  ┌─ Account A (Personal) ──── owner ──────┐   │
│  └────────────────────────────────────────┘   │
│  ┌─ Account B (Work Team) ─── member ─────┐   │
│  └────────────────────────────────────────┘   │
│                                                │
└────────────────────────────────────────────────┘
```

In Fizzy, this requires signed transfer IDs and session recreation. In Convex + Clerk, it's trivial — the Clerk session stays the same, and the frontend just changes which `accountId` it passes to Convex functions.

```typescript
// Frontend: just change the accountId
const [activeAccountId, setActiveAccountId] = useState<Id<"accounts">>();

// All queries automatically switch context
const boards = useQuery(api.boards.list,
  activeAccountId ? { accountId: activeAccountId } : "skip"
);
```

## Isolation Testing Checklist

After implementing multi-tenancy, verify these scenarios:

| Scenario | Expected |
|----------|----------|
| User in Account A queries boards | Only sees Account A's boards |
| User in Account A tries to access Account B's board by ID | Gets "Not a member" error |
| User with access to both accounts | Can list and switch between them |
| Deactivated user tries to access their account | Gets "User is deactivated" error |
| Unauthenticated request with an accountId | Gets "Not authenticated" error |
| New member auto-gets access to `allAccess` boards | Access records created |
| Mutation in Account A creates card | Card has Account A's `accountId` |

## Fizzy's Approach vs Ours

| Fizzy (Rails) | Flat Earth (Convex) |
|---------------|---------------------|
| Rack middleware extracts account from URL | Frontend passes `accountId` as function arg |
| `Current.account` thread-local | `accountId` parameter threaded through functions |
| `SCRIPT_NAME` trick for URL generation | TanStack Router params (`/$accountId/boards`) |
| Job serialization via GlobalID | `accountId` passed to scheduled functions |
| Explicit scoping (no default_scope) | Index-based queries with `accountId` prefix |
| Session transfer for account switching | Same Clerk session, different `accountId` arg |

The end result is identical: no query ever crosses tenant boundaries because every query requires and uses `accountId` explicitly.

## Exercise: Account Isolation

1. **Update `convex/lib/auth.ts`** with the `requireAccountAccess` helper from this module

2. **Write account CRUD** in `convex/accounts.ts`:
   - `listMembers` — list all users in an account
   - `inviteMember` — add a new user (admin-only)
   - `updateMemberRole` — change a user's role (owner-only)
   - `deactivateMember` — soft-delete a user (admin-only)

3. **Test isolation via the dashboard**:
   - Create two accounts with different data
   - Verify a query for Account A's boards doesn't return Account B's boards
   - Try accessing Account B with an Account A user — verify it throws

4. **Add `accountId` to all future functions**: From this point forward, every query and mutation you write should:
   - Accept `accountId: v.id("accounts")` as an argument
   - Call `requireAccountAccess(ctx, accountId)` first
   - Scope all queries using the `by_account` index

---

Next: [Module 06 — CRUD Operations](./06-crud-operations.md)
