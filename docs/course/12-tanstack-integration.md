# Module 12 — TanStack Integration

> **Goal:** Wire up the Convex backend to a TanStack Start frontend — type-safe routing, real-time data, and forms.
>
> **Reference:** [docs/fizzy-analysis/08-frontend-and-realtime.md](../fizzy-analysis/08-frontend-and-realtime.md)

## What TanStack Actually Is

TanStack is a family of type-safe libraries:

| Library | Purpose | Do We Use It? |
|---------|---------|---------------|
| **TanStack Router** | File-based routing with type-safe params | Yes |
| **TanStack Start** | Vite-based React meta-framework (SSR, bundling) | Yes |
| **TanStack Query** | Data fetching + caching | No — Convex replaces this |
| **TanStack Table** | Headless data tables | Maybe (for list views) |
| **TanStack Form** | Type-safe form management | Yes (for card creation/editing) |

### Why TanStack Start

- **Vite-based** — fast dev server, instant HMR
- **Type-safe routing** — route params are typed, links are validated at compile time
- **React meta-framework** — handles SSR, code splitting, file-based routing
- **No lock-in** — uses standard React, easy to integrate Convex

### Why NOT TanStack Query with Convex

TanStack Query manages client-side caching, refetching, and staleness for traditional REST/GraphQL APIs. Convex already handles all of this:

| TanStack Query Feature | Convex Equivalent |
|------------------------|-------------------|
| `useQuery` with polling/refetch | `useQuery` — real-time, no polling needed |
| Cache invalidation | Automatic — mutations trigger query re-runs |
| Optimistic updates | `useMutation().withOptimisticUpdate()` |
| Loading/error states | Same — `useQuery` returns `undefined` while loading |
| Stale-while-revalidate | Not needed — data is always fresh via subscription |

Using TanStack Query with Convex would add complexity for no benefit. Use Convex's hooks directly.

## Project Setup

### Create TanStack Start Project

```bash
# From your project root
bunx create-tsrouter@latest flat-earth-app --template file-based
cd flat-earth-app

# Install dependencies
bun add convex @clerk/clerk-react @clerk/tanstack-start
bun add -d @types/react @types/react-dom
```

### Install Convex

```bash
# Link to your existing Convex project (or init a new one)
bunx convex init
# Or if you already have a convex/ directory, just ensure convex is installed:
bun add convex
```

### Project Structure

```
flat-earth-app/
├── convex/                   # Convex functions (from previous modules)
│   ├── _generated/
│   ├── schema.ts
│   ├── boards.ts
│   ├── cards.ts
│   ├── cards/lifecycle.ts
│   ├── lib/auth.ts
│   └── ...
├── app/
│   ├── routes/
│   │   ├── __root.tsx        # Root layout (Convex + Clerk providers)
│   │   ├── index.tsx         # Landing / account picker
│   │   ├── $accountId/
│   │   │   ├── route.tsx     # Account layout (sidebar, nav)
│   │   │   ├── index.tsx     # Dashboard / board list
│   │   │   └── boards/
│   │   │       ├── $boardId/
│   │   │       │   ├── route.tsx    # Board layout
│   │   │       │   └── index.tsx    # Kanban board view
│   │   └── public/
│   │       └── boards/
│   │           └── $publicKey.tsx   # Public board view
│   ├── components/
│   │   ├── BoardList.tsx
│   │   ├── KanbanBoard.tsx
│   │   ├── Column.tsx
│   │   ├── Card.tsx
│   │   └── CardDetail.tsx
│   └── lib/
│       └── convex.ts         # Convex client setup
├── app.config.ts             # TanStack Start config
├── package.json
└── tsconfig.json
```

## Convex + Clerk Provider Setup

### Root Layout

The root layout wraps the entire app with Convex and Clerk providers:

```tsx
// app/routes/__root.tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL as string
);

function RootComponent() {
  return (
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <Outlet />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
```

### Environment Variables

Create `.env`:

```
VITE_CONVEX_URL=https://your-project.convex.cloud
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

## File-Based Routing

TanStack Router maps file paths to URL routes:

| File | URL | Params |
|------|-----|--------|
| `routes/index.tsx` | `/` | — |
| `routes/$accountId/index.tsx` | `/:accountId` | `accountId` |
| `routes/$accountId/boards/$boardId/index.tsx` | `/:accountId/boards/:boardId` | `accountId`, `boardId` |
| `routes/public/boards/$publicKey.tsx` | `/public/boards/:publicKey` | `publicKey` |

This mirrors Fizzy's URL structure: `/{account_id}/boards/{board_id}`.

### Typed Route Params

TanStack Router validates params at the type level:

```tsx
// app/routes/$accountId/boards/$boardId/index.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$accountId/boards/$boardId/")({
  component: BoardView,
});

