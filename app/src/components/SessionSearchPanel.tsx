import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '../engine'
import { useChatStore } from '../stores/chatStore'
import { useEngineStore } from '../stores/engineStore'
import { resolveSessionRecord, toChatThread } from '../utils/sessionThreads'
import { tr } from '../i18n'

type SessionLike = Partial<SessionSummary> & { id?: unknown }

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

const normalizeSessionSummary = (value: unknown): SessionSummary | null => {
  if (!value || typeof value !== 'object') return null
  const session = value as SessionLike
  const id = typeof session.id === 'string' ? session.id : ''
  if (!id) return null

  return {
    id,
    title: typeof session.title === 'string' && session.title.trim() ? session.title : 'Untitlede Session',
    cwd: typeof session.cwd === 'string' ? session.cwd : '',
    messageCount: typeof session.messageCount === 'number' && Number.isFinite(session.messageCount)
      ? session.messageCount
      : 0,
    createdAt: toNumber(session.createdAt),
    updatedAt: toNumber(session.updatedAt),
  }
}

const normalizeSessions = (values: unknown): SessionSummary[] => {
  if (!Array.isArray(values)) return []
  return values
    .map(normalizeSessionSummary)
    .filter((session): session is SessionSummary => session !== null)
}

export default function SessionSearchPanel() {
  const getSessions = useEngineStore((s) => s.getSessions)
  const deleteSessionById = useEngineStore((s) => s.deleteSessionById)
  const loadSessionById = useEngineStore((s) => s.loadSessionById)
  const currentSessionId = useEngineStore((s) => s.currentSessionId)
  const hydrateThread = useChatStore((s) => s.hydrateThread)
  const [query, setQuery] = useState('')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)

  const refreshSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getSessions()
      setSessions(normalizeSessions(result))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [getSessions])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  const filteredSessions = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return sessions
    return sessions.filter((session) =>
      `${session.title} ${session.cwd}`.toLowerCase().includes(trimmed),
    )
  }, [query, sessions])

  const handleLoadSession = async (sessionId: string) => {
    setBusySessionId(sessionId)
    setError(null)
    try {
      const session = await resolveSessionRecord(sessionId, loadSessionById)
      if (!session) {
        setError(tr("Session could not be loaded."))
        return
      }
      hydrateThread(toChatThread(session))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusySessionId(null)
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    setBusySessionId(sessionId)
    setError(null)
    try {
      await deleteSessionById(sessionId)
      setSessions((current) => current.filter((session) => session.id !== sessionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusySessionId(null)
    }
  }

  return (
    <div className="panel">
      <h2>{tr("📂 Sessions")}</h2>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder={tr("Filter sessions by title or path...")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', fontSize: 13 }}
        />
        <button type="button" className="btn-sm" onClick={() => void refreshSessions()}>{tr("Refresh")}</button>
      </div>

      {query.trim() && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          {filteredSessions.length}{tr("Session")}{filteredSessions.length !== 1 ? 's' : ''}{tr("passen zu &quot;")}{query}{tr("&quot;")}</div>
      )}


      {loading ? (
        <p className="panel-empty">{tr("Loading...")}</p>
      ) : filteredSessions.length === 0 ? (
        <p className="panel-empty">{query.trim() ? tr('No matching sessions') : tr('No sessions yet')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
          {filteredSessions.map((session) => (
            <div key={session.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{session.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    {new Date(session.updatedAt).toLocaleString('en-US')}
                    <span style={{ marginLeft: 6 }}>• {session.messageCount}{tr("Messages")}</span>
                    {currentSessionId === session.id && <span style={{ color: 'var(--success)', marginLeft: 6 }}>{tr("loaded as active")}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{session.cwd || tr('No working directory saved')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => void handleLoadSession(session.id)}
                    disabled={busySessionId === session.id}
                  >{tr("Load")}</button>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => void handleDeleteSession(session.id)}
                    disabled={busySessionId === session.id}
                  >{tr("Delete")}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
