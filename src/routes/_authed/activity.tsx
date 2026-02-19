import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import { useActiveAccount } from '~/utils/useActiveAccount'

export const Route = createFileRoute('/_authed/activity')({
  component: ActivityRouteComponent,
})

function ActivityRouteComponent() {
  const { activeAccount } = useActiveAccount()
  const accountId = activeAccount?._id
  const events = useQuery(api.events.listRecent, accountId ? { accountId } : 'skip')
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  if (!accountId || events === undefined) {
    return (
      <section className="simple-page">
        <header className="page-header">
          <p className="page-eyebrow">Signal Log</p>
          <h1>Activity</h1>
          <p className="page-dek">Loading account activity…</p>
        </header>
      </section>
    )
  }

  return (
    <section className="simple-page">
      <header className="page-header">
        <p className="page-eyebrow">Signal Log</p>
        <h1>Activity</h1>
        <p className="page-dek">Recent account-level events and lane transitions.</p>
      </header>
      <ul className="activity-list">
        {events.length === 0 ? (
          <li className="activity-empty">No events yet.</li>
        ) : (
          events.map((event) => (
            <li key={event._id}>
              <p className="activity-meta">{dateFormatter.format(new Date(event._creationTime))}</p>
              <p className="activity-action">{event.action}</p>
              <p className="activity-context">Board {event.boardId}</p>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
