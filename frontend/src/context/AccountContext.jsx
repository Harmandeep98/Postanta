import { createContext, useContext, useState } from 'react'

const AccountContext = createContext(null)

export function AccountProvider({ children }) {
  const [selectedAccountId, setSelectedAccountId] = useState(
    () => localStorage.getItem('selectedAccountId') || null,
  )

  function selectAccount(id) {
    setSelectedAccountId(id)
    if (id) localStorage.setItem('selectedAccountId', id)
    else localStorage.removeItem('selectedAccountId')
  }

  return (
    <AccountContext.Provider value={{ selectedAccountId, selectAccount }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useSelectedAccount() {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useSelectedAccount must be used within AccountProvider')
  return ctx
}
