import { Suspense, lazy, useEffect } from 'react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog'
import Layout from './components/Layout'
import { useUiStore } from './stores/uiStore'
import { useChatStore } from './stores/chatStore'
import { useTaskStore } from './stores/taskStore'
import { useLogStore } from './stores/logStore'
import { useConfigStore } from './stores/configStore'
import { useCoworkStore } from './stores/coworkStore'
import { useCrewStore } from './stores/crewStore'
import { useCrewRuntimeStore } from './stores/crewRuntimeStore'
import { useEngineStore } from './stores/engineStore'
import { useWorkTasksStore } from './stores/workTasksStore'
import { useProjectStore } from './stores/projectStore'
import { handleCrewTaskMessage } from './engine/crew/crewHandler'
import { writeAuditEvent } from './utils/audit'
import { seedDefaultPersonalities, seedDefaultMemory } from './utils/defaultSeeds'
import { startScheduledWorker, stopScheduledWorker } from './engine/scheduledWorker'
import { hasTauriRuntime, safeInvoke } from './utils/safeInvoke'
import './App.css'

const CoworkView = lazy(() => import('./components/CoworkView'))
const SettingsView = lazy(() => import('./components/SettingsView'))
const TasksView = lazy(() => import('./components/TasksView'))
const CrewView = lazy(() => import('./components/CrewView'))
const ProjectView = lazy(() => import('./components/ProjectView'))

type BackendPolicyState = {
  flags: Record<string, boolean>
  denyRules: string[]
  enabledToolIds: string[]
}

function hasRunningWork(): boolean {
  const chatState = useChatStore.getState()
  const legacyTasks = useTaskStore.getState().tasks
  const workTasks = useWorkTasksStore.getState().tasks
  const crews = useCrewStore.getState().crews
  const engineStatus = useEngineStore.getState().status

  return chatState.busy
    || chatState.threads.some((thread) => thread.messages.some((message) => message.streaming))
    || legacyTasks.some((task) => task.status === 'running' || task.status === 'waiting_approval')
    || workTasks.some((task) => task.status === 'running' || task.status === 'waiting_approval')
    || crews.some((crew) => crew.status === 'running' || crew.status === 'awaiting-approval')
    || engineStatus === 'streaming'
    || engineStatus === 'tool_running'
    || engineStatus === 'waiting_approval'
}

function shouldConfirmAppClose(): boolean {
  return useConfigStore.getState().preferences.confirmOnCloseWithRunningTasks
}

async function confirmAppClose(): Promise<boolean> {
  const runningWork = hasRunningWork()
  const message = runningWork
    ? 'Es laufen noch Tasks oder Chat-Antworten. Open Cowork wirklich schliessen? Laufende Ausfuehrungen koennen abgebrochen werden.'
    : 'Moechtest du Open Cowork wirklich schliessen?'

  try {
    return await confirmDialog(message, {
      title: 'Open Cowork schliessen',
      kind: runningWork ? 'warning' : 'info',
      okLabel: 'Schliessen',
      cancelLabel: 'Abbrechen',
    })
  } catch (error) {
    console.warn('Close confirmation dialog failed:', error)
    try {
      return window.confirm(message)
    } catch {
      return false
    }
  }
}

