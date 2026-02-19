import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const createWithOwner = mutation({
    args: { accountName: v.string() },
    handler: async (ctx, {accountName}) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new ConvexError("Not authenticated");
        const accountId = await ctx.db.insert("accounts", {
            name: accountName,
            cardsCount: 0,
        });

        const userId = await ctx.db.insert("users", {
            accountId,
            clerkId: identity.subject,
            name: identity.name ?? "New User",
            role: "owner",
            active: true,
        });

        const boardId = await ctx.db.insert("boards", {
            accountId,
            name: "First Plane",
            creatorId: userId,
            allAccess: true,
        });

        const defaultColumns = [
            { name: "Later", color: "#00272b", position: 0, protected: true},
            { name: "Done", color: "#e0ff4f", position: 9, protected: true},
        ]

        for ( const col of defaultColumns ) {
            await ctx.db.insert("columns", { accountId, boardId, ...col});
        }

        await ctx.db.insert("accesses", {
            accountId,
            boardId,
            userId,
            involvement: "watching",
        })

        return { accountId, userId, boardId };
    },
});

export const listMyAccounts = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if ( !identity ) return [];

        const users = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .collect();

        const activeUsers = users.filter( (u) => u.active );

        const accounts = await Promise.all(
            activeUsers.map(async (user) => {
                const account = await ctx.db.get(user.accountId);
                return account
                    ? { ...account, role: user.role, userId: user._id }
                    : null;
            })
        );
    }
})
