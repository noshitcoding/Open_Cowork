import { useEffect, useMemo, useState } from 'react'
import { useCrewControlPlaneStore } from '../../stores/crewControlPlaneStore'
import { useCrewStore, type CrewGovernanceMode } from '../../stores/crewStore'

const GOVERNANCE_MODES: Array<{
  value: CrewGovernanceMode
  title: string
  description: string
}> = [
  {
    value: 'allow-all',
    title: 'Alles erlauben',
    description: 'Crew startet ohne Rueckfrage. Bereits vorhandene manuelle Freigaben bleiben trotzdem wirksam.',
  },
  {
    value: 'ask-risky',
    title: 'Nur bei riskanten Aktionen fragen',
    description: 'Rueckfrage nur bei riskanten Tools, MCP-Zugriffen oder Delegation.',
  },
  {
    value: 'ask-all',
    title: 'Immer vor Aktionen fragen',
    description: 'Jeder Crew-Start wird zuerst softwareseitig pausiert und erst nach Freigabe fortgesetzt.',
  },
  {
    value: 'read-only',
    title: 'Nur lesen',
    description: 'Erlaubt nur Lesezugriffe wie read_file, grep, glob, web_fetch und web_search.',
  },
]

type Props = {
  activeCrewId: string
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE')
}

function formatApprovalType(value: string): string {
  if (value === 'run_gate') return 'Startfreigabe'
  if (value === 'tool_gate') return 'Tool-Freigabe'
  if (value === 'delegation_gate') return 'Delegations-Freigabe'
  return value
}

function formatApprovalStatus(value: string): string {
  if (value === 'approved') return 'genehmigt'
  if (value === 'rejected') return 'abgelehnt'
  if (value === 'pending') return 'offen'
  return value
}

export default function CrewGovernancePanel({ activeCrewId }: Props) {
  const crew = useCrewStore((state) => state.crews.find((entry) => entry.id === activeCrewId) ?? null)
  const updateCrew = useCrewStore((state) => state.updateCrew)
  const {
    approvals,
    loading,
    error,
    loadApprovals,
    resolveApproval,
  } = useCrewControlPlaneStore()
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadApprovals(undefined, activeCrewId)
    setNotice(null)
  }, [activeCrewId, loadApprovals])

  const activeMode = crew?.governanceMode ?? 'allow-all'
  const activeModeDefinition = useMemo(
    () => GOVERNANCE_MODES.find((entry) => entry.value === activeMode) ?? GOVERNANCE_MODES[0],
    [activeMode],
  )

  const handleModeSelect = (mode: CrewGovernanceMode) => {
    updateCrew(activeCrewId, { governanceMode: mode })
    const definition = GOVERNANCE_MODES.find((entry) => entry.value === mode)
    setNotice(definition ? `Governance-Modus gesetzt: ${definition.title}.` : null)
  }

  const handleResolveApproval = async (approvalId: string, status: 'approved' | 'rejected') => {
    await resolveApproval({
      id: approvalId,
      crewId: activeCrewId,
      status,
      resolvedBy: 'manual-panel',
      resolutionNote: status === 'approved' ? 'Manuell genehmigt' : 'Manuell abgelehnt',
    })

    if (!useCrewControlPlaneStore.getState().error) {
      setNotice(
        status === 'approved'
          ? 'Freigabe erteilt. Falls ein Crew-Run pausiert war, wird er jetzt im Hintergrund fortgesetzt.'
          : 'Freigabe abgelehnt.',
      )
    }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Governance</div>
        <strong style={{ fontSize: 16 }}>Freigaben & Schutzmodus</strong>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      {notice && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{notice}</div>}

      <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Aktiver Modus</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{activeModeDefinition.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{activeModeDefinition.description}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {GOVERNANCE_MODES.map((mode) => {
          const selected = mode.value === activeMode
          return (
            <button
              key={mode.value}
              type="button"
              className="card"
              onClick={() => handleModeSelect(mode.value)}
              style={{
                textAlign: 'left',
                background: selected ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-secondary))' : 'var(--bg-secondary)',
                border: selected ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                display: 'grid',
                gap: 6,
              }}
            >
              <strong style={{ fontSize: 13 }}>{mode.title}</strong>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{mode.description}</span>
            </button>
          )
        })}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Offene / letzte Freigaben</div>
        {approvals.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Noch keine Freigaben fuer diese Crew vorhanden.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {approvals.slice(0, 6).map((approval) => (
              <div key={approval.id} style={{ padding: 10, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>{formatApprovalType(approval.approvalType)}</strong>
                  <span style={{ fontSize: 11, color: approval.status === 'approved' ? 'var(--success)' : approval.status === 'rejected' ? 'var(--danger)' : 'var(--warning)' }}>{formatApprovalStatus(approval.status)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Angefragt: {formatTimestamp(approval.requestedAt)}
                </div>
                {approval.resolvedAt && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Entschieden: {formatTimestamp(approval.resolvedAt)}
                  </div>
                )}
                {approval.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn-sm" disabled={loading} onClick={() => void handleResolveApproval(approval.id, 'approved')}>Genehmigen</button>
                    <button type="button" className="btn-sm" disabled={loading} onClick={() => void handleResolveApproval(approval.id, 'rejected')}>Ablehnen</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}