# Module 09 — Collaboration Features

> **What you'll see running:** A comment thread on each card with real-time updates, emoji reaction buttons, @mention autocomplete, assignee avatars, tag chips, pin bookmarks, and watch indicators.
>
> **References:** [docs/fizzy-analysis/02-domain-models.md](../fizzy-analysis/02-domain-models.md), [docs/fizzy-analysis/06-features.md](../fizzy-analysis/06-features.md)

## Comments

### Backend

```typescript
// convex/comments.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

async function ensureWatching(ctx: any, accountId: any, cardId: any, userId: any) {
  const existing = await ctx.db
    .query("watches")
    .withIndex("by_user_card", (q: any) =>
      q.eq("userId", userId).eq("cardId", cardId)
    )
    .unique();
  if (!existing) {
    await ctx.db.insert("watches", { accountId, cardId, userId, watching: true });
  } else if (!existing.watching) {
    await ctx.db.patch(existing._id, { watching: true });
  }
}

export const create = mutation({
  args: { accountId: v.id("accounts"), cardId: v.id("cards"), body: v.string() },
  handler: async (ctx, { accountId, cardId, body }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) throw new ConvexError("Card not found");

    const commentId = await ctx.db.insert("comments", {
      accountId, cardId, creatorId: user._id, body, isSystem: false,
    });

    await ctx.db.patch(cardId, { lastActiveAt: Date.now() });
    await ensureWatching(ctx, accountId, cardId, user._id);

    await ctx.db.insert("events", {
      accountId, boardId: card.boardId, creatorId: user._id,
      action: "comment_created", eventable: { type: "comment", id: commentId },
    });

    return commentId;
  },
});

export const listByCard = query({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();

    return Promise.all(
      comments.map(async (comment) => {
        const creator = await ctx.db.get(comment.creatorId);
        return { ...comment, creatorName: creator?.name ?? "Unknown" };
      })
    );
  },
});

export const remove = mutation({
  args: { accountId: v.id("accounts"), commentId: v.id("comments") },
  handler: async (ctx, { accountId, commentId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const comment = await ctx.db.get(commentId);
    if (!comment || comment.accountId !== accountId) throw new ConvexError("Comment not found");

    const isAdmin = user.role === "owner" || user.role === "admin";
    if (!isAdmin && comment.creatorId !== user._id) throw new ConvexError("Not authorized");

    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect();
    for (const r of reactions) await ctx.db.delete(r._id);

    await ctx.db.delete(commentId);
  },
});
```

### Frontend: Comment Thread

```tsx
// src/components/CommentThread.tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/button";
import { useState } from "react";

export function CommentThread({
  accountId,
  cardId,
}: {
  accountId: Id<"accounts">;
  cardId: Id<"cards">;
}) {
  const comments = useQuery(api.comments.listByCard, { accountId, cardId });
  const addComment = useMutation(api.comments.create);
  const [body, setBody] = useState("");

  return (
    <div className="space-y-4">
      <h4 className="font-semibold">Comments</h4>

      <div className="space-y-3">
        {comments?.map((comment) => (
          <div
            key={comment._id}
            className={`rounded p-3 ${comment.isSystem ? "bg-gray-50 text-sm italic text-gray-500" : "bg-white border"}`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium">{comment.creatorName}</span>
              <span className="text-xs text-gray-400">
                {new Date(comment._creationTime).toLocaleString()}
              </span>
            </div>
            <p className="text-sm">{comment.body}</p>
            <ReactionBar accountId={accountId} commentId={comment._id} />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          placeholder="Write a comment..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && body.trim()) {
              addComment({ accountId, cardId, body: body.trim() });
              setBody("");
            }
          }}
        />
        <Button
          size="sm"
          onClick={() => {
            if (!body.trim()) return;
            addComment({ accountId, cardId, body: body.trim() });
            setBody("");
          }}
        >
          Post
        </Button>
      </div>
    </div>
  );
}
```

## Emoji Reactions

### Backend