function AppRoutes() {
  return (
    <Suspense fallback={<div className="main-content" style={{ padding: 24 }}>Ansicht wird geladen...</div>}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<CoworkView />} />
          <Route path="settings" element={
            <div className="code-mode" style={{ overflow: 'auto', height: '100%' }}>
              <SettingsView />
            </div>
          } />
          <Route path="tasks" element={
            <div className="code-mode" style={{ overflow: 'auto', height: '100%' }}>
              <TasksView />
            </div>
          } />
          <Route path="crew" element={<CrewView />} />
          <Route path="projects" element={<ProjectView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

function App() {
  const loadChatFromDb = useChatStore((s) => s.loadFromDb)
  const loadTasksFromDb = useTaskStore((s) => s.loadFromDb)
  const loadProjectsFromDb = useProjectStore((s) => s.loadFromDb)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const preferences = useConfigStore((s) => s.preferences)
  const addLog = useLogStore((s) => s.addLog)
  const loadScheduledTasks = useCoworkStore((s) => s.loadScheduledTasks)
  const loadScheduledRuns = useCoworkStore((s) => s.loadScheduledRuns)
  const setPolicySnapshot = useCoworkStore((s) => s.setPolicySnapshot)
  const ensureCrewRuntimeReady = useCrewRuntimeStore((s) => s.ensureReady)

  useEffect(() => {
    const startedAt = performance.now()
    loadChatFromDb()
    loadTasksFromDb()
    void loadProjectsFromDb()
    void loadScheduledTasks()
    void loadScheduledRuns(20)
    void safeInvoke<BackendPolicyState | null>('policy_get', undefined, null)
      .then((policy) => {
        if (!policy) return
        setPolicySnapshot(policy.flags, policy.denyRules ?? [], policy.enabledToolIds ?? [])
      })
      .catch(() => {})
    seedDefaultPersonalities().catch(() => {})
    seedDefaultMemory().catch(() => {})
    if (hasTauriRuntime()) {
      void ensureCrewRuntimeReady()
    }
    addLog({
      level: 'info',
      area: 'runtime',
      message: 'App gestartet',
      details: { startupMs: Math.round(performance.now() - startedAt) },
    })
    void writeAuditEvent('runtime', 'app_started', {
      startupMs: Math.round(performance.now() - startedAt),
    })
    // Start scheduled tasks worker
    startScheduledWorker()
    return () => stopScheduledWorker()
  }, [addLog, ensureCrewRuntimeReady, loadChatFromDb, loadProjectsFromDb, loadScheduledRuns, loadScheduledTasks, loadTasksFromDb, setPolicySnapshot])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
    document.documentElement.style.fontSize = `${Math.max(85, Math.min(120, preferences.fontScale))}%`
    document.body.classList.toggle('compact-mode', preferences.compactMode)

    // Register crew task message handler
    useEngineStore.getState().setCrewTaskMessageHandler(handleCrewTaskMessage)
    return () => {
      useEngineStore.getState().setCrewTaskMessageHandler(null)
    }
  }, [theme, preferences.compactMode, preferences.fontScale])

  useEffect(() => {
    void writeAuditEvent('ui', 'theme_applied', { theme })
  }, [theme])

  useEffect(() => {
    if (!preferences.syncThemeWithSystem) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (matchesDark: boolean) => setTheme(matchesDark ? 'dark' : 'light')
    applyTheme(media.matches)

    const onChange = (event: MediaQueryListEvent) => applyTheme(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preferences.syncThemeWithSystem, setTheme])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldConfirmAppClose() || !hasRunningWork()) return
      event.preventDefault()
      event.returnValue = ''
    }
    if (!hasTauriRuntime()) {
      window.addEventListener('beforeunload', beforeUnload)
    }

    let unlistenClose: (() => void) | null = null
    let closeListenerDisposed = false
    if (hasTauriRuntime()) {
      const appWindow = getCurrentWindow()
      let closePromptOpen = false
      let closeConfirmed = false

      void appWindow.onCloseRequested(async (event) => {
        if (closeConfirmed || !shouldConfirmAppClose()) return

        event.preventDefault()
        if (closePromptOpen) return

        closePromptOpen = true
        const confirmed = await confirmAppClose()
        closePromptOpen = false

        if (confirmed) {
          closeConfirmed = true
          try {
            // Force-close to avoid re-entrancy issues (close() emits closeRequested again).
            await appWindow.destroy()
          } catch (error) {
            closeConfirmed = false
            console.warn('Closing the app window failed:', error)
          }
        }
      }).then((unlisten) => {
        if (closeListenerDisposed) {
          unlisten()
          return
        }
        unlistenClose = unlisten
      }).catch(() => {})
    }

    return () => {
      closeListenerDisposed = true
      window.removeEventListener('beforeunload', beforeUnload)
      unlistenClose?.()
    }
  }, [])

  return (
    <MemoryRouter>
      <AppRoutes />
    </MemoryRouter>
  )
}

export default App
