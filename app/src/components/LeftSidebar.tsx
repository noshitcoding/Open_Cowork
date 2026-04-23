import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionSummary } from '../engine'
import { useChatStore } from '../stores/chatStore'
import { useUiStore } from '../stores/uiStore'
import { useConfigStore } from '../stores/configStore'
import { useCoworkStore } from '../stores/coworkStore'
import { useEngineStore } from '../stores/engineStore'
import { resolveSessionRecord, toChatThread } from '../utils/sessionThreads'

export default function LeftSidebar() {
  const navigate = useNavigate()
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
  const getSessions = useEngineStore((s) => s.getSessions)
  const loadSessionById = useEngineStore((s) => s.loadSessionById)
  const currentSessionId = useEngineStore((s) => s.currentSessionId)
  const hydrateThread = useChatStore((s) => s.hydrateThread)
  const [persistedSessions, setPersistedSessions] = useState<SessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  const enabledConnectors = connectors.filter((entry) => entry.enabled).length
  const enabledPlugins = plugins.filter((entry) => entry.enabled).length

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setLoadingSessions(true)
      try {
        const sessions = await getSessions()
        if (!cancelled) {
          setPersistedSessions(sessions)
        }
      } catch {
        if (!cancelled) {
          setPersistedSessions([])
        }
      } finally {
        if (!cancelled) {
          setLoadingSessions(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [getSessions, currentSessionId])

  const threadIds = useMemo(() => new Set(threads.map((thread) => thread.id)), [threads])
  const recentPersistedSessions = useMemo(
    () => persistedSessions.filter((session) => !threadIds.has(session.id)).slice(0, 6),
    [persistedSessions, threadIds],
  )

  const handleNewTask = () => {
    setActiveMode('work')
    setActiveThread(null)
    navigate('/')
  }

  const handleOpenThread = (threadId: string) => {
    setActiveMode('work')
    setActiveThread(threadId)
    navigate('/')
  }

  const handleOpenPersistedSession = async (sessionId: string) => {
    const session = await resolveSessionRecord(sessionId, loadSessionById)
    if (!session) return

    hydrateThread(toChatThread(session))
    setActiveMode('work')
    navigate('/')
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
                onClick={() => handleOpenThread(t.id)}
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

      <div className="sidebar-section">
        <h3 className="sidebar-section-title">Persistierte Sessions</h3>
        <div className="session-list">
          {recentPersistedSessions.map((session) => (
            <div
              key={session.id}
              className={`session-item${session.id === currentSessionId ? ' active' : ''}`}
            >
              <button
                type="button"
                className="session-select"
                onClick={() => void handleOpenPersistedSession(session.id)}
              >
                <span className="session-icon">🗂</span>
                <span className="session-title">{session.title}</span>
              </button>
            </div>
          ))}
          {loadingSessions && (
            <p className="hint-text">Sessions werden geladen...</p>
          )}
          {!loadingSessions && recentPersistedSessions.length === 0 && (
            <p className="hint-text">Keine weiteren Sessions</p>
          )}
        </div>
      </div>
    </aside>
  )
}
