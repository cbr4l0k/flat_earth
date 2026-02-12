# Module 04 — Schema Design & Multi-Tenancy

> **What you'll see running:** An account creation flow, an account picker for users with multiple accounts, and data scoped per tenant — queries from Account A never return Account B's data.
>
> **References:** [docs/fizzy-analysis/01-database-schema.md](../fizzy-analysis/01-database-schema.md), [docs/fizzy-analysis/05-multi-tenancy.md](../fizzy-analysis/05-multi-tenancy.md)

## The Full Flat Earth Schema

Fizzy has 74 tables. We consolidate to ~25 by eliminating infrastructure tables (auth, sessions, search shards, storage), merging 1:1 tables into parent documents, and replacing filter join tables with arrays.

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // === Core ===

  accounts: defineTable({
    name: v.string(),
    cardsCount: v.number(),
  }),

  users: defineTable({
    accountId: v.id("accounts"),
    clerkId: v.string(),
    name: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
    ),
    active: v.boolean(),
  })
    .index("by_account", ["accountId"])
    .index("by_clerk_id", ["clerkId"])
    .index("by_account_clerk", ["accountId", "clerkId"])
    .index("by_account_role", ["accountId", "role"]),

  boards: defineTable({
    accountId: v.id("accounts"),
    name: v.string(),
    creatorId: v.id("users"),
    allAccess: v.boolean(),
    publicKey: v.optional(v.string()),
    publicDescription: v.optional(v.string()),
  })
    .index("by_account", ["accountId"])
    .index("by_public_key", ["publicKey"]),

  columns: defineTable({
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    name: v.string(),
    color: v.string(),
    position: v.number(),
  })
    .index("by_board", ["boardId"])
    .index("by_board_position", ["boardId", "position"]),

  cards: defineTable({
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    columnId: v.union(v.id("columns"), v.null()),
    creatorId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    number: v.number(),
    status: v.union(v.literal("drafted"), v.literal("published")),
    dueOn: v.optional(v.string()),
    lastActiveAt: v.number(),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.id("users")),
    postponedAt: v.optional(v.number()),
    postponedBy: v.optional(v.id("users")),
    isGolden: v.boolean(),
    activitySpikeAt: v.optional(v.number()),
    imageId: v.optional(v.id("_storage")),
  })
    .index("by_account", ["accountId"])
    .index("by_account_number", ["accountId", "number"])
    .index("by_board", ["boardId"])
    .index("by_column", ["columnId"])
    .index("by_account_status", ["accountId", "status"])
    .index("by_account_activity", ["accountId", "lastActiveAt"])
    .searchIndex("search_cards", {
      searchField: "title",
      filterFields: ["accountId", "boardId"],
    }),

  // === Collaboration ===

  comments: defineTable({
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    creatorId: v.id("users"),
    body: v.string(),
    isSystem: v.boolean(),
  })
    .index("by_card", ["cardId"])
    .index("by_account", ["accountId"]),

  assignments: defineTable({
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    assigneeId: v.id("users"),
    assignerId: v.id("users"),
  })
    .index("by_card", ["cardId"])
    .index("by_assignee", ["assigneeId"])
    .index("by_card_assignee", ["cardId", "assigneeId"]),

  tags: defineTable({
    accountId: v.id("accounts"),
    title: v.string(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_title", ["accountId", "title"]),

  taggings: defineTable({
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    tagId: v.id("tags"),
  })
    .index("by_card", ["cardId"])
    .index("by_tag", ["tagId"])
    .index("by_card_tag", ["cardId", "tagId"]),

  steps: defineTable({
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    content: v.string(),
    completed: v.boolean(),
  }).index("by_card", ["cardId"]),

  watches: defineTable({
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    userId: v.id("users"),
    watching: v.boolean(),
  })
    .index("by_card", ["cardId"])
    .index("by_user", ["userId"])
    .index("by_user_card", ["userId", "cardId"]),

  pins: defineTable({
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    userId: v.id("users"),
  })
    .index("by_user", ["userId"])
    .index("by_card_user", ["cardId", "userId"]),

  mentions: defineTable({
    accountId: v.id("accounts"),
    source: v.union(
      v.object({ type: v.literal("card"), id: v.id("cards") }),
      v.object({ type: v.literal("comment"), id: v.id("comments") }),
    ),
    mentionerId: v.id("users"),
    mentioneeId: v.id("users"),
  })
    .index("by_mentionee", ["mentioneeId"])
    .index("by_account", ["accountId"]),

  reactions: defineTable({
    accountId: v.id("accounts"),
    commentId: v.id("comments"),
    reacterId: v.id("users"),
    emoji: v.string(),
  }).index("by_comment", ["commentId"]),

  // === Access Control ===

  accesses: defineTable({
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    userId: v.id("users"),
    involvement: v.union(v.literal("access_only"), v.literal("watching")),
    accessedAt: v.optional(v.number()),
  })
    .index("by_board", ["boardId"])
    .index("by_user", ["userId"])
    .index("by_board_user", ["boardId", "userId"]),

  // === Events & Notifications ===

  events: defineTable({
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    creatorId: v.id("users"),
    action: v.string(),
    eventable: v.union(
      v.object({ type: v.literal("card"), id: v.id("cards") }),
      v.object({ type: v.literal("comment"), id: v.id("comments") }),
    ),
    particulars: v.optional(v.any()),
  })
    .index("by_board", ["boardId"])
    .index("by_account_action", ["accountId", "action"]),

  notifications: defineTable({
    accountId: v.id("accounts"),
    userId: v.id("users"),
    creatorId: v.optional(v.id("users")),
    source: v.union(
      v.object({ type: v.literal("event"), id: v.id("events") }),
      v.object({ type: v.literal("mention"), id: v.id("mentions") }),
    ),
    readAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "readAt"]),

  notificationBundles: defineTable({
    accountId: v.id("accounts"),
    userId: v.id("users"),
    startsAt: v.number(),
    endsAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("delivered"),
    ),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_ends_status", ["endsAt", "status"]),

  // === Entropy ===

  entropies: defineTable({
    accountId: v.id("accounts"),
    container: v.union(
      v.object({ type: v.literal("account"), id: v.id("accounts") }),
      v.object({ type: v.literal("board"), id: v.id("boards") }),
    ),
    autoPostponePeriod: v.number(),
  }).index("by_account", ["accountId"]),

  // === Webhooks ===

  webhooks: defineTable({
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    name: v.string(),
    url: v.string(),
    signingSecret: v.string(),
    subscribedActions: v.array(v.string()),
    active: v.boolean(),
  }).index("by_board", ["boardId"]),

  webhookDeliveries: defineTable({
    accountId: v.id("accounts"),
    webhookId: v.id("webhooks"),
    eventId: v.id("events"),
    state: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("errored"),
    ),
    request: v.optional(v.string()),
    response: v.optional(v.string()),
  }).index("by_webhook", ["webhookId"]),

  // === Filters ===

  filters: defineTable({
    accountId: v.id("accounts"),
    creatorId: v.id("users"),
    paramsDigest: v.string(),
    boardIds: v.array(v.id("boards")),
    tagIds: v.array(v.id("tags")),
    assigneeIds: v.array(v.id("users")),
    assignerIds: v.array(v.id("users")),
    closerIds: v.array(v.id("users")),
    creatorIds: v.array(v.id("users")),
    fields: v.optional(v.any()),
  })
    .index("by_account", ["accountId"])
    .index("by_creator_digest", ["creatorId", "paramsDigest"]),

  searchQueries: defineTable({
    accountId: v.id("accounts"),
    userId: v.id("users"),
    terms: v.string(),
  }).index("by_user", ["userId"]),
});
```

## Schema Design Principles

### Every Document Gets Free Fields

Convex automatically adds to every document:

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `Id<"tableName">` | Unique document ID (typed per table) |
| `_creationTime` | `number` | Millisecond timestamp |

### Optional vs Nullable

```typescript
// Optional: field may not exist
description: v.optional(v.string())
// Type: string | undefined

// Nullable: field always exists but can be null
columnId: v.union(v.id("columns"), v.null())
// Type: Id<"columns"> | null
```

Use **optional** for fields not every document needs. Use **nullable** for fields every document has but might be empty.

### Indexes

Indexes make queries fast. Without an index, Convex scans every document.

```typescript
boards: defineTable({
  accountId: v.id("accounts"),
  name: v.string(),
})
  .index("by_account", ["accountId"]),
```

Compound indexes support left-to-right matching:

```typescript
.index("by_account_status_activity", ["accountId", "status", "lastActiveAt"])
// Supports:
//   eq("accountId", x)                                    ✓
//   eq("accountId", x).eq("status", y)                    ✓
//   eq("accountId", x).eq("status", y).gte("lastActiveAt", z)  ✓
//   eq("status", y)  ← skips leftmost field               ✗
```

### Relational Patterns (No JOINs)

**One-to-Many:** Store parent ID on child, add index.

```typescript
boards: defineTable({
  accountId: v.id("accounts"),  // FK to parent
}).index("by_account", ["accountId"]),
```

**Many-to-Many:** Join table for large sets, array for small bounded sets.

```typescript
// Join table (large sets)
taggings: defineTable({
  cardId: v.id("cards"),
  tagId: v.id("tags"),
}).index("by_card", ["cardId"]).index("by_tag", ["tagId"]),

// Array (small bounded sets)
filters: defineTable({
  boardIds: v.array(v.id("boards")),
}),
```

### Discriminated Unions Instead of Polymorphism

Fizzy uses Rails polymorphic associations (`source_type` + `source_id`). Convex uses discriminated unions:

```typescript
notifications: defineTable({
  source: v.union(
    v.object({ type: v.literal("event"), id: v.id("events") }),
    v.object({ type: v.literal("mention"), id: v.id("mentions") }),
  ),
}),
```

This gives compile-time type safety that Rails polymorphism doesn't.

## TypeScript in Context: Union Types, `Id<>`, `Doc<>`

Working with Convex generates typed helpers you'll use constantly:

```typescript
import { Doc, Id } from "../_generated/dataModel";

// Id<"cards"> — a typed document reference
const cardId: Id<"cards"> = /* from a query or mutation arg */;

// Doc<"cards"> — the full shape of a cards document
const card: Doc<"cards"> = await ctx.db.get(cardId);

// Union types for roles
type Role = Doc<"users">["role"];  // "owner" | "admin" | "member"
```

## Multi-Tenancy: The `accountId` Pattern

### How Fizzy Does It

Fizzy uses URL path-based tenanting: `/0001234567/boards`. A Rack middleware extracts the account ID and sets `Current.account`. Every query explicitly scopes through `Current.account`.

### How Convex Does It

Same principle, different mechanism:
1. Frontend sends `accountId` with every function call
2. Every function receives `accountId` as an argument
3. Every query uses indexes starting with `accountId`
4. Helper functions enforce that the user belongs to the requested account

### The `requireAccountAccess` Helper

This is the most important helper in the entire app:

```typescript
// convex/lib/auth.ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }
  return identity;
}

