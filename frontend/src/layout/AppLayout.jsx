import { NavLink, Outlet } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import { Users, CalendarClock, Zap, LayoutDashboard, Moon, Sun } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/accounts', label: 'Accounts', icon: Users },
  { to: '/posts', label: 'Posts', icon: CalendarClock },
  { to: '/automations', label: 'Automations', icon: Zap },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
]

export default function AppLayout({ theme, onToggleTheme }) {
  return (
    <div className="app-shell">
      <header className="navbar">
        <img src="/logo-nav.png" alt="Postanta" className="brand" />
        <nav className="navbar-links">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <item.icon size={17} strokeWidth={2} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="navbar-actions">
          <button type="button" className="theme-toggle-inline" onClick={onToggleTheme} aria-label="Toggle dark mode">
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <UserButton />
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
