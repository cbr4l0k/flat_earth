import * as React from 'react'
import { useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import type { Id } from 'convex/_generated/dataModel'

const ACTIVE_ACCOUNT_KEY = 'flat-earth.active-account-id'

export type Account = {
  _id: Id<'accounts'>
  name: string
  role: 'owner' | 'admin' | 'member'
}

type Board = {
  _id: Id<'boards'>
  name: string
}

export type ActiveAccountState = {
  accounts: ReadonlyArray<Account> | undefined
  activeAccount: Account | null
  activeBoards: ReadonlyArray<Board | null> | undefined
  setActiveAccountId: (accountId: Id<'accounts'>) => void
}

const ActiveAccountContext = React.createContext<ActiveAccountState | null>(null)

function readPersistedActiveAccountId() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(ACTIVE_ACCOUNT_KEY) as Id<'accounts'> | null
}

export function useManagedActiveAccount(
  accounts: ReadonlyArray<Account> | undefined,
  activeBoards?: ReadonlyArray<Board | null>,
): ActiveAccountState {
  const [selectedAccountId, setSelectedAccountId] = React.useState<Id<'accounts'> | null>(() =>
    readPersistedActiveAccountId(),
  )

  const activeAccount = React.useMemo(() => {
    if (!accounts || accounts.length === 0) return null

    const selected = selectedAccountId
      ? accounts.find((account) => account._id === selectedAccountId)
      : null
    if (selected) return selected

    return accounts[0]
  }, [accounts, selectedAccountId])

  const activeAccountId = activeAccount?._id ?? null

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!activeAccountId) {
      window.localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
      return
    }

    window.localStorage.setItem(ACTIVE_ACCOUNT_KEY, activeAccountId)
    if (selectedAccountId !== activeAccountId) {
      setSelectedAccountId(activeAccountId)
    }
  }, [activeAccountId, selectedAccountId])

  return React.useMemo(
    () => ({
      accounts,
      activeAccount,
      activeBoards,
      setActiveAccountId: setSelectedAccountId,
    }),
    [accounts, activeAccount, activeBoards],
  )
}

export function ActiveAccountProvider({
  value,
  children,
}: {
  value: ActiveAccountState
  children: React.ReactNode
}) {
  return React.createElement(ActiveAccountContext.Provider, { value }, children)
}

export function useActiveAccount() {
  const context = React.useContext(ActiveAccountContext)
  if (context) {
    return context
  }

  const accounts = useQuery(api.accounts.listMyAccounts, {})
  return useManagedActiveAccount(accounts)
}
