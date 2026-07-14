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
      <nav className="sidebar">
        <div className="brand">Social Media Manager</div>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                <item.icon size={18} strokeWidth={2} aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="content-area">
        <header className="app-header">
          <button type="button" className="theme-toggle-inline" onClick={onToggleTheme} aria-label="Toggle dark mode">
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
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
