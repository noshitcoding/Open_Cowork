import { useMemo, useState } from 'react'
import { useUiStore } from '../stores/uiStore'

type Command = {
  id: string
  label: string
  hint: string
  action: () => void
}

export default function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveMode,
    toggleLeftSidebar,
    leftSidebarOpen,
    toggleTheme,
    theme,
    setShortcutsOverlayOpen,
  } = useUiStore()
  const [query, setQuery] = useState('')

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'switch-work',
        label: 'Zu Arbeitsbereich wechseln',
        hint: 'Ctrl+1',
        action: () => setActiveMode('work'),
      },
      {
        id: 'switch-settings',
        label: 'Zu Einstellungen wechseln',
        hint: 'Ctrl+2',
        action: () => setActiveMode('settings'),
      },
      {
        id: 'toggle-left-sidebar',
        label: leftSidebarOpen
          ? 'Seitenleiste ausblenden'
          : 'Seitenleiste einblenden',
        hint: 'Ctrl+Shift+B',
        action: () => toggleLeftSidebar(),
      },
      {
        id: 'show-shortcuts',
        label: 'Shortcut-Uebersicht anzeigen',
        hint: 'Ctrl+Shift+?',
        action: () => setShortcutsOverlayOpen(true),
      },
      {
        id: 'toggle-theme',
        label: theme === 'light' ? 'Dark Theme aktivieren' : 'Light Theme aktivieren',
        hint: 'Ctrl+Shift+L',
        action: () => toggleTheme(),
      },
    ],
    [leftSidebarOpen, setActiveMode, setShortcutsOverlayOpen, theme, toggleLeftSidebar, toggleTheme]
  )

  const filteredCommands = commands.filter((command) => {
    if (!query.trim()) return true
    const normalizedQuery = query.trim().toLowerCase()
    return (
      command.label.toLowerCase().includes(normalizedQuery) ||
      command.hint.toLowerCase().includes(normalizedQuery)
    )
  })

  if (!commandPaletteOpen) return null

  return (
    <div className="command-palette-overlay" onClick={() => setCommandPaletteOpen(false)}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-header">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Befehl suchen..."
          />
          <button type="button" onClick={() => setCommandPaletteOpen(false)}>
            Esc
          </button>
        </div>
        <ul className="command-palette-list">
          {filteredCommands.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                onClick={() => {
                  command.action()
                  setCommandPaletteOpen(false)
                  setQuery('')
                }}
              >
                <span>{command.label}</span>
                <kbd>{command.hint}</kbd>
              </button>
            </li>
          ))}
          {filteredCommands.length === 0 && (
            <li className="command-palette-empty">Keine Treffer</li>
          )}
        </ul>
      </div>
    </div>
  )
}
