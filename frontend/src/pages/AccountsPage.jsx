import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApiClient } from '../lib/api'
import { useSelectedAccount } from '../context/AccountContext'

export default function AccountsPage() {
  const api = useApiClient()
  const queryClient = useQueryClient()
  const { selectedAccountId, selectAccount } = useSelectedAccount()

  const { data: accounts, isLoading, error } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts'),
  })

  const connect = useMutation({
    mutationFn: () => api.get('/auth/instagram'),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
  })

  const disconnect = useMutation({
    mutationFn: (id) => api.del(`/accounts/${id}`),
    onSuccess: (_, id) => {
      if (selectedAccountId === id) selectAccount(null)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  if (isLoading) return <p>Loading accounts…</p>
  if (error) return <p className="error">{error.message}</p>

  return (
    <div>
      <div className="page-header">
        <h1>Accounts</h1>
        <button type="button" onClick={() => connect.mutate()} disabled={connect.isPending}>
          {connect.isPending ? 'Redirecting…' : 'Connect Instagram'}
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="empty-state">No connected accounts yet — click "Connect Instagram" above.</div>
      ) : (
        <ul className="account-list">
          {accounts.map((account) => (
            <li key={account.id} className={account.id === selectedAccountId ? 'selected' : ''}>
              <label>
                <input
                  type="radio"
                  name="selectedAccount"
                  checked={account.id === selectedAccountId}
                  onChange={() => selectAccount(account.id)}
                />
                @{account.instagramUsername}
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => disconnect.mutate(account.id)}
                disabled={disconnect.isPending}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
