import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type OllamaConfig = {
  baseUrl: string
  model: string
  timeoutMs: number
}

type OllamaHealth = {
  ok: boolean
  endpoint: string
  model: string
  latencyMs: number
  version: string | null
  models: string[]
  error: string | null
}

type PlanResponse = {
  endpoint: string
  model: string
  rawResponse: string
  steps: string[]
}

type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type ChatTurnResponse = {
  endpoint: string
  model: string
  assistantMessage: string
  requiresApproval: boolean
  proposedPlan: string[]
}

type McpServer = {
  name: string
  command: string
  args: string
}

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

function App() {
  const [config, setConfig] = useState<OllamaConfig>(() => {
    const fallback = {
      baseUrl: 'http://192.168.178.82:11434',
      model: 'llama3.1:8b',
      timeoutMs: 20000,
    }

    const persisted = localStorage.getItem('open-cowork.ollama-config')
    if (!persisted) {
      return fallback
    }

    try {
      const parsed = JSON.parse(persisted) as Partial<OllamaConfig>
      return {
        baseUrl: parsed.baseUrl ?? fallback.baseUrl,
        model: parsed.model ?? fallback.model,
        timeoutMs: parsed.timeoutMs ?? fallback.timeoutMs,
      }
    } catch {
      return fallback
    }
  })
  const [prompt, setPrompt] = useState(
    'Erstelle einen knappen Arbeitsplan für die Implementierung eines sicheren Datei-Backups.'
  )
  const [health, setHealth] = useState<OllamaHealth | null>(null)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'system',
      content:
        'Open_Cowork ist bereit. Sende eine Aufgabe, um Planung und Ausfuehrung im Chatmodus zu starten.',
    },
  ])
  const [chatInput, setChatInput] = useState('')
  const [pendingApproval, setPendingApproval] = useState<string[]>([])
  const [mcpServer, setMcpServer] = useState<McpServer>(() => {
    const persisted = localStorage.getItem('open-cowork.mcp-server')
    if (!persisted) {
      return {
        name: 'filesystem',
        command: 'npx',
        args: '-y @modelcontextprotocol/server-filesystem .',
      }
    }

    try {
      const parsed = JSON.parse(persisted) as Partial<McpServer>
      return {
        name: parsed.name ?? 'filesystem',
        command: parsed.command ?? 'npx',
        args: parsed.args ?? '-y @modelcontextprotocol/server-filesystem .',
      }
    } catch {
      return {
        name: 'filesystem',
        command: 'npx',
        args: '-y @modelcontextprotocol/server-filesystem .',
      }
    }
  })
  const [mcpProbe, setMcpProbe] = useState<McpProbeResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canRun = useMemo(() => {
    return config.baseUrl.trim().length > 0 && config.model.trim().length > 0
  }, [config])

  useEffect(() => {
    localStorage.setItem('open-cowork.ollama-config', JSON.stringify(config))
  }, [config])

  useEffect(() => {
    localStorage.setItem('open-cowork.mcp-server', JSON.stringify(mcpServer))
  }, [mcpServer])

  const runHealthCheck = async () => {
    if (!canRun) return
    setBusy(true)
    setError(null)
    try {
      const response = await invoke<OllamaHealth>('ollama_health_check', { config })
      setHealth(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setHealth(null)
    } finally {
      setBusy(false)
    }
  }

  const runPlan = async (event: FormEvent) => {
    event.preventDefault()
    if (!canRun || prompt.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const response = await invoke<PlanResponse>('generate_plan', {
        request: { prompt, config },
      })
      setPlan(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setPlan(null)
    } finally {
      setBusy(false)
    }
  }

  const runChatTurn = async (event: FormEvent) => {
    event.preventDefault()
    if (!canRun || chatInput.trim().length === 0) return

    const userMessage: ChatMessage = { role: 'user', content: chatInput.trim() }
    const history = messages.filter((msg) => msg.role !== 'system').slice(-12)

    setBusy(true)
    setError(null)
    setMessages((prev) => [...prev, userMessage])

    try {
      const response = await invoke<ChatTurnResponse>('chat_turn', {
        request: {
          prompt: userMessage.content,
          history,
          config,
        },
      })

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: response.assistantMessage,
        },
      ])

      setPendingApproval(response.requiresApproval ? response.proposedPlan : [])
      setChatInput('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const approvePlan = () => {
    if (pendingApproval.length === 0) return

    setMessages((prev) => [
      ...prev,
      {
        role: 'system',
        content: `Plan freigegeben: ${pendingApproval.join(' | ')}`,
      },
    ])
    setPendingApproval([])
  }

  const probeMcpServer = async () => {
    if (mcpServer.command.trim().length === 0) return

    setBusy(true)
    setError(null)
    try {
      const response = await invoke<McpProbeResponse>('mcp_probe', {
        request: {
          name: mcpServer.name,
          command: mcpServer.command,
          args: mcpServer.args
            .split(' ')
            .map((arg) => arg.trim())
            .filter(Boolean),
        },
      })
      setMcpProbe(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setMcpProbe(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="layout">
      <header className="hero">
        <p className="eyebrow">Open_Cowork · Cowork Chat + MCP</p>
        <h1>Lokaler Chat mit Plan-Freigabe und MCP-Server-Anbindung</h1>
        <p className="subtitle">
          Diese Build-Stufe verbindet die Desktop-App mit einem echten Ollama-Endpunkt,
          prueft die Erreichbarkeit und erzeugt einen ersten Arbeitsplan direkt ueber das
          konfigurierte Modell.
        </p>
      </header>

      <section className="panel">
        <h2>Ollama Konfiguration</h2>
        <div className="grid">
          <label>
            Endpoint
            <input
              value={config.baseUrl}
              onChange={(e) => setConfig((old) => ({ ...old, baseUrl: e.target.value }))}
              placeholder="http://192.168.178.82:11434"
            />
          </label>
          <label>
            Modell
            <input
              value={config.model}
              onChange={(e) => setConfig((old) => ({ ...old, model: e.target.value }))}
              placeholder="llama3.1:8b"
            />
          </label>
          <label>
            Timeout (ms)
            <input
              type="number"
              min={1000}
              max={120000}
              value={config.timeoutMs}
              onChange={(e) =>
                setConfig((old) => ({
                  ...old,
                  timeoutMs: Number.parseInt(e.target.value || '20000', 10),
                }))
              }
            />
          </label>
        </div>
        <div className="actions">
          <button disabled={busy || !canRun} onClick={runHealthCheck}>
            {busy ? 'Pruefung laeuft...' : 'Health Check ausfuehren'}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Cowork Chat</h2>
        <div className="chat-log">
          {messages.map((msg, index) => (
            <div key={`${msg.role}-${index}`} className={`chat-msg ${msg.role}`}>
              <strong>{msg.role}</strong>
              <p>{msg.content}</p>
            </div>
          ))}
        </div>

        {pendingApproval.length > 0 ? (
          <div className="approval-box">
            <p>Diese Schritte erfordern Freigabe:</p>
            <ol>
              {pendingApproval.map((step, idx) => (
                <li key={`${step}-${idx}`}>{step}</li>
              ))}
            </ol>
            <button type="button" onClick={approvePlan} disabled={busy}>
              Plan freigeben
            </button>
          </div>
        ) : null}

        <form onSubmit={runChatTurn}>
          <label>
            Nachricht
            <textarea
              rows={4}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Beschreibe die naechste Aufgabe fuer den Agenten"
            />
          </label>
          <button type="submit" disabled={busy || chatInput.trim().length === 0}>
            {busy ? 'Agent antwortet...' : 'Nachricht senden'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>MCP Server</h2>
        <div className="grid">
          <label>
            Name
            <input
              value={mcpServer.name}
              onChange={(e) => setMcpServer((old) => ({ ...old, name: e.target.value }))}
            />
          </label>
          <label>
            Command
            <input
              value={mcpServer.command}
              onChange={(e) => setMcpServer((old) => ({ ...old, command: e.target.value }))}
            />
          </label>
          <label>
            Args
            <input
              value={mcpServer.args}
              onChange={(e) => setMcpServer((old) => ({ ...old, args: e.target.value }))}
            />
          </label>
        </div>
        <div className="actions">
          <button disabled={busy} onClick={probeMcpServer}>
            {busy ? 'MCP Probe laeuft...' : 'MCP Server pruefen'}
          </button>
        </div>

        {mcpProbe ? (
          <div className="card">
            <p>
              Server: <strong>{mcpProbe.serverName}</strong>
            </p>
            <p>Protocol: {mcpProbe.protocolVersion ?? 'unbekannt'}</p>
            <p>Info: {mcpProbe.serverInfo ?? 'keine'}</p>
            <p>Tools:</p>
            <ul>
              {mcpProbe.tools.map((tool) => (
                <li key={tool.name}>
                  <strong>{tool.name}</strong>
                  {tool.description ? ` - ${tool.description}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Plan-Generierung (Rust Orchestrator)</h2>
        <form onSubmit={runPlan}>
          <label>
            Aufgabe
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Beschreibe die Aufgabe, die in Schritte zerlegt werden soll."
            />
          </label>
          <button type="submit" disabled={busy || !canRun || prompt.trim().length === 0}>
            {busy ? 'Plan wird erzeugt...' : 'Plan erzeugen'}
          </button>
        </form>
      </section>

      <section className="panel output">
        <h2>Status</h2>
        {error ? <p className="error">{error}</p> : null}
        {health ? (
          <div className="card">
            <p>
              Verbindung: <strong>{health.ok ? 'OK' : 'Fehler'}</strong>
            </p>
            <p>Endpoint: {health.endpoint}</p>
            <p>Modell: {health.model}</p>
            <p>Latenz: {health.latencyMs} ms</p>
            <p>Server-Version: {health.version ?? 'unbekannt'}</p>
            <p>Verfuegbare Modelle: {health.models.join(', ') || 'keine'}</p>
            {health.error ? <p className="error">{health.error}</p> : null}
          </div>
        ) : (
          <p>Noch kein Health Check ausgefuehrt.</p>
        )}

        {plan ? (
          <div className="card">
            <p>
              Plan ueber <strong>{plan.model}</strong> an <strong>{plan.endpoint}</strong>
            </p>
            <ol>
              {plan.steps.map((step, index) => (
                <li key={`${step}-${index}`}>{step}</li>
              ))}
            </ol>
          </div>
        ) : (
          <p>Noch kein Plan erzeugt.</p>
        )}
      </section>
    </main>
  )
}

export default App
