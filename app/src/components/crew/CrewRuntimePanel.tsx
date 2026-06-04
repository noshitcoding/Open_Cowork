import { useEffect } from 'react'
import { useCrewRuntimeStore } from '../../stores/crewRuntimeStore'
import { tr } from '../../i18n'

function formatTimestamp(value: string | null): string {
  if (!value) return 'nie'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US')
}

export default function CrewRuntimePanel() {
  const { status, loading, bootstrapping, error, loadStatus, bootstrap } = useCrewRuntimeStore()

  useEffect(() => {
    if (!status && !loading) {
      void loadStatus()
    }
  }, [loadStatus, loading, status])

  return (
    <div className="card crew-overview-card crew-runtime-panel">
      <div className="crew-overview-head">
        <div className="crew-overview-copy">
          <div className="crew-overview-kicker">{tr("Crew Runtime")}</div>
          <div className="crew-overview-title-row">
            <strong className="crew-overview-title">{tr("Python + CrewAI")}</strong>
            <span className={`crew-status-pill${status?.ready ? ' ready' : ' warning'}`}>
              {status?.ready ? 'ready' : 'Setup erforderlich'}
            </span>
          </div>
          <div className="crew-overview-description">
            {status?.message ?? 'The production crew runtime runs through an embedded Python environment with CrewAI.'}
          </div>
        </div>
        <div className="crew-overview-actions">
          <button type="button" className="btn-sm crew-action-btn" onClick={() => void loadStatus()} disabled={loading || bootstrapping}>
            {loading ? 'Check…' : 'Load status'}
          </button>
          <button type="button" className="btn-sm crew-action-btn" onClick={() => void bootstrap(false)} disabled={loading || bootstrapping}>
            {bootstrapping ? 'Initializing...' : 'Initialize runtime'}
          </button>
          <button type="button" className="btn-sm crew-action-btn" onClick={() => void bootstrap(true)} disabled={loading || bootstrapping}>
            {bootstrapping ? 'Rebuilding...' : 'Reinstall'}
          </button>
        </div>
      </div>

      {error && (
        <div className="crew-inline-feedback error">{error}</div>
      )}

      {status && (
        <div className="crew-stat-grid">
          <div className="crew-stat-card">
            <div className="crew-stat-label">{tr("Python")}</div>
            <div className="crew-stat-value">{status.pythonVersion ?? 'unknown'}</div>
            <div className="crew-stat-meta crew-wrap-anywhere">{status.detectedPythonPath ?? status.embeddedPythonPath ?? 'no interpreter detected'}</div>
          </div>
          <div className="crew-stat-card">
            <div className="crew-stat-label">{tr("CrewAI")}</div>
            <div className="crew-stat-value">{status.crewaiInstalled ? `installed${status.crewaiVersion ? ` (${status.crewaiVersion})` : ''}` : 'not installed'}</div>
            <div className="crew-stat-meta">{tr("Letztes Bootstrap:")}{formatTimestamp(status.lastBootstrapAt)}</div>
          </div>
          <div className="crew-stat-card">
            <div className="crew-stat-label">{tr("Runtime Root")}</div>
            <div className="crew-stat-value crew-wrap-anywhere">{status.runtimeRoot}</div>
          </div>
          <div className="crew-stat-card">
            <div className="crew-stat-label">{tr("Venv")}</div>
            <div className="crew-stat-value crew-wrap-anywhere">{status.venvPythonPath ?? 'not created yet'}</div>
          </div>
        </div>
      )}
    </div>
  )
}