export async function requireAccountAccess(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }

  const account = await ctx.db.get(accountId);
  if (!account) {
    throw new ConvexError("Account not found");
  }

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

Every tenant-scoped function follows this pattern:

```typescript
export const listBoards = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    return ctx.db
      .query("boards")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
  },
});
```

## Account Creation

```typescript
// convex/accounts.ts
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const createWithOwner = mutation({
  args: { accountName: v.string() },
  handler: async (ctx, { accountName }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const accountId = await ctx.db.insert("accounts", {
      name: accountName,
      cardsCount: 0,
    });

    const userId = await ctx.db.insert("users", {
      accountId,
      clerkId: identity.subject,
      name: identity.name ?? "New User",
      role: "owner",
      active: true,
    });

    const boardId = await ctx.db.insert("boards", {
      accountId,
      name: "My First Board",
      creatorId: userId,
      allAccess: true,
    });

    const defaultColumns = [
      { name: "To Do", color: "#6366f1", position: 0 },
      { name: "In Progress", color: "#f59e0b", position: 1 },
      { name: "Done", color: "#22c55e", position: 2 },
    ];

    for (const col of defaultColumns) {
      await ctx.db.insert("columns", { accountId, boardId, ...col });
    }

    await ctx.db.insert("accesses", {
      accountId,
      boardId,
      userId,
      involvement: "watching",
    });

    return { accountId, userId, boardId };
  },
});

export const listMyAccounts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const users = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .collect();

    const activeUsers = users.filter((u) => u.active);

    const accounts = await Promise.all(
      activeUsers.map(async (user) => {
        const account = await ctx.db.get(user.accountId);
        return account
          ? { ...account, role: user.role, userId: user._id }
          : null;
      })
    );

    return accounts.filter(Boolean);
  },
});
```

