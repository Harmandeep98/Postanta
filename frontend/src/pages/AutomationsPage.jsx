import { useSelectedAccount } from '../context/AccountContext'

export default function AutomationsPage() {
  const { selectedAccountId } = useSelectedAccount()

  if (!selectedAccountId) return <p>Select an account on the Accounts page first.</p>

  return <h1>Automations — coming next</h1>
}
