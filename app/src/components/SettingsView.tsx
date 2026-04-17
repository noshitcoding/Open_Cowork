import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useConfigStore } from '../stores/configStore'
import type { AppPreferences, StartView } from '../stores/configStore'

type OllamaHealth = {
  ok: boolean
  endpoint: string
  model: string
  latencyMs: number
  version: string | null
  models: string[]
  error: string | null
}

/* ── Tiny reusable primitives (App.css based) ── */

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <div className="toggle-label">
        <span>{label}</span>
        {hint && <small className="hint-text">{hint}</small>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`toggle-switch${checked ? ' on' : ''}`}
      >
        <span className="toggle-knob" />
      </button>
    </label>
  )
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h2>{icon} {title}</h2>
      {children}
    </div>
  )
}

/* ── Main Component ─────────────────────────── */

export default function SettingsView() {
  const { ollama, setOllama, preferences, setPreference, availableModels } = useConfigStore()
  const [health, setHealth] = useState<OllamaHealth | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pref = <K extends keyof AppPreferences>(key: K) => ({
    checked: preferences[key] as boolean,
    onChange: (v: boolean) => setPreference(key, v as AppPreferences[K]),
  })

  const runHealthCheck = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await invoke<OllamaHealth>('ollama_health_check', { config: ollama })
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
      <p className="hint-text">Konfiguration und Präferenzen verwalten</p>

      {/* ── Ollama ─────────────────── */}
      <Section title="Ollama Konfiguration" icon="🤖">
        <div className="grid">
          <label>
            Endpoint
            <input value={ollama.baseUrl} onChange={(e) => setOllama({ baseUrl: e.target.value })} placeholder="http://192.168.178.82:11434" style={{ fontFamily: 'monospace' }} />
          </label>
          <label>
            Modell
            {availableModels.length > 0 ? (
              <select value={ollama.model} onChange={(e) => setOllama({ model: e.target.value })}>
                {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                {!availableModels.includes(ollama.model) && <option value={ollama.model}>{ollama.model}</option>}
              </select>
            ) : (
              <input value={ollama.model} onChange={(e) => setOllama({ model: e.target.value })} placeholder="llama3.1:8b" />
            )}
          </label>
          <label>
            Timeout (ms)
            <input type="number" min={1000} max={600000} step={1000} value={ollama.timeoutMs} onChange={(e) => setOllama({ timeoutMs: Number(e.target.value) })} />
          </label>
          <label>
            Context Window
            <input type="number" min={512} max={131072} step={512} value={ollama.contextWindow} onChange={(e) => setOllama({ contextWindow: Number(e.target.value) })} />
          </label>
          <label>
            Temperature
            <input type="number" min={0} max={2} step={0.05} value={ollama.temperature} onChange={(e) => setOllama({ temperature: Number(e.target.value) })} />
          </label>
        </div>
        <div className="actions">
          <button disabled={busy} onClick={runHealthCheck}>
            {busy ? '⏳ Prüfung läuft...' : '🔍 Health Check'}
          </button>
          {health && <span className={health.ok ? 'success' : 'error'}>{health.ok ? '✓ Verbunden' : '✗ Fehler'}</span>}
        </div>
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        {health && (
          <div className="card" style={{ marginTop: 12 }}>
            <p><strong>Latenz:</strong> {health.latencyMs} ms</p>
            <p><strong>Server-Version:</strong> {health.version ?? '—'}</p>
            <p><strong>Verfügbare Modelle:</strong> {health.models.join(', ') || 'keine'}</p>
          </div>
        )}
        <Toggle label="Stream-Antworten automatisch speichern" hint="Ollama-Antworten werden während des Streamings gesichert" {...pref('ollamaStreamAutosave')} />
      </Section>

      {/* ── Agent-Verhalten ──────── */}
      <Section title="Agent-Verhalten" icon="⚡">
        <Toggle label="Sichere Tools automatisch genehmigen" hint="Leseoperationen ohne Bestätigung ausführen" {...pref('autoApproveSafeTools')} />
        <Toggle label="Autopilot für alle Tools" hint="Alle Tool-Aufrufe automatisch genehmigen (Vorsicht!)" {...pref('autoPilotAllTools')} />
        <Toggle label="Bei wiederholtem Fehler zum Menschen wechseln" hint="Agent stoppt nach mehreren Fehlversuchen" {...pref('fallbackToHumanOnRepeatedFailure')} />
        <Toggle label="Batch Multi-Select für Tasks" hint="Mehrere Tasks gleichzeitig auswählen und bearbeiten" {...pref('taskBatchMultiSelectEnabled')} />
        <div className="grid" style={{ marginTop: 12 }}>
          <label>
            Max Tool-Aufrufe pro Schleife
            <input type="number" min={1} max={50} value={preferences.maxToolCallsPerLoop} onChange={(e) => setPreference('maxToolCallsPerLoop', Number(e.target.value))} />
          </label>
        </div>
      </Section>

      {/* ── Dateisicherheit ──────── */}
      <Section title="Dateisicherheit" icon="🔒">
        <Toggle label="Nur-Lesen-Modus" hint="Keine Dateien schreiben oder löschen" {...pref('readOnlyFsMode')} />
        <div className="grid" style={{ marginTop: 12 }}>
          <label>
            Erlaubte Befehle (Whitelist)
            <textarea rows={3} value={preferences.commandWhitelist} onChange={(e) => setPreference('commandWhitelist', e.target.value)} placeholder="Ein Befehl pro Zeile" />
          </label>
          <label>
            Gesperrte Befehle (Blacklist)
            <textarea rows={3} value={preferences.commandBlacklist} onChange={(e) => setPreference('commandBlacklist', e.target.value)} placeholder="Ein Befehl pro Zeile" />
          </label>
        </div>
      </Section>

      {/* ── Oberfläche ───────────── */}
      <Section title="Oberfläche" icon="🎨">
        <Toggle label="Fokusmodus" hint="Sidebar und Ablenkungen ausblenden" {...pref('focusMode')} />
        <Toggle label="Kompaktmodus" hint="Weniger Abstände für mehr Inhalt" {...pref('compactMode')} />
        <Toggle label="Zeitstempel anzeigen" hint="Uhrzeiten bei Chat-Nachrichten" {...pref('showTimestamps')} />
        <Toggle label="Shortcut-Overlay aktivieren" hint="Tastenkürzel-Hilfe über Ctrl+Shift+?" {...pref('shortcutOverlayEnabled')} />
        <Toggle label="Theme mit System synchronisieren" hint="Light/Dark automatisch nach OS-Einstellung" {...pref('syncThemeWithSystem')} />
        <div className="grid" style={{ marginTop: 12 }}>
          <label>
            Schriftgröße (%)
            <input type="number" min={85} max={120} step={5} value={preferences.fontScale} onChange={(e) => setPreference('fontScale', Number(e.target.value))} />
          </label>
          <label>
            Startansicht
            <select value={preferences.defaultStartView} onChange={(e) => setPreference('defaultStartView', e.target.value as StartView)}>
              <option value="last">Letzte Ansicht</option>
              <option value="work">Arbeitsbereich</option>
              <option value="settings">Einstellungen</option>
            </select>
          </label>
        </div>
      </Section>

      {/* ── Benachrichtigungen ───── */}
      <Section title="Benachrichtigungen & Sound" icon="🔔">
        <Toggle label="Desktop-Benachrichtigungen" hint="Windows-Notifications bei wichtigen Ereignissen" {...pref('notificationsEnabled')} />
        <Toggle label="Sounds aktivieren" hint="Akustisches Feedback bei Aktionen" {...pref('soundsEnabled')} />
        <Toggle label="Bestätigung beim Schließen mit laufenden Tasks" hint="Warnung vor versehentlichem Beenden" {...pref('confirmOnCloseWithRunningTasks')} />
      </Section>

      {/* ── Daten & Speicherung ─── */}
      <Section title="Daten & Speicherung" icon="💾">
        <Toggle label="Telemetrie aktivieren" hint="Anonyme Nutzungsstatistiken senden" {...pref('telemetryEnabled')} />
        <Toggle label="Automatisches DB-Backup" hint="SQLite-Datenbank regelmäßig sichern" {...pref('autoBackupDb')} />
        <Toggle label="DB-Cleanup beim Start" hint="Verwaiste Einträge beim App-Start bereinigen" {...pref('dbCleanupOnStart')} />
        <div className="grid" style={{ marginTop: 12 }}>
          <label>
            Chat-Aufbewahrung (Tage)
            <input type="number" min={1} max={365} value={preferences.chatRetentionDays} onChange={(e) => setPreference('chatRetentionDays', Number(e.target.value))} />
          </label>
          <label>
            Backup-Intervall (Stunden)
            <input type="number" min={1} max={168} value={preferences.dbBackupIntervalHours} onChange={(e) => setPreference('dbBackupIntervalHours', Number(e.target.value))} />
          </label>
        </div>
      </Section>

      {/* ── MCP Einstellungen ────── */}
      <Section title="MCP Server-Einstellungen" icon="🔌">
        <Toggle label="Auto-Reconnect" hint="MCP-Server bei Verbindungsverlust automatisch neu verbinden" {...pref('mcpAutoReconnect')} />
        <Toggle label="Verbose Logging" hint="Detailliertes MCP-Protokoll-Logging" {...pref('mcpVerboseLogging')} />
        <Toggle label="Env-Editor aktivieren" hint="Umgebungsvariablen manuell bearbeiten" {...pref('mcpEnvEditorEnabled')} />
        <Toggle label="Manueller JSON-Import" hint="MCP-Server per JSON-Import hinzufügen" {...pref('mcpAllowManualImport')} />
      </Section>

      {/* ── Workspace ────────────── */}
      <Section title="Workspace & System" icon="📁">
        <Toggle label="Beim Systemstart starten" hint="App automatisch mit Windows starten" {...pref('launchAtStartup')} />
        <div className="grid" style={{ marginTop: 12 }}>
          <label>
            Standard-Workspace-Pfad
            <input value={preferences.workspaceDefaultPath} onChange={(e) => setPreference('workspaceDefaultPath', e.target.value)} placeholder="C:\Projekte\mein-workspace" style={{ fontFamily: 'monospace' }} />
          </label>
        </div>
      </Section>

      {/* ── Über ─────────────────── */}
      <Section title="Über Open_Cowork" icon="✦">
        <div className="card">
          <p><strong>Open_Cowork</strong> v0.2.0</p>
          <p>Tauri + React + Rust Desktop-App für agentisches Arbeiten</p>
          <p><strong>Endpoint:</strong> {ollama.baseUrl}</p>
          <p><strong>Modell:</strong> {ollama.model}</p>
        </div>
      </Section>
    </div>
  )
}
