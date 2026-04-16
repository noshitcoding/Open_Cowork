import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import WelcomeScreen from './components/WelcomeScreen'
import CoworkView from './components/CoworkView'
import McpView from './components/McpView'
import SettingsView from './components/SettingsView'
import ArtifactsView from './components/ArtifactsView'
import { useUiStore } from './stores/uiStore'
import { useChatStore } from './stores/chatStore'
import { useTaskStore } from './stores/taskStore'
import { useLogStore } from './stores/logStore'
import { useConfigStore } from './stores/configStore'
import { writeAuditEvent } from './utils/audit'
import './App.css'

function AppRoutes() {
  const activeThreadId = useChatStore((s) => s.activeThreadId)

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={activeThreadId ? <CoworkView /> : <WelcomeScreen />} />
        <Route path="artifacts" element={<ArtifactsView />} />
        <Route path="settings" element={
          <div className="code-mode" style={{ overflow: 'auto', height: '100%' }}>
            <SettingsView />
            <McpView />
          </div>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function App() {
  const loadChatFromDb = useChatStore((s) => s.loadFromDb)
  const loadTasksFromDb = useTaskStore((s) => s.loadFromDb)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const preferences = useConfigStore((s) => s.preferences)
  const addLog = useLogStore((s) => s.addLog)

  useEffect(() => {
    const startedAt = performance.now()
    loadChatFromDb()
    loadTasksFromDb()
    addLog({
      level: 'info',
      area: 'runtime',
      message: 'App gestartet',
      details: { startupMs: Math.round(performance.now() - startedAt) },
    })
    void writeAuditEvent('runtime', 'app_started', {
      startupMs: Math.round(performance.now() - startedAt),
    })
  }, [addLog, loadChatFromDb, loadTasksFromDb])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
    document.documentElement.style.fontSize = `${Math.max(85, Math.min(120, preferences.fontScale))}%`
    document.body.classList.toggle('compact-mode', preferences.compactMode)
    void writeAuditEvent('ui', 'theme_applied', { theme })
  }, [preferences.compactMode, preferences.fontScale, theme])

  useEffect(() => {
    if (!preferences.syncThemeWithSystem) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (matchesDark: boolean) => setTheme(matchesDark ? 'dark' : 'light')
    applyTheme(media.matches)

    const onChange = (event: MediaQueryListEvent) => applyTheme(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preferences.syncThemeWithSystem, setTheme])

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App
