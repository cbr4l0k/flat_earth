# Module 08 — Real-Time Updates

> **Goal:** Understand how Convex reactivity works, design granular queries for efficient subscriptions, and handle real-time patterns for the kanban board.
>
> **Reference:** [docs/fizzy-analysis/08-frontend-and-realtime.md](../fizzy-analysis/08-frontend-and-realtime.md)

## How Fizzy Does Real-Time

Fizzy uses a multi-layer system:

1. Model changes trigger `broadcasts_refreshes` (Turbo)
2. Turbo broadcasts a WebSocket message via Action Cable (Solid Cable)
3. Solid Cable polls its SQLite database every 0.1 seconds
4. Connected clients receive the WebSocket message
5. Turbo morphs the DOM to reflect the change

This requires: Action Cable configuration, Solid Cable setup, broadcast calls in models, Turbo Stream templates, and Stimulus controllers to handle incoming updates.

## How Convex Does Real-Time

Every query is automatically a subscription. Zero configuration.

```typescript
// Server: a normal query
export const listByBoard = query({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    return ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
  },
});

// Client: automatically subscribes
function BoardView({ boardId }: { boardId: Id<"boards"> }) {
  const cards = useQuery(api.cards.listByBoard, { boardId });
  // 'cards' updates in real-time whenever ANY card on this board changes
  return <div>{cards?.map((c) => <Card key={c._id} card={c} />)}</div>;
}
```

When a mutation modifies the `cards` table, Convex:
1. Detects which queries depend on that table
2. Re-runs those queries
3. Compares old vs new results
4. Pushes only changed results to subscribed clients

No WebSocket code. No broadcast calls. No polling. It just works.

## The Reactivity Model

### What Triggers a Re-Run

A query re-runs when **any document it read** changes. This includes:

- Documents fetched with `ctx.db.get(id)`
- Documents returned by `ctx.db.query("table").collect()`
- Index scans via `.withIndex()`

If a query reads from the `cards` table with a board filter, it re-runs when *any card on that board* changes — even if the change doesn't affect the query's result.

### Granularity Matters

The more data a query reads, the more often it re-runs. Design queries to be as specific as possible:

```typescript
// Too broad: re-runs when ANY card in the account changes
export const allCards = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    return ctx.db
      .query("cards")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
  },
});

// Better: only re-runs when cards on THIS board change
export const boardCards = query({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    return ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
  },
});

// Best for card detail: only re-runs when THIS card changes
export const cardDetail = query({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    return ctx.db.get(cardId);
  },
});
```

## Designing Queries for the Board View

The kanban board needs several pieces of data, each at different granularity levels:

### Level 1: Board Metadata

Changes rarely. Separate query so it doesn't trigger re-renders when cards move:

```typescript
// convex/boards.ts
export const get = query({
  args: { accountId: v.id("accounts"), boardId: v.id("boards") },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);
    return ctx.db.get(boardId);
  },
});
```

### Level 2: Columns

Changes when columns are added/removed/reordered, not when cards move:

```typescript
// convex/columns.ts
export const listByBoard = query({
  args: { accountId: v.id("accounts"), boardId: v.id("boards") },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);
    return ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", boardId))
      .collect();
  },
});
```

### Level 3: Cards per Column

This is the main real-time data. When a card moves between columns, only the affected column queries re-run:

```typescript
// convex/cards.ts
export const listByColumn = query({
  args: {
    accountId: v.id("accounts"),
    columnId: v.id("columns"),
  },
  handler: async (ctx, { accountId, columnId }) => {
    await requireAccountAccess(ctx, accountId);
    return ctx.db
      .query("cards")
      .withIndex("by_column", (q) => q.eq("columnId", columnId))
      .collect();
  },
});
```

However, there's a subtlety: when a card *leaves* a column, the old column's query re-runs (the card no longer appears). When it *enters* a new column, the new column's query re-runs (the card now appears). This is exactly what we want.

### Level 4: Card Detail

For the card detail panel/modal:

```typescript
export const getWithDetails = query({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) return null;

    const [creator, comments, assignments] = await Promise.all([
      ctx.db.get(card.creatorId),
      ctx.db
        .query("comments")
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect(),
      ctx.db
        .query("assignments")
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect(),
    ]);

    return {
      ...card,
      creatorName: creator?.name ?? "Unknown",
      comments,
      assignmentCount: assignments.length,
    };
  },
});
```

This query reads from `cards`, `users`, `comments`, and `assignments`. It re-runs when any of those change for this card. But it does NOT re-run when other cards change.

## Query Architecture for the Board

```
BoardPage
├── useQuery(boards.get, { boardId })                    // Board metadata
├── useQuery(columns.listByBoard, { boardId })           // Column list
├── For each column:
│   └── useQuery(cards.listByColumn, { columnId })       // Cards in column
├── useQuery(cards.listTriage, { boardId })              // Triage cards
├── useQuery(cards.listPostponed, { boardId })           // Not Now cards
└── useQuery(cards.listClosed, { boardId })              // Closed cards

CardDetailPanel (opens when clicking a card)
├── useQuery(cards.getWithDetails, { cardId })           // Card + comments
└── useQuery(assignments.listByCard, { cardId })         // Assignees
```

