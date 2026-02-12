# Module 11 — Production Patterns & Polish

> **What you'll see running:** Error boundaries catching failures gracefully, toast notifications for mutation feedback, skeleton loading screens, paginated card lists with infinite scroll, and a full-text search bar returning instant results.
>
> **References:** [docs/fizzy-analysis/08-frontend-and-realtime.md](../fizzy-analysis/08-frontend-and-realtime.md), [docs/fizzy-analysis/06-features.md](../fizzy-analysis/06-features.md)

## Deep Dive: Convex Reactivity

Before polishing the app, understand how Convex's reactivity model works under the hood.

### Every Query Is a Subscription

When you call `useQuery`, Convex:

1. Runs your query function on the server
2. Tracks every document and index the query touched
3. Opens a WebSocket subscription
4. When any tracked document changes, re-runs the query
5. Diffs old vs new results and pushes only changes to the client

```typescript
// This query subscribes to changes in the "cards" table for this board
const cards = useQuery(api.cards.listByColumn, { accountId, columnId });
```

No broadcast calls. No polling. No WebSocket code. The subscription is automatic.

### What Triggers a Re-Run

A query re-runs when **any document it read** changes:

- Documents fetched with `ctx.db.get(id)`
- Documents returned by `ctx.db.query("table").collect()`
- Index scans via `.withIndex()`

If a query reads from the `cards` table filtered by board, it re-runs when *any card on that board* changes — even if the specific change doesn't affect the result.

### Subscription Lifecycle

```
Component mounts  → useQuery subscribes → server runs query → data arrives
Component updates → args change → old subscription closed, new one opened
Component unmounts → subscription automatically closed
```

### Skip Subscriptions When Not Needed

Pass `"skip"` to disable a subscription:

```typescript
// Only subscribe to card detail when a card is selected
const cardDetail = useQuery(
  api.cards.get,
  selectedCardId ? { accountId, cardId: selectedCardId } : "skip"
);
```

## Error Handling

### `ConvexError` on the Server

All our mutations throw `ConvexError` for business-logic failures:

```typescript
// Server: throw typed errors
import { ConvexError } from "convex/values";

throw new ConvexError("Only admins can configure entropy");
throw new ConvexError("Card not found");
throw new ConvexError("Already closed");
```

### Catching Errors on the Client

Wrap mutation calls in try/catch:

```typescript
const closeCard = useMutation(api.cards.lifecycle.close);

async function handleClose() {
  try {
    await closeCard({ accountId, cardId: card._id });
  } catch (error) {
    if (error instanceof ConvexError) {
      // Business logic error — show to user
      toast.error(error.data as string);
    } else {
      // Unexpected error
      toast.error("Something went wrong");
      console.error(error);
    }
  }
}
```

### Error Boundary Component

Catch rendering errors from queries:

```tsx
// src/components/ErrorBoundary.tsx
import { Component, ReactNode } from "react";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-800">Something went wrong.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => this.setState({ hasError: false })}
            >
              Try again
            </Button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
```

Use it around sections that might fail:

```tsx
<ErrorBoundary>
  <BoardPage />
</ErrorBoundary>
```

### Toast Notifications

Install a toast library (e.g., `sonner`) and use it for mutation feedback:

```tsx
// src/components/providers.tsx
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
      <Toaster position="bottom-right" />
    </ConvexProviderWithClerk>
  );
}
```

```tsx
// Usage in components
import { toast } from "sonner";

async function handleDelete() {
  try {
    await removeCard({ accountId, cardId });
    toast.success("Card deleted");
  } catch (error) {
    toast.error(error instanceof ConvexError ? (error.data as string) : "Failed to delete card");
  }
}
```

## Loading States

### Skeleton Screens

Replace blank "Loading..." text with skeleton placeholders:

