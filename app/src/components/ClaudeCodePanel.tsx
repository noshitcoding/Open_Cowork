import { useEffect, useMemo, useState } from 'react'
import type { EngineConfig, Command, Tool } from '../engine'
import { getAllCommands, getAllTools, registerBuiltinCommands, registerAllBuiltinTools } from '../engine'
import { useConfigStore } from '../stores/configStore'
import {
  selectCompactionCount,
  selectContextWarning,
  selectIsEngineReady,
  useEngineStore,
} from '../stores/engineStore'

type SubTab = 'status' | 'commands' | 'tools' | 'config'

let registriesInitialized = false
function ensureRegistries() {
  if (!registriesInitialized) {
    registerBuiltinCommands()
    registerAllBuiltinTools()
    registriesInitialized = true
  }
}

export default function ClaudeCodePanel() {
  const {
    setActiveProvider,
    config,
    setConfig,
    status,
    totalUsage,
    totalCostUsd,
    activeTools,
    error,
    clearError,
    forceCompact,
    currentSessionId,
    contextSnapshot,
    fetchOllamaModels,
    checkOllamaStatus,
  } = useEngineStore()
  const compactionCount = useEngineStore(selectCompactionCount)
  const contextWarning = useEngineStore(selectContextWarning)
  const isReady = useEngineStore(selectIsEngineReady)

  const ollama = useConfigStore((s) => s.ollama)
  const setOllama = useConfigStore((s) => s.setOllama)
  const availableModels = useConfigStore((s) => s.availableModels)

  const [subTab, setSubTab] = useState<SubTab>('status')
  const [commandFilter, setCommandFilter] = useState('')
  const [toolFilter, setToolFilter] = useState('')
  const [commands, setCommands] = useState<Command[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null)

  useEffect(() => {
    ensureRegistries()
    setActiveProvider('ollama')
    setCommands(getAllCommands())
    setTools([...getAllTools()])
    void refreshRuntimeInfo()
  }, [])

  const refreshRuntimeInfo = async () => {
    setRefreshing(true)
    try {
      const [reachable] = await Promise.all([
        checkOllamaStatus(),
        fetchOllamaModels().catch(() => []),
      ])
      setOllamaReachable(reachable)
    } finally {
      setRefreshing(false)
    }
  }

  const groupedCommands = useMemo(() => {
    const lowerFilter = commandFilter.toLowerCase()
    const filtered = commands.filter(
      (command) =>
        command.name.toLowerCase().includes(lowerFilter) ||
        command.description.toLowerCase().includes(lowerFilter) ||
        command.category.toLowerCase().includes(lowerFilter),
    )
    const groups: Record<string, Command[]> = {}
    for (const command of filtered) {
      const category = command.category
      if (!groups[category]) groups[category] = []
      groups[category].push(command)
    }
    return groups
  }, [commands, commandFilter])

  const groupedTools = useMemo(() => {
    const lowerFilter = toolFilter.toLowerCase()
    const filtered = tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(lowerFilter) ||
        tool.description.toLowerCase().includes(lowerFilter) ||
        tool.category.toLowerCase().includes(lowerFilter),
    )
    const groups: Record<string, Tool[]> = {}
    for (const tool of filtered) {
      const category = tool.category
      if (!groups[category]) groups[category] = []
      groups[category].push(tool)
    }
    return groups
  }, [tools, toolFilter])

  const categoryLabels: Record<string, string> = {
    session: 'Session',
    config: 'Konfiguration',
    code: 'Code & Dateien',
    planning: 'Planung',
    agents: 'Agenten & Tasks',
    tools: 'Tools & Erweiterungen',
    bridge: 'IDE & Bridge',
    debug: 'Debugging',
    advanced: 'Erweitert',
    execution: 'Ausfuehrung',
    filesystem: 'Dateien',
    file: 'Dateien',
    web: 'Web',
    mcp: 'MCP',
    search: 'Suche',
    memory: 'Memory',
    shell: 'Shell',
    agent: 'Agenten',
    interaction: 'Interaktion',
    task: 'Tasks',
    info: 'Info',
    navigation: 'Navigation',
  }

  return (
    <div className="panel">
      <div className="panel-heading-row">
        <h2>Claude Code Backend</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Backend: Ollama-only</span>
          <button type="button" className="btn-sm" onClick={() => void refreshRuntimeInfo()} disabled={refreshing}>
            {refreshing ? 'Aktualisiere...' : 'Status aktualisieren'}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
        Die Engine laeuft ausschliesslich lokal ueber Ollama. Alte Anthropic- oder Cloud-UIs sind in diesem Panel deaktiviert.
      </p>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0, flex: 1 }}>{error}</p>
          <button type="button" className="btn-sm" onClick={clearError} style={{ fontSize: 11 }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>
        {(
          [
            { key: 'status', label: 'Status' },
            { key: 'commands', label: `Commands (${commands.length})` },
            { key: 'tools', label: `Tools (${tools.length})` },
            { key: 'config', label: 'Konfiguration' },
          ] as { key: SubTab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`btn-sm${subTab === tab.key ? ' active' : ''}`}
            onClick={() => setSubTab(tab.key)}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'status' && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div>
                <strong>Status:</strong>{' '}
                <span style={{ color: status === 'error' ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                  {status === 'idle' && 'Bereit'}
                  {status === 'streaming' && 'Streaming'}
                  {status === 'tool_running' && 'Tool laeuft'}
                  {status === 'waiting_approval' && 'Warte auf Freigabe'}
                  {status === 'error' && 'Fehler'}
                </span>
              </div>
              <div>
                <strong>Ollama:</strong>{' '}
                <span style={{ color: ollamaReachable === false ? 'var(--danger)' : 'var(--success)' }}>
                  {ollamaReachable === null ? 'Ungeprueft' : ollamaReachable ? 'Erreichbar' : 'Nicht erreichbar'}
                </span>
              </div>
              <div><strong>Endpoint:</strong> {ollama.baseUrl}</div>
              <div><strong>Modell:</strong> {ollama.model}</div>
              <div><strong>Session:</strong> {currentSessionId ?? 'Keine aktive Session'}</div>
              <div><strong>Compactions:</strong> {compactionCount}</div>
              <div>
                <strong>Kontextwarnung:</strong>{' '}
                {contextWarning.level === 'none'
                  ? 'Keine'
                  : `${contextWarning.level} (${contextWarning.estimatedTokens} Tokens)`}
              </div>
              <div>
                <strong>Tokens:</strong>{' '}
                {totalUsage.input_tokens + totalUsage.output_tokens > 0
                  ? `${totalUsage.input_tokens} in / ${totalUsage.output_tokens} out`
                  : '—'}
              </div>
              <div><strong>Kosten:</strong> ${totalCostUsd.toFixed(4)}</div>
              <div><strong>Kontext gesamt:</strong> {contextSnapshot?.totalTokens ?? 0}</div>
              <div><strong>Nachrichten im Kontext:</strong> {contextSnapshot?.messageCount ?? 0}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn-sm" onClick={() => void forceCompact()} disabled={status !== 'idle'}>
                Jetzt kompaktieren
              </button>
              <button type="button" className="btn-sm" onClick={() => void refreshRuntimeInfo()} disabled={refreshing}>
                Modelle & Status neu laden
              </button>
            </div>
          </div>

          {activeTools.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Aktive Tools</h3>
              {activeTools.map((tool) => (
                <div key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: tool.status === 'running' ? 'var(--warning)' : tool.status === 'completed' ? 'var(--success)' : 'var(--danger)' }}>
                    {tool.status === 'running' ? '⟳' : tool.status === 'completed' ? '✓' : '✕'}
                  </span>
                  <code>{tool.toolName}</code>
                  <span style={{ color: 'var(--text-muted)' }}>{((Date.now() - tool.startedAt) / 1000).toFixed(1)}s</span>
                </div>
              ))}
            </div>
          )}

          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Verfuegbare Engine-Features</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {[
              { label: 'Ollama Chat-Loop', desc: 'Lokales Modell mit Tools und Streaming' },
              { label: `${tools.length} Tools`, desc: 'Dateien, Shell, Planung, Search und MCP' },
              { label: `${commands.length} Commands`, desc: 'Slash-Commands aus dem Engine-Registry' },
              { label: 'Session Persistence', desc: 'Konversationen speichern, laden und fortsetzen' },
              { label: 'Kontextmanagement', desc: 'Warnungen, Snapshot und automatische Compaction' },
              { label: 'Memory System', desc: 'CLAUDE.md, .cowork und globale Hinweise' },
              { label: 'Retry & Recovery', desc: 'Prompt-too-long und Verbindungs-Retries' },
              { label: 'Parallel Tools', desc: 'Concurrency-Limits und Timeouts' },
            ].map((feature) => (
              <div key={feature.label} className="card" style={{ padding: '8px 10px', fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{feature.label}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{feature.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'commands' && (
        <div>
          <input
            type="text"
            value={commandFilter}
            onChange={(event) => setCommandFilter(event.target.value)}
            placeholder="Commands durchsuchen..."
            style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, marginBottom: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          />

          {Object.entries(groupedCommands).map(([category, items]) => (
            <div key={category} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{categoryLabels[category] ?? category}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {items.map((command) => (
                  <div key={command.name} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', fontSize: 12 }}>
                    <div>
                      <code style={{ fontWeight: 600, color: 'var(--accent)' }}>{command.name}</code>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{command.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {Object.keys(groupedCommands).length === 0 && <p className="panel-empty">Keine Commands gefunden</p>}
        </div>
      )}

      {subTab === 'tools' && (
        <div>
          <input
            type="text"
            value={toolFilter}
            onChange={(event) => setToolFilter(event.target.value)}
            placeholder="Tools durchsuchen..."
            style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, marginBottom: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          />

          {Object.entries(groupedTools).map(([category, items]) => (
            <div key={category} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{categoryLabels[category] ?? category}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                {items.map((tool) => (
                  <div key={tool.name} className="card" style={{ padding: '8px 10px', fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}><code>{tool.name}</code></div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{tool.description}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {Object.keys(groupedTools).length === 0 && <p className="panel-empty">Keine Tools gefunden</p>}
        </div>
      )}

      {subTab === 'config' && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Engine-Konfiguration</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 12 }}>
                Ollama Endpoint
                <input
                  value={ollama.baseUrl}
                  onChange={(event) => setOllama({ baseUrl: event.target.value })}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                Modell
                {availableModels.length > 0 ? (
                  <select
                    value={ollama.model}
                    onChange={(event) => setOllama({ model: event.target.value })}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  >
                    {availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
                    {!availableModels.includes(ollama.model) && <option value={ollama.model}>{ollama.model}</option>}
                  </select>
                ) : (
                  <input
                    value={ollama.model}
                    onChange={(event) => setOllama({ model: event.target.value })}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  />
                )}
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 12 }}>
                Max Turns
                <input
                  type="number"
                  value={config.maxTurns}
                  onChange={(event) => setConfig({ maxTurns: Number(event.target.value) || 25 })}
                  min={1}
                  max={200}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                Berechtigungsmodus
                <select
                  value={config.permissionMode}
                  onChange={(event) => setConfig({ permissionMode: event.target.value as EngineConfig['permissionMode'] })}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  <option value="default">Standard</option>
                  <option value="plan">Plan</option>
                  <option value="bypass">Bypass</option>
                  <option value="strict">Strikt</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 12 }}>
                Context Window
                <input
                  type="number"
                  value={ollama.contextWindow}
                  onChange={(event) => setOllama({ contextWindow: Number(event.target.value) || 128000 })}
                  min={512}
                  max={131072}
                  step={512}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                Session Persistence
                <select
                  value={config.sessionPersistence ? 'enabled' : 'disabled'}
                  onChange={(event) => setConfig({ sessionPersistence: event.target.value === 'enabled' })}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  <option value="enabled">Aktiviert</option>
                  <option value="disabled">Deaktiviert</option>
                </select>
              </label>
            </div>

            <label style={{ fontSize: 12, display: 'block' }}>
              System-Prompt Erweiterung
              <textarea
                rows={4}
                value={config.appendSystemPrompt}
                onChange={(event) => setConfig({ appendSystemPrompt: event.target.value })}
                placeholder="Zusaetzliche Anweisungen fuer den Agenten..."
                style={{ width: '100%', resize: 'vertical', marginTop: 4 }}
              />
            </label>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
              {isReady ? 'Engine bereit fuer lokale Ollama-Anfragen.' : 'Die Engine konnte noch nicht initialisiert werden.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
