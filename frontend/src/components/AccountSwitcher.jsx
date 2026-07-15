import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiClient } from '../lib/api'
import { useSelectedAccount } from '../context/AccountContext'

export default function AccountSwitcher() {
  const api = useApiClient()
  const { selectedAccountId, selectAccount } = useSelectedAccount()
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get('/accounts') })

  useEffect(() => {
    if (!accounts?.length) return
    if (!accounts.some((a) => a.id === selectedAccountId)) {
      selectAccount(accounts[0].id)
    }
  }, [accounts, selectedAccountId, selectAccount])

  if (!accounts?.length) return null

  return (
    <select
      className="account-switcher"
      value={selectedAccountId ?? ''}
      onChange={(e) => selectAccount(e.target.value)}
      aria-label="Selected Instagram account"
    >
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          @{account.instagramUsername}
        </option>
      ))}
    </select>
  )
}
