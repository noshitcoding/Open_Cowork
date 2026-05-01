import { useEffect, useState } from 'react'
import { safeInvoke } from '../../utils/safeInvoke'

type CrewRunHistoryRow = {
  id: string
  crewId: string
  crewName: string
  process: string
  status: string
  managerAgentId: string | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

type CrewExecutionLogRow = {
  id: string
  crewId: string
  agentId: string
  taskId: string
  action: string
  result: string
  timestamp: number
}

type CrewRunEventRow = {
  id: string
  runId: string
  crewId: string
  eventType: string
  payloadJson: string | null
  createdAt: string
}

type Props = {
  activeCrewId: string
}

function formatTimestamp(value: string | number | null): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('de-DE')
}

export default function CrewHistoryPanel({ activeCrewId }: Props) {
  const [runs, setRuns] = useState<CrewRunHistoryRow[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [logs, setLogs] = useState<CrewExecutionLogRow[]>([])
  const [events, setEvents] = useState<CrewRunEventRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void safeInvoke<CrewRunHistoryRow[]>('crew_runs_list', { crewId: activeCrewId, limit: 12 }, [])
      .then((rows) => {
        if (cancelled) return
        const safeRows = Array.isArray(rows) ? rows : []
        setRuns(safeRows)
        setSelectedRunId((current) => current && safeRows.some((row) => row.id === current) ? current : safeRows[0]?.id ?? null)
      })
      .catch((value) => {
        if (!cancelled) setError(value instanceof Error ? value.message : String(value))
      })

    return () => {
      cancelled = true
    }
  }, [activeCrewId])

  useEffect(() => {
    if (!selectedRunId) {
      setLogs([])
      setEvents([])
      return
    }

    let cancelled = false
    void Promise.all([
      safeInvoke<CrewExecutionLogRow[]>('crew_run_logs_list', { runId: selectedRunId }, []),
      safeInvoke<CrewRunEventRow[]>('crew_run_events_list', { runId: selectedRunId, limit: 120 }, []),
    ])
      .then(([nextLogs, nextEvents]) => {
        if (cancelled) return
        setLogs(Array.isArray(nextLogs) ? nextLogs : [])
        setEvents(Array.isArray(nextEvents) ? nextEvents : [])
      })
      .catch((value) => {
        if (!cancelled) setError(value instanceof Error ? value.message : String(value))
      })

    return () => {
      cancelled = true
    }
  }, [selectedRunId])

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>History</div>
        <strong style={{ fontSize: 16 }}>Crew-Runs & Events</strong>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      {runs.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Noch keine gespeicherten Runs fuer diese Crew.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.9fr) 1.1fr', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className="card"
                onClick={() => setSelectedRunId(run.id)}
                style={{ textAlign: 'left', border: selectedRunId === run.id ? '1px solid var(--accent)' : '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{run.process}</strong>
                  <span style={{ fontSize: 11, color: run.status === 'completed' ? 'var(--success)' : run.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>{run.status}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{formatTimestamp(run.startedAt)}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Events</div>
              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'grid', gap: 8 }}>
                {events.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Noch keine Events gespeichert.</div>
                ) : events.slice(0, 8).map((event) => (
                  <div key={event.id} style={{ padding: 10, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: 12 }}>{event.eventType}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatTimestamp(event.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Logs</div>
              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'grid', gap: 8 }}>
                {logs.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Noch keine Logs fuer diesen Run.</div>
                ) : logs.slice(0, 8).map((log) => (
                  <div key={log.id} style={{ padding: 10, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{log.action}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{log.agentId} • {log.taskId}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{log.result.slice(0, 180)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}