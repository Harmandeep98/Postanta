import { useSelectedAccount } from '../context/AccountContext'

export default function PostsPage() {
  const { selectedAccountId } = useSelectedAccount()

  if (!selectedAccountId) return <p>Select an account on the Accounts page first.</p>

  return <h1>Posts — coming next</h1>
}
