import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '../stores/uiStore'
import { useCommandRegistry, type SlashCommandCategory } from '../stores/commandRegistryStore'
import { tr } from '../i18n'

const CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  navigation: '🧭 Navigation',
  workspace: '📁 Workspace',
  agent: '🤖 Agent',
  model: '⚡ Model',
  memory: '🧠 Memory',
  tools: '🔧 Tools',
  session: '💬 Session',
  config: '?? Configuration',
  security: '🔒 security',
  display: '🎨 Anzeige',
  plugins: '🔌 Plugins',
  crew: '🚀 Crew AI',
  debug: '🐛 Debug',
  export: '📤 Export',
}

const CATEGORY_ORDER: SlashCommandCategory[] = [
  'navigation', 'workspace', 'agent', 'crew', 'model', 'memory',
  'session', 'tools', 'plugins', 'config', 'security', 'display', 'export', 'debug',
]

export default function CommandPalette() {
  const navigate = useNavigate()
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    toggleLeftSidebar,
    leftSidebarOpen,
    toggleTheme,
    theme,
    setShortcutsOverlayOpen,
    setActiveMode,
  } = useUiStore()
  const { commands: registeredCommands, executeCommand } = useCommandRegistry()
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<SlashCommandCategory | null>(null)

  const legacyCommands = useMemo(
    () => [
      { id: 'switch-work', label: 'Switch to workspace', hint: 'Ctrl+1', action: () => { setActiveMode('work'); navigate('/') } },
      { id: 'switch-settings', label: 'Switch to settings', hint: 'Ctrl+2', action: () => { setActiveMode('settings'); navigate('/settings') } },
      { id: 'switch-crew', label: 'Switch to crew area', hint: 'Ctrl+3', action: () => { setActiveMode('crew'); navigate('/crew') } },
      { id: 'toggle-left-sidebar', label: leftSidebarOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden', hint: 'Ctrl+Shift+B', action: () => toggleLeftSidebar() },
      { id: 'show-shortcuts', label: 'Show shortcut overview', hint: 'Ctrl+Shift+?', action: () => setShortcutsOverlayOpen(true) },
      { id: 'toggle-theme', label: theme === 'light' ? 'Enable dark theme' : 'Enable light theme', hint: 'Ctrl+Shift+L', action: () => toggleTheme() },
    ],
    [leftSidebarOpen, navigate, setActiveMode, setShortcutsOverlayOpen, theme, toggleLeftSidebar, toggleTheme]
  )

  const isSlashQuery = query.startsWith('/')

  const filteredCommands = useMemo(() => {
    if (isSlashQuery) {
      const normalizedQuery = query.toLowerCase()
      let filtered = registeredCommands.filter(cmd =>
        cmd.command.toLowerCase().includes(normalizedQuery) ||
        tr(cmd.label).toLowerCase().includes(normalizedQuery.slice(1)) ||
        tr(cmd.description).toLowerCase().includes(normalizedQuery.slice(1))
      )
      if (selectedCategory) {
        filtered = filtered.filter(cmd => cmd.category === selectedCategory)
      }
      return filtered
    }

    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      if (selectedCategory) {
        return registeredCommands.filter(cmd => cmd.category === selectedCategory)
      }
      return [...legacyCommands.map(c => ({
        ...c, command: '', description: c.label, category: 'navigation' as SlashCommandCategory,
        execute: c.action,
      })), ...registeredCommands]
    }
    const matchingRegistry = registeredCommands.filter(cmd =>
      tr(cmd.label).toLowerCase().includes(normalizedQuery) ||
      cmd.command.toLowerCase().includes(normalizedQuery) ||
      tr(cmd.description).toLowerCase().includes(normalizedQuery)
    )
    const matchingLegacy = legacyCommands.filter(c =>
      c.label.toLowerCase().includes(normalizedQuery) || c.hint.toLowerCase().includes(normalizedQuery)
    ).map(c => ({
      ...c, command: '', description: c.label, category: 'navigation' as SlashCommandCategory,
      execute: c.action,
    }))
    return [...matchingLegacy, ...matchingRegistry]
  }, [query, isSlashQuery, selectedCategory, registeredCommands, legacyCommands])

  const groupedCommands = useMemo(() => {
    if (isSlashQuery || selectedCategory) return null
    const groups = new Map<SlashCommandCategory, typeof filteredCommands>()
    for (const cmd of filteredCommands) {
      const cat = cmd.category
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(cmd)
    }
    return groups
  }, [filteredCommands, isSlashQuery, selectedCategory])

  const handleExecute = useCallback((cmd: typeof filteredCommands[0]) => {
    const slashArgs = isSlashQuery ? query.replace(/^\/\S+\s*/, '').trim() : undefined
    if ('action' in cmd && typeof cmd.action === 'function') {
      (cmd as { action: () => void }).action()
    } else {
      executeCommand(cmd.id, slashArgs || undefined)
    }
    setCommandPaletteOpen(false)
    setQuery('')
    setSelectedCategory(null)
  }, [isSlashQuery, query, executeCommand, setCommandPaletteOpen])

  if (!commandPaletteOpen) return null

  return (
    <div className="command-palette-overlay" onClick={() => { setCommandPaletteOpen(false); setSelectedCategory(null) }}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()} style={{ maxHeight: '70vh' }}>
        <div className="command-palette-header">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isSlashQuery ? 'Enter slash command...' : 'Search command or / for commands...'}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filteredCommands.length > 0) {
                handleExecute(filteredCommands[0])
              }
            }}
          />
          <button type="button" onClick={() => { setCommandPaletteOpen(false); setSelectedCategory(null) }}>{tr("Esc")}</button>
        </div>

        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', padding: '4px 12px', borderBottom: '1px solid var(--border-color)' }}>
          <button type="button"
            style={{
              padding: '2px 6px', fontSize: 10, borderRadius: 'var(--radius-sm)',
              background: selectedCategory === null ? 'var(--accent)' : 'transparent',
              color: selectedCategory === null ? 'white' : 'var(--text-secondary)',
              border: 'none', cursor: 'pointer',
            }}
            onClick={() => setSelectedCategory(null)}>{tr("All")}</button>
          {CATEGORY_ORDER.map(cat => (
            <button key={cat} type="button"
              style={{
                padding: '2px 6px', fontSize: 10, borderRadius: 'var(--radius-sm)',
                background: selectedCategory === cat ? 'var(--accent)' : 'transparent',
                color: selectedCategory === cat ? 'white' : 'var(--text-secondary)',
                border: 'none', cursor: 'pointer',
              }}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}>
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <ul className="command-palette-list" style={{ maxHeight: '50vh', overflow: 'auto' }}>
          {groupedCommands && !query.trim() ? (
            Array.from(groupedCommands.entries())
              .sort(([a], [b]) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
              .map(([cat, cmds]) => (
                <li key={cat} style={{ listStyle: 'none' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '6px 12px 2px', textTransform: 'uppercase' }}>
                    {CATEGORY_LABELS[cat]}
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {cmds.slice(0, 5).map(cmd => (
                      <li key={cmd.id}>
                        <button type="button" onClick={() => handleExecute(cmd)}>
                          <span>
                            {cmd.command && <span style={{ color: 'var(--accent)', marginRight: 6, fontFamily: 'monospace', fontSize: 12 }}>{cmd.command}</span>}
                            {tr(cmd.label)}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tr(cmd.description)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))
          ) : (
            filteredCommands.map(cmd => (
              <li key={cmd.id}>
                <button type="button" onClick={() => handleExecute(cmd)}>
                  <span>
                    {cmd.command && <span style={{ color: 'var(--accent)', marginRight: 6, fontFamily: 'monospace', fontSize: 12 }}>{cmd.command}</span>}
                    {tr(cmd.label)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tr(cmd.description)}
                  </span>
                </button>
              </li>
            ))
          )}
          {filteredCommands.length === 0 && (
            <li className="command-palette-empty">{tr("No results for &quot;")}{query}{tr("&quot;")}</li>
          )}
          <li style={{ padding: '8px 12px', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
            {registeredCommands.length}{tr("Commands available • Type / for slash commands")}</li>
        </ul>
      </div>
    </div>
  )
}
