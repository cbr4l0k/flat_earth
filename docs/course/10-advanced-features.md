# Module 10 — Advanced Features

> **Goal:** Implement comments, reactions, mentions, assignments, tags, pins, and watches — the collaboration features that make a kanban tool actually useful.
>
> **References:** [docs/fizzy-analysis/02-domain-models.md](../fizzy-analysis/02-domain-models.md), [docs/fizzy-analysis/06-features.md](../fizzy-analysis/06-features.md)

## Comments

### Creating Comments

Comments belong to cards. Rich text is stored as a string (JSON from TipTap, or plain text to start):

```typescript
// convex/comments.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    body: v.string(),
  },
  handler: async (ctx, { accountId, cardId, body }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    const commentId = await ctx.db.insert("comments", {
      accountId,
      cardId,
      creatorId: user._id,
      body,
      isSystem: false,
    });

    // Update card activity
    await ctx.db.patch(cardId, { lastActiveAt: Date.now() });

    // Auto-watch the card for the commenter
    await ensureWatching(ctx, accountId, cardId, user._id);

    // Track event
    await ctx.db.insert("events", {
      accountId,
      boardId: card.boardId,
      creatorId: user._id,
      action: "comment_created",
      eventable: { type: "comment", id: commentId },
    });

    return commentId;
  },
});

// Helper: ensure user is watching a card
async function ensureWatching(
  ctx: any,
  accountId: any,
  cardId: any,
  userId: any,
) {
  const existing = await ctx.db
    .query("watches")
    .withIndex("by_user_card", (q: any) =>
      q.eq("userId", userId).eq("cardId", cardId)
    )
    .unique();

  if (!existing) {
    await ctx.db.insert("watches", {
      accountId,
      cardId,
      userId,
      watching: true,
    });
  } else if (!existing.watching) {
    await ctx.db.patch(existing._id, { watching: true });
  }
}
```

### Listing Comments

Chronological order — oldest first, like a conversation:

```typescript
export const listByCard = query({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();

    // Enrich with creator names
    const enriched = await Promise.all(
      comments.map(async (comment) => {
        const creator = await ctx.db.get(comment.creatorId);
        return {
          ...comment,
          creatorName: creator?.name ?? "Unknown",
        };
      })
    );

    return enriched;
  },
});
```

### System Comments

Fizzy auto-generates system comments for certain events (card closed, reopened, etc.). These appear in the comment thread as timeline markers:

```typescript
export const createSystem = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    body: v.string(),
    creatorId: v.id("users"),
  },
  handler: async (ctx, { accountId, cardId, body, creatorId }) => {
    // This is an internal mutation — called from lifecycle mutations
    return ctx.db.insert("comments", {
      accountId,
      cardId,
      creatorId,
      body,
      isSystem: true,
    });
  },
});
```

### Deleting Comments

```typescript
export const remove = mutation({
  args: {
    accountId: v.id("accounts"),
    commentId: v.id("comments"),
  },
  handler: async (ctx, { accountId, commentId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const comment = await ctx.db.get(commentId);
    if (!comment || comment.accountId !== accountId) {
      throw new ConvexError("Comment not found");
    }

    // Only creator or admins can delete
    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && comment.creatorId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    // Delete reactions on this comment
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect();
    for (const r of reactions) {
      await ctx.db.delete(r._id);
    }

    await ctx.db.delete(commentId);
  },
});
```

## Emoji Reactions

### Adding/Removing Reactions

Toggle pattern — same emoji by same user removes it:

