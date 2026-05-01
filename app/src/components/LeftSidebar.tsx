import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionSummary } from '../engine'
import { useChatStore } from '../stores/chatStore'
import { useUiStore } from '../stores/uiStore'
import { useConfigStore } from '../stores/configStore'
import { useCoworkStore } from '../stores/coworkStore'
import { useEngineStore } from '../stores/engineStore'
import { useWorkTasksStore, type WorkTask } from '../stores/workTasksStore'
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

type SidebarFilter = 'all' | 'task' | 'chat' | 'session'

interface SidebarItem {
  id: string
  type: SidebarFilter
  title: string
  status?: string
  onClick: () => void
  onDelete?: () => void
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
  const deleteSessionById = useEngineStore((s) => s.deleteSessionById)
  const [persistedSessions, setPersistedSessions] = useState<SessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [filter, setFilter] = useState<SidebarFilter>('all')

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
        if (!cancelled) setPersistedSessions(sessions)
      } catch {
        if (!cancelled) setPersistedSessions([])
      } finally {
        if (!cancelled) setLoadingSessions(false)
      }
    })()
    return () => { cancelled = true }
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

  const handleOpenSession = async (sessionId: string) => {
    const session = await loadSessionById(sessionId)
    if (!session) return
    if (session.threadId && threadIds.has(session.threadId)) {
      setActiveThread(session.threadId)
    }
    setActiveMode('work')
    navigate('/')
  }

  const items: SidebarItem[] = useMemo(() => {
    const result: SidebarItem[] = []

    workTasks.forEach((task) => {
      result.push({
        id: `task-${task.id}`,
        type: 'task',
        title: `${getTaskSidebarTitle(task)} · ${task.status}`,
        status: task.status,
        onClick: () => handleOpenTaskThread(task),
      })
    })

    historyThreads.forEach((t) => {
      result.push({
        id: `chat-${t.id}`,
        type: 'chat',
        title: t.title,
        onClick: () => handleOpenThread(t.id),
        onDelete: () => deleteThread(t.id),
      })
    })

    persistedSessions.forEach((session) => {
      result.push({
        id: `session-${session.id}`,
        type: 'session',
        title: session.title,
        onClick: () => void handleOpenSession(session.id),
        onDelete: () => void deleteSessionById(session.id),
      })
    })

    return result
  }, [workTasks, historyThreads, persistedSessions, threadIds])

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((item) => item.type === filter)
  }, [items, filter])

  const isActive = (item: SidebarItem): boolean => {
    if (item.type === 'chat') {
      return item.id.replace('chat-', '') === activeThreadId
    }
    if (item.type === 'task') {
      const task = workTasks.find((t) => `task-${t.id}` === item.id)
      return task?.threadId === activeThreadId
    }
    if (item.type === 'session') {
      return item.id.replace('session-', '') === currentSessionId
    }
    return false
  }

  return (
    <aside className="left-sidebar">
      <button type="button" className="btn-new-task" onClick={handleNewTask}>
        + Neuer Chat
      </button>
      <button type="button" className="btn-sm" style={{ width: '100%', marginBottom: 12 }} onClick={() => navigate('/crew')}>
        🚀 Crew Studio
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

      {/* Unified History */}
      <div className="sidebar-section">
        <div className="sidebar-filter-bar">
          {(['all', 'task', 'chat', 'session'] as SidebarFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`sidebar-filter-btn${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' && 'Alle'}
              {f === 'task' && 'Tasks'}
              {f === 'chat' && 'Chats'}
              {f === 'session' && 'Sessions'}
            </button>
          ))}
        </div>
        <div className="session-list">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`session-item${isActive(item) ? ' active' : ''}`}
            >
              <button
                type="button"
                className="session-select"
                onClick={item.onClick}
              >
                <span className="session-icon">
                  {item.type === 'task' && '🧩'}
                  {item.type === 'chat' && '💬'}
                  {item.type === 'session' && '🗂'}
                </span>
                <span className="session-title">{item.title}</span>
                <span className={`session-badge badge-${item.type}`}>
                  {item.type === 'task' && 'Task'}
                  {item.type === 'chat' && 'Chat'}
                  {item.type === 'session' && 'Session'}
                </span>
              </button>
              {item.onDelete && (
                <button
                  type="button"
                  className="session-delete"
                  onClick={(e) => { e.stopPropagation(); item.onDelete!() }}
                  title="Löschen"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {loadingSessions && (
            <p className="hint-text">Wird geladen...</p>
          )}
          {!loadingSessions && filteredItems.length === 0 && (
            <p className="hint-text">
              {filter === 'all' ? 'Noch keine Einträge' : `Keine ${filter === 'task' ? 'Tasks' : filter === 'chat' ? 'Chats' : 'Sessions'}`}
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}
