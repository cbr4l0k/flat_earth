# Module 10 — Background Jobs & Entropy

> **What you'll see running:** Stale cards auto-postponing after a configurable inactivity period, "postponing soon" warning badges, a notification bell with real-time unread count, and a notification list that bundles events into time windows.
>
> **References:** [docs/fizzy-analysis/02-domain-models.md](../fizzy-analysis/02-domain-models.md), [docs/fizzy-analysis/07-dev-vs-production.md](../fizzy-analysis/07-dev-vs-production.md)

## Convex Scheduling Primitives

Fizzy uses Solid Queue with 16 job classes, 7 recurring jobs, Redis, and worker processes. Convex replaces all of that with two built-in mechanisms.

### 1. `ctx.scheduler` — One-Off Scheduled Functions

Run a function after a delay or at a specific time:

```typescript
// Run immediately (async, non-blocking)
await ctx.scheduler.runAfter(0, api.notifications.send, { userId, eventId });

// Run after 30 minutes
await ctx.scheduler.runAfter(30 * 60 * 1000, api.notifications.deliverBundle, {
  userId,
  bundleId,
});

// Run at a specific timestamp
await ctx.scheduler.runAt(timestamp, api.entropy.checkCard, { cardId });
```

`ctx.scheduler` is available in mutations and actions. The scheduled function runs independently — if the scheduling mutation succeeds, the function is guaranteed to execute (at-least-once delivery).

### 2. `crons.ts` — Recurring Jobs

Define recurring jobs in a dedicated file:

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every hour: auto-postpone stale cards
crons.interval(
  "auto-postpone stale cards",
  { hours: 1 },
  internal.entropy.autoPostponeAll,
);

// Every 30 minutes: deliver notification bundles
crons.interval(
  "deliver notification bundles",
  { minutes: 30 },
  internal.notifications.deliverAllBundles,
);

// Daily at 4:02 AM UTC: clean up unused tags
crons.cron(
  "cleanup unused tags",
  "2 4 * * *",
  internal.tags.deleteUnused,
);

// Daily at 3:00 AM UTC: clean up stale webhook deliveries
crons.cron(
  "cleanup stale webhook deliveries",
  "0 3 * * *",
  internal.webhooks.cleanupDeliveries,
);

export default crons;
```

Two scheduling modes:
- `crons.interval(name, interval, fn)` — run every N hours/minutes
- `crons.cron(name, cronExpression, fn)` — standard cron syntax

No Redis. No worker processes. No job infrastructure. Scheduled functions and crons are first-class Convex features.

## The Entropy System

Fizzy's most distinctive feature. Cards that go inactive for too long automatically get postponed ("Not Now"), preventing boards from filling up with stale items.

### How It Works

1. Every card has a `lastActiveAt` timestamp (updated on events, comments, lifecycle changes)
2. Every account has an entropy configuration (default: 30 days)
3. Boards can override the account-level entropy period
4. An hourly cron job finds cards past their entropy deadline and auto-postpones them

### Configuration

```typescript
// convex/entropy.ts
import { query, mutation, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";
import { isAdmin } from "./lib/permissions";

// Get the effective entropy period for a board
export const getEffectivePeriod = query({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);

    const entropies = await ctx.db
      .query("entropies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    // Check board-level override first
    const boardEntropy = entropies.find(
      (e) => e.container.type === "board" && e.container.id === boardId
    );
    if (boardEntropy) return boardEntropy.autoPostponePeriod;

    // Fall back to account-level
    const accountEntropy = entropies.find(
      (e) => e.container.type === "account" && e.container.id === accountId
    );
    if (accountEntropy) return accountEntropy.autoPostponePeriod;

    // Default: 30 days in milliseconds
    return 30 * 24 * 60 * 60 * 1000;
  },
});

