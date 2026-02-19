import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/workspace')({
  component: WorkspaceRouteComponent,
})

function WorkspaceRouteComponent() {
  return (
    <section className="simple-page workspace-page">
      <header className="page-header">
        <p className="page-eyebrow">Operations Atlas</p>
        <h1>Workspace</h1>
        <p className="page-dek">
          Shared operating notes, owner map, and execution boundaries.
        </p>
      </header>
      <div className="simple-grid workspace-grid">
        <article className="info-tile info-tile-feature">
          <div>
            <h2>Command line</h2>
            <p>Single source for priorities and cross-team commitments.</p>
          </div>
          <p className="workspace-meta">Week 08 editorial brief</p>
        </article>
        <article className="info-tile">
          <h2>Ownership</h2>
          <p>Decision log updates close every Friday at 16:00.</p>
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