```typescript
// convex/reactions.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

export const toggle = mutation({
  args: { accountId: v.id("accounts"), commentId: v.id("comments"), emoji: v.string() },
  handler: async (ctx, { accountId, commentId, emoji }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const comment = await ctx.db.get(commentId);
    if (!comment || comment.accountId !== accountId) throw new ConvexError("Comment not found");

    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect();

    const existing = reactions.find(
      (r) => r.reacterId === user._id && r.emoji === emoji
    );

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("reactions", { accountId, commentId, reacterId: user._id, emoji });
    }
  },
});

export const listByComment = query({
  args: { accountId: v.id("accounts"), commentId: v.id("comments") },
  handler: async (ctx, { accountId, commentId }) => {
    await requireAccountAccess(ctx, accountId);
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_comment", (q) => q.eq("commentId", commentId))
      .collect();

    const grouped: Record<string, { emoji: string; count: number; reacterIds: string[] }> = {};
    for (const r of reactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, reacterIds: [] };
      grouped[r.emoji].count++;
      grouped[r.emoji].reacterIds.push(r.reacterId);
    }
    return Object.values(grouped);
  },
});
```

### Frontend: Reaction Bar

```tsx
function ReactionBar({ accountId, commentId }: { accountId: Id<"accounts">; commentId: Id<"comments"> }) {
  const reactions = useQuery(api.reactions.listByComment, { accountId, commentId });
  const toggle = useMutation(api.reactions.toggle);

  const emojis = ["👍", "❤️", "😂", "🎉", "🤔", "👀"];

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {reactions?.map((r) => (
        <button
          key={r.emoji}
          onClick={() => toggle({ accountId, commentId, emoji: r.emoji })}
          className="rounded-full border px-2 py-0.5 text-xs hover:bg-gray-100"
        >
          {r.emoji} {r.count}
        </button>
      ))}
      <button
        onClick={() => toggle({ accountId, commentId, emoji: emojis[0] })}
        className="rounded-full border px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100"
      >
        +
      </button>
    </div>
  );
}
```

## Assignments

### Backend

```typescript
// convex/assignments.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

const ASSIGNMENT_LIMIT = 100;

export const toggle = mutation({
  args: { accountId: v.id("accounts"), cardId: v.id("cards"), assigneeId: v.id("users") },
  handler: async (ctx, { accountId, cardId, assigneeId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) throw new ConvexError("Card not found");

    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_card_assignee", (q) =>
        q.eq("cardId", cardId).eq("assigneeId", assigneeId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      const count = await ctx.db
        .query("assignments")
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect();
      if (count.length >= ASSIGNMENT_LIMIT) {
        throw new ConvexError(`Max ${ASSIGNMENT_LIMIT} assignees per card`);
      }

      const assignee = await ctx.db.get(assigneeId);
      if (!assignee || assignee.accountId !== accountId) throw new ConvexError("User not found");

      await ctx.db.insert("assignments", {
        accountId, cardId, assigneeId, assignerId: user._id,
      });
      await ctx.db.patch(cardId, { lastActiveAt: Date.now() });
    }
  },
});

export const listByCard = query({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    await requireAccountAccess(ctx, accountId);
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_card", (q) => q.eq("cardId", cardId))
      .collect();
    return Promise.all(
      assignments.map(async (a) => {
        const assignee = await ctx.db.get(a.assigneeId);
        return { ...a, assigneeName: assignee?.name ?? "Unknown" };
      })
    );
  },
});
```

## Tags

### Backend

