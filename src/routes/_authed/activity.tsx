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

  if (!accountId || events === undefined) {
    return (
      <section className="simple-page">
        <header className="page-header">
          <h1>Activity</h1>
          <p>Loading account activity…</p>
        </header>
      </section>
    )
  }

  return (
    <section className="simple-page">
      <header className="page-header">
        <h1>Activity</h1>
        <p>Recent account-level events and lane transitions.</p>
      </header>
      <ul className="activity-list">
        {events.length === 0 ? (
          <li>No events yet.</li>
        ) : (
          events.map((event) => (
            <li key={event._id}>
              <strong>{event.action}</strong> · board {event.boardId}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
