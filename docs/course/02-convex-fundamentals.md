# Module 02 — Convex Fundamentals

> **Goal:** Understand what Convex is, how it differs from traditional backends, set up your first project, and write your first query and mutation.

## What Convex Is (and Isn't)

Convex is a **backend-as-a-service** that replaces your database, server, ORM, real-time infrastructure, and job queue with a single system. You write TypeScript functions; Convex runs them.

### What You Don't Need Anymore

| Traditional Backend     | With Convex              |
|-------------------------|--------------------------|
| Express/Hono server     | Not needed — Convex hosts your functions |
| PostgreSQL/MySQL        | Convex document database (built-in) |
| Prisma/Drizzle ORM      | `ctx.db` API directly    |
| SQL migrations          | Declarative schema (no migrations) |
| Redis/BullMQ for jobs   | `ctx.scheduler` (built-in) |
| WebSocket server        | Every query is a real-time subscription |
| Elasticsearch           | Built-in search indexes  |

### The Three Function Types

Convex has exactly three kinds of server functions:

| Type | Purpose | Properties |
|------|---------|-----------|
| **Query** | Read data | Reactive (clients auto-subscribe), deterministic, no side effects |
| **Mutation** | Write data | Transactional (all-or-nothing), can read and write |
| **Action** | Side effects | Can call external APIs, not transactional, can call queries/mutations |

This is the core mental model. Everything in Convex is one of these three.

## Architecture: How It Works

```
┌─────────────────────────────────────┐
│  Browser (React/TanStack)           │
│                                     │
│  useQuery(api.boards.list)  ──────┐ │
│  useMutation(api.cards.create) ─┐ │ │
│                                 │ │ │
└─────────────────────────────────┼─┼─┘
                                  │ │
                           WebSocket connection
                                  │ │
┌─────────────────────────────────┼─┼─┘
│  Convex Cloud                   │ │
│                                 │ │
│  ┌─ Queries ──────────────────┐ │ │
│  │  Reactive: re-run when     │◄┘ │
│  │  underlying data changes.  │   │
│  │  Results pushed to client. │   │
│  └────────────────────────────┘   │
│                                   │
│  ┌─ Mutations ────────────────┐   │
│  │  Transactional: reads +    │◄──┘
│  │  writes happen atomically. │
│  │  Triggers query re-runs.   │
│  └────────────────────────────┘
│
│  ┌─ Actions ──────────────────┐
│  │  Side effects: call APIs,  │
│  │  send emails, etc.         │
│  │  Not transactional.        │
│  └────────────────────────────┘
│
│  ┌─ Document Database ────────┐
│  │  Indexed, typed, reactive  │
│  └────────────────────────────┘
└───────────────────────────────────┘
```

When a mutation writes data, Convex automatically re-runs any queries that depend on that data and pushes updated results to all subscribed clients. You never write WebSocket code.

## The `ctx` Object

Every Convex function receives a context object (`ctx`) as its first argument. What's on it depends on the function type:

| Property | Query | Mutation | Action |
|----------|-------|----------|--------|
| `ctx.db` | read-only | read + write | — |
| `ctx.auth` | yes | yes | yes |
| `ctx.storage` | read URLs | read + write | read URLs |
| `ctx.scheduler` | — | yes | yes |
| `ctx.runQuery` | — | — | yes |
| `ctx.runMutation` | — | — | yes |
| `ctx.runAction` | — | — | yes |

Key insight: queries can only read. Mutations can read and write but can't call external APIs. Actions can do anything but aren't transactional.

## Validators (`v`)

Convex uses a runtime validation library (`v`) to define both your schema and your function arguments:

```typescript
import { v } from "convex/values";

// Primitive validators
v.string()                              // string
v.number()                              // number (includes floats)
v.boolean()                             // boolean
v.int64()                               // 64-bit integer
v.float64()                             // 64-bit float
v.bytes()                               // ArrayBuffer
v.null()                                // null

// Composite validators
v.array(v.string())                     // string[]
v.object({ name: v.string() })          // { name: string }
v.optional(v.string())                  // string | undefined (for optional fields)
v.union(v.string(), v.number())         // string | number

// Special
v.id("tableName")                       // Id<"tableName"> — typed document reference
v.literal("active")                     // the exact string "active"
v.any()                                 // any (avoid this)
```

These validators serve double duty: they define your schema types AND validate data at runtime.

## Project Setup

### Create a Convex Project

```bash
# Create project directory and initialize
mkdir flat-earth && cd flat-earth
bun init -y

# Install Convex
bun add convex

# Initialize Convex (creates convex/ directory)
bunx convex init
```

This creates:

```
flat-earth/
├── convex/
│   ├── _generated/       # Auto-generated types (don't edit)
│   │   ├── api.d.ts
│   │   ├── dataModel.d.ts
│   │   └── server.d.ts
│   ├── schema.ts         # Your database schema (empty initially)
│   └── tsconfig.json     # TypeScript config for convex/
├── package.json
└── tsconfig.json
```

### Start the Development Server

```bash
bunx convex dev
```

This does three things:
1. Watches your `convex/` directory for changes
2. Pushes schema and function changes to Convex Cloud
3. Generates TypeScript types from your schema

Keep this running in a terminal while developing.

## Your First Schema