// Set entropy period (admin only)
export const setPeriod = mutation({
  args: {
    accountId: v.id("accounts"),
    containerId: v.union(v.id("accounts"), v.id("boards")),
    containerType: v.union(v.literal("account"), v.literal("board")),
    periodMs: v.number(),
  },
  handler: async (ctx, { accountId, containerId, containerType, periodMs }) => {
    const user = await requireAccountAccess(ctx, accountId);
    if (!isAdmin(user)) {
      throw new ConvexError("Only admins can configure entropy");
    }

    const entropies = await ctx.db
      .query("entropies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    const existing = entropies.find(
      (e) =>
        e.container.type === containerType && e.container.id === containerId
    );

    if (existing) {
      await ctx.db.patch(existing._id, { autoPostponePeriod: periodMs });
    } else {
      await ctx.db.insert("entropies", {
        accountId,
        container: { type: containerType, id: containerId },
        autoPostponePeriod: periodMs,
      });
    }
  },
});
```

### The Auto-Postpone Cron Job

The heart of the entropy system:

```typescript
// convex/entropy.ts (continued)
export const autoPostponeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const accounts = await ctx.db.query("accounts").collect();

    for (const account of accounts) {
      // Get entropy configs for this account
      const entropies = await ctx.db
        .query("entropies")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect();

      const accountPeriod =
        entropies.find(
          (e) =>
            e.container.type === "account" &&
            e.container.id === account._id
        )?.autoPostponePeriod ?? 30 * 24 * 60 * 60 * 1000;

      // Find active, published, non-postponed, non-closed cards
      const cards = await ctx.db
        .query("cards")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect();

      const eligibleCards = cards.filter(
        (c) =>
          c.status === "published" &&
          !c.closedAt &&
          !c.postponedAt
      );

      for (const card of eligibleCards) {
        // Board-level override
        const boardEntropy = entropies.find(
          (e) =>
            e.container.type === "board" && e.container.id === card.boardId
        );
        const effectivePeriod = boardEntropy?.autoPostponePeriod ?? accountPeriod;

        if (now - card.lastActiveAt > effectivePeriod) {
          await ctx.db.patch(card._id, {
            postponedAt: now,
            columnId: null,
            activitySpikeAt: undefined,
            lastActiveAt: now,
          });

          // Track event (use account owner as creator)
          const owner = await ctx.db
            .query("users")
            .withIndex("by_account_role", (q) =>
              q.eq("accountId", account._id).eq("role", "owner")
            )
            .first();

          if (owner) {
            await ctx.db.insert("events", {
              accountId: account._id,
              boardId: card.boardId,
              creatorId: owner._id,
              action: "card_auto_postponed",
              eventable: { type: "card", id: card._id },
            });
          }
        }
      }
    }
  },
});
```

### "Postponing Soon" Query

Cards approaching their entropy deadline (75% of the period elapsed):

```typescript
// convex/entropy.ts (continued)
export const listPostponingSoon = query({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);

    const now = Date.now();

    const entropies = await ctx.db
      .query("entropies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    const boardEntropy = entropies.find(
      (e) => e.container.type === "board" && e.container.id === boardId
    );
    const accountEntropy = entropies.find(
      (e) => e.container.type === "account" && e.container.id === accountId
    );
    const period =
      boardEntropy?.autoPostponePeriod ??
      accountEntropy?.autoPostponePeriod ??
      30 * 24 * 60 * 60 * 1000;

    const warningThreshold = period * 0.75;

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();

    return cards.filter(
      (c) =>
        c.status === "published" &&
        !c.closedAt &&
        !c.postponedAt &&
        now - c.lastActiveAt > warningThreshold
    );
  },
});
```

## Frontend: Entropy Warning Badges

Show warning indicators on cards approaching auto-postpone:

```tsx
// src/components/EntropyWarning.tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function EntropyWarning({
  accountId,
  boardId,
}: {
  accountId: Id<"accounts">;
  boardId: Id<"boards">;
}) {
  const soonCards = useQuery(api.entropy.listPostponingSoon, {
    accountId,
    boardId,
  });

  if (!soonCards || soonCards.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-800">
        {soonCards.length} card{soonCards.length === 1 ? "" : "s"} will be
        auto-postponed soon due to inactivity
      </p>
      <ul className="mt-1 space-y-1">
        {soonCards.slice(0, 5).map((card) => (
          <li key={card._id} className="text-xs text-amber-700">
            #{card.number} {card.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Entropy Settings Panel

```tsx
// src/components/EntropySettings.tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/button";
import { useState } from "react";

const PERIOD_OPTIONS = [
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "14 days", ms: 14 * 24 * 60 * 60 * 1000 },
  { label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "60 days", ms: 60 * 24 * 60 * 60 * 1000 },
  { label: "90 days", ms: 90 * 24 * 60 * 60 * 1000 },
];

function msToLabel(ms: number): string {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return `${days} days`;
}

export function EntropySettings({
  accountId,
  boardId,
}: {
  accountId: Id<"accounts">;
  boardId?: Id<"boards">;
}) {
  const period = useQuery(
    api.entropy.getEffectivePeriod,
    boardId ? { accountId, boardId } : "skip"
  );
  const setPeriod = useMutation(api.entropy.setPeriod);

  if (period === undefined) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        Cards inactive for longer than the entropy period are auto-postponed.
        Current: <span className="font-medium">{msToLabel(period)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <Button
            key={opt.ms}
            size="sm"
            variant={period === opt.ms ? "default" : "outline"}
            onClick={() =>
              setPeriod({
                accountId,
                containerId: boardId ?? accountId,
                containerType: boardId ? "board" : "account",
                periodMs: opt.ms,
              })
            }
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

## Notification System

### Creating Notifications

When events happen (card published, comment added, etc.), create notifications for watchers:

```typescript
// convex/notifications.ts
import { mutation, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireAccountAccess } from "./lib/auth";

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    userId: v.id("users"),
    creatorId: v.optional(v.id("users")),
    source: v.union(
      v.object({ type: v.literal("event"), id: v.id("events") }),
      v.object({ type: v.literal("mention"), id: v.id("mentions") }),
    ),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      ...args,
      readAt: undefined,
    });

    // Schedule bundle delivery (30 minutes from now)
    const now = Date.now();
    const bundleWindow = 30 * 60 * 1000;

    // Check if there's already a pending bundle for this user
    const existingBundle = await ctx.db
      .query("notificationBundles")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "pending")
      )
      .first();

    if (!existingBundle) {
      const bundleId = await ctx.db.insert("notificationBundles", {
        accountId: args.accountId,
        userId: args.userId,
        startsAt: now,
        endsAt: now + bundleWindow,
        status: "pending",
      });

      // Schedule delivery at end of window
      await ctx.scheduler.runAfter(
        bundleWindow,
        internal.notifications.deliverBundle,
        { bundleId }
      );
    }

    return notificationId;
  },
});
```

### Delivering Bundles

```typescript
// convex/notifications.ts (continued)
export const deliverBundle = internalMutation({
  args: { bundleId: v.id("notificationBundles") },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (!bundle || bundle.status !== "pending") return;

    await ctx.db.patch(bundleId, { status: "processing" });

    // Get unread notifications in the bundle window
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", bundle.userId))
      .collect();

    const unread = notifications.filter(
      (n) =>
        !n.readAt &&
        n._creationTime >= bundle.startsAt &&
        n._creationTime <= bundle.endsAt
    );

    if (unread.length > 0) {
      // Schedule an action for email delivery
      // await ctx.scheduler.runAfter(0, api.email.sendNotificationBundle, {
      //   userId: bundle.userId,
      //   notificationIds: unread.map((n) => n._id),
      // });
    }

    await ctx.db.patch(bundleId, { status: "delivered" });
  },
});