```typescript
// convex/reactions.ts
export const toggle = mutation({
  args: {
    accountId: v.id("accounts"),
    commentId: v.id("comments"),
    emoji: v.string(),
  },
  handler: async (ctx, { accountId, commentId, emoji }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const comment = await ctx.db.get(commentId);
    if (!comment || comment.accountId !== accountId) {
      throw new ConvexError("Comment not found");
    }

    // Check if user already reacted with this emoji
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect();

    const existing = reactions.find(
      (r) => r.reacterId === user._id && r.emoji === emoji
    );

    if (existing) {
      // Remove reaction
      await ctx.db.delete(existing._id);
    } else {
      // Add reaction
      await ctx.db.insert("reactions", {
        accountId,
        commentId,
        reacterId: user._id,
        emoji,
      });

      // Register card activity
      const card = await ctx.db.get(comment.cardId);
      if (card) {
        await ctx.db.patch(card._id, { lastActiveAt: Date.now() });
      }
    }
  },
});

export const listByComment = query({
  args: {
    accountId: v.id("accounts"),
    commentId: v.id("comments"),
  },
  handler: async (ctx, { accountId, commentId }) => {
    await requireAccountAccess(ctx, accountId);

    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect();

    // Group by emoji
    const grouped: Record<string, { emoji: string; count: number; reacterIds: string[] }> = {};
    for (const r of reactions) {
      if (!grouped[r.emoji]) {
        grouped[r.emoji] = { emoji: r.emoji, count: 0, reacterIds: [] };
      }
      grouped[r.emoji].count++;
      grouped[r.emoji].reacterIds.push(r.reacterId);
    }

    return Object.values(grouped);
  },
});
```

## Mentions

### Parsing Mentions

When a comment contains `@username`, create mention records. In a real implementation, the rich text editor (TipTap) would embed user references. For now, we'll use a simple pattern:

```typescript
// convex/mentions.ts
export const createFromComment = mutation({
  args: {
    accountId: v.id("accounts"),
    commentId: v.id("comments"),
    mentioneeIds: v.array(v.id("users")),
  },
  handler: async (ctx, { accountId, commentId, mentioneeIds }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const comment = await ctx.db.get(commentId);
    if (!comment || comment.accountId !== accountId) {
      throw new ConvexError("Comment not found");
    }

    for (const mentioneeId of mentioneeIds) {
      // Don't create self-mentions
      if (mentioneeId === user._id) continue;

      const mentionee = await ctx.db.get(mentioneeId);
      if (!mentionee || mentionee.accountId !== accountId) continue;

      await ctx.db.insert("mentions", {
        accountId,
        source: { type: "comment", id: commentId },
        mentionerId: user._id,
        mentioneeId,
      });

      // Auto-watch the card for the mentionee
      await ensureWatching(ctx, accountId, comment.cardId, mentioneeId);
    }
  },
});
```

## Assignments

### Toggle Assignment

Fizzy uses a toggle pattern — assign or unassign with the same action:

```typescript
// convex/assignments.ts
const ASSIGNMENT_LIMIT = 100;

export const toggle = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    assigneeId: v.id("users"),
  },
  handler: async (ctx, { accountId, cardId, assigneeId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    // Check if already assigned
    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_card_assignee", (q) =>
        q.eq("cardId", cardId).eq("assigneeId", assigneeId)
      )
      .unique();

    if (existing) {
      // Unassign
      await ctx.db.delete(existing._id);

      await ctx.db.insert("events", {
        accountId,
        boardId: card.boardId,
        creatorId: user._id,
        action: "card_unassigned",
        eventable: { type: "card", id: cardId },
        particulars: { assigneeIds: [assigneeId] },
      });
    } else {
      // Check limit
      const currentAssignments = await ctx.db
        .query("assignments")
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect();

      if (currentAssignments.length >= ASSIGNMENT_LIMIT) {
        throw new ConvexError(`Maximum ${ASSIGNMENT_LIMIT} assignees per card`);
      }

      // Verify assignee exists in this account
      const assignee = await ctx.db.get(assigneeId);
      if (!assignee || assignee.accountId !== accountId) {
        throw new ConvexError("User not found");
      }

      // Assign
      await ctx.db.insert("assignments", {
        accountId,
        cardId,
        assigneeId,
        assignerId: user._id,
      });

      // Auto-watch for the assignee
      await ensureWatching(ctx, accountId, cardId, assigneeId);

      await ctx.db.patch(cardId, { lastActiveAt: Date.now() });

      await ctx.db.insert("events", {
        accountId,
        boardId: card.boardId,
        creatorId: user._id,
        action: "card_assigned",
        eventable: { type: "card", id: cardId },
        particulars: { assigneeIds: [assigneeId] },
      });
    }
  },
});

export const listByCard = query({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);

    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();

    return Promise.all(
      assignments.map(async (a) => {
        const assignee = await ctx.db.get(a.assigneeId);
        return {
          ...a,
          assigneeName: assignee?.name ?? "Unknown",
        };
      })
    );
  },
});
```

## Tags

### Toggle Tag

