# Module 07 — Card Lifecycle

> **Goal:** Implement the card state machine — draft, publish, triage, close, postpone, reopen, resume — with validated transitions and derived status.
>
> **References:** [docs/fizzy-analysis/02-domain-models.md](../fizzy-analysis/02-domain-models.md), [docs/fizzy-analysis/06-features.md](../fizzy-analysis/06-features.md)

## The State Machine

Fizzy's card lifecycle is one of its most interesting features. A card doesn't just have a "status" column — its effective state is *derived* from multiple fields:

```
                    ┌──────────┐
                    │ drafted  │  card.status === "drafted"
                    └────┬─────┘
                         │ publish()
                         ▼
                    ┌──────────┐
            ┌──────│  active   │◄─────┐
            │      │           │      │
            │      └──┬────┬──┘      │
            │         │    │         │
            │  close() │    │ postpone()
            │         ▼    ▼         │
            │    ┌────────┐ ┌──────┐ │
            │    │ closed │ │not_now│ │
            │    └───┬────┘ └──┬───┘ │
            │        │         │     │
            │ reopen()│  resume()│     │
            │        └─────────┘     │
            │              │         │
            └──────────────┘─────────┘
```

### Status vs Derived State

In our schema (Module 03), the `cards` table has:

| Field | Type | Meaning |
|-------|------|---------|
| `status` | `"drafted" \| "published"` | Base status (only two values) |
| `closedAt` | `number \| undefined` | Timestamp when closed |
| `closedBy` | `Id<"users"> \| undefined` | Who closed it |
| `postponedAt` | `number \| undefined` | Timestamp when postponed |
| `postponedBy` | `Id<"users"> \| undefined` | Who postponed it |
| `columnId` | `Id<"columns"> \| null` | Which column (null = triage) |

The **effective state** is computed from these fields:

```typescript
type EffectiveStatus =
  | "drafted"    // status === "drafted"
  | "active"     // status === "published" && !closedAt && !postponedAt
  | "closed"     // status === "published" && closedAt exists
  | "not_now"    // status === "published" && postponedAt exists
  | "triage";    // active && columnId === null

function getEffectiveStatus(card: Doc<"cards">): EffectiveStatus {
  if (card.status === "drafted") return "drafted";
  if (card.closedAt) return "closed";
  if (card.postponedAt) return "not_now";
  if (card.columnId === null) return "triage";
  return "active";
}
```

Why not just use a single `status` field? Because Fizzy's model tracks *who* and *when* for closures and postponements, and supports operations like "reopen" that need to restore previous state. Keeping these as separate fields gives us the history and reversibility.

## Lifecycle Mutations

### Publish

Transitions a card from `drafted` to `published`. This makes the card visible to other users:

