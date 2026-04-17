import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView'
import { useConfigStore } from '../stores/configStore'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

/* Default invoke handler: return safe defaults for all known commands */
function defaultInvoke(cmd: string) {
  switch (cmd) {
    case 'personality_list': return Promise.resolve([])
    case 'memory_search': return Promise.resolve([])
    case 'memory_hints': return Promise.resolve([])
    case 'user_profile_list': return Promise.resolve([])
    case 'memory_provider_list': return Promise.resolve([])
    case 'skill_list': return Promise.resolve([])
    case 'learning_list': return Promise.resolve([])
    case 'pipeline_list': return Promise.resolve([])
    case 'tool_gateway_list': return Promise.resolve([])
    case 'session_list': return Promise.resolve([])
    case 'session_search': return Promise.resolve([])
    case 'insights_list': return Promise.resolve([])
    case 'insights_summary': return Promise.resolve({ totalSessions: 0, totalEvents: 0 })
    case 'backend_list': return Promise.resolve([])
    case 'backend_ensure_local': return Promise.resolve(null)
    case 'process_list': return Promise.resolve([])
    case 'mcp_list_servers': return Promise.resolve([])
    case 'mcp_probe': return Promise.resolve({ tools: [] })
    default: return Promise.resolve(null)
  }
}

/* Reset stores before each test */
function resetConfigStore() {
  useConfigStore.setState({
    ollama: {
      baseUrl: 'http://192.168.178.82:11434',
      model: 'llama3.1:8b',
      timeoutMs: 200000,
      contextWindow: 8192,
      temperature: 0.2,
    },
    preferences: {
      autoApproveSafeTools: true,
      autoPilotAllTools: false,
      readOnlyFsMode: false,
      commandWhitelist: '',
      commandBlacklist: '',
      maxToolCallsPerLoop: 12,
      fallbackToHumanOnRepeatedFailure: true,
      confirmOnCloseWithRunningTasks: true,
      telemetryEnabled: true,
      notificationsEnabled: true,
      soundsEnabled: false,
      launchAtStartup: false,
      showTimestamps: true,
      defaultStartView: 'last',
      focusMode: false,
      compactMode: false,
      verboseMode: false,
      limitThinkingWindow: true,
      superVerboseAuditLogging: false,
      fontScale: 100,
      shortcutOverlayEnabled: true,
      syncThemeWithSystem: false,
      chatRetentionDays: 30,
      autoBackupDb: true,
      dbBackupIntervalHours: 24,
      workspaceDefaultPath: '',
      mcpAutoReconnect: true,
      mcpVerboseLogging: false,
      mcpEnvEditorEnabled: true,
      mcpAllowManualImport: true,
      ollamaStreamAutosave: true,
      dbCleanupOnStart: false,
      taskBatchMultiSelectEnabled: true,
    },
    availableModels: [],
    mcpServer: { name: '', command: '', args: '', env: {} },
    mcpServers: [],
    activeMcpServerName: '',
  })
}