function BoardView() {
  // Fully typed — accountId and boardId are strings
  const { accountId, boardId } = Route.useParams();

  // Use these as Convex IDs (you'll need to cast or validate)
  return <KanbanBoard accountId={accountId} boardId={boardId} />;
}
```

## Connecting to Convex

### Using `useQuery`

```tsx
// app/components/BoardList.tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

interface BoardListProps {
  accountId: Id<"accounts">;
}

export function BoardList({ accountId }: BoardListProps) {
  const boards = useQuery(api.boards.list, { accountId });

  if (boards === undefined) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      {boards.map((board) => (
        <a key={board._id} href={`/${accountId}/boards/${board._id}`}>
          {board.name}
        </a>
      ))}
    </div>
  );
}
```

`useQuery` returns:
- `undefined` — while loading (first render)
- The query result — once loaded AND on every subsequent real-time update

### Using `useMutation`

```tsx
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function CreateBoardButton({ accountId }: { accountId: Id<"accounts"> }) {
  const createBoard = useMutation(api.boards.create);

  const handleCreate = async () => {
    await createBoard({
      accountId,
      name: "New Board",
      allAccess: true,
    });
    // No need to refetch — the board list query updates automatically
  };

  return <button onClick={handleCreate}>New Board</button>;
}
```

### Conditional Queries (Skip)

Only subscribe when you have the required data:

```tsx
function CardDetail({ cardId }: { cardId: Id<"cards"> | null }) {
  // Don't subscribe if no card is selected
  const card = useQuery(
    api.cards.getWithDetails,
    cardId ? { accountId, cardId } : "skip"
  );

  if (!cardId) return <div>Select a card</div>;
  if (card === undefined) return <div>Loading...</div>;
  if (card === null) return <div>Card not found</div>;

  return <div>{card.title}</div>;
}
```

## The Kanban Board Component

Here's how the board view comes together with real-time subscriptions:

```tsx
// app/components/KanbanBoard.tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useState } from "react";

interface KanbanBoardProps {
  accountId: Id<"accounts">;
  boardId: Id<"boards">;
}

