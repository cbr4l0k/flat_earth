# Module 06 — Cards & the Kanban Board

> **What you'll see running:** A full kanban board with cards in columns, a triage area for unsorted cards, drag-and-drop to move cards between columns, and a card detail panel — all updating in real time across browser tabs.

## Card Operations (Backend)

### Create Card

Cards start as "drafted" with a sequential number per account:

```typescript
// convex/cards.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, boardId, title }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const account = await ctx.db.get(accountId);
    if (!account) throw new ConvexError("Account not found");

    const nextNumber = account.cardsCount + 1;

    const cardId = await ctx.db.insert("cards", {
      accountId,
      boardId,
      columnId: null,
      creatorId: user._id,
      title: title ?? "",
      number: nextNumber,
      status: "drafted",
      lastActiveAt: Date.now(),
      isGolden: false,
    });

    await ctx.db.patch(accountId, { cardsCount: nextNumber });
    return cardId;
  },
});
```

### Get Card

```typescript
export const get = query({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);
    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) return null;

    const creator = await ctx.db.get(card.creatorId);
    return { ...card, creatorName: creator?.name ?? "Unknown" };
  },
});

export const getByNumber = query({
  args: { accountId: v.id("accounts"), number: v.number() },
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

### List Cards by Column (Granular Queries)

This is the key pattern for the kanban board. Each column has its own subscription — when a card moves, only the affected columns re-render:

```typescript
export const listByColumn = query({
  args: { accountId: v.id("accounts"), columnId: v.id("columns") },
  handler: async (ctx, { accountId, columnId }) => {
    await requireAccountAccess(ctx, accountId);
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_column", (q) => q.eq("columnId", columnId))
      .collect();
    return cards.filter(
      (c) => c.status === "published" && !c.closedAt && !c.postponedAt
    );
  },
});

export const listTriage = query({
  args: { accountId: v.id("accounts"), boardId: v.id("boards") },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
    return cards.filter(
      (c) =>
        c.status === "published" &&
        c.columnId === null &&
        !c.closedAt &&
        !c.postponedAt
    );
  },
});
```

### Move Card

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

    if (columnId !== null) {
      const column = await ctx.db.get(columnId);
      if (!column || column.boardId !== card.boardId) {
        throw new ConvexError("Column not on this board");
      }
    }

    await ctx.db.patch(cardId, { columnId, lastActiveAt: Date.now() });
  },
});

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

    await ctx.db.patch(cardId, {
      boardId: newBoardId,
      columnId: null,
      lastActiveAt: Date.now(),
    });
  },
});
```

### Update and Delete Card

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

export const remove = mutation({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && card.creatorId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    // Cascade delete related data
    for (const table of ["comments", "assignments", "taggings"] as const) {
      const docs = await ctx.db
        .query(table)
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect();
      for (const doc of docs) await ctx.db.delete(doc._id);
    }

    await ctx.db.delete(cardId);
  },
});
```

## Query Architecture for the Board

Each `useQuery` is an independent real-time subscription:

```
BoardPage
├── useQuery(boards.get, { boardId })              → Board metadata
├── useQuery(columns.listByBoard, { boardId })     → Column list
├── useQuery(cards.listTriage, { boardId })         → Triage cards
├── For each column:
│   └── useQuery(cards.listByColumn, { columnId }) → Cards in column
└── CardDetailPanel (when a card is selected)
    └── useQuery(cards.get, { cardId })            → Card details
```

When a card moves from "To Do" to "In Progress":
- The "To Do" column query re-runs (card disappears)
- The "In Progress" column query re-runs (card appears)
- Board metadata, other columns, and triage do NOT re-run

## Frontend: The Kanban Board

Update the board page from Module 05 to include cards:

```tsx
// src/routes/$accountId/boards/$boardId/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "../../../../components/ui/button";
import { useState } from "react";

export const Route = createFileRoute("/$accountId/boards/$boardId/")({
  component: BoardPage,
});

function BoardPage() {
  const { accountId, boardId } = Route.useParams();
  const aid = accountId as Id<"accounts">;
  const bid = boardId as Id<"boards">;

  const board = useQuery(api.boards.get, { accountId: aid, boardId: bid });
  const columns = useQuery(api.columns.listByBoard, {
    accountId: aid,
    boardId: bid,
  });
  const triageCards = useQuery(api.cards.listTriage, {
    accountId: aid,
    boardId: bid,
  });
  const [selectedCardId, setSelectedCardId] = useState<Id<"cards"> | null>(
    null
  );

  if (board === undefined || columns === undefined) {
    return <p className="text-gray-500">Loading board...</p>;
  }
  if (!board) {
    return <p className="text-red-500">Board not found.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{board.name}</h1>
        <QuickCreateCard accountId={aid} boardId={bid} />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {/* Triage column */}
        <div className="w-72 shrink-0 rounded-lg bg-amber-50 p-4">
          <h3 className="mb-3 font-semibold text-amber-700">
            Triage ({triageCards?.length ?? 0})
          </h3>
          <div className="space-y-2">
            {triageCards?.map((card) => (
              <CardItem
                key={card._id}
                card={card}
                onSelect={() => setSelectedCardId(card._id)}
              />
            ))}
          </div>
        </div>

        {/* Regular columns */}
        {columns.map((column) => (
          <ColumnView
            key={column._id}
            accountId={aid}
            column={column}
            onSelectCard={setSelectedCardId}
          />
        ))}
      </div>

      {/* Card detail panel */}
      {selectedCardId && (
        <CardDetailPanel
          accountId={aid}
          cardId={selectedCardId}
          onClose={() => setSelectedCardId(null)}
        />
      )}
    </div>
  );
}

