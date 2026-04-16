import { useChatStore } from '../stores/chatStore'
import { useUiStore } from '../stores/uiStore'
import { useConfigStore } from '../stores/configStore'
import { useCoworkStore } from '../stores/coworkStore'

export default function LeftSidebar() {
  const {
    threads,
    activeThreadId,
    setActiveThread,
    deleteThread,
  } = useChatStore()
  const setActiveMode = useUiStore((s) => s.setActiveMode)
  const mcpServer = useConfigStore((s) => s.mcpServer)
  const ollama = useConfigStore((s) => s.ollama)
  const connectors = useCoworkStore((s) => s.connectors)
  const plugins = useCoworkStore((s) => s.plugins)

  const enabledConnectors = connectors.filter((entry) => entry.enabled).length
  const enabledPlugins = plugins.filter((entry) => entry.enabled).length

  const handleNewTask = () => {
    setActiveMode('work')
    setActiveThread(null)
  }

  return (
    <aside className="left-sidebar">
      <button type="button" className="btn-new-task" onClick={handleNewTask}>
        + Neuer Chat
      </button>

      {/* Context Panel */}
      <div className="sidebar-section">
        <h3 className="sidebar-section-title">🔗 Kontext</h3>
        <div className="context-items">
          <div className="context-item">
            <span className="context-label">Modell</span>
            <span className="context-value" title={ollama.model}>{ollama.model}</span>
          </div>
          <div className="context-item">
            <span className="context-label">MCP Server</span>
            <span className="context-value" title={mcpServer.name}>{mcpServer.name}</span>
          </div>
          <div className="context-item">
            <span className="context-label">Connectors</span>
            <span className="context-value">{enabledConnectors} aktiv</span>
          </div>
          <div className="context-item">
            <span className="context-label">Plugins</span>
            <span className="context-value">{enabledPlugins} aktiv</span>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="sidebar-section">
        <h3 className="sidebar-section-title">Verlauf</h3>
        <div className="session-list">
          {threads.map((t) => (
            <div
              key={t.id}
              className={`session-item${t.id === activeThreadId ? ' active' : ''}`}
            >
              <button
                type="button"
                className="session-select"
                onClick={() => {
                  setActiveMode('work')
                  setActiveThread(t.id)
                }}
              >
                <span className="session-icon">💬</span>
                <span className="session-title">{t.title}</span>
              </button>
              <button
                type="button"
                className="session-delete"
                onClick={() => deleteThread(t.id)}
                title="Löschen"
              >
                ×
              </button>
            </div>
          ))}
          {threads.length === 0 && (
            <p className="hint-text">Noch keine Chats</p>
          )}
        </div>
      </div>
    </aside>
  )
}
