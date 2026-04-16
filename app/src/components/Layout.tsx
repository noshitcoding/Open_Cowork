import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

type Props = { children: ReactNode }

const NAV_ITEMS = [
  { to: '/', label: 'Chat' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/mcp', label: 'MCP' },
  { to: '/settings', label: 'Einstellungen' },
]

export default function Layout({ children }: Props) {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-brand">Open_Cowork</div>
        <ul className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'active' : ''}`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">v0.2.0 · MVP</div>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  )
}
