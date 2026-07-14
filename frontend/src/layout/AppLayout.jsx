import { NavLink, Outlet } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'

const NAV_ITEMS = [
  { to: '/accounts', label: 'Accounts' },
  { to: '/posts', label: 'Posts' },
  { to: '/automations', label: 'Automations' },
  { to: '/dashboard', label: 'Dashboard' },
]

export default function AppLayout({ theme, onToggleTheme }) {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">Social Media Manager</div>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="content-area">
        <header className="app-header">
          <button type="button" className="theme-toggle-inline" onClick={onToggleTheme} aria-label="Toggle dark mode">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <UserButton />
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
