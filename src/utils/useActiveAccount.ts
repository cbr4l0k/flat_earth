import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import type { Id } from 'convex/_generated/dataModel'

const ACTIVE_ACCOUNT_KEY = 'flat-earth.active-account-id'

type Account = {
  _id: Id<'accounts'>
  name: string
  role: 'owner' | 'admin' | 'member'
}

export function useActiveAccount() {
  const accounts = useQuery(api.accounts.listMyAccounts, {})

  const activeAccount = useMemo(() => {
    if (!accounts || accounts.length === 0) return null

    const persistedId =
      typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(ACTIVE_ACCOUNT_KEY)
    const persisted = accounts.find((account) => account._id === persistedId)
    if (persisted) return persisted as Account

    return accounts[0] as Account
  }, [accounts])

  function setActiveAccountId(accountId: Id<'accounts'>) {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId)
    }
  }

  return {
    accounts,
    activeAccount,
    setActiveAccountId,
  }
}
