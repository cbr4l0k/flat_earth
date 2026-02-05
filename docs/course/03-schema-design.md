# Module 03 — Schema Design

> **Goal:** Design the Convex schema for Flat Earth, understand indexes and relational patterns in a document database, and translate Fizzy's 74-table SQL schema.
>
> **Reference:** [docs/fizzy-analysis/01-database-schema.md](../fizzy-analysis/01-database-schema.md)

## Convex Schema Basics

### `defineSchema` and `defineTable`

Your entire database schema lives in one file:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  accounts: defineTable({
    name: v.string(),
    externalId: v.string(),
    cardsCount: v.number(),
  }),
});
```

This is **declarative** — you describe what the schema looks like, not how to migrate to it. When you change the schema, Convex figures out the transition. No migration files, no `ALTER TABLE`, no rollbacks.

### Every Document Gets Free Fields

Convex automatically adds to every document:

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `Id<"tableName">` | Unique document ID (typed per table) |
| `_creationTime` | `number` | Millisecond timestamp of creation |

You never define these — they're implicit.

### Field Validators

```typescript
defineTable({
  // Required fields
  name: v.string(),
  count: v.number(),
  active: v.boolean(),

  // Optional fields (can be missing from the document)
  dueOn: v.optional(v.string()),

  // Nullable fields (present but null)
  columnId: v.union(v.id("columns"), v.null()),

  // References to other tables
  boardId: v.id("boards"),
  accountId: v.id("accounts"),

  // Union types (like enums)
  status: v.union(
    v.literal("drafted"),
    v.literal("published"),
  ),

  // Nested objects
  metadata: v.object({
    key: v.string(),
    value: v.string(),
  }),

  // Arrays
  tagIds: v.array(v.id("tags")),
})
```

### Optional vs Nullable

This distinction matters:

```typescript
// Optional: field may not exist on the document
description: v.optional(v.string())
// Type: string | undefined
// Document might be: { title: "Card" } (no description key at all)

// Nullable: field always exists but can be null
columnId: v.union(v.id("columns"), v.null())
// Type: Id<"columns"> | null
// Document is always: { columnId: "abc123" } or { columnId: null }
```

Use **optional** for fields that not every document needs (like settings, metadata). Use **nullable** for fields that every document has but might be empty (like `columnId` on a card that hasn't been triaged).

## Indexes

Indexes make queries fast. Without an index, Convex scans every document in the table.

### Defining Indexes

```typescript
accounts: defineTable({
  name: v.string(),
  externalId: v.string(),
})
  .index("by_external_id", ["externalId"]),

boards: defineTable({
  accountId: v.id("accounts"),
  name: v.string(),
  creatorId: v.id("users"),
})
  .index("by_account", ["accountId"])
  .index("by_creator", ["creatorId"]),
```

### Using Indexes in Queries

```typescript
// Without index: scans entire table (slow for large tables)
const boards = await ctx.db
  .query("boards")
  .filter((q) => q.eq(q.field("accountId"), accountId))
  .collect();

// With index: jumps directly to matching documents (fast)
const boards = await ctx.db
  .query("boards")
  .withIndex("by_account", (q) => q.eq("accountId", accountId))
  .collect();
```

Always use `.withIndex()` in production code. Use `.filter()` only for ad-hoc filtering on top of an index.

### Compound Indexes

Index on multiple fields — useful when you always query by a combination:

```typescript
cards: defineTable({
  accountId: v.id("accounts"),
  number: v.number(),
  status: v.union(v.literal("drafted"), v.literal("published")),
  lastActiveAt: v.number(),
})
  // Query: get card #42 in account X
  .index("by_account_number", ["accountId", "number"])
  // Query: get active cards in account X, sorted by activity
  .index("by_account_status_activity", ["accountId", "status", "lastActiveAt"]),