describe('SettingsView', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockImplementation(defaultInvoke)
    resetConfigStore()
  })

  /* ── 1. sidebar renders all 9 categories ── */
  it('renders all 9 category buttons in sidebar', async () => {
    await act(async () => { render(<SettingsView />) })
    const nav = screen.getByRole('navigation', { name: 'Einstellungs-Kategorien' })
    const buttons = nav.querySelectorAll('.settings-nav-item')
    expect(buttons.length).toBe(9)
  })

  /* ── 2. default category is KI & Modell ── */
  it('shows KI & Modell content by default', async () => {
    await act(async () => { render(<SettingsView />) })
    expect(screen.getByRole('heading', { level: 1, name: 'KI & Modell' })).toBeInTheDocument()
  })

  /* ── 3. navigation switches categories ── */
  it('switches to Agent & Skills when clicked', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Agent & Skills')) })
    expect(screen.getByRole('heading', { level: 1, name: 'Agent & Skills' })).toBeInTheDocument()
  })

  /* ── 4. Oberflaeche category ── */
  it('switches to Oberflaeche category', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Oberflaeche')) })
    expect(screen.getByRole('heading', { level: 1, name: 'Oberflaeche' })).toBeInTheDocument()
    expect(screen.getByText('Fokusmodus')).toBeInTheDocument()
    expect(screen.getByText('Kompaktmodus')).toBeInTheDocument()
  })

  /* ── 5. Sicherheit category ── */
  it('switches to Sicherheit & Daten category', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Sicherheit & Daten')) })
    expect(screen.getByRole('heading', { level: 1, name: 'Sicherheit & Daten' })).toBeInTheDocument()
    expect(screen.getByText('Nur-Lesen-Modus')).toBeInTheDocument()
  })

  /* ── 6. System & Info shows version ── */
  it('switches to System & Info and shows version info', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('System & Info')) })
    expect(screen.getByRole('heading', { level: 1, name: 'System & Info' })).toBeInTheDocument()
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument()
  })

  /* ── 7. Gedaechtnis category renders ── */
  it('switches to Gedaechtnis category', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Gedaechtnis')) })
    expect(screen.getByRole('heading', { level: 1, name: 'Gedaechtnis' })).toBeInTheDocument()
  })

  /* ── 8. Sessions & Insights category renders ── */
  it('switches to Sessions & Insights', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Sessions & Insights')) })
    expect(screen.getByRole('heading', { level: 1, name: 'Sessions & Insights' })).toBeInTheDocument()
  })

  /* ── 9. Terminal & Prozesse category renders ── */
  it('switches to Terminal & Prozesse', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Terminal & Prozesse')) })
    expect(screen.getByRole('heading', { level: 1, name: 'Terminal & Prozesse' })).toBeInTheDocument()
  })

  /* ── 10. MCP Server category renders ── */
  it('switches to MCP Server', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('MCP Server')) })
    // McpView also has an h1 "MCP Server", so check for the settings toggle instead
    expect(screen.getByText('Auto-Reconnect')).toBeInTheDocument()
    expect(screen.getByText('Verbose Logging')).toBeInTheDocument()
  })

  /* ── 11. Ollama endpoint input updates store ── */
  it('updates Ollama endpoint on input change', async () => {
    await act(async () => { render(<SettingsView />) })
    // ModelSwitcher also shows the URL; pick the first input
    const inputs = screen.getAllByDisplayValue('http://192.168.178.82:11434')
    fireEvent.change(inputs[0], { target: { value: 'http://localhost:11434' } })
    expect(useConfigStore.getState().ollama.baseUrl).toBe('http://localhost:11434')
  })

  /* ── 12. Ollama model input updates store ── */
  it('updates Ollama model on input change', async () => {
    await act(async () => { render(<SettingsView />) })
    // ModelSwitcher also shows model; pick the first input element
    const inputs = screen.getAllByDisplayValue('llama3.1:8b')
    fireEvent.change(inputs[0], { target: { value: 'mistral:7b' } })
    expect(useConfigStore.getState().ollama.model).toBe('mistral:7b')
  })

  /* ── 13. Toggle updates preference ── */
  it('toggles autoApproveSafeTools preference', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Agent & Skills')) })
    const toggleBtn = screen.getByText('Sichere Tools automatisch genehmigen').closest('.toggle-row')!.querySelector('button[role="switch"]')!
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggleBtn)
    expect(useConfigStore.getState().preferences.autoApproveSafeTools).toBe(false)
  })

  /* ── 14. Health check invokes backend ── */
  it('calls ollama_health_check on button click', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'ollama_health_check') {
        return Promise.resolve({
          ok: true, endpoint: 'http://192.168.178.82:11434', model: 'llama3.1:8b',
          latencyMs: 42, version: '0.3.0', models: ['llama3.1:8b'], error: null,
        })
      }
      return defaultInvoke(cmd)
    })
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('🔍 Health Check')) })
    await waitFor(() => expect(screen.getByText('✓ Verbunden')).toBeInTheDocument())
  })

  /* ── 15. Health check error ── */
  it('shows error message on health check failure', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'ollama_health_check') {
        return Promise.reject(new Error('Connection refused'))
      }
      return defaultInvoke(cmd)
    })
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('🔍 Health Check')) })
    await waitFor(() => expect(screen.getByText('Connection refused')).toBeInTheDocument())
  })

  /* ── 16. Model dropdown with available models ── */
  it('renders model dropdown when availableModels are set', async () => {
    useConfigStore.setState({ availableModels: ['llama3.1:8b', 'mistral:7b', 'codellama:13b'] })
    await act(async () => { render(<SettingsView />) })
    // The first select we find for model in the Ollama config section
    const selects = screen.getAllByDisplayValue('llama3.1:8b')
    const selectEl = selects.find((el) => el.tagName === 'SELECT')
    expect(selectEl).toBeTruthy()
  })

  /* ── 17. Number input for maxToolCalls ── */
  it('updates maxToolCallsPerLoop preference', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Agent & Skills')) })
    const input = screen.getByDisplayValue('12')
    fireEvent.change(input, { target: { value: '25' } })
    expect(useConfigStore.getState().preferences.maxToolCallsPerLoop).toBe(25)
  })

  /* ── 18. Font scale input in Oberflaeche ── */
  it('updates fontScale preference', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Oberflaeche')) })
    const input = screen.getByDisplayValue('100')
    fireEvent.change(input, { target: { value: '110' } })
    expect(useConfigStore.getState().preferences.fontScale).toBe(110)
  })

  /* ── 19. active category button gets active class ── */
  it('highlights the active category button', async () => {
    await act(async () => { render(<SettingsView />) })
    const nav = screen.getByRole('navigation', { name: 'Einstellungs-Kategorien' })
    const aiBtn = nav.querySelector('.settings-nav-item.active')!
    expect(aiBtn.textContent).toContain('KI & Modell')

    await act(async () => { fireEvent.click(screen.getByText('Oberflaeche')) })
    const uiBtn = nav.querySelector('.settings-nav-item.active')!
    expect(uiBtn.textContent).toContain('Oberflaeche')
  })

  /* ── 20. sidebar has navigation role ── */
  it('sidebar has proper navigation role', async () => {
    await act(async () => { render(<SettingsView />) })
    expect(screen.getByRole('navigation', { name: 'Einstellungs-Kategorien' })).toBeInTheDocument()
  })
})
