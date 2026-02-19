import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/workspace')({
  component: WorkspaceRouteComponent,
})

function WorkspaceRouteComponent() {
  return (
    <section className="simple-page">
      <header className="page-header">
        <h1>Workspace</h1>
        <p>Shared operating notes, owner map, and execution boundaries.</p>
      </header>
      <div className="simple-grid">
        <article className="info-tile">
          <h2>Command line</h2>
          <p>Single source for priorities and cross-team commitments.</p>
        </article>
        <article className="info-tile">
          <h2>Cadence</h2>
          <p>Monday planning, Wednesday sync, Friday retrospective close.</p>
        </article>
        <article className="info-tile">
          <h2>Rules</h2>
          <p>Every card has an owner, decision, and visible next action.</p>
        </article>
      </div>
    </section>
  )
}