```

Compound index rules:
- Fields are matched **left to right**
- You can use equality on leading fields and a range/order on the last field
- `["accountId", "status", "lastActiveAt"]` supports:
  - `eq("accountId", x)` ✓
  - `eq("accountId", x).eq("status", y)` ✓
  - `eq("accountId", x).eq("status", y).gte("lastActiveAt", z)` ✓
  - `eq("status", y)` ✗ (must start from leftmost field)

### Search Indexes

For full-text search:

```typescript
cards: defineTable({
  accountId: v.id("accounts"),
  boardId: v.id("boards"),
  title: v.string(),
  searchableText: v.string(),
})
  .searchIndex("search_cards", {
    searchField: "searchableText",
    filterFields: ["accountId", "boardId"],
  }),
```

This replaces Fizzy's 16-shard MySQL FULLTEXT setup with a single declaration.

## Relational Patterns in Convex

Convex is a document database, not relational. There are no JOINs. Here's how to model relationships:

### One-to-Many (1:N)

Store the parent's ID on the child:

```typescript
// One account has many boards
boards: defineTable({
  accountId: v.id("accounts"),  // FK to parent
  name: v.string(),
}).index("by_account", ["accountId"]),
```

Query:

```typescript
const boards = await ctx.db
  .query("boards")
  .withIndex("by_account", (q) => q.eq("accountId", accountId))
  .collect();
```

### Many-to-Many (M:N)

Two approaches:

**Approach 1: Join table** (like SQL, better for large sets or when you need metadata on the relationship):

```typescript
// Card ←→ Tag relationship
taggings: defineTable({
  accountId: v.id("accounts"),
  cardId: v.id("cards"),
  tagId: v.id("tags"),
})
  .index("by_card", ["cardId"])
  .index("by_tag", ["tagId"])
  .index("by_card_tag", ["cardId", "tagId"]),
