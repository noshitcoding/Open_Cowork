import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionSummary } from '../engine'
import { useChatStore } from '../stores/chatStore'
import { useUiStore } from '../stores/uiStore'
import { useConfigStore } from '../stores/configStore'
import { useCoworkStore } from '../stores/coworkStore'
import { useEngineStore } from '../stores/engineStore'
import { useWorkTasksStore, type WorkTask } from '../stores/workTasksStore'
import { resolveSessionRecord, toChatThread } from '../utils/sessionThreads'
import { createChatProviderSelection, getChatProviderState } from '../utils/chatProvider'

function isAbsolutePath(path: string): boolean {
  const trimmed = path.trim()
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(trimmed)
}

function getTaskSidebarTitle(task: WorkTask): string {
  const title = task.title.trim()
  if (title) return title

  const prompt = task.prompt.trim().replace(/\s+/g, ' ')
  if (!prompt) return task.id
  return prompt.length > 36 ? `${prompt.slice(0, 36)}…` : prompt
}

function buildTaskSidebarSummary(task: WorkTask): string {
  return [
    `Task angelegt: ${getTaskSidebarTitle(task)}`,
    `Runner: ${task.runner === 'crew' ? 'Crew' : 'Modell'}`,
    task.expectedOutput.trim() ? `Expected Output: ${task.expectedOutput.trim()}` : '',
    task.workDir.trim() ? `Arbeitsordner: ${task.workDir.trim()}` : '',
  ].filter(Boolean).join('\n')
}

export default function LeftSidebar() {
  const navigate = useNavigate()
  const {
    threads,
    activeThreadId,
    addThread,
    addMessage,
    setActiveThread,
    deleteThread,
  } = useChatStore()
  const setActiveMode = useUiStore((s) => s.setActiveMode)
  const setWorkingFolder = useUiStore((s) => s.setWorkingFolder)
  const mcpServer = useConfigStore((s) => s.mcpServer)
  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const llmProfiles = useConfigStore((s) => s.llmProfiles)
  const defaultLlmProfileIds = useConfigStore((s) => s.defaultLlmProfileIds)
  const llmProfileModels = useConfigStore((s) => s.llmProfileModels)
  const connectors = useCoworkStore((s) => s.connectors)
  const plugins = useCoworkStore((s) => s.plugins)
  const workTasks = useWorkTasksStore((s) => s.tasks)
  const updateWorkTask = useWorkTasksStore((s) => s.updateTask)
  const activeProvider = useEngineStore((s) => s.activeProvider)
  const getSessions = useEngineStore((s) => s.getSessions)
  const loadSessionById = useEngineStore((s) => s.loadSessionById)
  const currentSessionId = useEngineStore((s) => s.currentSessionId)
  const hydrateThread = useChatStore((s) => s.hydrateThread)
  const [persistedSessions, setPersistedSessions] = useState<SessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  const enabledConnectors = connectors.filter((entry) => entry.enabled).length
  const enabledPlugins = plugins.filter((entry) => entry.enabled).length
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId),
    [activeThreadId, threads],
  )
  const providerState = useMemo(
    () => getChatProviderState({
      ollama,
      availableModels,
      llmProfiles,
      defaultLlmProfileIds,
      llmProfileModels,
    }, activeProvider, activeThread?.providerSettings),
    [activeProvider, activeThread?.providerSettings, availableModels, defaultLlmProfileIds, llmProfileModels, llmProfiles, ollama],
  )

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
  const taskThreadIds = useMemo(
    () => new Set(workTasks.map((task) => task.threadId).filter((threadId): threadId is string => typeof threadId === 'string' && threadId.trim().length > 0)),
    [workTasks],
  )
  const historyThreads = useMemo(
    () => threads.filter((thread) => !taskThreadIds.has(thread.id)),
    [taskThreadIds, threads],
  )
  const recentPersistedSessions = useMemo(
    () => persistedSessions.filter((session) => !threadIds.has(session.id)).slice(0, 6),
    [persistedSessions, threadIds],
  )

  const handleNewTask = () => {
    const threadId = addThread('Neuer Chat', createChatProviderSelection(providerState))
    setActiveMode('work')
    setActiveThread(threadId)
    navigate('/')
  }

  const handleOpenThread = (threadId: string) => {
    setActiveMode('work')
    setActiveThread(threadId)
    navigate('/')
  }

  const handleOpenTaskThread = (task: WorkTask) => {
    const existingThreadId = task.threadId && threadIds.has(task.threadId)
      ? task.threadId
      : null

    const threadId = existingThreadId ?? addThread(getTaskSidebarTitle(task), createChatProviderSelection(providerState))

    if (!existingThreadId) {
      addMessage(threadId, {
        role: 'system',
        content: buildTaskSidebarSummary(task),
        visibleInChat: true,
        timestamp: Date.now(),
      })
      updateWorkTask(task.id, { threadId })
    }

    const workDir = task.workDir.trim()
    setWorkingFolder(workDir && isAbsolutePath(workDir) ? workDir : null)
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
            <span className="context-value" title={`${providerState.label}: ${providerState.model}`}>
              {providerState.model || providerState.label}
            </span>
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
        <h3 className="sidebar-section-title">Task Chats</h3>
        <div className="session-list">
          {workTasks.map((task) => (
            <div
              key={task.id}
              className={`session-item${task.threadId === activeThreadId ? ' active' : ''}`}
            >
              <button
                type="button"
                className="session-select"
                onClick={() => handleOpenTaskThread(task)}
              >
                <span className="session-icon">🧩</span>
                <span className="session-title">{getTaskSidebarTitle(task)} · {task.status}</span>
              </button>
            </div>
          ))}
          {workTasks.length === 0 && (
            <p className="hint-text">Noch keine Tasks</p>
          )}
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-section-title">Verlauf</h3>
        <div className="session-list">
          {historyThreads.map((t) => (
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
          {historyThreads.length === 0 && (
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
