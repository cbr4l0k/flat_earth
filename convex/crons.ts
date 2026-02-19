import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
const internalApi = internal as never as {
  entropy: { autoPostponeAll: never }
  notifications: { deliverAllBundles: never }
  tags: { deleteUnused: never }
  webhooks: { cleanupDeliveries: never }
}

crons.interval('auto-postpone stale cards', { hours: 1 }, internalApi.entropy.autoPostponeAll)
crons.interval(
  'deliver notification bundles',
  { minutes: 30 },
  internalApi.notifications.deliverAllBundles,
)
crons.cron('cleanup unused tags', '2 4 * * *', internalApi.tags.deleteUnused)
crons.cron('cleanup stale webhook deliveries', '0 3 * * *', internalApi.webhooks.cleanupDeliveries)

export default crons