```tsx
// src/components/BoardSkeleton.tsx
export function BoardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Title skeleton */}
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />

      {/* Columns skeleton */}
      <div className="flex gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="w-72 shrink-0 rounded-lg bg-gray-100 p-4">
            <div className="mb-3 h-5 w-24 animate-pulse rounded bg-gray-200" />
            {[1, 2, 3].map((j) => (
              <div
                key={j}
                className="mb-2 h-16 animate-pulse rounded bg-gray-200"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// Usage
function BoardPage() {
  const board = useQuery(api.boards.get, { accountId, boardId });
  const columns = useQuery(api.columns.listByBoard, { accountId, boardId });

  if (board === undefined || columns === undefined) {
    return <BoardSkeleton />;
  }

  if (!board) return <p className="text-red-500">Board not found.</p>;

  return <KanbanBoard board={board} columns={columns} />;
}
```

### Card Skeleton

```tsx
export function CardSkeleton() {
  return (
    <div className="rounded bg-white p-3 shadow-sm">
      <div className="mb-1 h-3 w-10 animate-pulse rounded bg-gray-200" />
      <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
      <div className="mt-2 h-3 w-20 animate-pulse rounded bg-gray-200" />
    </div>
  );
}
```

## Pagination

For large lists (closed cards, notifications, search results), use Convex's built-in pagination.

### Backend: Paginated Query

```typescript
// convex/cards.ts (add to existing file)
import { paginationOptsValidator } from "convex/server";

export const listClosedPaginated = query({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { accountId, boardId, paginationOpts }) => {
    await requireAccountAccess(ctx, accountId);
    return ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .order("desc")
      .paginate(paginationOpts);
  },
});
```

### Frontend: `usePaginatedQuery`

```tsx
// src/components/ClosedCardsList.tsx
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/button";

export function ClosedCardsList({
  accountId,
  boardId,
}: {
  accountId: Id<"accounts">;
  boardId: Id<"boards">;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.cards.listClosedPaginated,
    { accountId, boardId },
    { initialNumItems: 20 }
  );

  // Filter to only closed cards in the client
  const closedCards = results.filter((c) => c.closedAt);

  return (
    <div className="space-y-2">
      {closedCards.map((card) => (
        <div
          key={card._id}
          className="flex items-center justify-between rounded border p-3"
        >
          <div>
            <span className="text-xs text-gray-400">#{card.number}</span>
            <p className="text-sm font-medium">{card.title}</p>
          </div>
          <span className="text-xs text-gray-400">
            Closed {new Date(card.closedAt!).toLocaleDateString()}
          </span>
        </div>
      ))}

      {status === "CanLoadMore" && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => loadMore(20)}
        >
          Load more
        </Button>
      )}

      {status === "Exhausted" && closedCards.length > 0 && (
        <p className="text-center text-xs text-gray-400">No more cards</p>
      )}

      {closedCards.length === 0 && status === "Exhausted" && (
        <p className="text-sm text-gray-400">No closed cards.</p>
      )}
    </div>
  );
}
```

The three `status` values:
- `"LoadingFirstPage"` — initial load
- `"CanLoadMore"` — more pages available
- `"Exhausted"` — all data loaded

## Full-Text Search

### Search Index (already in schema)

The schema from Module 04 already defines:

```typescript
cards: defineTable({ /* ... */ })
  .searchIndex("search_cards", {
    searchField: "title",
    filterFields: ["accountId", "boardId"],
  }),
```

### Search Query

```typescript
// convex/cards.ts (add to existing file)
export const search = query({
  args: {
    accountId: v.id("accounts"),
    terms: v.string(),
    boardId: v.optional(v.id("boards")),
  },
  handler: async (ctx, { accountId, terms, boardId }) => {
    await requireAccountAccess(ctx, accountId);

    if (!terms.trim()) return [];

    let searchQuery = ctx.db
      .query("cards")
      .withSearchIndex("search_cards", (q) => {
        let search = q.search("title", terms).eq("accountId", accountId);
        if (boardId) {
          search = search.eq("boardId", boardId);
        }
        return search;
      });

    const results = await searchQuery.take(25);

    // Enrich with board name
    return Promise.all(
      results.map(async (card) => {
        const board = await ctx.db.get(card.boardId);
        return {
          ...card,
          boardName: board?.name ?? "Unknown",
        };
      })
    );
  },
});
```

