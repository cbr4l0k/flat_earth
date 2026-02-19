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
        )
        return boards.filter(Boolean);
    },
});

export const get = query({
    args: { accountId: v.id("accounts"), boardId: v.id("boards")},
    handler: async (ctx, { accountId, boardId }) => {
        await requireAccountAccess(ctx, accountId);
        const board = await ctx.db.get(boardId);
        if (!board || board.accountId !== accountId) return null;
        return board;
    }
})