Each `useQuery` is an independent subscription. When a card moves from "To Do" to "In Progress":
- The "To Do" column query re-runs (card disappears)
- The "In Progress" column query re-runs (card appears)
- Board metadata, other columns, and card detail (if open for a *different* card) do NOT re-run

## Conflict Handling

### Last-Write-Wins

Convex mutations are serializable transactions. If two users simultaneously:
1. User A moves card to "In Progress"
2. User B moves the same card to "Done"

Convex serializes these: one runs first, then the other. The second mutation sees the state *after* the first mutation. No data loss, no race conditions, but the "last" write wins.

For most kanban operations, this is fine. If you need conflict detection:

```typescript
export const updateTitle = mutation({
  args: {
    cardId: v.id("cards"),
    title: v.string(),
    expectedLastActiveAt: v.number(),
  },
  handler: async (ctx, { cardId, title, expectedLastActiveAt }) => {
    const card = await ctx.db.get(cardId);
    if (!card) throw new ConvexError("Card not found");

    // Optimistic concurrency check
    if (card.lastActiveAt !== expectedLastActiveAt) {
      throw new ConvexError("Card was modified by someone else");
    }

    await ctx.db.patch(cardId, { title, lastActiveAt: Date.now() });
  },
});
```

### Optimistic Updates

Convex supports client-side optimistic updates for perceived instant feedback:

```typescript
// Client-side
const moveCard = useMutation(api.cards.moveToColumn).withOptimisticUpdate(
  (localStore, { cardId, columnId }) => {
    const card = localStore.getQuery(api.cards.get, { cardId });
    if (card) {
      localStore.setQuery(api.cards.get, { cardId }, {
        ...card,
        columnId,
      });
    }
  }
);
```

The optimistic update immediately updates the local cache. When the server confirms (or rejects), the real data replaces the optimistic version. This makes drag-and-drop feel instant even with network latency.

We'll wire this up fully in Module 12 (TanStack Integration).

## Real-Time Notification Count

A common pattern — show unread notification count in the header:

```typescript
// convex/notifications.ts
export const unreadCount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", user._id).eq("readAt", undefined)
      )
      .collect();

    return unread.length;
  },
});
```

This query re-runs whenever a notification for this user is created or read. The badge updates automatically across all the user's open tabs/devices.

## Testing Real-Time

### Two-Session Test

1. Open the Convex dashboard in two browser tabs
2. In Tab 1, run `cards.listByBoard({ boardId: "..." })`
3. In Tab 2, run `cards.create({ boardId: "...", title: "New Card" })`
4. Observe Tab 1's query result — it should instantly include the new card

When you have the frontend (Module 12), open the app in two browsers:
- Move a card in Browser A
- Watch it move in Browser B in real-time
- No page refresh, no polling, no manual WebSocket code

## Performance Considerations

### Query Cost

Each subscribed query has a cost. For a board with 5 columns, you have ~8 active subscriptions (board + columns list + 5 column cards + triage). This is fine — Convex is designed for this.

### Large Result Sets

If a column has hundreds of cards, return only what's visible:

```typescript
export const listByColumn = query({
  args: {
    accountId: v.id("accounts"),
    columnId: v.id("columns"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, columnId, limit }) => {
    await requireAccountAccess(ctx, accountId);
    const query = ctx.db
      .query("cards")
      .withIndex("by_column", (q) => q.eq("columnId", columnId))
      .order("desc");

    return limit ? query.take(limit) : query.collect();
  },
});
```

### Skip Subscriptions When Not Needed

On the client, pass `"skip"` to disable a subscription:

```typescript
// Only subscribe to card detail when a card is selected
const cardDetail = useQuery(
  api.cards.getWithDetails,
  selectedCardId ? { accountId, cardId: selectedCardId } : "skip"
);
```

## Fizzy vs Flat Earth Real-Time Comparison

| Aspect | Fizzy (Rails) | Flat Earth (Convex) |
|--------|---------------|---------------------|
| Transport | Action Cable (WebSocket via Solid Cable) | Convex WebSocket (built-in) |
| Push model | Explicit broadcasts in models | Automatic: every query = subscription |
| Template updates | Turbo Streams (replace/morph DOM) | React re-render with new data |
| Configuration | cable.yml, broadcast calls, stream templates | None — it just works |
| Granularity | Per-model broadcast channels | Per-query: whatever data the query reads |
| Polling | Solid Cable polls SQLite every 100ms | No polling — push-based |
| Offline | Not supported | Convex handles reconnection and sync |

## Exercise: Real-Time Queries

1. **Split your card queries** into granular subscriptions:
   - `cards.listByColumn` — cards in a specific column
   - `cards.listTriage` — cards awaiting triage
   - `cards.getWithDetails` — single card with comments and assignments

2. **Write an unread notification count query** that only re-runs when the current user's notifications change

3. **Test reactivity** in the dashboard:
   - Run `cards.listByColumn` for a column
   - In another tab, move a card into that column via `cards.moveToColumn`
   - Observe the query result updating (if using the dashboard's live mode)

4. **Think about your query architecture**: For each page/view in the app, list which queries you'd need and at what granularity. Consider:
   - Board list page
   - Board detail page (kanban view)
   - Card detail panel
   - Notification tray

---

Next: [Module 09 — Permissions](./09-permissions.md)