```

**Approach 2: Array of IDs** (simpler, better for small bounded sets):

```typescript
// Filter has a set of board IDs it applies to
filters: defineTable({
  accountId: v.id("accounts"),
  boardIds: v.array(v.id("boards")),  // M:N via array
  tagIds: v.array(v.id("tags")),      // M:N via array
}),
```

Use arrays when the set is small and bounded (like Fizzy's filter join tables). Use join tables when the set can be large (like card assignments — up to 100).

### Denormalization

Sometimes you duplicate data for query efficiency:

```typescript
// Instead of joining cards → columns to get color:
cards: defineTable({
  columnId: v.union(v.id("columns"), v.null()),
  columnColor: v.optional(v.string()),  // Denormalized from column
}),
```

Trade-off: reads are faster, but writes must update the denormalized field. In Convex, this is often worth it since reads (queries) vastly outnumber writes (mutations) and queries need to be fast for real-time updates.

### No Polymorphic Associations

Fizzy uses Rails polymorphic associations (`source_type` + `source_id`). In Convex, use a discriminated union:

```typescript
// Fizzy: source_type = "Event" | "Mention", source_id = UUID
// Convex:
notifications: defineTable({
  source: v.union(
    v.object({ type: v.literal("event"), id: v.id("events") }),
    v.object({ type: v.literal("mention"), id: v.id("mentions") }),
  ),
}),
```

This gives you compile-time type safety that Rails polymorphism doesn't.

## Translating Fizzy's Schema

Fizzy has 74 tables. Not all of them translate directly. Here's how the major ones map:

### Tables That Map Directly

| Fizzy Table | Convex Table | Notes |
|-------------|-------------|-------|
| `accounts` | `accounts` | Drop `external_account_id` sequence, use Convex IDs |
| `boards` | `boards` | Add `allAccess: v.boolean()` |
| `columns` | `columns` | Same structure |
| `cards` | `cards` | Rich text as JSON field, not separate table |
| `comments` | `comments` | Body stored inline, not in `action_text_rich_texts` |
| `assignments` | `assignments` | Same join table pattern |
| `tags` | `tags` | Same structure |
| `taggings` | `taggings` | Same join table |
| `watches` | `watches` | Same structure |
| `pins` | `pins` | Same structure |
| `events` | `events` | Polymorphic → discriminated union |
| `accesses` | `accesses` | Same board-user access records |
| `notifications` | `notifications` | Polymorphic → discriminated union |
| `webhooks` | `webhooks` | Same structure |
| `entropies` | `entropies` | Polymorphic → discriminated union |

### Tables That Get Eliminated

| Fizzy Table | Why It's Gone |
|-------------|--------------|
| `action_text_rich_texts` | Store rich text directly in card/comment documents |
| `active_storage_*` (3 tables) | Use Convex file storage API |
| `search_records_*` (16 tables) | Use Convex search indexes |
| `sessions` | Clerk handles sessions |
| `magic_links` | Clerk handles auth |
| `identities` | Clerk handles global identity |
| `identity_access_tokens` | Clerk handles API tokens |
| `6 filter join tables` | Use arrays on the filter document |

### Tables That Transform

| Fizzy Table | Convex Approach |
|-------------|----------------|
| `closures` | Field on card: `closedAt`, `closedBy` |
| `card_not_nows` | Field on card: `postponedAt`, `postponedBy` |
| `card_goldnesses` | Field on card: `isGolden: v.boolean()` |
| `card_activity_spikes` | Field on card: `activitySpikeAt` |
| `card_engagements` | Field on card: `engagement` |
| `board_publications` | Fields on board: `publicKey`, `publicDescription` |
| `notification_bundles` | Separate table (needed for time-windowed queries) |

The general principle: if a Fizzy table is 1:1 with its parent (one closure per card, one goldness per card), merge it into the parent document. If it's 1:N, keep it as a separate table.

## The Full Flat Earth Schema

Here's the core schema we'll build throughout this course:

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
    // Merged from closures table
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.id("users")),
    // Merged from card_not_nows table
    postponedAt: v.optional(v.number()),
    postponedBy: v.optional(v.id("users")),
    // Merged from card_goldnesses table
    isGolden: v.boolean(),
    // Merged from card_activity_spikes
    activitySpikeAt: v.optional(v.number()),
    // Image
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
  })
    .index("by_card", ["cardId"]),

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
  })
    .index("by_comment", ["commentId"]),

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
  })
    .index("by_account", ["accountId"]),

  // === Webhooks ===

  webhooks: defineTable({
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    name: v.string(),
    url: v.string(),
    signingSecret: v.string(),
    subscribedActions: v.array(v.string()),
    active: v.boolean(),
  })
    .index("by_board", ["boardId"]),

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
  })
    .index("by_webhook", ["webhookId"]),

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

  // === Search ===

  searchQueries: defineTable({
    accountId: v.id("accounts"),
    userId: v.id("users"),
    terms: v.string(),
  })
    .index("by_user", ["userId"]),
});
```

This schema consolidates Fizzy's 74 tables into ~25 Convex tables by:

1. Eliminating infrastructure tables (auth, sessions, search shards, storage)
2. Merging 1:1 tables into parent documents (closures → card fields)
3. Replacing filter join tables with arrays
4. Using Convex's built-in search instead of shard tables

## Exercise: Define the Core Schema

Create `convex/schema.ts` with the core tables. Start with just these:

1. `accounts` — name, cardsCount
2. `users` — accountId, clerkId, name, role, active (with indexes: by_account, by_clerk_id)
3. `boards` — accountId, name, creatorId, allAccess (with indexes: by_account)
4. `columns` — accountId, boardId, name, color, position (with indexes: by_board, by_board_position)
5. `cards` — all fields from the schema above (with indexes: by_board, by_account_number, by_column)
6. `comments` — accountId, cardId, creatorId, body, isSystem (with index: by_card)

Verify it deploys: `bunx convex dev` should push the schema without errors.

Then add test data through the dashboard:
- Create an account
- Create a user linked to that account
- Create a board in that account
- Create columns for the board
- Create a card on the board

Verify you can query the data and that the ID references work correctly.

---

Next: [Module 04 — Authentication](./04-authentication.md)
