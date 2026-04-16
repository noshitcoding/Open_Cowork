import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useConfigStore } from '../stores/configStore'

type McpTool = {
  name: string
  description: string
}

type McpProbeResponse = {
  serverName: string
  protocolVersion: string | null
  serverInfo: string | null
  tools: McpTool[]
}

type McpCallResponse = {
  serverName: string
  toolName: string
  success: boolean
  result: string
  error: string | null
}

export default function McpView() {
  const { mcpServer, setMcpServer } = useConfigStore()
  const [probe, setProbe] = useState<McpProbeResponse | null>(null)
  const [callResult, setCallResult] = useState<McpCallResponse | null>(null)
  const [selectedTool, setSelectedTool] = useState<string>('')
  const [toolArgs, setToolArgs] = useState<string>('{}')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleProbe = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await invoke<McpProbeResponse>('mcp_probe', {
        request: {
          name: mcpServer.name,
          command: mcpServer.command,
          args: mcpServer.args.split(' ').map((a) => a.trim()).filter(Boolean),
        },
      })
      setProbe(response)
      if (response.tools.length > 0) {
        setSelectedTool(response.tools[0].name)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProbe(null)
    } finally {
      setBusy(false)
    }
  }

  const handleToolCall = async () => {
    if (!selectedTool) return
    setBusy(true)
    setError(null)
    setCallResult(null)
    try {
      let parsedArgs: Record<string, unknown>
      try {
        parsedArgs = JSON.parse(toolArgs)
      } catch {
        setError('Ungültiges JSON in Tool-Argumenten')
        setBusy(false)
        return
      }

      const response = await invoke<McpCallResponse>('mcp_call_tool', {
        request: {
          name: mcpServer.name,
          command: mcpServer.command,
          args: mcpServer.args.split(' ').map((a) => a.trim()).filter(Boolean),
          toolName: selectedTool,
          toolArgs: parsedArgs,
        },
      })
      setCallResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mcp-view">
      <h1>MCP Server</h1>

      <section className="panel">
        <h2>Server-Konfiguration</h2>
        <div className="grid">
          <label>
            Name
            <input
              value={mcpServer.name}
              onChange={(e) => setMcpServer({ name: e.target.value })}
            />
          </label>
          <label>
            Command
            <input
              value={mcpServer.command}
              onChange={(e) => setMcpServer({ command: e.target.value })}
            />
          </label>
          <label>
            Args
            <input
              value={mcpServer.args}
              onChange={(e) => setMcpServer({ args: e.target.value })}
            />
          </label>
        </div>
        <div className="actions">
          <button disabled={busy} onClick={handleProbe}>
            {busy ? 'Probe läuft...' : 'Server verbinden & Tools laden'}
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {probe && (
        <section className="panel">
          <h2>Server-Info</h2>
          <div className="card">
            <p>Server: <strong>{probe.serverName}</strong></p>
            <p>Protocol: {probe.protocolVersion ?? 'unbekannt'}</p>
            <p>Info: {probe.serverInfo ?? 'keine'}</p>
          </div>

          <h2>Verfügbare Tools ({probe.tools.length})</h2>
          <ul className="tool-list">
            {probe.tools.map((tool) => (
              <li key={tool.name} className="tool-item">
                <strong>{tool.name}</strong>
                {tool.description && <span> — {tool.description}</span>}
              </li>
            ))}
          </ul>

          {probe.tools.length > 0 && (
            <div className="tool-execute">
              <h2>Tool ausführen</h2>
              <div className="grid">
                <label>
                  Tool
                  <select
                    value={selectedTool}
                    onChange={(e) => setSelectedTool(e.target.value)}
                  >
                    {probe.tools.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Argumente (JSON)
                  <textarea
                    rows={4}
                    value={toolArgs}
                    onChange={(e) => setToolArgs(e.target.value)}
                    placeholder='{"path": "."}'
                  />
                </label>
              </div>
              <div className="actions">
                <button disabled={busy || !selectedTool} onClick={handleToolCall}>
                  {busy ? 'Aufruf läuft...' : 'Tool aufrufen'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {callResult && (
        <section className="panel">
          <h2>Tool-Ergebnis</h2>
          <div className="card">
            <p>Tool: <strong>{callResult.toolName}</strong></p>
            <p>Erfolg: {callResult.success ? 'Ja' : 'Nein'}</p>
            {callResult.error && <p className="error">{callResult.error}</p>}
            <pre className="tool-result">{callResult.result}</pre>
          </div>
        </section>
      )}
    </div>
  )
}