## Account Picker UI

```tsx
// src/routes/index.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { SignInButton, UserButton, useUser } from "@clerk/clerk-react";
import { Button } from "../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../components/ui/card";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">Flat Earth</CardTitle>
            <CardDescription>Sign in to get started.</CardDescription>
          </CardHeader>
          <CardContent>
            <SignInButton mode="modal">
              <Button className="w-full" size="lg">
                Sign In
              </Button>
            </SignInButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AccountPicker />;
}

function AccountPicker() {
  const accounts = useQuery(api.accounts.listMyAccounts);
  const createAccount = useMutation(api.accounts.createWithOwner);
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();

  if (accounts === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading accounts...</p>
      </div>
    );
  }

  // Auto-redirect if only one account
  if (accounts.length === 1) {
    navigate({ to: "/$accountId", params: { accountId: accounts[0]._id } });
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Your Accounts</CardTitle>
            <UserButton />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.map((account) => (
            <Button
              key={account._id}
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                navigate({
                  to: "/$accountId",
                  params: { accountId: account._id },
                })
              }
            >
              {account.name}
              <span className="ml-auto text-xs text-gray-500">
                {account.role}
              </span>
            </Button>
          ))}

          <div className="border-t pt-4">
            <p className="mb-2 text-sm font-medium">Create New Account</p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border px-3 py-2 text-sm"
                placeholder="Account name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button
                onClick={async () => {
                  if (!newName.trim()) return;
                  const result = await createAccount({
                    accountName: newName.trim(),
                  });
                  navigate({
                    to: "/$accountId",
                    params: { accountId: result.accountId },
                  });
                }}
              >
                Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

## Account Layout with `/$accountId` Route

```tsx
// src/routes/$accountId/route.tsx
import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useUser, UserButton } from "@clerk/clerk-react";

export const Route = createFileRoute("/$accountId")({
  component: AccountLayout,
});

function AccountLayout() {
  const { isSignedIn, isLoaded } = useUser();
  const { accountId } = Route.useParams();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    window.location.href = "/sign-in";
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-white p-4">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-lg font-bold">
            Flat Earth
          </Link>
          <UserButton />
        </div>
        <nav className="space-y-1">
          <Link
            to="/$accountId"
            params={{ accountId }}
            className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
          >
            Boards
          </Link>
        </nav>
      </aside>
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

## Exercise

1. Replace the simple messages schema with the full Flat Earth schema
2. Create `convex/lib/auth.ts` with `requireAuth` and `requireAccountAccess`
3. Implement `createWithOwner` and `listMyAccounts` in `convex/accounts.ts`
4. Build the account picker page — create accounts, select, auto-redirect
5. Build the `/$accountId` route layout with sidebar
6. Verify tenant isolation: create two accounts, confirm data is scoped

**Result:** Account creation, selection, and a sidebar layout. All queries require `accountId` — no cross-tenant data leaks.

---

Next: [Module 05 — Boards & Columns](./05-boards-and-columns.md)