function ColumnView({
  accountId,
  column,
  onSelectCard,
}: {
  accountId: Id<"accounts">;
  column: any;
  onSelectCard: (id: Id<"cards">) => void;
}) {
  const cards = useQuery(api.cards.listByColumn, {
    accountId,
    columnId: column._id,
  });

  return (
    <div className="w-72 shrink-0 rounded-lg bg-gray-100 p-4">
      <h3 className="mb-3 font-semibold" style={{ color: column.color }}>
        {column.name} ({cards?.length ?? 0})
      </h3>
      <div className="space-y-2">
        {cards?.map((card) => (
          <CardItem
            key={card._id}
            card={card}
            onSelect={() => onSelectCard(card._id)}
          />
        ))}
      </div>
    </div>
  );
}

function CardItem({ card, onSelect }: { card: any; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="cursor-pointer rounded bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-400">
          #{card.number}
        </span>
        {card.isGolden && <span className="text-xs">★</span>}
      </div>
      <p className="mt-1 text-sm font-medium">
        {card.title || "Untitled"}
      </p>
      {card.dueOn && (
        <p className="mt-1 text-xs text-gray-500">Due: {card.dueOn}</p>
      )}
    </div>
  );
}

function CardDetailPanel({
  accountId,
  cardId,
  onClose,
}: {
  accountId: Id<"accounts">;
  cardId: Id<"cards">;
  onClose: () => void;
}) {
  const card = useQuery(api.cards.get, { accountId, cardId });
  const updateCard = useMutation(api.cards.update);
  const [title, setTitle] = useState("");

  if (card === undefined) return null;
  if (!card) return <p>Card not found.</p>;

  return (
    <div className="fixed inset-y-0 right-0 w-96 border-l bg-white p-6 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-gray-500">#{card.number}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          Close
        </button>
      </div>
      <input
        className="mb-4 w-full border-b pb-2 text-lg font-bold outline-none"
        defaultValue={card.title}
        onBlur={(e) =>
          updateCard({ accountId, cardId, title: e.target.value })
        }
      />
      <div className="space-y-2 text-sm text-gray-600">
        <p>Created by: {card.creatorName}</p>
        <p>Status: {card.status}</p>
        {card.dueOn && <p>Due: {card.dueOn}</p>}
      </div>
    </div>
  );
}

function QuickCreateCard({
  accountId,
  boardId,
}: {
  accountId: Id<"accounts">;
  boardId: Id<"boards">;
}) {
  const createCard = useMutation(api.cards.create);
  const [title, setTitle] = useState("");

  return (
    <div className="flex gap-2">
      <input
        className="rounded border px-3 py-2 text-sm"
        placeholder="New card title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === "Enter" && title.trim()) {
            await createCard({ accountId, boardId, title: title.trim() });
            setTitle("");
          }
        }}
      />
      <Button
        size="sm"
        onClick={async () => {
          if (!title.trim()) return;
          await createCard({ accountId, boardId, title: title.trim() });
          setTitle("");
        }}
      >
        Add Card
      </Button>
    </div>
  );
}
```

## Drag and Drop with @dnd-kit

Install `@dnd-kit`:

```bash
bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Wrap the kanban board with a `DndContext`:

```tsx
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";

function KanbanBoard({ accountId, boardId, columns, triageCards }) {
  const moveCard = useMutation(api.cards.moveToColumn);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const cardId = active.id as Id<"cards">;
    const columnId = over.id === "triage"
      ? null
      : (over.id as Id<"columns">);

    await moveCard({ accountId, cardId, columnId });
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {/* columns with droppable areas and draggable cards */}
    </DndContext>
  );
}
```

Make each column a droppable target and each card a draggable item. The full drag-and-drop implementation involves `useDraggable`, `useDroppable`, and `DragOverlay` from `@dnd-kit/core`. Consult the `@dnd-kit` docs for the complete pattern.

## Optimistic Updates

Make card moves feel instant by optimistically updating the local cache:

```typescript
const moveCard = useMutation(api.cards.moveToColumn).withOptimisticUpdate(
  (localStore, args) => {
    const currentCard = localStore.getQuery(api.cards.get, {
      accountId: args.accountId,
      cardId: args.cardId,
    });
    if (currentCard) {
      localStore.setQuery(
        api.cards.get,
        { accountId: args.accountId, cardId: args.cardId },
        { ...currentCard, columnId: args.columnId }
      );
    }
  }
);
```

The optimistic update immediately reflects in the UI. When the server confirms (or rejects), the real data replaces the optimistic version.

## Exercise

1. Implement card CRUD in `convex/cards.ts`: `create`, `get`, `getByNumber`, `listByColumn`, `listTriage`, `update`, `moveToColumn`, `moveToBoard`, `remove`
2. Build the kanban board page with per-column subscriptions
3. Add the triage column for cards without a column
4. Add a card detail panel that opens on click
5. Install `@dnd-kit` and add drag-and-drop between columns
6. Add optimistic updates for card moves
7. Open two browser tabs: move a card in one, watch it move in the other

**Result:** A fully interactive kanban board with real-time updates and drag-and-drop.

---

Next: [Module 07 — Card Lifecycle: State Machine](./07-card-lifecycle.md)
