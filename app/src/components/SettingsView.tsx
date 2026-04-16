import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useConfigStore } from '../stores/configStore'

type OllamaHealth = {
  ok: boolean
  endpoint: string
  model: string
  latencyMs: number
  version: string | null
  models: string[]
  error: string | null
}

export default function SettingsView() {
  const { ollama, setOllama } = useConfigStore()
  const [health, setHealth] = useState<OllamaHealth | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runHealthCheck = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await invoke<OllamaHealth>('ollama_health_check', {
        config: ollama,
      })
      setHealth(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setHealth(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-view">
      <h1>Einstellungen</h1>

      <section className="panel">
        <h2>Ollama Konfiguration</h2>
        <div className="grid">
          <label>
            Endpoint
            <input
              value={ollama.baseUrl}
              onChange={(e) => setOllama({ baseUrl: e.target.value })}
              placeholder="http://192.168.178.82:11434"
            />
          </label>
          <label>
            Modell
            <input
              value={ollama.model}
              onChange={(e) => setOllama({ model: e.target.value })}
              placeholder="llama3.1:8b"
            />
          </label>
          <label>
            Timeout (ms)
            <input
              type="number"
              min={1000}
              max={120000}
              value={ollama.timeoutMs}
              onChange={(e) =>
                setOllama({ timeoutMs: Number.parseInt(e.target.value || '20000', 10) })
              }
            />
          </label>
        </div>
        <div className="actions">
          <button disabled={busy} onClick={runHealthCheck}>
            {busy ? 'Prüfung läuft...' : 'Health Check ausführen'}
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {health && (
        <section className="panel">
          <h2>Health-Check Ergebnis</h2>
          <div className="card">
            <p>Verbindung: <strong>{health.ok ? 'OK' : 'Fehler'}</strong></p>
            <p>Endpoint: {health.endpoint}</p>
            <p>Modell: {health.model}</p>
            <p>Latenz: {health.latencyMs} ms</p>
            <p>Server-Version: {health.version ?? 'unbekannt'}</p>
            <p>Verfügbare Modelle: {health.models.join(', ') || 'keine'}</p>
            {health.error && <p className="error">{health.error}</p>}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Über</h2>
        <div className="card">
          <p><strong>Open_Cowork</strong> v0.2.0</p>
          <p>Tauri + React + Rust Desktop-App für agentisches Arbeiten</p>
          <p>Ollama-Endpoint: {ollama.baseUrl}</p>
          <p>Aktives Modell: {ollama.model}</p>
        </div>
      </section>
    </div>
  )
}
