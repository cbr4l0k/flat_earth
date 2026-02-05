# Module 11 — Background Jobs

> **Goal:** Implement scheduled functions, cron jobs, the entropy (auto-postpone) system, notification bundling, and cleanup jobs.
>
> **Reference:** [docs/fizzy-analysis/02-domain-models.md](../fizzy-analysis/02-domain-models.md)

## Convex Scheduling Primitives

Convex replaces Fizzy's Solid Queue (16 job classes, 7 recurring jobs) with two built-in mechanisms:

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

`ctx.scheduler` is available in mutations and actions. The scheduled function runs independently — if the scheduling mutation succeeds, the scheduled function is guaranteed to execute (at-least-once delivery).

### 2. `crons.ts` — Recurring Jobs

Define recurring jobs in a dedicated file:

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every hour
crons.interval(
  "auto-postpone stale cards",
  { hours: 1 },
  internal.entropy.autoPostponeAll,
);

// Every 30 minutes
crons.interval(
  "deliver notification bundles",
  { minutes: 30 },
  internal.notifications.deliverAllBundles,
);

// Daily at 4:02 AM UTC
crons.cron(
  "cleanup unused tags",
  "2 4 * * *",
  internal.tags.deleteUnused,
);

// Daily at 3:00 AM UTC
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

## The Entropy System

This is Fizzy's most distinctive feature. Cards that go inactive for too long automatically get postponed ("Not Now"), preventing boards from filling up with stale items.

### How It Works

1. Every card has a `lastActiveAt` timestamp (updated on events, comments, etc.)
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

    // Check board-level override
    const entropies = await ctx.db
      .query("entropies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

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

    // Find existing entropy record
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

This is the heart of the entropy system:

```typescript
// convex/entropy.ts
export const autoPostponeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get all accounts
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
        // Determine the effective period for this card's board
        const boardEntropy = entropies.find(
          (e) =>
            e.container.type === "board" && e.container.id === card.boardId
        );
        const effectivePeriod = boardEntropy?.autoPostponePeriod ?? accountPeriod;

        // Check if card is past deadline
        if (now - card.lastActiveAt > effectivePeriod) {
          // Auto-postpone
          await ctx.db.patch(card._id, {
            postponedAt: now,
            columnId: null,
            activitySpikeAt: undefined,
            lastActiveAt: now,
          });

          // Track event (use account's system identity or first owner)
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
export const listPostponingSoon = query({
  args: {
    accountId: v.id("accounts"),
    boardId: v.id("boards"),
  },
  handler: async (ctx, { accountId, boardId }) => {
    await requireAccountAccess(ctx, accountId);

    const now = Date.now();

    // Get effective period for this board
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

## Notification Bundling

Fizzy aggregates notifications into 30-minute windows before sending emails. This prevents users from getting one email per event.

### Creating Bundles

When a notification is created, schedule a bundle delivery:

```typescript
// convex/notifications.ts
import { mutation, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

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
      // Create a new bundle window
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
export const deliverBundle = internalMutation({
  args: { bundleId: v.id("notificationBundles") },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (!bundle || bundle.status !== "pending") return;

    // Mark as processing
    await ctx.db.patch(bundleId, { status: "processing" });

    // Get unread notifications for this user in the bundle window
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
      // In a real app, schedule an action to send the email
      // await ctx.scheduler.runAfter(0, api.email.sendNotificationBundle, {
      //   userId: bundle.userId,
      //   notificationIds: unread.map(n => n._id),
      // });
    }

    await ctx.db.patch(bundleId, { status: "delivered" });
  },
});
```

### Delivering All Pending Bundles (Cron Fallback)

The cron job catches any bundles that weren't delivered by their scheduled function:

```typescript
export const deliverAllBundles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const dueBundles = await ctx.db
      .query("notificationBundles")
      .withIndex("by_ends_status", (q) =>
        q.lt("endsAt", now).eq("status", "pending")
      )
      .collect();

    // The index filtering might not work exactly like this for compound
    // range + equality queries, so filter in memory:
    const pending = dueBundles.filter(
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
    // Fetch user data via internal query
    const user = await ctx.runQuery(internal.users.getById, { userId });
    if (!user) return;

    // Fetch notification details
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
// convex/tags.ts
export const deleteUnused = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db.query("tags").collect();

    for (const tag of tags) {
      const taggings = await ctx.db
        .query("taggings")
        .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
        .first();

      if (!taggings) {
        await ctx.db.delete(tag._id);
      }
    }
  },
});
```

### Stale Webhook Delivery Cleanup

```typescript
// convex/webhooks.ts
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

Convex eliminates the job infrastructure entirely. No Solid Queue, no Redis, no worker processes. Scheduled functions and cron jobs are first-class features.

## Exercise: Background Jobs

1. **Create `convex/crons.ts`** with all recurring jobs:
   - Auto-postpone (hourly)
   - Notification bundle delivery (every 30 min)
   - Unused tag cleanup (daily)
   - Stale webhook delivery cleanup (daily)

2. **Implement the entropy system** (`convex/entropy.ts`):
   - `getEffectivePeriod` query
   - `setPeriod` mutation (admin-only)
   - `autoPostponeAll` internal mutation
   - `listPostponingSoon` query

3. **Implement notification bundling** (`convex/notifications.ts`):
   - `create` mutation (with bundle scheduling)
   - `deliverBundle` internal mutation
   - `deliverAllBundles` internal mutation (cron fallback)

4. **Test entropy**:
   - Set a short entropy period (e.g., 1 minute) on an account
   - Create a card with `lastActiveAt` in the past
   - Run `autoPostponeAll` manually from the dashboard
   - Verify the card gets postponed

5. **Test notification bundling**:
   - Create a notification
   - Verify a bundle is created with `pending` status
   - Run `deliverBundle` manually
   - Verify the bundle transitions to `delivered`

---

Next: [Module 12 — TanStack Integration](./12-tanstack-integration.md)
