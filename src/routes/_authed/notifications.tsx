import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import { useActiveAccount } from '~/utils/useActiveAccount'

export const Route = createFileRoute('/_authed/notifications')({
  component: NotificationsRouteComponent,
})

function NotificationsRouteComponent() {
  const { activeAccount } = useActiveAccount()
  const accountId = activeAccount?._id
  const notifications = useQuery(
    api.notifications.list,
    accountId ? { accountId } : 'skip',
  )
  const unreadCount = useQuery(
    api.notifications.unreadCount,
    accountId ? { accountId } : 'skip',
  )
  const markRead = useMutation(api.notifications.markRead)
  const markAllRead = useMutation(api.notifications.markAllRead)

  if (!accountId || notifications === undefined || unreadCount === undefined) {
    return (
      <section className="simple-page">
        <header className="page-header">
          <h1>Notifications</h1>
          <p>Loading account notifications…</p>
        </header>
      </section>
    )
  }

  return (
    <section className="simple-page">
      <header className="page-header">
        <h1>Notifications</h1>
        <p>{unreadCount} unread in this account.</p>
      </header>

      <div className="onboard-actions">
        <button type="button" onClick={() => markAllRead({ accountId })}>
          Mark all read
        </button>
      </div>

      <div className="notification-table">
        {notifications.length === 0 ? (
          <article className="notification-row">
            <h2>No notifications</h2>
            <p>New mentions and events will appear here.</p>
            <span>Idle</span>
          </article>
        ) : (
          notifications.map((notification) => (
            <article key={notification._id} className="notification-row">
              <h2>{notification.source.type}</h2>
              <p>Source #{notification.source.id}</p>
              <span>{notification.readAt ? 'Read' : 'Unread'}</span>
              {!notification.readAt ? (
                <button
                  type="button"
                  className="text-action"
                  onClick={() =>
                    markRead({
                      accountId,
                      notificationId: notification._id,
                    })
                  }
                >
                  Mark read
                </button>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  )
}