// Cron fallback: catch any bundles missed by their scheduled function
export const deliverAllBundles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const bundles = await ctx.db
      .query("notificationBundles")
      .withIndex("by_user_status")
      .collect();

    const pending = bundles.filter(
      (b) => b.endsAt < now && b.status === "pending"
    );

    for (const bundle of pending) {
      await ctx.db.patch(bundle._id, { status: "processing" });
      // Process same as deliverBundle...
      await ctx.db.patch(bundle._id, { status: "delivered" });
    }
  },
});
```

### Notification Queries

```typescript
// convex/notifications.ts (continued)
export const list = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);

    // Enrich with source data
    return Promise.all(
      notifications.map(async (n) => {
        let summary = "";
        if (n.source.type === "event") {
          const event = await ctx.db.get(n.source.id);
          summary = event?.action ?? "Unknown event";
        } else {
          summary = "You were mentioned";
        }

        let creatorName = "System";
        if (n.creatorId) {
          const creator = await ctx.db.get(n.creatorId);
          creatorName = creator?.name ?? "Unknown";
        }

        return { ...n, summary, creatorName };
      })
    );
  },
});

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

export const markRead = mutation({
  args: {
    accountId: v.id("accounts"),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, { accountId, notificationId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.userId !== user._id) return;
    await ctx.db.patch(notificationId, { readAt: Date.now() });
  },
});

