import { useEffect, useState } from 'react'
import { useEngineStore } from '../stores/engineStore'
import { safeInvoke } from '../utils/safeInvoke'

type EngineRunRow = {
  id: string
  parentRunId: string | null
  sessionId: string | null
  title: string
  inputSummary: string | null
  status: string
  phase: string
  cwd: string | null
  model: string | null
  provider: string | null
  retryCount: number
  resumedFromRunId: string | null
  checkpointJson: string | null
  resultSummary: string | null
  error: string | null
  updatedAt: string
  createdAt: string
}

type EngineRunCheckpointRow = {
  id: string
  runId: string
  label: string
  snapshotJson: string
  createdAt: string
}

type WorkerSandboxRow = {
  id: string
  runId: string
  backendId: string | null
  status: string
  mode: string
  sourceCwd: string
  workspaceRoot: string
  allowFileRead: boolean
  allowFileWrite: boolean
  allowShellExecution: boolean
  allowWebFetch: boolean
  allowWebSearch: boolean
  allowMcp: boolean
}

type RawRecord = Record<string, unknown>

const ISO_EPOCH = new Date(0).toISOString()

const asRecord = (value: unknown): RawRecord =>
  value && typeof value === 'object' ? value as RawRecord : {}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback

const asTimestampString = (primary: unknown, secondary?: unknown): string => {
  const value = asString(primary) || asString(secondary)
  return value || ISO_EPOCH
}

const normalizeRun = (value: unknown): EngineRunRow | null => {
  const row = asRecord(value)
  const id = asString(row.id)
  if (!id) return null

  return {
    id,
    parentRunId: asNullableString(row.parentRunId ?? row.parent_run_id),
    sessionId: asNullableString(row.sessionId ?? row.session_id),
    title: asString(row.title, 'Unbenannter Run'),
    inputSummary: asNullableString(row.inputSummary ?? row.input_summary),
    status: asString(row.status, 'unknown'),
    phase: asString(row.phase, 'unknown'),
    cwd: asNullableString(row.cwd),
    model: asNullableString(row.model),
    provider: asNullableString(row.provider),
    retryCount: asNumber(row.retryCount ?? row.retry_count),
    resumedFromRunId: asNullableString(row.resumedFromRunId ?? row.resumed_from_run_id),
    checkpointJson: asNullableString(row.checkpointJson ?? row.checkpoint_json),
    resultSummary: asNullableString(row.resultSummary ?? row.result_summary),
    error: asNullableString(row.error),
    updatedAt: asTimestampString(row.updatedAt ?? row.updated_at, row.createdAt ?? row.created_at),
    createdAt: asTimestampString(row.createdAt ?? row.created_at, row.updatedAt ?? row.updated_at),
  }
}

const normalizeCheckpoint = (value: unknown): EngineRunCheckpointRow | null => {
  const checkpoint = asRecord(value)
  const id = asString(checkpoint.id)
  if (!id) return null

  return {
    id,
    runId: asString(checkpoint.runId ?? checkpoint.run_id),
    label: asString(checkpoint.label, 'Checkpoint'),
    snapshotJson: asString(checkpoint.snapshotJson ?? checkpoint.snapshot_json),
    createdAt: asTimestampString(checkpoint.createdAt ?? checkpoint.created_at),
  }
}

const normalizeSandbox = (value: unknown): WorkerSandboxRow | null => {
  const sandbox = asRecord(value)
  const id = asString(sandbox.id)
  if (!id) return null

  return {
    id,
    runId: asString(sandbox.runId ?? sandbox.run_id),
    backendId: asNullableString(sandbox.backendId ?? sandbox.backend_id),
    status: asString(sandbox.status, 'unknown'),
    mode: asString(sandbox.mode, 'unknown'),
    sourceCwd: asString(sandbox.sourceCwd ?? sandbox.source_cwd),
    workspaceRoot: asString(sandbox.workspaceRoot ?? sandbox.workspace_root),
    allowFileRead: asBoolean(sandbox.allowFileRead ?? sandbox.allow_file_read),
    allowFileWrite: asBoolean(sandbox.allowFileWrite ?? sandbox.allow_file_write),
    allowShellExecution: asBoolean(sandbox.allowShellExecution ?? sandbox.allow_shell_execution),
    allowWebFetch: asBoolean(sandbox.allowWebFetch ?? sandbox.allow_web_fetch),
    allowWebSearch: asBoolean(sandbox.allowWebSearch ?? sandbox.allow_web_search),
    allowMcp: asBoolean(sandbox.allowMcp ?? sandbox.allow_mcp),
  }
}

