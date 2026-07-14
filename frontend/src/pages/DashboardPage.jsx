import { useSelectedAccount } from '../context/AccountContext'

export default function DashboardPage() {
  const { selectedAccountId } = useSelectedAccount()

  if (!selectedAccountId) return <p>Select an account on the Accounts page first.</p>

  return <h1>Dashboard — coming next</h1>
}