export const markAllRead = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", user._id).eq("readAt", undefined)
      )
      .collect();

    const now = Date.now();
    for (const n of unread) {
      await ctx.db.patch(n._id, { readAt: now });
    }
  },
});
```

## Frontend: Notification Bell & List

### Unread Count Badge

```tsx
// src/components/NotificationBell.tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function NotificationBell({
  accountId,
  onClick,
}: {
  accountId: Id<"accounts">;
  onClick: () => void;
}) {
  const count = useQuery(api.notifications.unreadCount, { accountId });

  return (
    <button
      onClick={onClick}
      className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
      {count !== undefined && count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
```

The `unreadCount` query is a real-time subscription. When a new notification is created or one is read, the badge updates automatically across all open tabs.

### Notification List

```tsx
// src/components/NotificationList.tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/button";

export function NotificationList({
  accountId,
}: {
  accountId: Id<"accounts">;
}) {
  const notifications = useQuery(api.notifications.list, { accountId });
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);

  if (notifications === undefined) return <p className="p-4 text-sm text-gray-500">Loading...</p>;

  return (
    <div className="w-80">
      <div className="flex items-center justify-between border-b p-3">
        <h3 className="font-semibold">Notifications</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => markAllRead({ accountId })}
        >
          Mark all read
        </Button>
      </div>
      {notifications.length === 0 ? (
        <p className="p-4 text-center text-sm text-gray-400">No notifications</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {notifications.map((n) => (
            <button
              key={n._id}
              onClick={() => {
                if (!n.readAt) markRead({ accountId, notificationId: n._id });
              }}
              className={`block w-full border-b p-3 text-left text-sm hover:bg-gray-50 ${
                n.readAt ? "opacity-60" : "bg-blue-50"
              }`}
            >
              <p className="font-medium">{n.creatorName}</p>
              <p className="text-gray-600">{n.summary}</p>
              <p className="mt-1 text-xs text-gray-400">
                {new Date(n._creationTime).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

## Actions for External APIs

Actions can call external services. Unlike queries and mutations, they're not transactional and can have side effects:

```typescript
// convex/email.ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const sendNotificationBundle = action({
  args: {
    userId: v.id("users"),
    notificationIds: v.array(v.id("notifications")),
  },
  handler: async (ctx, { userId, notificationIds }) => {
    // Actions can't read the DB directly — use ctx.runQuery
    const user = await ctx.runQuery(internal.users.getById, { userId });
    if (!user) return;

    const notifications = await ctx.runQuery(
      internal.notifications.getByIds,
      { ids: notificationIds }
    );

    // Call external email API (e.g., Resend, SendGrid)
    // const response = await fetch("https://api.resend.com/emails", {
    //   method: "POST",
    //   headers: {
    //     Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     from: "Flat Earth <notifications@flatearth.app>",
    //     to: user.email,
    //     subject: `${notifications.length} new notifications`,
    //     html: renderNotificationEmail(notifications),
    //   }),
    // });
  },
});
```

Key pattern: actions can't read the database directly. They call `ctx.runQuery()` and `ctx.runMutation()` to interact with data.

## Cleanup Jobs

### Unused Tag Cleanup

```typescript
// convex/tags.ts (add to existing file)
export const deleteUnused = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db.query("tags").collect();

    for (const tag of tags) {
      const tagging = await ctx.db
        .query("taggings")
        .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
        .first();

      if (!tagging) {
        await ctx.db.delete(tag._id);
      }
    }
  },
});
```

### Stale Webhook Delivery Cleanup

```typescript
// convex/webhooks.ts (add to existing file)
export const cleanupDeliveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const deliveries = await ctx.db.query("webhookDeliveries").collect();

    for (const delivery of deliveries) {
      if (delivery._creationTime < sevenDaysAgo) {
        await ctx.db.delete(delivery._id);
      }
    }
  },
});
```

## Fizzy's Jobs vs Convex

| Fizzy Job | Convex Equivalent |
|-----------|-------------------|
| `Card.auto_postpone_all_due` (hourly) | `entropy.autoPostponeAll` (cron, hourly) |
| `Notification::Bundle.deliver_all` (30 min) | `notifications.deliverAllBundles` (cron, 30 min) |
| `DeleteUnusedTagsJob` (daily at 04:02) | `tags.deleteUnused` (cron, daily) |
| `CleanupWebhookDeliveriesJob` (daily) | `webhooks.cleanupDeliveries` (cron, daily) |
| `Webhook::DeliveryJob` (on event) | `ctx.scheduler.runAfter(0, ...)` |
| `NotificationJob` (on event) | `ctx.scheduler.runAfter(0, ...)` |
| `MentionCreateJob` (on comment) | Direct call in mutation |
| `Board::CleanInaccessibleDataJob` | Direct cleanup in revoke mutation |

No Solid Queue, no Redis, no worker processes. Convex eliminates the job infrastructure entirely.

## Exercise

1. Create `convex/crons.ts` with all recurring jobs
2. Implement the entropy system in `convex/entropy.ts`:
   - `getEffectivePeriod` query
   - `setPeriod` mutation (admin-only)
   - `autoPostponeAll` internal mutation
   - `listPostponingSoon` query
3. Implement notification bundling in `convex/notifications.ts`:
   - `create` mutation (with bundle scheduling)
   - `deliverBundle` internal mutation
   - `list`, `unreadCount`, `markRead`, `markAllRead`
4. Build the `NotificationBell` and `NotificationList` components
5. Add the `EntropyWarning` component to the board page
6. Build the `EntropySettings` panel for admins
7. Test entropy: set a short period (1 minute), create a card with old `lastActiveAt`, run `autoPostponeAll` from the dashboard
8. Test notifications: create one, verify unread count updates in real time

**Result:** Auto-postpone system keeping boards clean, real-time notification bell, and configurable entropy settings.

---

Next: [Module 11 — Production Patterns & Polish](./11-production-patterns.md)
