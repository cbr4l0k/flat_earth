import { Link, createFileRoute } from '@tanstack/react-router'
import { SignIn, SignedIn, SignedOut } from '@clerk/tanstack-react-start'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="shell-page">
      <section className="shell-header">
        <p className="shell-kicker">Flat Earth</p>
        <h1 className="shell-title">
          Decision lanes for shared work. Precise, calm, and visible.
        </h1>
      </section>

      <section className="shell-grid">
        <article className="shell-panel">
          <p className="panel-label">System</p>
          <h2>Swiss/International workspace shell</h2>
          <p>
            Route-first dashboard with protected completion lanes and a strict
            onboarding gate.
          </p>
          <SignedIn>
            <Link className="shell-cta" to="/boards">
              Enter workspace
            </Link>
          </SignedIn>
        </article>

        <article className="shell-panel">
          <p className="panel-label">Access</p>
          <h2>Inline login</h2>
          <p>Sign in here to continue into boards, workspace, and activity.</p>
          <SignedOut>
            <div className="signin-inline">
              <SignIn routing="hash" />
            </div>
          </SignedOut>
          <SignedIn>
            <p className="signed-in-note">Signed in. Continue to your board.</p>
          </SignedIn>
        </article>
      </section>
    </main>
  )
}
