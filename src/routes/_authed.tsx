import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { SignedIn, UserButton } from '@clerk/tanstack-react-start'
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import type { Id } from 'convex/_generated/dataModel'
import {
  ActiveAccountProvider,
  useManagedActiveAccount,
} from '~/utils/useActiveAccount'

export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ context }) => {
    if (!context.userId) {
      throw redirect({ to: '/' })
    }
  },
  component: AuthedLayout,
})

const navLinks = [
  { to: '/boards', label: 'Boards' },
  { to: '/workspace', label: 'Workspace' },
  { to: '/activity', label: 'Activity' },
  { to: '/notifications', label: 'Notifications' },
] as const

function AuthedLayout() {
  const accounts = useQuery(api.accounts.listMyAccounts, {})
  const activeAccountState = useManagedActiveAccount(accounts)
  const { activeAccount, setActiveAccountId } = activeAccountState
  const accountId = activeAccount?._id
  const activeBoards = useQuery(api.boards.list, accountId ? { accountId } : 'skip')
  const canBootstrap = useQuery(api.accounts.canBootstrapFirstOwner, {})
  const redeemJoinCode = useMutation(api.accounts.redeemJoinCode)
  const createWithOwner = useMutation(api.accounts.createWithOwner)

  const [joinCode, setJoinCode] = useState('')
  const [accountName, setAccountName] = useState('First Plane')
  const [installerSecret, setInstallerSecret] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const isLoading = useMemo(
    () => accounts === undefined || canBootstrap === undefined,
    [accounts, canBootstrap],
  )
  const providerValue = useMemo(
    () => ({ ...activeAccountState, activeBoards }),
    [activeAccountState, activeBoards],
  )

  if (isLoading) {
    return <main className="authed-shell">Loading workspace…</main>
  }

  async function onRedeemCode() {
    const normalized = joinCode.trim().toUpperCase()
    if (!normalized) {
      setErrorMessage('Join code is required.')
      return
    }

    setIsPending(true)
    setErrorMessage(null)
    try {
      await redeemJoinCode({ code: normalized })
      setJoinCode('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to redeem code')
    } finally {
      setIsPending(false)
    }
  }

  async function onBootstrap() {
    if (!accountName.trim()) {
      setErrorMessage('Account name is required.')
      return
    }

    setIsPending(true)
    setErrorMessage(null)
    try {
      await createWithOwner({
        accountName: accountName.trim(),
        installerSecret: installerSecret.trim(),
      })
      setInstallerSecret('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to bootstrap workspace')
    } finally {
      setIsPending(false)
    }
  }

  if (!accounts || accounts.length === 0) {
    return (
      <main className="authed-shell">
        <section className="onboard-gate">
          <h2>Account Access Required</h2>
          <p>Redeem a time-limited account code, or bootstrap the first owner workspace.</p>
          <div className="onboard-form">
            <label htmlFor="join-code">Join code</label>
            <input
              id="join-code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="UPPERCASE CODE"
              disabled={isPending}
            />
            <div className="onboard-actions">
              <button type="button" disabled={isPending} onClick={onRedeemCode}>
                Redeem code
              </button>
            </div>
          </div>

          {canBootstrap ? (
            <div className="onboard-form onboard-form-secondary">
              <label htmlFor="account-name">Account name</label>
              <input
                id="account-name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                disabled={isPending}
              />
              <label htmlFor="installer-secret">Installer secret</label>
              <input
                id="installer-secret"
                type="password"
                value={installerSecret}
                onChange={(event) => setInstallerSecret(event.target.value)}
                disabled={isPending}
              />
              <div className="onboard-actions">
                <button type="button" className="secondary" disabled={isPending} onClick={onBootstrap}>
                  Bootstrap first owner
                </button>
              </div>
            </div>
          ) : null}

          {errorMessage ? <p className="field-error">{errorMessage}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <ActiveAccountProvider value={providerValue}>
      <main className="authed-shell">
        <header className="authed-header">
          <div className="authed-identity">
            <p className="shell-kicker">Flat Earth Collective</p>
            <p className="authed-title">Workspace Shell</p>
            <p className="authed-subtitle">
              Mission control for board operations, account activity, and notification flow.
            </p>
          </div>
          <div className="authed-account-switcher">
            <label htmlFor="account-switcher">Account</label>
            <select
              id="account-switcher"
              value={activeAccount?._id}
              onChange={(event) =>
                setActiveAccountId(event.target.value as Id<'accounts'>)
              }
            >
              {accounts.map((account) => (
                <option key={account._id} value={account._id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <SignedIn>
            <div className="authed-user">
              <UserButton />
            </div>
          </SignedIn>
        </header>

        <nav className="authed-nav" aria-label="Primary">
          {navLinks.map((item, index) => (
            <Link
              key={item.to}
              to={item.to}
              className="nav-link"
              activeProps={{ className: 'nav-link nav-link-active' }}
            >
              <span className="nav-link-index">{String(index + 1).padStart(2, '0')}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <section className="authed-content">
          <Outlet />
        </section>
      </main>
    </ActiveAccountProvider>
  )
}