Create a simple messages table:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    author: v.string(),
    body: v.string(),
  }),
});
```

When you save this file, `convex dev` pushes the schema to Convex Cloud. The `_generated/` directory updates with types for your `messages` table.

## Your First Query

```typescript
// convex/messages.ts
import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Fetch all messages, newest first
    const messages = await ctx.db
      .query("messages")
      .order("desc")
      .collect();
    return messages;
  },
});
```

Breaking this down:

- `query({...})` — defines a query function (read-only, reactive)
- `args: {}` — this query takes no arguments
- `handler: async (ctx) => {...}` — the function body, receives the context
- `ctx.db.query("messages")` — starts a query on the "messages" table
- `.order("desc")` — sort by `_creationTime` descending (newest first)
- `.collect()` — execute the query and return all results as an array

## Your First Mutation

```typescript
// convex/messages.ts (add to the same file)
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ... list query above ...

export const send = mutation({
  args: {
    author: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      author: args.author,
      body: args.body,
    });
  },
});
```

Breaking this down:

- `mutation({...})` — defines a mutation (read + write, transactional)
- `args: { author: v.string(), body: v.string() }` — declares and validates input
- `ctx.db.insert("messages", {...})` — inserts a new document, returns its ID

If a mutation throws an error, all its writes are rolled back. This is automatic — no `transaction do` blocks needed.

## Database Operations

### Reading

```typescript
// Get a single document by ID
const message = await ctx.db.get(messageId);
// Returns Doc<"messages"> | null

// Query all documents in a table
const all = await ctx.db.query("messages").collect();
// Returns Doc<"messages">[]

// Query with ordering
const newest = await ctx.db
  .query("messages")
  .order("desc")
  .collect();

// Take first N results
const latest5 = await ctx.db
  .query("messages")
  .order("desc")
  .take(5);

// Get first matching result
const first = await ctx.db
  .query("messages")
  .first();
// Returns Doc<"messages"> | null
```

### Writing (mutations only)

```typescript
// Insert — returns the new document's ID
const id = await ctx.db.insert("messages", {
  author: "Alice",
  body: "Hello!",
});

// Patch — update specific fields (merge)
await ctx.db.patch(messageId, {
  body: "Updated body",
});

// Replace — overwrite entire document (except _id and _creationTime)
await ctx.db.replace(messageId, {
  author: "Alice",
  body: "Completely replaced",
});

// Delete
await ctx.db.delete(messageId);
```

### Filtering

```typescript
// Filter in-memory (works but doesn't use indexes)
const aliceMessages = await ctx.db
  .query("messages")
  .filter((q) => q.eq(q.field("author"), "Alice"))
  .collect();
```

For efficient filtering, you'll use indexes — covered in Module 03.

## The Convex Dashboard

Open the dashboard to test your functions:

```bash
bunx convex dashboard
```

Or visit `https://dashboard.convex.dev` and select your project.

The dashboard lets you:

- **Browse data** — see all documents in each table
- **Run functions** — call queries and mutations with arguments
- **View logs** — see function execution logs and errors
- **Manage schema** — view your deployed schema

Test your work:

1. Go to the "Functions" tab
2. Find `messages:send`
3. Enter arguments: `{ "author": "Test", "body": "Hello Convex!" }`
4. Run it
5. Switch to `messages:list` and run it — you should see your message

## How Reactivity Works

This is the key concept that makes Convex different:

1. A client calls `useQuery(api.messages.list)`.
2. Convex runs the `list` query and returns the result.
3. The client displays the result.
4. Another client calls `useMutation(api.messages.send, { author: "Bob", body: "Hi" })`.
5. The mutation inserts a document into `messages`.
6. Convex detects that `messages:list` reads from the `messages` table.
7. Convex re-runs `messages:list`.
8. The new result is pushed to **all** clients subscribed to `messages:list`.
9. The components re-render with the new data.

No polling. No manual invalidation. No WebSocket channels to set up. The query *is* the subscription.

## Function Naming and Organization

Convex functions are organized by file. The file path becomes the function path:

```
convex/
├── messages.ts          → api.messages.list, api.messages.send
├── boards.ts            → api.boards.list, api.boards.create
├── cards.ts             → api.cards.list, api.cards.create
└── cards/
    └── lifecycle.ts     → api.cards.lifecycle.close, api.cards.lifecycle.reopen
```

Use subdirectories for logical grouping as your codebase grows.

## Internal Functions

Functions that should only be called from other server functions (not from clients):

```typescript
import { internalQuery, internalMutation } from "./_generated/server";

// Can only be called from other server functions
export const getByAccountId = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
  },
});
```

Use `internal` variants for helper functions that shouldn't be exposed to clients.

## Exercise: Messages Table

Build a complete messages system to practice what you've learned:

1. **Schema** (`convex/schema.ts`): Define a `messages` table with:
   - `author` (string)
   - `body` (string)
   - `channel` (string) — e.g., "general", "random"

2. **List query** (`convex/messages.ts`): Write `list` that takes a `channel` argument and returns messages for that channel, newest first.

3. **Send mutation** (`convex/messages.ts`): Write `send` that takes `author`, `body`, and `channel`, inserts a new message.

4. **Delete mutation**: Write `remove` that takes a message ID and deletes it.

5. **Test in the dashboard**:
   - Send a few messages to different channels
   - List messages by channel
   - Delete a message
   - Verify the list updates

If you want a stretch goal: add a `listAll` query that returns all messages across all channels, grouped by channel (using `reduce` in the handler).

---

Next: [Module 03 — Schema Design](./03-schema-design.md)
