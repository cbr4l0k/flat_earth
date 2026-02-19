import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({

    accounts: defineTable({
        name: v.string(),
        cardsCount: v.number(),
    }),

    accountJoinCodes: defineTable({
        accountId: v.id("accounts"),
        code: v.string(),
        createdByUserId: v.id("users"),
        createdAt: v.number(),
        expiresAt: v.number(),
        disabledAt: v.optional(v.number()),
        usedAt: v.optional(v.number()),
        usedByUserId: v.optional(v.id("users")),
    })
        .index("by_code", ["code"])
        .index("by_account", ["accountId"])
        .index("by_account_used", ["accountId", "usedAt"])
        .index("by_expires_at", ["expiresAt"]),

    users: defineTable({
        accountId: v.id("accounts"),
        clerkId: v.string(),
        telegramId: v.optional(v.string()),
        name: v.string(),
        role: v.union(
            v.literal("owner"),
            v.literal("admin"),
            v.literal("member"),
        ),
        active: v.boolean(),
    })
        .index("by_account", ["accountId"])
        .index("by_clerk_id", ["clerkId"])
        .index("by_telegram_id", ["telegramId"])
        .index("by_account_clerk", ["accountId", "clerkId"])
        .index("by_account_telegram", ["accountId", "telegramId"])
        .index("by_account_role", ["accountId", "role"]),

    boards: defineTable({
        accountId: v.id("accounts"),
        name: v.string(),
        creatorId: v.id("users"),
        allAccess: v.boolean(),
        publicKey: v.optional(v.string()),
        publicDescription: v.optional(v.string()),
    })
        .index("by_account", ["accountId"])
        .index("by_public_key", ["publicKey"]),

    columns: defineTable({
        accountId: v.id("accounts"),
        boardId: v.id("boards"),
        name: v.string(),
        color: v.string(),
        position: v.number(),
        protected: v.boolean(),
    })
        .index("by_board", ["boardId"])
        .index("by_board_position", ["boardId", "position"]),

    cards: defineTable({
        accountId: v.id("accounts"),
        boardId: v.id("boards"),
        columnId: v.union(v.id("columns"), v.null()),
        creatorId: v.id("users"),
        title: v.string(),
        description: v.optional(v.string()),
        number: v.number(),
        status: v.union(v.literal("drafted"), v.literal("published")),
        dueOn: v.optional(v.string()),
        lastActiveAt: v.number(),
        closedAt: v.optional(v.number()),
        closedBy: v.optional(v.id("users")),
        postponedAt: v.optional(v.number()),
        postponedBy: v.optional(v.id("users")),
        isGolden: v.boolean(),
        activitySpikeAt: v.optional(v.number()),
        imageId: v.optional(v.id("_storage")),
    })
        .index("by_account", ["accountId"])
        .index("by_account_number", ["accountId", "number"])
        .index("by_board", ["boardId"])
        .index("by_column", ["columnId"])
        .index("by_account_status", ["accountId", "status"])
        .index("by_account_activity", ["accountId", "lastActiveAt"])
        .searchIndex("search_cards", {
            searchField: "title",
            filterFields: ["accountId", "boardId"],
        }),

    comments: defineTable({
        accountId: v.id("accounts"),
        cardId: v.id("cards"),
        creatorId: v.id("users"),
        body: v.string(),
        isSystem: v.boolean(),
    })
        .index("by_card", ["cardId"])
        .index("by_account", ["accountId"]),

    assignments: defineTable({
        accountId: v.id("accounts"),
        cardId: v.id("cards"),
        assigneeId: v.id("users"),
        assignerId: v.id("users"),
    })
        .index("by_card", ["cardId"])
        .index("by_assignee", ["assigneeId"])
        .index("by_card_assignee", ["cardId", "assigneeId"]),

    tags: defineTable({
        accountId: v.id("accounts"),
        title: v.string(),
    })
        .index("by_account", ["accountId"])
        .index("by_account_title", ["accountId", "title"]),

    taggings: defineTable({
        accountId: v.id("accounts"),
        cardId: v.id("cards"),
        tagId: v.id("tags"),
    })
        .index("by_card", ["cardId"])
        .index("by_tag", ["tagId"])
        .index("by_card_tag", ["cardId", "tagId"]),

    steps: defineTable({
        accountId: v.id("accounts"),
        cardId: v.id("cards"),
        content: v.string(),
        completed: v.boolean(),
    })
        .index("by_card", ["cardId"]),

    watches: defineTable({
        accountId: v.id("accounts"),
        cardId: v.id("cards"),
        userId: v.id("users"),
        watching: v.boolean(),
    })
        .index("by_card", ["cardId"])
        .index("by_user", ["userId"])
        .index("by_user_card", ["userId", "cardId"]),

    pins: defineTable({
        accountId: v.id("accounts"),
        cardId: v.id("cards"),
        userId: v.id("users"),
    })
        .index("by_user", ["userId"])
        .index("by_card", ["cardId"])
        .index("by_card_user", ["cardId", "userId"]),

    mentions: defineTable({
        accountId: v.id("accounts"),
        source: v.union(
            v.object({ type: v.literal("card"), id: v.id("cards")}),
            v.object({ type: v.literal("comment"), id: v.id("comments")}),
        ),
        mentionerId: v.id("users"),
        mentioneeId: v.id("users"),
    })
        .index("by_mentionee", ["mentioneeId"])
        .index("by_account", ["accountId"]),

    reactions: defineTable({
        accountId: v.id("accounts"),
        commentId: v.id("comments"),
        reacterId: v.id("users"),
        emoji: v.string(),
    })
        .index("by_comment", ["commentId"]),

    accesses: defineTable({
        accountId: v.id("accounts"),
        boardId: v.id("boards"),
        userId: v.id("users"),
        involvement: v.union(
            v.literal("access_only"),
            v.literal("watching")
        ),
        accessedAt: v.optional(v.number()),
    })

        .index("by_board", ["boardId"])
        .index("by_user", ["userId"])
        .index("by_board_user", ["boardId", "userId"]),

    events: defineTable({
        accountId: v.id("accounts"),
        boardId: v.id("boards"),
        creatorId: v.id("users"),
        action: v.string(),
        eventable: v.union(
            v.object({ type: v.literal("card"), id: v.id("cards") }),
            v.object({ type: v.literal("comment"), id: v.id("comments") }),
        ),
        particulars: v.optional(v.any()),
    })
        .index("by_board", ["boardId"])
        .index("by_account_action", ["accountId", "action"]),


    notifications: defineTable({
        accountId: v.id("accounts"),
        userId: v.id("users"),
        creatorId: v.optional(v.id("users")),
        source: v.union(
            v.object({ type: v.literal("event"), id: v.id("events")}),
            v.object({ type: v.literal("mention"), id: v.id("mentions")}),
        ),
        readAt: v.optional(v.number()),
    })
        .index("by_user", ["userId"])
        .index("by_user_read", ["userId", "readAt"]),

    notificationBundles: defineTable({
        accountId: v.id("accounts"),
        userId: v.id("users"),
        startsAt: v.number(),
        endsAt: v.number(),
        status: v.union(
            v.literal("pending"),
            v.literal("processing"),
            v.literal("delivered"),
        ),
    })
        .index("by_user_status", ["userId", "status"])
        .index("by_ends_status", ["endsAt", "status"]),


    entropies: defineTable({
        accountId: v.id("accounts"),
        container: v.union(
            v.object({ type: v.literal("account"), id: v.id("accounts")}),
            v.object({ type: v.literal("board"), id: v.id("boards") }),
        ),
        autoPostponePeriod: v.number(),
    })
        .index("by_account", ["accountId"]),

    webhooks: defineTable({
        accountId: v.id("accounts"),
        boardId: v.id("boards"),
        name: v.string(),
        url: v.string(),
        signingSecret: v.string(),
        subscribedActions: v.array(v.string()),
        active: v.boolean(),
    })
        .index("by_board", ["boardId"]),

    webhookDeliveries: defineTable({
        accountId: v.id("accounts"),
        webhookId: v.id("webhooks"),
        eventId: v.id("events"),
        state: v.union(
            v.literal("pending"),
            v.literal("in_progress"),
            v.literal("completed"),
            v.literal("errored"),
        ),
        request: v.optional(v.string()),
        response: v.optional(v.string()),
    })
        .index("by_webhook", ["webhookId"]),

    filters: defineTable({
        accountId: v.id("accounts"),
        creatorId: v.id("users"),
        paramsDigest: v.string(),
        boardIds: v.array(v.id("boards")),
        tagIds: v.array(v.id("tags")),
        assigneeIds: v.array(v.id("users")),
        assignerIds: v.array(v.id("users")),
        closerIds: v.array(v.id("users")),
        creatorIds: v.array(v.id("users")),
        fields: v.optional(v.any()),
    })
        .index("by_account", ["accountId"])
        .index("by_creator_digest", ["creatorId", "paramsDigest"]),

    searchQueries: defineTable({
        accountId: v.id("accounts"),
        userId: v.id("users"),
        terms: v.string(),
    })
        .index("by_user", ["userId"]),

})