```typescript
// convex/cards/lifecycle.ts
import { mutation } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "../lib/auth";

export const publish = mutation({
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

    // Validate transition: only drafted cards can be published
    if (card.status !== "drafted") {
      throw new ConvexError("Only drafted cards can be published");
    }

    // Default title if blank
    const title = card.title.trim() || `Card #${card.number}`;

    await ctx.db.patch(cardId, {
      status: "published",
      title,
      lastActiveAt: Date.now(),
    });

    // Track event (we'll implement the full events system in Module 10)
    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "card_published",
      eventable: { type: "card", id: cardId },
    });
  },
});
```

### Close

Marks a card as done:

```typescript
export const close = mutation({
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

    // Can only close published, active (not already closed or postponed) cards
    if (card.status !== "published") {
      throw new ConvexError("Can only close published cards");
    }
    if (card.closedAt) {
      throw new ConvexError("Card is already closed");
    }

    // If postponed, resume first (clear postponement)
    const patch: Record<string, any> = {
      closedAt: Date.now(),
      closedBy: user._id,
      lastActiveAt: Date.now(),
    };

    if (card.postponedAt) {
      patch.postponedAt = undefined;
      patch.postponedBy = undefined;
    }

    await ctx.db.patch(cardId, patch);

    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "card_closed",
      eventable: { type: "card", id: cardId },
    });
  },
});
```

### Reopen

Brings a closed card back to active:

```typescript
export const reopen = mutation({
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

    if (!card.closedAt) {
      throw new ConvexError("Card is not closed");
    }

    await ctx.db.patch(cardId, {
      closedAt: undefined,
      closedBy: undefined,
      lastActiveAt: Date.now(),
    });

    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "card_reopened",
      eventable: { type: "card", id: cardId },
    });
  },
});
```

### Postpone ("Not Now")

Sends a card to the "Not Now" pile. In Fizzy, this also sends the card back to triage and clears any closure:

```typescript
export const postpone = mutation({
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

    if (card.status !== "published") {
      throw new ConvexError("Can only postpone published cards");
    }
    if (card.postponedAt) {
      throw new ConvexError("Card is already postponed");
    }

    // Postpone: set postponed fields, send back to triage, clear closure
    await ctx.db.patch(cardId, {
      postponedAt: Date.now(),
      postponedBy: user._id,
      columnId: null,          // Back to triage
      closedAt: undefined,     // Clear closure if any
      closedBy: undefined,
      activitySpikeAt: undefined, // Clear activity spike
      lastActiveAt: Date.now(),
    });

    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "card_postponed",
      eventable: { type: "card", id: cardId },
    });
  },
});
```

### Resume

Brings a postponed card back to active:

```typescript
export const resume = mutation({
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

    if (!card.postponedAt) {
      throw new ConvexError("Card is not postponed");
    }

    await ctx.db.patch(cardId, {
      postponedAt: undefined,
      postponedBy: undefined,
      closedAt: undefined,
      closedBy: undefined,
      activitySpikeAt: undefined,
      lastActiveAt: Date.now(),
    });

    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "card_resumed",
      eventable: { type: "card", id: cardId },
    });
  },
});
```

### Triage Into Column

Move a card from triage (or another column) into a specific column:

```typescript
export const triageInto = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    columnId: v.id("columns"),
  },
  handler: async (ctx, { accountId, cardId, columnId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    const column = await ctx.db.get(columnId);
    if (!column || column.boardId !== card.boardId) {
      throw new ConvexError("Column not found on this board");
    }

    // If postponed, resume first
    const patch: Record<string, any> = {
      columnId,
      lastActiveAt: Date.now(),
    };

    if (card.postponedAt) {
      patch.postponedAt = undefined;
      patch.postponedBy = undefined;
      patch.activitySpikeAt = undefined;
    }

    await ctx.db.patch(cardId, patch);

    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "card_triaged",
      eventable: { type: "card", id: cardId },
      particulars: { column: column.name },
    });
  },
});
```

### Send Back to Triage

```typescript
export const sendToTriage = mutation({
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

    await ctx.db.patch(cardId, {
      columnId: null,
      lastActiveAt: Date.now(),
    });

    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "card_sent_back_to_triage",
      eventable: { type: "card", id: cardId },
    });
  },
});
```

## Querying by Lifecycle State

### Active Cards (on a board)

```typescript
export const listActive = query({
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

    return cards.filter(
      (c) => c.status === "published" && !c.closedAt && !c.postponedAt
    );
  },
});
```

### Closed Cards

```typescript
export const listClosed = query({
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

    return cards
      .filter((c) => c.closedAt !== undefined)
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  },
});
```

### Postponed Cards ("Not Now")

```typescript
export const listPostponed = query({
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

    return cards.filter((c) => c.postponedAt !== undefined);
  },
});
```

### Triage Cards (Awaiting Column Assignment)

```typescript
export const listTriage = query({
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

## Golden Cards

A simple but nice feature — mark important cards:

```typescript
export const toggleGolden = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    await ctx.db.patch(cardId, { isGolden: !card.isGolden });
  },
});
```

## Transition Validation Summary

| From → To | Allowed | Mutation |
|-----------|---------|----------|
| drafted → published | Yes | `publish` |
| active → closed | Yes | `close` |
| active → not_now | Yes | `postpone` |
| active → triage | Yes | `sendToTriage` |
| triage → active (column) | Yes | `triageInto` |
| closed → active | Yes | `reopen` |
| not_now → active | Yes | `resume` |
| not_now → closed | Yes | `close` (clears postponement first) |
| closed → not_now | No | Invalid — reopen first |
| drafted → closed | No | Must publish first |
| drafted → not_now | No | Must publish first |
| published → drafted | No | Can't un-publish |

Each mutation validates its preconditions before making changes. Invalid transitions throw `ConvexError`.

## Exercise: Implement the Full Lifecycle

1. **Create `convex/cards/lifecycle.ts`** with all lifecycle mutations: `publish`, `close`, `reopen`, `postpone`, `resume`, `triageInto`, `sendToTriage`, `toggleGolden`

2. **Create lifecycle queries** in `convex/cards.ts`: `listActive`, `listClosed`, `listPostponed`, `listTriage`

3. **Write `getEffectiveStatus`** as a helper function

4. **Test the complete lifecycle in the dashboard**:
   - Create a card (drafted)
   - Publish it (→ active, in triage)
   - Triage into a column (→ triaged)
   - Postpone it (→ not_now, back to triage)
   - Resume it (→ active, in triage)
   - Close it (→ closed)
   - Reopen it (→ active)
   - Toggle golden status

5. **Test invalid transitions**:
   - Try to close a drafted card → should throw
   - Try to postpone an already postponed card → should throw
   - Try to reopen a card that isn't closed → should throw
   - Verify each mutation rejects invalid states

---

Next: [Module 08 — Real-Time Updates](./08-realtime.md)
