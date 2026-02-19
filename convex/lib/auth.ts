import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

export async function requireAuth(ctx: QueryCtx | MutationCtx)
{
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
        throw new ConvexError("Not authenticated");
    }
    return identity;
}

export async function requireAccountAccess(
    ctx: QueryCtx | MutationCtx,
    accountId: Id<"accounts">,
): Promise<Doc<"users">> {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
        throw new ConvexError("Not authenticated");
    }

    const account = await ctx.db.get(accountId);
    if (!account) {
        throw new ConvexError("Account not found!");
    }

    const user = await ctx.db
        .query("users")
        .withIndex("by_account_clerk", (q) =>
            q.eq("accountId", accountId)
                .eq("clerkId", identity.subject)
            )
            .unique();


    if (!user) {
        throw new ConvexError("Not a memeber of this account");
    }

    if (!user.active) {
        throw new ConvexError("User is deactivated");
    }
    return user;
}
