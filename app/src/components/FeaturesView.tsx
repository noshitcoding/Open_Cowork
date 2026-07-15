import { useMemo, useState } from 'react'
import { Brain, Command, PlugZap, Sparkles } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { tr } from '../i18n'
import { useCommandRegistry } from '../stores/commandRegistryStore'
import McpView from './McpView'
import MemoryPanel from './MemoryPanel'
import SkillPanel from './SkillPanel'

type WorkbenchTab = 'mcp' | 'knowledge' | 'skills' | 'commands'

const TABS: Array<{ id: WorkbenchTab; label: string; icon: typeof PlugZap }> = [
  { id: 'mcp', label: 'MCP Server', icon: PlugZap },
  { id: 'knowledge', label: 'Knowledge base', icon: Brain },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'commands', label: 'Slash commands', icon: Command },
]

function isWorkbenchTab(value: string | null): value is WorkbenchTab {
  return TABS.some((tab) => tab.id === value)
}

export default function FeaturesView() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab: WorkbenchTab = isWorkbenchTab(requestedTab) ? requestedTab : 'mcp'
  const commands = useCommandRegistry((state) => state.commands)
  const [commandQuery, setCommandQuery] = useState('')

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase()
    if (!query) return commands
    return commands.filter((command) => (
      `${command.command} ${command.label} ${command.description} ${command.category}`.toLowerCase().includes(query)
    ))
  }, [commandQuery, commands])

  const selectTab = (tab: WorkbenchTab) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const openCommandInChat = (command: string) => {
    navigate(`/?slash=${encodeURIComponent(command)}`)
  }

  return (
    <main className="feature-workbench">
      <header className="feature-workbench-header">
        <div>
          <h1>{tr('Tools and knowledge')}</h1>
          <p className="hint-text">{tr('Connect MCP tools, maintain reusable knowledge, manage skills, and discover commands.')}</p>
        </div>
      </header>

      <div className="feature-workbench-tabs" role="tablist" aria-label={tr('Tools and knowledge')}>
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              type="button"
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => selectTab(tab.id)}
            >
              <Icon size={16} aria-hidden="true" />
              {tr(tab.label)}
            </button>
          )
        })}
      </div>

      <section className="feature-workbench-body" role="tabpanel">
        {activeTab === 'mcp' && <McpView />}
        {activeTab === 'knowledge' && <MemoryPanel />}
        {activeTab === 'skills' && <SkillPanel />}
        {activeTab === 'commands' && (
          <div className="command-workbench">
            <div className="command-workbench-toolbar">
              <input
                type="search"
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder={tr('Search slash commands...')}
                aria-label={tr('Search slash commands...')}
              />
              <span>{filteredCommands.length} {tr('commands')}</span>
            </div>
            <div className="command-workbench-list">
              {filteredCommands.map((command) => (
                <button type="button" key={command.id} onClick={() => openCommandInChat(command.command)}>
                  <code>{command.command}</code>
                  <span className="command-workbench-copy">
                    <strong>{tr(command.label)}</strong>
                    <small>{tr(command.description)}</small>
                  </span>
                  <span className="command-workbench-category">{tr(command.category)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