### Frontend: Search Bar

```tsx
// src/components/SearchBar.tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useState, useDeferredValue } from "react";

export function SearchBar({
  accountId,
}: {
  accountId: Id<"accounts">;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const results = useQuery(
    api.cards.search,
    deferredQuery.trim()
      ? { accountId, terms: deferredQuery }
      : "skip"
  );

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search cards..."
        className="w-full rounded-md border px-3 py-2 text-sm"
      />

      {deferredQuery.trim() && results !== undefined && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border bg-white shadow-lg">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-gray-400">No results</p>
          ) : (
            results.map((card) => (
              <a
                key={card._id}
                href={`/${accountId}/boards/${card.boardId}`}
                className="block border-b p-3 text-sm hover:bg-gray-50"
              >
                <span className="text-xs text-gray-400">
                  #{card.number} · {card.boardName}
                </span>
                <p className="font-medium">{card.title}</p>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

`useDeferredValue` prevents the search query from firing on every keystroke — React defers re-rendering with the new value until the browser is idle.

## Conflict Handling

### Last-Write-Wins

Convex mutations are serializable transactions. If two users simultaneously move the same card:

1. User A moves card to "In Progress"
2. User B moves the same card to "Done"

Convex serializes these: one runs first, then the other. The second mutation sees the state *after* the first. No data corruption, but the "last" write wins.

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

## Performance Considerations

### Query Cost

Each subscribed query has a cost. For a board with 5 columns, you have ~8 active subscriptions (board metadata + column list + 5 column card lists + triage). This is fine — Convex is designed for this pattern.

### Large Result Sets

If a column has hundreds of cards, limit what you return:

```typescript
export const listByColumn = query({
  args: {
    accountId: v.id("accounts"),
    columnId: v.id("columns"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, columnId, limit }) => {
    await requireAccountAccess(ctx, accountId);
    const q = ctx.db
      .query("cards")
      .withIndex("by_column", (q) => q.eq("columnId", columnId))
      .order("desc");

    return limit ? q.take(limit) : q.collect();
  },
});
```

### Avoid Broad Queries

```typescript
// Too broad: re-runs when ANY card in the account changes
const allCards = useQuery(api.cards.listAll, { accountId });

// Better: scoped to one board
const boardCards = useQuery(api.cards.listByColumn, { accountId, columnId });

// Best for detail view: only this one card
const card = useQuery(api.cards.get, { accountId, cardId });
```

### Fizzy vs Flat Earth Real-Time Comparison

| Aspect | Fizzy (Rails) | Flat Earth (Convex) |
|--------|---------------|---------------------|
| Transport | Action Cable via Solid Cable | Convex WebSocket (built-in) |
| Push model | Explicit broadcasts in models | Automatic: every query = subscription |
| Template updates | Turbo Streams (replace/morph DOM) | React re-render with new data |
| Configuration | cable.yml, broadcast calls, stream templates | None |
| Granularity | Per-model broadcast channels | Per-query: whatever data the query reads |
| Polling | Solid Cable polls SQLite every 100ms | Push-based, no polling |
| Offline/reconnect | Not supported | Convex handles reconnection and sync |

## Exercise

1. Add `ErrorBoundary` around your board page and test by temporarily breaking a query
2. Install `sonner` and add toast notifications to card lifecycle mutations (publish, close, reopen)
3. Build `BoardSkeleton` and use it while board data loads
4. Add `listClosedPaginated` query and build the `ClosedCardsList` with "Load more" button
5. Implement the `search` query and build the `SearchBar` component
6. Add the `SearchBar` to the account layout sidebar
7. Open two browser tabs, move a card in one — verify it moves in the other instantly
8. Test pagination: create 30+ cards, close them, verify pagination loads 20 at a time

**Result:** Production-quality error handling, loading states, pagination, and search — all with real-time updates.

---

Next: [Module 12 — Deployment to Production](./12-deployment.md)
