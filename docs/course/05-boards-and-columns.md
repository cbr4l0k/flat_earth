# Module 05 — Boards & Columns

> **What you'll see running:** A board list page where you can create new boards, click into a board to see its columns, add/reorder/delete columns — all updating in real time.

## Board Operations (Backend)

### List Boards

Users only see boards they have access to:

```typescript
// convex/boards.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

export const list = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);

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

export const get = query({
  args: { accountId: v.id("accounts"), boardId: v.id("boards") },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);
    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) return null;
    return board;
  },
});
```

### Create Board

```typescript
export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    name: v.string(),
    allAccess: v.boolean(),
  },
  handler: async (ctx, { accountId, name, allAccess }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const boardId = await ctx.db.insert("boards", {
      accountId,
      name,
      creatorId: user._id,
      allAccess,
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
      userId: user._id,
      involvement: "watching",
    });

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

### Update and Delete Board

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

    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && board.creatorId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (allAccess !== undefined) updates.allAccess = allAccess;
    await ctx.db.patch(boardId, updates);
  },
});

export const remove = mutation({
  args: { accountId: v.id("accounts"), boardId: v.id("boards") },
  handler: async (ctx, { accountId, boardId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const board = await ctx.db.get(boardId);
    if (!board || board.accountId !== accountId) {
      throw new ConvexError("Board not found");
    }

    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && board.creatorId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    // Cascade delete
    for (const table of ["columns", "cards", "accesses"] as const) {
      const docs = await ctx.db
        .query(table)
        .withIndex("by_board", (q) => q.eq("boardId", boardId))
        .collect();
      for (const doc of docs) await ctx.db.delete(doc._id);
    }

    await ctx.db.delete(boardId);
  },
});
```

## Column Operations (Backend)

```typescript
// convex/columns.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

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

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, { accountId, boardId, name, color }) => {
    await requireAccountAccess(ctx, accountId);

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

    const columns = await ctx.db
      .query("columns")
      .withIndex("by_board_position", (q) => q.eq("boardId", boardId))
      .collect();

    for (const col of columns) {
      if (col._id === columnId) continue;
      if (oldPosition < newPosition) {
        if (col.position > oldPosition && col.position <= newPosition) {
          await ctx.db.patch(col._id, { position: col.position - 1 });
        }
      } else {
        if (col.position >= newPosition && col.position < oldPosition) {
          await ctx.db.patch(col._id, { position: col.position + 1 });
        }
      }
    }

    await ctx.db.patch(columnId, { position: newPosition });
  },
});

export const remove = mutation({
  args: { accountId: v.id("accounts"), columnId: v.id("columns") },
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

    // Compact positions
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

## Frontend: Board List Page

```tsx
// src/routes/$accountId/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../components/ui/card";
import { useState } from "react";

export const Route = createFileRoute("/$accountId/")({
  component: BoardListPage,
});