export default function RunPanel() {
  const currentRunId = useEngineStore((state) => state.currentRunId)
  const [runs, setRuns] = useState<EngineRunRow[]>([])
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [checkpoints, setCheckpoints] = useState<EngineRunCheckpointRow[]>([])
  const [sandbox, setSandbox] = useState<WorkerSandboxRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)

  const refreshRuns = async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await safeInvoke<unknown[] | null>('engine_run_list', { limit: 100 }, [])
      const safeRows = Array.isArray(rows)
        ? rows.map(normalizeRun).filter((row): row is EngineRunRow => row !== null)
        : []
      setRuns(safeRows)
      const nextSelected = selectedRun && safeRows.some((row) => row.id === selectedRun)
        ? selectedRun
        : safeRows[0]?.id ?? null
      setSelectedRun(nextSelected)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const refreshCheckpoints = async (runId: string) => {
    try {
      const rows = await safeInvoke<unknown[] | null>('engine_run_checkpoint_list', {
        runId,
        limit: 20,
      }, [])
      setCheckpoints(
        Array.isArray(rows)
          ? rows.map(normalizeCheckpoint).filter((checkpoint): checkpoint is EngineRunCheckpointRow => checkpoint !== null)
          : [],
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const refreshSandbox = async (runId: string) => {
    try {
      const row = await safeInvoke<unknown>('worker_sandbox_get_for_run', { runId }, null)
      setSandbox(normalizeSandbox(row))
    } catch {
      setSandbox(null)
    }
  }

  useEffect(() => {
    void refreshRuns()
  }, [])

  useEffect(() => {
    if (!selectedRun) {
      setCheckpoints([])
      setSandbox(null)
      return
    }
    void refreshCheckpoints(selectedRun)
    void refreshSandbox(selectedRun)
  }, [selectedRun])

  const handleAction = async (runId: string, action: 'cancel' | 'resume' | 'retry') => {
    setBusyRunId(runId)
    setError(null)
    try {
      let nextSelectedRun = runId
      if (action === 'cancel') {
        await safeInvoke('engine_run_cancel', { id: runId }, null)
      } else if (action === 'resume') {
        await safeInvoke('engine_run_resume', { id: runId }, null)
      } else {
        nextSelectedRun = await safeInvoke<string>('engine_run_retry', { id: runId })
      }
      await refreshRuns()
      setSelectedRun(nextSelectedRun)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyRunId(null)
    }
  }

  return (
    <div className="panel">
      <div className="panel-heading-row">
        <h2>Runs</h2>
        <button type="button" className="btn-sm" onClick={() => void refreshRuns()}>
          Aktualisieren
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Aktiver Run: {currentRunId ?? 'keiner'}
      </div>

      {loading ? (
        <p className="panel-empty">Laden...</p>
      ) : runs.length === 0 ? (
        <p className="panel-empty">Noch keine Runs gespeichert.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className="card"
                onClick={() => setSelectedRun(run.id)}
                style={{
                  textAlign: 'left',
                  border: selectedRun === run.id ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{run.title}</strong>
                  <span style={{ fontSize: 11, color: run.status === 'completed' ? 'var(--success)' : run.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {run.status}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {new Date(run.updatedAt).toLocaleString('de-DE')} • {run.phase}
                </div>
                {run.inputSummary && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                    {run.inputSummary.slice(0, 180)}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="card" style={{ minHeight: 320 }}>
            {selectedRun ? (
              (() => {
                const run = runs.find((item) => item.id === selectedRun)
                if (!run) return <p className="panel-empty">Run nicht gefunden.</p>
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <strong>{run.title}</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        {run.id}
                      </div>
                    </div>
                    <div style={{ fontSize: 12 }}>
                      <div>Status: {run.status}</div>
                      <div>Phase: {run.phase}</div>
                      <div>Provider: {run.provider ?? 'n/a'}</div>
                      <div>Modell: {run.model ?? 'n/a'}</div>
                      <div>Retry Count: {run.retryCount}</div>
                      {run.parentRunId && <div>Parent: {run.parentRunId}</div>}
                    </div>
                    {sandbox && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Sandbox</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          <div>Status: {sandbox.status}</div>
                          <div>Mode: {sandbox.mode}</div>
                          <div>Backend: {sandbox.backendId ?? 'local'}</div>
                          <div>Workspace: {sandbox.workspaceRoot}</div>
                          <div>Source: {sandbox.sourceCwd}</div>
                          <div>
                            Rechte: read {String(sandbox.allowFileRead)} | write {String(sandbox.allowFileWrite)} | shell {String(sandbox.allowShellExecution)} | web {String(sandbox.allowWebFetch || sandbox.allowWebSearch)} | mcp {String(sandbox.allowMcp)}
                          </div>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn-sm" disabled={busyRunId === run.id || run.status === 'completed'} onClick={() => void handleAction(run.id, 'resume')}>
                        Resume
                      </button>
                      <button type="button" className="btn-sm" disabled={busyRunId === run.id} onClick={() => void handleAction(run.id, 'retry')}>
                        Retry
                      </button>
                      <button type="button" className="btn-sm" disabled={busyRunId === run.id || run.status === 'completed' || run.status === 'failed' || run.status === 'canceled'} onClick={() => void handleAction(run.id, 'cancel')}>
                        Cancel
                      </button>
                    </div>
                    {run.resultSummary && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Ergebnis</div>
                        <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 8, borderRadius: 'var(--radius-sm)', maxHeight: 140, overflowY: 'auto' }}>
                          {run.resultSummary}
                        </pre>
                      </div>
                    )}
                    {run.error && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--danger)' }}>Fehler</div>
                        <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 8, borderRadius: 'var(--radius-sm)', maxHeight: 120, overflowY: 'auto', color: 'var(--danger)' }}>
                          {run.error}
                        </pre>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Checkpoints</div>
                      {checkpoints.length === 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Keine Checkpoints</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
                          {checkpoints.map((checkpoint) => (
                            <div key={checkpoint.id} style={{ fontSize: 11, background: 'var(--bg-primary)', padding: 8, borderRadius: 'var(--radius-sm)' }}>
                              <div style={{ fontWeight: 600 }}>{checkpoint.label}</div>
                              <div style={{ color: 'var(--text-muted)', margin: '3px 0 6px' }}>{new Date(checkpoint.createdAt).toLocaleString('de-DE')}</div>
                              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{checkpoint.snapshotJson.slice(0, 400)}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()
            ) : (
              <p className="panel-empty">Run auswaehlen.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
