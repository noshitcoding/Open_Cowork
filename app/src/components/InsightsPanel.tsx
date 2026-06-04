import { useEffect } from 'react'
import { useInsightsStore } from '../stores/insightsStore'
import { tr } from '../i18n'

export default function InsightsPanel() {
  const { summary, events, loading, error, loadSummary, loadEvents } = useInsightsStore()

  useEffect(() => {
    loadSummary()
    loadEvents(undefined, 50)
  }, [loadSummary, loadEvents])

  const recentSummaryEvents = summary?.recentEvents ?? []
  const topCategories = summary?.topCategories ?? []
  const totalTokensEst = summary?.totalTokensEst ?? 0
  const avgSessionDurationMin = summary?.avgSessionDurationMin ?? 0

  return (
    <div className="panel">
      <h2>{tr("📊 Insights Dashboard")}</h2>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}

      {loading && <p className="panel-empty">{tr("Loading...")}</p>}

      {summary && (
        <>
          {/* Key metrics */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{summary.totalSessions}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr("Sessions")}</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--info)' }}>{summary.skillUsageCount}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr("Skill uses")}</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{summary.memoryEntryCount}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr("Memory")}</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{summary.totalEvents}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr("Events")}</div>
            </div>
          </div>

          {/* Additional stats */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{summary.totalMessagesSent}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr("Messages")}</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{totalTokensEst.toLocaleString('en-US')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr("Tokens (est.)")}</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{avgSessionDurationMin.toFixed(1)}{tr("min")}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr("Avg. duration")}</div>
            </div>
          </div>

          {/* Recent events from summary */}
          {recentSummaryEvents.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>{tr("Latest events")}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentSummaryEvents.slice(0, 10).map((ev, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-light)' }}>
                    <span>{ev.eventType} <span style={{ color: 'var(--text-muted)' }}>({ev.category})</span></span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {new Date(ev.createdAt).toLocaleString('en-US')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Categories */}
          {topCategories.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>{tr("Top categories")}</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {topCategories.map((cat) => (
                  <span key={cat.category} className="card" style={{ padding: '4px 10px', fontSize: 12 }}>
                    {cat.category}: {cat.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Recent events */}
      {events.length > 0 && (
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>{tr("Latest events")}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
            {events.slice(0, 30).map((ev) => (
              <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <span style={{ fontWeight: 500 }}>{ev.event_type}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{ev.category}</span>
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {new Date(ev.created_at).toLocaleString('en-US')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