function BoardListPage() {
  const { accountId } = Route.useParams();
  const boards = useQuery(api.boards.list, {
    accountId: accountId as Id<"accounts">,
  });
  const createBoard = useMutation(api.boards.create);
  const [newName, setNewName] = useState("");

  if (boards === undefined) {
    return <p className="text-gray-500">Loading boards...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Boards</h1>
      </div>

      {/* Create board form */}
      <div className="flex gap-2">
        <input
          className="rounded border px-3 py-2 text-sm"
          placeholder="New board name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button
          onClick={async () => {
            if (!newName.trim()) return;
            await createBoard({
              accountId: accountId as Id<"accounts">,
              name: newName.trim(),
              allAccess: true,
            });
            setNewName("");
          }}
        >
          Create Board
        </Button>
      </div>

      {/* Board grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {boards.map((board) => (
          <a
            key={board._id}
            href={`/${accountId}/boards/${board._id}`}
            className="block"
          >
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>{board.name}</CardTitle>
              </CardHeader>
            </Card>
          </a>
        ))}
        {boards.length === 0 && (
          <p className="text-sm text-gray-500">
            No boards yet. Create one above.
          </p>
        )}
      </div>
    </div>
  );
}
```

## Frontend: Board Layout with Columns

```tsx
// src/routes/$accountId/boards/$boardId/route.tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/$accountId/boards/$boardId")({
  component: () => <Outlet />,
});
```

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

  if (board === undefined || columns === undefined) {
    return <p className="text-gray-500">Loading board...</p>;
  }

  if (!board) {
    return <p className="text-red-500">Board not found.</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{board.name}</h1>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <ColumnCard
            key={column._id}
            accountId={aid}
            column={column}
          />
        ))}
        <AddColumnButton accountId={aid} boardId={bid} />
      </div>
    </div>
  );
}

function ColumnCard({
  accountId,
  column,
}: {
  accountId: Id<"accounts">;
  column: any;
}) {
  const removeColumn = useMutation(api.columns.remove);

  return (
    <div className="w-72 shrink-0 rounded-lg bg-gray-100 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: column.color }}>
          {column.name}
        </h3>
        <button
          className="text-xs text-gray-400 hover:text-red-500"
          onClick={() =>
            removeColumn({ accountId, columnId: column._id })
          }
        >
          Delete
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Cards will go here in Module 06.
      </p>
    </div>
  );
}

function AddColumnButton({
  accountId,
  boardId,
}: {
  accountId: Id<"accounts">;
  boardId: Id<"boards">;
}) {
  const createColumn = useMutation(api.columns.create);
  const [name, setName] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button
        className="flex h-12 w-72 shrink-0 items-center justify-center rounded-lg border-2 border-dashed text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600"
        onClick={() => setIsOpen(true)}
      >
        + Add Column
      </button>
    );
  }

  return (
    <div className="w-72 shrink-0 rounded-lg bg-gray-100 p-4">
      <input
        className="mb-2 w-full rounded border px-3 py-2 text-sm"
        placeholder="Column name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            if (!name.trim()) return;
            await createColumn({
              accountId,
              boardId,
              name: name.trim(),
              color: "#6366f1",
            });
            setName("");
            setIsOpen(false);
          }}
        >
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setName("");
            setIsOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

## Nested Routes

The URL structure mirrors Fizzy's: `/:accountId/boards/:boardId`.

| File | URL | Purpose |
|------|-----|---------|
| `$accountId/index.tsx` | `/:accountId` | Board list |
| `$accountId/boards/$boardId/index.tsx` | `/:accountId/boards/:boardId` | Board view |

Each level has its own layout. The account layout provides the sidebar; the board layout will provide board-level navigation in later modules.

## Loading States and Error Handling

`useQuery` returns `undefined` while loading. Handle all three states:

```tsx
const boards = useQuery(api.boards.list, { accountId });

if (boards === undefined) return <p>Loading...</p>;     // Loading
if (boards.length === 0) return <p>No boards yet.</p>;   // Empty
return boards.map(/* ... */);                             // Data
```

For mutations, errors from `ConvexError` will be thrown. Handle them with try/catch:

```tsx
const createBoard = useMutation(api.boards.create);

try {
  await createBoard({ accountId, name, allAccess: true });
} catch (error) {
  // error.message contains the ConvexError message
  console.error(error);
}
```

We'll add proper error boundaries and toast notifications in Module 11.

## Exercise

1. Implement board CRUD in `convex/boards.ts`: `list`, `get`, `create`, `update`, `remove`
2. Implement column CRUD in `convex/columns.ts`: `listByBoard`, `create`, `reorder`, `remove`
3. Build the board list page at `/$accountId/index.tsx`
4. Build the board view page at `/$accountId/boards/$boardId/index.tsx`
5. Create a board, add columns, delete a column, verify real-time updates in two tabs
6. Navigate between the board list and individual boards

**Result:** A working board management UI with columns. Creating a board in one tab shows it in another instantly.

---

Next: [Module 06 — Cards & the Kanban Board](./06-cards-and-kanban.md)
