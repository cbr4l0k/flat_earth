# Module 04 — Authentication

> **Goal:** Set up Clerk for authentication, integrate it with Convex, and implement the Identity → User mapping pattern.
>
> **Reference:** [docs/fizzy-analysis/03-authentication-and-sessions.md](../fizzy-analysis/03-authentication-and-sessions.md)

## Fizzy's Auth Model (What We're Replacing)

Fizzy implements custom passwordless authentication:

1. User enters email → receives 6-digit code → verifies code → gets session cookie
2. **Identity** = global user (email-based, not tenant-scoped)
3. **User** = account membership (Identity + Account + role)
4. **Session** = browser session (signed cookie with Rails `signed_id`)

We keep the same **Identity/User split** but delegate the auth infrastructure to Clerk. Clerk handles magic links, email verification, session management, and JWTs. We handle the User (account membership) model ourselves in Convex.

## Why Clerk

- Passwordless auth (magic links, email OTP) out of the box — matches Fizzy's approach
- Built-in Convex integration (JWT validation)
- Handles session management, token refresh, multi-device
- Organizations feature maps to Fizzy's accounts (optional — we'll manage accounts ourselves for flexibility)

## Setup Clerk

### 1. Create a Clerk Application

Go to [clerk.com](https://clerk.com), create an account, and create a new application.

In the Clerk dashboard:
- **Application name:** Flat Earth
- **Sign-in options:** Enable **Email address** only
- **Email verification:** Enable **Email code** (this mimics Fizzy's magic link behavior)
- Disable password, username, phone, and social sign-in

### 2. Get Your Keys

From the Clerk dashboard, copy:
- **Publishable Key** (starts with `pk_`)
- **Clerk Domain** (e.g., `your-app.clerk.accounts.dev`)

### 3. Install Clerk

```bash
bun add @clerk/clerk-react
```

## Configure Convex + Clerk

### 1. Set the Auth Config

Create the Convex auth configuration:

```typescript
// convex/auth.config.ts
export default {
  providers: [
    {
      domain: process.env.CLERK_ISSUER_URL,
    },
  ],
};
```

### 2. Set Environment Variables

In the Convex dashboard (Settings → Environment Variables), set:

```
CLERK_ISSUER_URL=https://your-app.clerk.accounts.dev
```

Or via CLI:

```bash
bunx convex env set CLERK_ISSUER_URL https://your-app.clerk.accounts.dev
```

### 3. How JWT Validation Works

The flow:

```
1. User signs in with Clerk (browser)
2. Clerk issues a JWT (JSON Web Token)
3. Client sends JWT with every Convex request (automatic)
4. Convex validates the JWT against Clerk's public keys
5. Your server functions access the identity via ctx.auth
```

You don't write any of this plumbing. Convex and Clerk handle the JWT exchange automatically.

## Using `ctx.auth` in Server Functions

### Getting the Current Identity

```typescript
import { query } from "./_generated/server";

export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null; // Not authenticated
    }

    return {
      clerkId: identity.subject,        // Clerk user ID (stable)
      email: identity.email,            // Email address
      name: identity.name,              // Display name (if set)
      tokenIdentifier: identity.tokenIdentifier, // Full identifier
    };
  },
});
```

`ctx.auth.getUserIdentity()` returns:
- `null` if the request is unauthenticated
- An `UserIdentity` object with Clerk user data if authenticated

The `subject` field is the Clerk user ID — this is stable across sessions and is what we store as `clerkId` in our `users` table.

### Requiring Authentication

Pattern for functions that require a logged-in user:

```typescript
import { query, mutation } from "./_generated/server";
import { ConvexError } from "convex/values";

// Helper: require authentication and return the identity
async function requireAuth(ctx: { auth: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }
  return identity;
}
```

## The Identity → User Mapping

This is the critical pattern. Clerk gives you a global identity (like Fizzy's `Identity`). But your app needs account-scoped users (like Fizzy's `User`).

### The Flow

```
Clerk Identity (global)          Your Convex Users Table (per-account)
┌──────────────────────┐         ┌─────────────────────────────────────┐
│ subject: "clerk_123" │   1:N   │ { clerkId: "clerk_123",            │
│ email: "me@test.com" │ ──────► │   accountId: account_A, role: "owner" } │
│ name: "Alice"        │         │ { clerkId: "clerk_123",            │
└──────────────────────┘         │   accountId: account_B, role: "member" } │
                                 └─────────────────────────────────────┘
```

One Clerk identity can have multiple User documents — one per account they belong to.

### The `getCurrentUser` Helper

This is the most important helper in the entire app. Almost every function will call it:

```typescript
// convex/lib/auth.ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_account_clerk", (q) =>
      q.eq("accountId", accountId).eq("clerkId", identity.subject)
    )
    .unique();

  if (!user || !user.active) {
    throw new ConvexError("No active user in this account");
  }

  return user;
}
```

Usage in any function:

```typescript
export const listBoards = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await getCurrentUser(ctx, accountId);
    // user is guaranteed to be an active user in this account
    // ... fetch boards ...
  },
});
```

### First-Time User Setup

When a Clerk user first signs in, they don't have a User document yet. Handle account creation:

```typescript
// convex/accounts.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

export const createWithOwner = mutation({
  args: {
    accountName: v.string(),
  },
  handler: async (ctx, { accountName }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    // Create the account
    const accountId = await ctx.db.insert("accounts", {
      name: accountName,
      cardsCount: 0,
    });

    // Create the owner user
    const userId = await ctx.db.insert("users", {
      accountId,
      clerkId: identity.subject,
      name: identity.name ?? "New User",
      role: "owner",
      active: true,
    });

    // Seed default data (board with columns)
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
      await ctx.db.insert("columns", {
        accountId,
        boardId,
        ...col,
      });
    }

    // Grant owner access to the board
    await ctx.db.insert("accesses", {
      accountId,
      boardId,
      userId,
      involvement: "watching",
    });

    return { accountId, userId, boardId };
  },
});
```

### Listing Accounts for a Clerk User

When a user has multiple accounts, show an account picker:

```typescript
// convex/accounts.ts
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
        return account ? { ...account, role: user.role, userId: user._id } : null;
      })
    );

    return accounts.filter(Boolean);
  },
});
```

## Joining an Existing Account

Like Fizzy's join codes, allow users to join an account:

```typescript
// convex/accounts.ts
export const join = mutation({
  args: {
    accountId: v.id("accounts"),
  },
  handler: async (ctx, { accountId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    // Check account exists
    const account = await ctx.db.get(accountId);
    if (!account) throw new ConvexError("Account not found");

    // Check user doesn't already exist in this account
    const existing = await ctx.db
      .query("users")
      .withIndex("by_account_clerk", (q) =>
        q.eq("accountId", accountId).eq("clerkId", identity.subject)
      )
      .unique();

    if (existing) throw new ConvexError("Already a member");

    // Create user with member role
    const userId = await ctx.db.insert("users", {
      accountId,
      clerkId: identity.subject,
      name: identity.name ?? "New Member",
      role: "member",
      active: true,
    });

    // Auto-grant access to all_access boards
    const publicBoards = await ctx.db
      .query("boards")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    for (const board of publicBoards.filter((b) => b.allAccess)) {
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

## Authentication Patterns Summary

| Pattern | When to Use |
|---------|-------------|
| `ctx.auth.getUserIdentity()` | Raw Clerk identity access |
| `getCurrentUser(ctx, accountId)` | Most functions — gets account-scoped user |
| `requireAuth(ctx)` | Functions that just need auth but not account context |
| Unauthenticated queries | Public board views, health checks |

Every query and mutation that reads or writes tenant data should call `getCurrentUser` with the `accountId` argument. This is the Convex equivalent of Fizzy's `Current.user`.

## Exercise: Set Up Authentication

1. **Create a Clerk app** at [clerk.com](https://clerk.com) with email-only sign-in

2. **Configure Convex auth**: Create `convex/auth.config.ts` with your Clerk domain, set the `CLERK_ISSUER_URL` environment variable

3. **Write `getCurrentUser` helper** in `convex/lib/auth.ts`

4. **Write `createWithOwner` mutation** in `convex/accounts.ts` that creates an account, owner user, and default board with columns

5. **Write `listMyAccounts` query** that returns all accounts for the current Clerk user

6. **Test the flow**:
   - Open the Convex dashboard
   - Manually insert a user document with a test `clerkId`
   - Use the Functions tab to call `listMyAccounts` (it won't work without a real Clerk token — but verify the function compiles and deploys)
   - Test `createWithOwner` via the dashboard

The real end-to-end test with Clerk tokens happens when we wire up the frontend in Module 12.

---

Next: [Module 05 — Multi-Tenancy](./05-multi-tenancy.md)