```typescript
// convex/tags.ts
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAccountAccess } from "./lib/auth";

export const toggleOnCard = mutation({
  args: { accountId: v.id("accounts"), cardId: v.id("cards"), title: v.string() },
  handler: async (ctx, { accountId, cardId, title }) => {
    await requireAccountAccess(ctx, accountId);
    const card = await ctx.db.get(cardId);
    if (!card || card.accountId !== accountId) throw new ConvexError("Card not found");

    const normalized = title.toLowerCase().replace(/^#/, "").trim();
    if (!normalized) throw new ConvexError("Tag title is required");

    let tag = await ctx.db
      .query("tags")
      .withIndex("by_account_title", (q) =>
        q.eq("accountId", accountId).eq("title", normalized)
      )
      .unique();

    if (!tag) {
      const tagId = await ctx.db.insert("tags", { accountId, title: normalized });
      tag = (await ctx.db.get(tagId))!;
    }

    const existing = await ctx.db
      .query("taggings")
      .withIndex("by_card_tag", (q) =>
        q.eq("cardId", cardId).eq("tagId", tag!._id)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("taggings", { accountId, cardId, tagId: tag._id });
    }

    await ctx.db.patch(cardId, { lastActiveAt: Date.now() });
  },
});

export const listByCard = query({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
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
    ).then((r) => r.filter(Boolean));
  },
});

export const listByAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireAccountAccess(ctx, accountId);
    return ctx.db.query("tags").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect();
  },
});
```

### Frontend: Tag Input

```tsx
// src/components/TagInput.tsx
export function TagInput({ accountId, cardId }: { accountId: Id<"accounts">; cardId: Id<"cards"> }) {
  const tags = useQuery(api.tags.listByCard, { accountId, cardId });
  const allTags = useQuery(api.tags.listByAccount, { accountId });
  const toggleTag = useMutation(api.tags.toggleOnCard);
  const [input, setInput] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tags?.map((tag) => (
          <span
            key={tag._id}
            onClick={() => toggleTag({ accountId, cardId, title: tag.title })}
            className="cursor-pointer rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-200"
          >
            #{tag.title} ×
          </span>
        ))}
      </div>
      <input
        className="w-full rounded border px-3 py-1 text-sm"
        placeholder="Add tag..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) {
            toggleTag({ accountId, cardId, title: input.trim() });
            setInput("");
          }
        }}
      />
    </div>
  );
}
```

## Pins and Watches

### Backend

```typescript
// convex/pins.ts
export const toggle = mutation({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const existing = await ctx.db
      .query("pins")
      .withIndex("by_card_user", (q) => q.eq("cardId", cardId).eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    else await ctx.db.insert("pins", { accountId, cardId, userId: user._id });
  },
});

export const listMy = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const pins = await ctx.db.query("pins").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return Promise.all(
      pins.map(async (p) => {
        const card = await ctx.db.get(p.cardId);
        return card ? { ...p, card } : null;
      })
    ).then((r) => r.filter(Boolean));
  },
});

// convex/watches.ts
export const toggle = mutation({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const existing = await ctx.db
      .query("watches")
      .withIndex("by_user_card", (q) => q.eq("userId", user._id).eq("cardId", cardId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { watching: !existing.watching });
    else await ctx.db.insert("watches", { accountId, cardId, userId: user._id, watching: true });
  },
});

export const isWatching = query({
  args: { accountId: v.id("accounts"), cardId: v.id("cards") },
  handler: async (ctx, { accountId, cardId }) => {
    const user = await requireAccountAccess(ctx, accountId);
    const watch = await ctx.db
      .query("watches")
      .withIndex("by_user_card", (q) => q.eq("userId", user._id).eq("cardId", cardId))
      .unique();
    return watch?.watching ?? false;
  },
});
```

## Exercise

1. Implement comments (`convex/comments.ts`): `create`, `listByCard`, `remove` with auto-watch
2. Implement reactions (`convex/reactions.ts`): `toggle`, `listByComment`
3. Implement assignments (`convex/assignments.ts`): `toggle`, `listByCard`
4. Implement tags (`convex/tags.ts`): `toggleOnCard`, `listByCard`, `listByAccount`
5. Implement pins and watches
6. Build `CommentThread`, `ReactionBar`, `TagInput` components
7. Add these to the card detail panel from Module 06
8. Test: add a comment, add a reaction, assign a user, tag a card, pin a card

**Result:** A card detail panel with comments, reactions, tags, assignments, and pins — all updating in real time.

---

Next: [Module 10 — Background Jobs & Entropy](./10-background-jobs.md)
