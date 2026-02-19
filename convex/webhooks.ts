import { internalMutation } from './_generated/server'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export const cleanupDeliveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const deliveries = await ctx.db.query('webhookDeliveries').collect()

    for (const delivery of deliveries) {
      if (now - delivery._creationTime > THIRTY_DAYS_MS) {
        await ctx.db.delete("webhookDeliveries", delivery._id)
      }
    }
  },
})
