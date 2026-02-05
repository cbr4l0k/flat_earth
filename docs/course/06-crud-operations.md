# Module 06 — CRUD Operations

> **Goal:** Implement full CRUD for boards, columns, and cards — the core data operations of the kanban app.
>
> **References:** [docs/fizzy-analysis/01-database-schema.md](../fizzy-analysis/01-database-schema.md), [docs/fizzy-analysis/06-features.md](../fizzy-analysis/06-features.md)

## Query Patterns

Before diving into CRUD, understand the common patterns for reading data in Convex.

### Index-Based Queries

Always prefer `.withIndex()` over `.filter()`:

```typescript
// Good: uses index, fast
const boards = await ctx.db
  .query("boards")
  .withIndex("by_account", (q) => q.eq("accountId", accountId))
  .collect();

// Bad: full table scan, slow for large tables
const boards = await ctx.db
  .query("boards")
  .filter((q) => q.eq(q.field("accountId"), accountId))
  .collect();
```

### Sorting

Convex queries sort by index order. The default sort is ascending by `_creationTime`:

```typescript
// Newest first
const cards = await ctx.db
  .query("cards")
  .withIndex("by_board", (q) => q.eq("boardId", boardId))
  .order("desc")
  .collect();
```

### Pagination

For large result sets, use `take()` or Convex's built-in pagination:

```typescript
// Take first 50
const cards = await ctx.db
  .query("cards")
  .withIndex("by_board", (q) => q.eq("boardId", boardId))
  .take(50);

// Paginated query (for use with usePaginatedQuery on the client)
import { paginationOptsValidator } from "convex/server";

export const listCards = query({
  args: {
    boardId: v.id("boards"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { boardId, paginationOpts }) => {
    return ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .order("desc")
      .paginate(paginationOpts);
  },
});
```

### Joining Data

No JOINs in Convex. Fetch related data manually:

```typescript
// Get a card with its creator name
const card = await ctx.db.get(cardId);
const creator = card ? await ctx.db.get(card.creatorId) : null;
return card ? { ...card, creatorName: creator?.name ?? "Unknown" } : null;

// Get all cards with creator names (batch)
const cards = await ctx.db
  .query("cards")
  .withIndex("by_board", (q) => q.eq("boardId", boardId))
  .collect();

const cardsWithCreators = await Promise.all(
  cards.map(async (card) => {
    const creator = await ctx.db.get(card.creatorId);
    return { ...card, creatorName: creator?.name ?? "Unknown" };
  })
);
```

## Board Operations

### List Boards

Users only see boards they have access to:

```typescript
// convex/boards.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

export const list = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    // Get all boards user has access to
    const accessRecords = await ctx.db
      .query("accesses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const boards = await Promise.all(
      accessRecords.map((access) => ctx.db.get(access.boardId))
    );

    return boards.filter(Boolean);
  },
});
```

### Create Board

Creating a board also creates default columns and grants access:

```typescript
export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    name: v.string(),
    allAccess: v.boolean(),
  },
  handler: async (ctx, { accountId, name, allAccess }) => {
    const user = await requireAccountAccess(ctx, accountId);

    // Create board
    const boardId = await ctx.db.insert("boards", {
      accountId,
      name,
      creatorId: user._id,
      allAccess,
    });

    // Create default columns
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

    // Grant creator access with "watching" involvement
    await ctx.db.insert("accesses", {
      accountId,
      boardId,
      userId: user._id,
      involvement: "watching",
    });

    // If all_access, grant access to all active users
    if (allAccess) {
      const users = await ctx.db
        .query("users")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect();

      for (const u of users.filter((u) => u.active && u._id !== user._id)) {
        await ctx.db.insert("accesses", {
          accountId,
          boardId,
          userId: u._id,
          involvement: "access_only",
        });
      }
    }

    return boardId;
  },
});
```

### Update Board

```typescript
export const update = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    name: v.optional(v.string()),
    allAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, { accountId, boardId, name, allAccess }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const board = await ctx.db.get(boardId);

    if (!board || board.accountId !== accountId) {
      throw new ConvexError("Board not found");
    }

    // Only admins or board creator can update
    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && board.creatorId !== user._id) {
      throw new ConvexError("Not authorized to update this board");
    }

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (allAccess !== undefined) updates.allAccess = allAccess;

    await ctx.db.patch(boardId, updates);
  },
});
```

### Delete Board

Deleting a board cascades: remove all columns, cards, accesses, and events for that board:

```typescript
export const remove = mutation({
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

    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && board.creatorId !== user._id) {
      throw new ConvexError("Not authorized to delete this board");
    }

    // Delete all related data
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
    for (const col of columns) {
      await ctx.db.delete(col._id);
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
    for (const card of cards) {
      await ctx.db.delete(card._id);
    }

    const accesses = await ctx.db
      .query("accesses")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
    for (const access of accesses) {
      await ctx.db.delete(access._id);
    }

    await ctx.db.delete(boardId);
  },
});
```

## Column Operations

### List Columns

```typescript
// convex/columns.ts
export const listByBoard = query({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);

    return ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", boardId))
      .collect();
  },
});
```

### Create Column

```typescript
export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, { accountId, boardId, name, color }) => {
    await requireAccountAccess(ctx, accountId);

    // Get current max position
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", boardId))
      .order("desc")
      .take(1);

    const nextPosition = columns.length > 0 ? columns[0].position + 1 : 0;

    return ctx.db.insert("columns", {
      accountId,
      boardId,
      name,
      color,
      position: nextPosition,
    });
  },
});
```

### Reorder Columns

Position management — move a column left or right:

```typescript
export const reorder = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    columnId: v.id("columns"),
    newPosition: v.number(),
  },
  handler: async (ctx, { accountId, boardId, columnId, newPosition }) => {
    await requireAccountAccess(ctx, accountId);

    const column = await ctx.db.get(columnId);
    if (!column || column.boardId !== boardId) {
      throw new ConvexError("Column not found");
    }

    const oldPosition = column.position;
    if (oldPosition === newPosition) return;

    // Get all columns for this board
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", boardId))
      .collect();

    // Shift positions of affected columns
    for (const col of columns) {
      if (col._id === columnId) continue;

      if (oldPosition < newPosition) {
        // Moving right: shift columns between old+1 and new down by 1
        if (col.position > oldPosition && col.position <= newPosition) {
          await ctx.db.patch(col._id, { position: col.position - 1 });
        }
      } else {
        // Moving left: shift columns between new and old-1 up by 1
        if (col.position >= newPosition && col.position < oldPosition) {
          await ctx.db.patch(col._id, { position: col.position + 1 });
        }
      }
    }

    await ctx.db.patch(columnId, { position: newPosition });
  },
});
```

### Delete Column

When a column is deleted, its cards go back to triage (`columnId: null`):

```typescript
export const remove = mutation({
  args: {
    accountId: v.id("accounts"),
    columnId: v.id("columns"),
  },
  handler: async (ctx, { accountId, columnId }) => {
    await requireAccountAccess(ctx, accountId);

    const column = await ctx.db.get(columnId);
    if (!column || column.accountId !== accountId) {
      throw new ConvexError("Column not found");
    }

    // Move cards back to triage
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_column", (q) => q.eq("columnId", columnId))
      .collect();

    for (const card of cards) {
      await ctx.db.patch(card._id, { columnId: null });
    }

    // Compact positions of remaining columns
    const siblings = await ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", column.boardId))
      .collect();

    for (const sib of siblings) {
      if (sib.position > column.position) {
        await ctx.db.patch(sib._id, { position: sib.position - 1 });
      }
    }

    await ctx.db.delete(columnId);
  },
});
```

## Card Operations

### Create Card

Cards start as "drafted" with a sequential number per account:

```typescript
// convex/cards.ts
export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, boardId, title }) => {
    const user = await requireAccountAccess(ctx, accountId);

    // Get the next card number for this account
    const account = await ctx.db.get(accountId);
    if (!account) throw new ConvexError("Account not found");

    const nextNumber = account.cardsCount + 1;

    // Create the card (drafted status)
    const cardId = await ctx.db.insert("cards", {
      accountId,
      boardId,
      columnId: null,  // Starts in triage
      creatorId: user._id,
      title: title ?? "",
      number: nextNumber,
      status: "drafted",
      lastActiveAt: Date.now(),
      isGolden: false,
    });

    // Update the account's card counter
    await ctx.db.patch(accountId, { cardsCount: nextNumber });

    return cardId;
  },
});
```

### Get Card

```typescript
export const get = query({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) return null;

    // Enrich with creator name
    const creator = await ctx.db.get(card.creatorId);

    return {
      ...card,
      creatorName: creator?.name ?? "Unknown",
    };
  },
});
```

### Get Card by Number

Fizzy uses card numbers in URLs (e.g., `/cards/42`). We support that:

```typescript
export const getByNumber = query({
  args: {
    accountId: v.id("accounts"),
    number: v.number(),
  },
  handler: async (ctx, { accountId, number }) => {
    await requireAccountAccess(ctx, accountId);

    return ctx.db
      .query("cards")
      .withIndex("by_account_number", (q) =>
        q.eq("accountId", accountId).eq("number", number)
      )
      .unique();
  },
});
```

### List Cards by Board

```typescript
export const listByBoard = query({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();

    // Only return published cards (drafts are private to their creator)
    return cards.filter((c) => c.status === "published");
  },
});
```

### Update Card

```typescript
export const update = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    dueOn: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { accountId, cardId, ...updates }) => {
    await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    const patch: Record<string, any> = { lastActiveAt: Date.now() };
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.dueOn !== undefined) patch.dueOn = updates.dueOn ?? undefined;

    await ctx.db.patch(cardId, patch);
  },
});
```

### Move Card Between Columns

This is the core kanban operation — triage a card into a column:

```typescript
export const moveToColumn = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    columnId: v.union(v.id("columns"), v.null()),
  },
  handler: async (ctx, { accountId, cardId, columnId }) => {
    await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    // Verify column belongs to the same board (if not null)
    if (columnId !== null) {
      const column = await ctx.db.get(columnId);
      if (!column || column.boardId !== card.boardId) {
        throw new ConvexError("Column not found on this board");
      }
    }

    await ctx.db.patch(cardId, {
      columnId,
      lastActiveAt: Date.now(),
    });
  },
});
```

### Move Card Between Boards

```typescript
export const moveToBoard = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    newBoardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, cardId, newBoardId }) => {
    await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    const newBoard = await ctx.db.get(newBoardId);
    if (!newBoard || newBoard.accountId !== accountId) {
      throw new ConvexError("Board not found");
    }

    // Card goes to triage on the new board
    await ctx.db.patch(cardId, {
      boardId: newBoardId,
      columnId: null,
      lastActiveAt: Date.now(),
    });
  },
});
```

### Delete Card

```typescript
export const remove = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    // Only admins or card creator can delete
    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && card.creatorId !== user._id) {
      throw new ConvexError("Not authorized to delete this card");
    }

    // Delete related data
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();
    for (const comment of comments) {
      await ctx.db.delete(comment._id);
    }

    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();
    for (const a of assignments) {
      await ctx.db.delete(a._id);
    }

    const taggings = await ctx.db
      .query("taggings")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();
    for (const t of taggings) {
      await ctx.db.delete(t._id);
    }

    await ctx.db.delete(cardId);
  },
});
```

## Validation Patterns

### Verify Ownership

Always check that a document belongs to the requested account:

```typescript
const board = await ctx.db.get(boardId);
if (!board || board.accountId !== accountId) {
  throw new ConvexError("Board not found");
}
```

This prevents a user in Account A from accessing Account B's board by guessing the ID.

### Enforce Uniqueness

Convex doesn't have unique constraints. Enforce them in mutations:

```typescript
// Ensure unique card number per account
const existing = await ctx.db
  .query("cards")
  .withIndex("by_account_number", (q) =>
    q.eq("accountId", accountId).eq("number", nextNumber)
  )
  .unique();

if (existing) {
  throw new ConvexError("Card number already exists");
}
```

### Validate References

Before using a foreign key, verify the referenced document exists and belongs to the right account:

```typescript
if (columnId !== null) {
  const column = await ctx.db.get(columnId);
  if (!column || column.boardId !== card.boardId) {
    throw new ConvexError("Column not found on this board");
  }
}
```

## Exercise: Full CRUD Workflow

Implement and test the complete flow:

1. **Board CRUD** (`convex/boards.ts`): `list`, `create`, `update`, `remove`

2. **Column CRUD** (`convex/columns.ts`): `listByBoard`, `create`, `reorder`, `remove`

3. **Card CRUD** (`convex/cards.ts`): `create`, `get`, `getByNumber`, `listByBoard`, `update`, `moveToColumn`, `moveToBoard`, `remove`

4. **Test the complete workflow** in the dashboard:
   - Create an account and user (from Module 04)
   - Create a board with default columns
   - Create 3 cards (verify sequential numbering: 1, 2, 3)
   - Move cards between columns
   - Update a card's title
   - Delete a card
   - Delete a column (verify cards go to triage)
   - Create a second board, move a card to it

5. **Verify isolation**:
   - Create a second account
   - Verify queries from Account A don't return Account B data
   - Verify mutations for Account A can't modify Account B data

---

Next: [Module 07 — Card Lifecycle](./07-card-lifecycle.md)
