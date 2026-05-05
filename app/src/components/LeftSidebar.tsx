import { useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionSummary } from '../engine'
import { useChatStore } from '../stores/chatStore'
import { useUiStore } from '../stores/uiStore'
import { useConfigStore } from '../stores/configStore'
import { useEngineStore } from '../stores/engineStore'
import { useTaskStore } from '../stores/taskStore'
import { useWorkTasksStore, type WorkTask } from '../stores/workTasksStore'
import { useProjectStore } from '../stores/projectStore'
import { createChatProviderSelection, getChatProviderState } from '../utils/chatProvider'
import { ContextPanel, OutputsPanel, ProgressPanel, WorkingFolderPanel } from './RightSidebar'

const THREAD_DND_MIME = 'application/open-cowork-thread-id'

function isAbsolutePath(path: string): boolean {
  const trimmed = path.trim()
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(trimmed)
}

function getTaskSidebarTitle(task: WorkTask): string {
  const title = task.title.trim()
  if (title) return title

  const prompt = task.prompt.trim().replace(/\s+/g, ' ')
  if (!prompt) return task.id
  return prompt.length > 36 ? `${prompt.slice(0, 36)}...` : prompt
}

function buildTaskSidebarSummary(task: WorkTask): string {
  return [
    `Task angelegt: ${getTaskSidebarTitle(task)}`,
    `Runner: ${task.runner === 'crew' ? 'Crew' : 'Modell'}`,
    task.expectedOutput.trim() ? `Expected Output: ${task.expectedOutput.trim()}` : '',
    task.workDir.trim() ? `Arbeitsordner: ${task.workDir.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function readDraggedThreadId(event: DragEvent): string {
  const typed = event.dataTransfer.getData(THREAD_DND_MIME).trim()
  if (typed) return typed

  const plain = event.dataTransfer.getData('text/plain').trim()
  return plain.startsWith('thread:') ? plain.slice('thread:'.length).trim() : plain
}

type SidebarFilter = 'all' | 'project' | 'task' | 'chat' | 'session'

interface SidebarItem {
  id: string
  type: SidebarFilter
  title: string
  status?: string
  threadId?: string
  onClick: () => void
  onDelete?: () => void
  onDropThread?: (threadId: string) => void
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
  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const llmProfiles = useConfigStore((s) => s.llmProfiles)
  const defaultLlmProfileIds = useConfigStore((s) => s.defaultLlmProfileIds)
  const llmProfileModels = useConfigStore((s) => s.llmProfileModels)
  const workTasks = useWorkTasksStore((s) => s.tasks)
  const updateWorkTask = useWorkTasksStore((s) => s.updateTask)
  const tasks = useTaskStore((s) => s.tasks)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const activeProvider = useEngineStore((s) => s.activeProvider)
  const getSessions = useEngineStore((s) => s.getSessions)
  const loadSessionById = useEngineStore((s) => s.loadSessionById)
  const currentSessionId = useEngineStore((s) => s.currentSessionId)
  const deleteSessionById = useEngineStore((s) => s.deleteSessionById)
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const addProject = useProjectStore((s) => s.addProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const attachThread = useProjectStore((s) => s.attachThread)
  const [persistedSessions, setPersistedSessions] = useState<SessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [filter, setFilter] = useState<SidebarFilter>('all')

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
  const activeTask = tasks.find((task) => task.id === activeTaskId)

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
  const projectThreadIds = useMemo(
    () => new Set(projects.flatMap((project) => project.threadIds)),
    [projects],
  )
  const historyThreads = useMemo(
    () => threads.filter((thread) => !taskThreadIds.has(thread.id) && !projectThreadIds.has(thread.id)),
    [projectThreadIds, taskThreadIds, threads],
  )

  const handleNewTask = () => {
    const threadId = addThread('Neuer Chat', createChatProviderSelection(providerState))
    setActiveMode('work')
    setActiveThread(threadId)
    navigate('/')
  }

  const handleNewProject = () => {
    const projectId = addProject(`Projekt ${projects.length + 1}`)
    setActiveProject(projectId)
    navigate('/projects')
  }

  const handleOpenProjects = () => {
    if (!activeProjectId && projects[0]) {
      setActiveProject(projects[0].id)
    }
    navigate('/projects')
  }

  const handleOpenProject = (projectId: string) => {
    setActiveProject(projectId)
    navigate('/projects')
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

  const handleThreadDragStart = (event: DragEvent, threadId: string) => {
    event.dataTransfer.setData(THREAD_DND_MIME, threadId)
    event.dataTransfer.setData('text/plain', `thread:${threadId}`)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleProjectDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleProjectDrop = (event: DragEvent, onDropThread: (threadId: string) => void) => {
    event.preventDefault()
    const threadId = readDraggedThreadId(event)
    if (threadId && threadIds.has(threadId)) {
      onDropThread(threadId)
    }
  }

  const items: SidebarItem[] = useMemo(() => {
    const result: SidebarItem[] = []

    projects.forEach((project) => {
      const existingThreadCount = project.threadIds.filter((threadId) => threadIds.has(threadId)).length
      result.push({
        id: `project-${project.id}`,
        type: 'project',
        title: project.title,
        status: `${existingThreadCount} Chats`,
        onClick: () => handleOpenProject(project.id),
        onDelete: () => deleteProject(project.id),
        onDropThread: (threadId) => attachThread(project.id, threadId),
      })
    })

    workTasks.forEach((task) => {
      result.push({
        id: `task-${task.id}`,
        type: 'task',
        title: `${getTaskSidebarTitle(task)} - ${task.status}`,
        status: task.status,
        onClick: () => handleOpenTaskThread(task),
      })
    })

    historyThreads.forEach((t) => {
      result.push({
        id: `chat-${t.id}`,
        type: 'chat',
        title: t.title,
        threadId: t.id,
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
  }, [projects, threadIds, workTasks, historyThreads, persistedSessions])

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((item) => item.type === filter)
  }, [items, filter])

  const isActive = (item: SidebarItem): boolean => {
    if (item.type === 'project') {
      return item.id.replace('project-', '') === activeProjectId
    }
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

  const getEmptyLabel = (): string => {
    if (filter === 'all') return 'Noch keine Eintraege'
    if (filter === 'project') return 'Keine Projekte'
    if (filter === 'task') return 'Keine Tasks'
    if (filter === 'chat') return 'Keine Chats'
    return 'Keine Sessions'
  }

  return (
    <aside className="left-sidebar">
      <button type="button" className="btn-new-task" onClick={handleNewTask}>
        + Neuer Chat
      </button>
      <button type="button" className="btn-new-task" onClick={handleNewProject}>
        + Neues Projekt
      </button>
      <button type="button" className="btn-sm" style={{ width: '100%', marginBottom: 6 }} onClick={handleOpenProjects}>
        Projekte
      </button>
      <button type="button" className="btn-sm" style={{ width: '100%', marginBottom: 12 }} onClick={() => navigate('/crew')}>
        Crew Studio
      </button>

      <div className="sidebar-status-panels">
        <ProgressPanel task={activeTask} />
        <WorkingFolderPanel />
        <OutputsPanel task={activeTask} />
        <ContextPanel />
      </div>

      <div className="sidebar-section">
        <div className="sidebar-filter-bar">
          {(['all', 'project', 'task', 'chat', 'session'] as SidebarFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`sidebar-filter-btn${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' && 'Alle'}
              {f === 'project' && 'Projekte'}
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
              draggable={Boolean(item.threadId)}
              onDragStart={(event) => {
                if (item.threadId) handleThreadDragStart(event, item.threadId)
              }}
              onDragOver={item.onDropThread ? handleProjectDragOver : undefined}
              onDrop={item.onDropThread ? (event) => handleProjectDrop(event, item.onDropThread!) : undefined}
            >
              <button
                type="button"
                className="session-select"
                onClick={item.onClick}
              >
                <span className="session-icon">
                  {item.type === 'project' && 'P'}
                  {item.type === 'task' && 'T'}
                  {item.type === 'chat' && 'C'}
                  {item.type === 'session' && 'S'}
                </span>
                <span className="session-title">{item.title}</span>
                <span className={`session-badge badge-${item.type}`}>
                  {item.type === 'project' && 'Projekt'}
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
                  title="Loeschen"
                >
                  x
                </button>
              )}
            </div>
          ))}
          {loadingSessions && (
            <p className="hint-text">Wird geladen...</p>
          )}
          {!loadingSessions && filteredItems.length === 0 && (
            <p className="hint-text">{getEmptyLabel()}</p>
          )}
        </div>
      </div>
    </aside>
  )
}
