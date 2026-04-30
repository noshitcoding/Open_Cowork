import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView'
import { useConfigStore } from '../stores/configStore'
import { useEngineStore } from '../stores/engineStore'

const invokeMock = vi.fn()
const checkOllamaStatusMock = vi.fn()
const fetchOllamaModelsMock = vi.fn()

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
      model: 'gpt-oss:20b',
      timeoutMs: 200000,
      contextWindow: 128000,
      temperature: 0.1,
    },
    openAIComputerUse: {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'computer-use-preview',
      maxSteps: 40,
      actionDelayMs: 900,
      launchDelayMs: 2000,
      autoAcknowledgeSafetyChecks: false,
    },
    llmProfiles: [
      {
        id: 'default-ollama',
        name: 'Lokales Ollama',
        provider: 'ollama',
        baseUrl: 'http://192.168.178.82:11434',
        model: 'gpt-oss:20b',
        apiKey: '',
        timeoutMs: 200000,
        contextWindow: 128000,
        temperature: 0.1,
      },
      {
        id: 'default-openai-compatible',
        name: 'OpenAI-kompatibel',
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        apiKey: '',
        timeoutMs: 600000,
        contextWindow: null,
        temperature: null,
      },
      {
        id: 'default-openrouter',
        name: 'OpenRouter',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: '',
        apiKey: '',
        timeoutMs: 600000,
        contextWindow: null,
        temperature: null,
      },
    ],
    defaultLlmProfileIds: {
      ollama: 'default-ollama',
      'openai-compatible': 'default-openai-compatible',
      openrouter: 'default-openrouter',
    },
    llmProfileModels: {
      'default-ollama': [],
      'default-openai-compatible': [],
      'default-openrouter': [],
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

function resetEngineStore() {
  checkOllamaStatusMock.mockReset()
  fetchOllamaModelsMock.mockReset()
  checkOllamaStatusMock.mockResolvedValue(true)
  fetchOllamaModelsMock.mockResolvedValue([
    { id: 'gpt-oss:20b', name: 'gpt-oss:20b', size: 1 },
  ])
  useEngineStore.setState({
    config: {
      ...useEngineStore.getState().config,
      maxTurns: 25,
      permissionMode: 'default',
      appendSystemPrompt: '',
      sessionPersistence: true,
    },
    contextWarning: { level: 'none', estimatedTokens: 0 },
    compactionCount: 0,
    currentSessionId: null,
    checkOllamaStatus: checkOllamaStatusMock,
    fetchOllamaModels: fetchOllamaModelsMock,
  })
}

describe('SettingsView', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockImplementation(defaultInvoke)
    resetConfigStore()
    resetEngineStore()
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

  /* ── 11. Legacy Ollama config section removed ── */
  it('does not render the legacy Ollama Konfiguration section', async () => {
    await act(async () => { render(<SettingsView />) })
    expect(screen.queryByRole('heading', { level: 2, name: /Ollama Konfiguration/ })).not.toBeInTheDocument()
  })

  /* ── 12. Default Ollama profile endpoint updates store ── */
  it('updates default Ollama profile endpoint on input change', async () => {
    await act(async () => { render(<SettingsView />) })
    const profileCard = screen.getByText('Lokales Ollama', { selector: 'strong' }).closest('.card') as HTMLElement
    const endpointInput = within(profileCard).getByLabelText('Endpoint')
    fireEvent.change(endpointInput, { target: { value: 'http://localhost:11434' } })
    expect(useConfigStore.getState().ollama.baseUrl).toBe('http://localhost:11434')
    expect(useConfigStore.getState().llmProfiles.find((profile) => profile.id === 'default-ollama')?.baseUrl).toBe('http://localhost:11434')
  })

  /* ── 13. Default Ollama profile model updates store ── */
  it('updates default Ollama profile model on input change', async () => {
    useConfigStore.getState().setLlmProfileModels('default-ollama', ['gpt-oss:20b', 'mistral:7b'])
    await act(async () => { render(<SettingsView />) })
    const profileCard = screen.getByText('Lokales Ollama', { selector: 'strong' }).closest('.card') as HTMLElement
    const modelControl = within(profileCard).getByLabelText('Modell')
    expect(modelControl.tagName).toBe('SELECT')
    fireEvent.change(modelControl, { target: { value: 'mistral:7b' } })
    expect(useConfigStore.getState().ollama.model).toBe('mistral:7b')
    expect(useConfigStore.getState().llmProfiles.find((profile) => profile.id === 'default-ollama')?.model).toBe('mistral:7b')
  })

  it('renders OpenAI Computer Use settings and keeps profile normalization separate', async () => {
    await act(async () => { render(<SettingsView />) })

    const section = screen.getByRole('heading', { level: 2, name: /OpenAI Computer Use/ }).closest('.panel') as HTMLElement
    const modelInput = within(section).getByLabelText('Modell')
    fireEvent.change(modelInput, { target: { value: 'computer-use-2025-03' } })

    expect(useConfigStore.getState().openAIComputerUse.model).toBe('computer-use-2025-03')

    await act(async () => {
      useConfigStore.getState().updateLlmProfile('default-openai-compatible', {
        model: 'computer-use-preview',
      })
    })

    expect(
      useConfigStore.getState().llmProfiles.find((profile) => profile.id === 'default-openai-compatible')?.model,
    ).toBe('gpt-4.1-mini')
  })

  /* ── 14. Toggle updates preference ── */
  it('toggles autoApproveSafeTools preference', async () => {
    await act(async () => { render(<SettingsView />) })
    await act(async () => { fireEvent.click(screen.getByText('Agent & Skills')) })
    const toggleBtn = screen.getByText('Sichere Tools automatisch genehmigen').closest('.toggle-row')!.querySelector('button[role="switch"]')!
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggleBtn)
    expect(useConfigStore.getState().preferences.autoApproveSafeTools).toBe(false)
  })

  /* ── 15. Model dropdown with Ollama profile models ── */
  it('renders model dropdown when Ollama profile models are set', async () => {
    useConfigStore.getState().setLlmProfileModels('default-ollama', ['gpt-oss:20b', 'mistral:7b', 'codellama:13b'])
    await act(async () => { render(<SettingsView />) })
    const profileCard = screen.getByText('Lokales Ollama', { selector: 'strong' }).closest('.card') as HTMLElement
    const modelControl = within(profileCard).getByLabelText('Modell')
    expect(modelControl.tagName).toBe('SELECT')
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
