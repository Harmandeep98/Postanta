import { lazy, Suspense, useEffect, useState } from 'react'
import { ClerkProvider, SignedIn, SignedOut, SignIn, SignUp } from '@clerk/clerk-react'
import { Moon, Sun } from 'lucide-react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AccountProvider } from './context/AccountContext'
import AppLayout from './layout/AppLayout'
import ToastContainer from './components/ToastContainer'
import { pushToast } from './lib/toast'

// Route-level splitting — each page ships its own chunk, fetched on first visit instead of upfront.
const AccountsPage = lazy(() => import('./pages/AccountsPage'))
const PostsPage = lazy(() => import('./pages/PostsPage'))
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!publishableKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')

const ACCENT = { light: '#0369a1', dark: '#38bdf8' }
// staleTime avoids an instant refetch on every remount/navigation/window-focus —
// data is treated as fresh for 30s before TanStack Query bothers hitting the API again.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
  mutationCache: new MutationCache({
    onError: (err) => pushToast(err.message || 'Something went wrong'),
  }),
})

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  return [theme, setTheme]
}

function App() {
  const [theme, setTheme] = useTheme()
  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light')

  return (
    <ClerkProvider publishableKey={publishableKey} appearance={{ variables: { colorPrimary: ACCENT[theme] } }}>
      <ToastContainer />
      <BrowserRouter>
        <SignedOut>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <Routes>
            <Route
              path="/sign-up/*"
              element={
                <div className="auth-shell">
                  <div className="auth-content">
                    <img src="/logo.png" alt="Postanta" className="auth-logo" />
                    <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
                  </div>
                </div>
              }
            />
            <Route
              path="/sign-in/*"
              element={
                <div className="auth-shell">
                  <div className="auth-content">
                    <img src="/logo.png" alt="Postanta" className="auth-logo" />
                    <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
                  </div>
                </div>
              }
            />
            <Route path="*" element={<Navigate to="/sign-in" replace />} />
          </Routes>
        </SignedOut>

        <SignedIn>
          <QueryClientProvider client={queryClient}>
            <AccountProvider>
              <Suspense fallback={null}>
                <Routes>
                  <Route element={<AppLayout theme={theme} onToggleTheme={toggleTheme} />}>
                    <Route index element={<Navigate to="/accounts" replace />} />
                    <Route path="/sign-in/*" element={<Navigate to="/accounts" replace />} />
                    <Route path="/sign-up/*" element={<Navigate to="/accounts" replace />} />
                    <Route path="accounts" element={<AccountsPage />} />
                    <Route path="posts" element={<PostsPage />} />
                    <Route path="automations" element={<AutomationsPage />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </AccountProvider>
          </QueryClientProvider>
        </SignedIn>
      </BrowserRouter>
    </ClerkProvider>
  )
}

export default App