export function KanbanBoard({ accountId, boardId }: KanbanBoardProps) {
  const board = useQuery(api.boards.get, { accountId, boardId });
  const columns = useQuery(api.columns.listByBoard, { accountId, boardId });
  const triageCards = useQuery(api.cards.listTriage, { accountId, boardId });
  const [selectedCardId, setSelectedCardId] = useState<Id<"cards"> | null>(null);

  if (board === undefined || columns === undefined) {
    return <div>Loading board...</div>;
  }

  return (
    <div>
      <h1>{board?.name}</h1>

      <div style={{ display: "flex", gap: "1rem" }}>
        {/* Triage column */}
        <TriageColumn
          cards={triageCards ?? []}
          onSelectCard={setSelectedCardId}
        />

        {/* Regular columns */}
        {columns.map((column) => (
          <ColumnView
            key={column._id}
            accountId={accountId}
            column={column}
            onSelectCard={setSelectedCardId}
          />
        ))}
      </div>

      {/* Card detail panel */}
      {selectedCardId && (
        <CardDetailPanel
          accountId={accountId}
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
  // Each column has its own subscription — only re-renders when
  // cards in THIS column change
  const cards = useQuery(api.cards.listByColumn, {
    accountId,
    columnId: column._id,
  });

  return (
    <div style={{ minWidth: 250, background: "#f5f5f5", padding: "1rem" }}>
      <h3 style={{ color: column.color }}>{column.name}</h3>
      {cards?.map((card) => (
        <div
          key={card._id}
          onClick={() => onSelectCard(card._id)}
          style={{ padding: "0.5rem", background: "white", marginBottom: "0.5rem" }}
        >
          <strong>#{card.number}</strong> {card.title}
        </div>
      ))}
    </div>
  );
}
```

Every `useQuery` call is an independent real-time subscription. When User A moves a card from "To Do" to "Done", User B sees the change instantly — the affected column components re-render with the new data.

## Card Creation with TanStack Form

```tsx
// app/components/CreateCardForm.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

interface CreateCardFormProps {
  accountId: Id<"accounts">;
  boardId: Id<"boards">;
  onCreated: () => void;
}

export function CreateCardForm({ accountId, boardId, onCreated }: CreateCardFormProps) {
  const createCard = useMutation(api.cards.create);
  const publishCard = useMutation(api.cards.lifecycle.publish);

  const form = useForm({
    defaultValues: {
      title: "",
    },
    onSubmit: async ({ value }) => {
      // Create as draft, then publish
      const cardId = await createCard({
        accountId,
        boardId,
        title: value.title,
      });

      if (value.title.trim()) {
        await publishCard({ accountId, cardId });
      }

      onCreated();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field
        name="title"
        children={(field) => (
          <input
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder="Card title..."
          />
        )}
      />
      <button type="submit">Add Card</button>
    </form>
  );
}
```

## Optimistic Updates for Drag and Drop

Make card moves feel instant:

```tsx
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

function useCardMove(accountId: Id<"accounts">) {
  return useMutation(api.cards.moveToColumn).withOptimisticUpdate(
    (localStore, args) => {
      // Optimistically update the card's columnId in the local cache
      // This makes the card appear in the new column immediately,
      // before the server confirms the mutation
      const currentCard = localStore.getQuery(api.cards.get, {
        accountId,
        cardId: args.cardId,
      });

      if (currentCard) {
        localStore.setQuery(api.cards.get, {
          accountId,
          cardId: args.cardId,
        }, {
          ...currentCard,
          columnId: args.columnId,
        });
      }
    }
  );
}
```

For full drag-and-drop, pair with a DnD library like `@dnd-kit/core`:

```tsx
import { DndContext, closestCenter } from "@dnd-kit/core";

function KanbanBoard({ accountId, boardId }: KanbanBoardProps) {
  const moveCard = useCardMove(accountId);

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const cardId = active.id as Id<"cards">;
    const columnId = over.id as Id<"columns">;

    await moveCard({ accountId, cardId, columnId });
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {/* ... columns and cards ... */}
    </DndContext>
  );
}
```

## Authentication in the Frontend

### Sign In / Sign Up

Clerk provides pre-built components:

```tsx
// app/routes/sign-in.tsx
import { SignIn } from "@clerk/clerk-react";

export function SignInPage() {
  return <SignIn routing="path" path="/sign-in" />;
}
```

### Protected Routes

Check authentication before rendering:

```tsx
// app/routes/$accountId/route.tsx
import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/$accountId")({
  component: AccountLayout,
});

function AccountLayout() {
  const { isSignedIn, isLoaded } = useUser();
  const { accountId } = Route.useParams();

  // Wait for Clerk to load
  if (!isLoaded) return <div>Loading...</div>;

  // Redirect if not signed in
  if (!isSignedIn) {
    window.location.href = "/sign-in";
    return null;
  }

  return (
    <div>
      <Sidebar accountId={accountId as any} />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

### Account Picker

```tsx
// app/routes/index.tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "@clerk/clerk-react";

export function HomePage() {
  const { isSignedIn } = useUser();
  const accounts = useQuery(api.accounts.listMyAccounts);

  if (!isSignedIn) {
    return <a href="/sign-in">Sign In</a>;
  }

  if (accounts === undefined) return <div>Loading...</div>;

  if (accounts.length === 0) {
    return <CreateAccountForm />;
  }

  if (accounts.length === 1) {
    // Auto-redirect to the only account
    window.location.href = `/${accounts[0]._id}`;
    return null;
  }

  return (
    <div>
      <h1>Select an Account</h1>
      {accounts.map((account) => (
        <a key={account._id} href={`/${account._id}`}>
          {account.name}
        </a>
      ))}
    </div>
  );
}
```

## Fizzy Frontend vs Flat Earth Frontend

| Fizzy (Hotwired) | Flat Earth (TanStack + Convex) |
|-------------------|-------------------------------|
| Server-rendered ERB templates | Client-rendered React components |
| Turbo Drive (SPA navigation) | TanStack Router (file-based, type-safe) |
| Turbo Frames (partial updates) | React component boundaries |
| Turbo Streams (real-time DOM mutations) | `useQuery` auto-subscriptions |
| 56 Stimulus controllers | React hooks + event handlers |
| Importmap (no bundler) | Vite (fast bundler) |
| Action Text (Trix editor) | TipTap (modern, extensible) |
| No client-side state | No client-side state either! (Convex is the state) |

The last point is important: in both architectures, the server is the source of truth. Fizzy renders HTML on the server and pushes updates. Flat Earth serves data from Convex and React renders it. Neither needs Redux, Zustand, or client-side state management — the database IS the state.

## Exercise: Scaffold the Frontend

1. **Create a TanStack Start project** with Convex and Clerk providers in the root layout

2. **Set up file-based routing**:
   - `/` — account picker (or redirect to single account)
   - `/$accountId` — account layout with sidebar
   - `/$accountId/boards/$boardId` — kanban board view
   - `/public/boards/$publicKey` — public board view

3. **Build the board list page**: Use `useQuery(api.boards.list)` to display boards

4. **Build the kanban board view**:
   - Board metadata query
   - Column list query
   - Per-column card queries
   - Card detail panel (opens on click)

5. **Add card creation**: Form with title field, creates a drafted card then publishes it

6. **Test real-time**: Open in two browser tabs, create a card in one, watch it appear in the other

7. **Add basic drag and drop** (stretch goal): Use `@dnd-kit/core` to move cards between columns via `cards.moveToColumn` mutation

---

You've completed the course. You now have the knowledge to build a full kanban app with TypeScript, Convex, Clerk, and TanStack Start — all the pieces that make up Flat Earth.

Go back to [Module 00 — Roadmap](./00-roadmap.md) for the big picture, or dive into the [fizzy-analysis docs](../fizzy-analysis/) for detailed reference on any feature.
