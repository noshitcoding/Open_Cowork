import { useEffect, useState } from 'react'
import { useProcessStore, type ProcessStatusResult } from '../stores/processStore'

export default function ProcessPanel() {
  const { processes, loading, error, loadProcesses, startProcess, stopProcess, approveProcess } = useProcessStore()
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    loadProcesses()
    const interval = setInterval(loadProcesses, 5000)
    return () => clearInterval(interval)
  }, [loadProcesses])

  const handleStart = async () => {
    if (!label.trim() || !command.trim()) return
    await startProcess(label.trim(), command.trim())
    setLabel('')
    setCommand('')
    setShowForm(false)
    loadProcesses()
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return 'var(--success)'
      case 'stopped': return 'var(--text-muted)'
      case 'failed': return 'var(--danger)'
      case 'pending_approval': return 'var(--warning)'
      default: return 'var(--text-secondary)'
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'running': return 'Laeuft'
      case 'stopped': return 'Gestoppt'
      case 'failed': return 'Fehler'
      case 'pending_approval': return 'Warte auf Freigabe'
      default: return status
    }
  }

  return (
    <div className="panel">
      <div className="panel-heading-row">
        <h2>⚙️ Prozesse</h2>
        <button type="button" className="btn-sm" onClick={() => setShowForm(!showForm)}>+ Starten</button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}

      {showForm && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', marginBottom: 8 }}>
            <label>
              Label
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z.B. Dev Server" />
            </label>
            <label>
              Befehl
              <input type="text" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="z.B. npm run dev" />
            </label>
          </div>
          <button type="button" className="btn-sm" onClick={handleStart}>Prozess starten</button>
        </div>
      )}

      {loading ? (
        <p className="panel-empty">Laden...</p>
      ) : processes.length === 0 ? (
        <p className="panel-empty">Keine aktiven Prozesse</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {processes.map((proc: ProcessStatusResult) => (
            <div key={proc.processId} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{proc.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{proc.command}</div>
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  <span style={{ color: statusColor(proc.status) }}>{statusLabel(proc.status)}</span>
                  {proc.pid != null && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>PID: {proc.pid}</span>}
                  {proc.requiresAdmin && <span style={{ color: 'var(--warning)', marginLeft: 8 }}>Admin</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {proc.status === 'pending_approval' && (
                  <>
                    <button type="button" className="btn-sm" onClick={async () => { await approveProcess(proc.processId, true); loadProcesses() }}
                      style={{ color: 'var(--success)' }}>✓</button>
                    <button type="button" className="btn-sm" onClick={async () => { await approveProcess(proc.processId, false); loadProcesses() }}
                      style={{ color: 'var(--danger)' }}>✗</button>
                  </>
                )}
                {proc.status === 'running' && (
                  <button type="button" className="btn-sm" onClick={async () => { await stopProcess(proc.processId); loadProcesses() }}
                    style={{ color: 'var(--danger)' }}>Stop</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