Tags are account-scoped. Created on-demand when first used:

```typescript
// convex/tags.ts
export const toggleOnCard = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    title: v.string(),
  },
  handler: async (ctx, { accountId, cardId, title }) => {
    await requireAccountAccess(ctx, accountId);

    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) {
      throw new ConvexError("Card not found");
    }

    // Normalize tag title
    const normalized = title.toLowerCase().replace(/^#/, "").trim();
    if (!normalized) throw new ConvexError("Tag title is required");

    // Find or create tag
    let tag = await ctx.db
      .query("tags")
      .withIndex("by_account_title", (q) =>
        q.eq("accountId", accountId).eq("title", normalized)
      )
      .unique();

    if (!tag) {
      const tagId = await ctx.db.insert("tags", {
        accountId,
        title: normalized,
      });
      tag = (await ctx.db.get(tagId))!;
    }

    // Check if tagging exists
    const existing = await ctx.db
      .query("taggings")
      .withIndex("by_card_tag", (q) =>
        q.eq("cardId", cardId).eq("tagId", tag!._id)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("taggings", {
        accountId,
        cardId,
        tagId: tag._id,
      });
    }

    await ctx.db.patch(cardId, { lastActiveAt: Date.now() });
  },
});

export const listByAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireAccountAccess(ctx, accountId);

    return ctx.db
      .query("tags")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
  },
});

export const listByCard = query({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);

    const taggings = await ctx.db
      .query("taggings")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();

    return Promise.all(
      taggings.map(async (t) => {
        const tag = await ctx.db.get(t.tagId);
        return tag ? { ...t, title: tag.title } : null;
      })
    ).then((results) => results.filter(Boolean));
  },
});
```

## Pins

### User-Specific Quick Access

```typescript
// convex/pins.ts
export const toggle = mutation({
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

    const existing = await ctx.db
      .query("pins")
      .withIndex("by_card_user", (q) =>
        q.eq("cardId", cardId).eq("userId", user._id)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("pins", {
        accountId,
        cardId,
        userId: user._id,
      });
    }
  },
});

export const listMy = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const pins = await ctx.db
      .query("pins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return Promise.all(
      pins.map(async (pin) => {
        const card = await ctx.db.get(pin.cardId);
        return card ? { ...pin, card } : null;
      })
    ).then((results) => results.filter(Boolean));
  },
});
```

## Watches

### Auto-Watch Rules

In Fizzy, users auto-watch a card when they:
- Create it
- Comment on it
- Get assigned to it
- Get mentioned on it

We've already integrated auto-watch into the comment and assignment mutations via `ensureWatching`. Add explicit toggle:

```typescript
// convex/watches.ts
export const toggle = mutation({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const existing = await ctx.db
      .query("watches")
      .withIndex("by_user_card", (q) =>
        q.eq("userId", user._id).eq("cardId", cardId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { watching: !existing.watching });
    } else {
      await ctx.db.insert("watches", {
        accountId,
        cardId,
        userId: user._id,
        watching: true,
      });
    }
  },
});

export const isWatching = query({
  args: {
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId);

    const watch = await ctx.db
      .query("watches")
      .withIndex("by_user_card", (q) =>
        q.eq("userId", user._id).eq("cardId", cardId)
      )
      .unique();

    return watch?.watching ?? false;
  },
});
```

## Exercise: Collaboration Features

Implement all the features from this module:

1. **Comments** (`convex/comments.ts`): `create`, `listByCard`, `remove` + system comment support

2. **Reactions** (`convex/reactions.ts`): `toggle`, `listByComment`

3. **Assignments** (`convex/assignments.ts`): `toggle`, `listByCard` (with 100-assignee limit)

4. **Tags** (`convex/tags.ts`): `toggleOnCard`, `listByAccount`, `listByCard`

5. **Pins** (`convex/pins.ts`): `toggle`, `listMy`

6. **Watches** (`convex/watches.ts`): `toggle`, `isWatching`

7. **Test the complete flow**:
   - Create a card, add comments, verify chronological order
   - Add emoji reactions to a comment, toggle off
   - Assign users (test the 100 limit with a loop)
   - Tag a card, create tags on-demand
   - Pin a card, list pins
   - Verify auto-watch triggers (comment, assign)

---

Next: [Module 11 — Background Jobs](./11-background-jobs.md)
