import { useEffect, useState } from 'react'
import { useCrewControlPlaneStore } from '../../stores/crewControlPlaneStore'

const ROLE_OPTIONS = ['Owner/Admin', 'Editor/Designer', 'Operator/Runner', 'Approver', 'Viewer/Auditor']
const APPROVAL_OPTIONS = ['run_gate', 'tool_gate', 'delegation_gate']

type Props = {
  activeCrewId: string
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE')
}

export default function CrewGovernancePanel({ activeCrewId }: Props) {
  const {
    roleBindings,
    approvals,
    loading,
    error,
    loadRoleBindings,
    upsertRoleBinding,
    loadApprovals,
    createApproval,
    resolveApproval,
  } = useCrewControlPlaneStore()
  const [subject, setSubject] = useState('workspace-user')
  const [role, setRole] = useState(ROLE_OPTIONS[1])
  const [approvalType, setApprovalType] = useState(APPROVAL_OPTIONS[0])

  useEffect(() => {
    void loadRoleBindings('crew', activeCrewId)
    void loadApprovals(undefined, activeCrewId)
  }, [activeCrewId, loadApprovals, loadRoleBindings])

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Governance</div>
        <strong style={{ fontSize: 16 }}>Rollen & Freigaben</strong>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 170px auto', gap: 8 }}>
        <input className="crew-toolbar-input" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject / Benutzer / Gruppe" />
        <select className="crew-select" value={role} onChange={(event) => setRole(event.target.value)}>
          {ROLE_OPTIONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        <button
          type="button"
          className="btn-sm"
          disabled={loading}
          onClick={() => void upsertRoleBinding({
            id: crypto.randomUUID(),
            scopeType: 'crew',
            scopeRef: activeCrewId,
            role,
            subject,
          })}
        >
          Rolle speichern
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '170px auto', gap: 8 }}>
        <select className="crew-select" value={approvalType} onChange={(event) => setApprovalType(event.target.value)}>
          {APPROVAL_OPTIONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        <button
          type="button"
          className="btn-sm"
          disabled={loading}
          onClick={() => void createApproval({
            id: crypto.randomUUID(),
            crewId: activeCrewId,
            approvalType,
            scopeRef: activeCrewId,
            status: 'pending',
            requestedBy: 'manual-panel',
            payloadJson: JSON.stringify({ crewId: activeCrewId, approvalType }),
          })}
        >
          Freigabe anfordern
        </button>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Rollen</div>
        {roleBindings.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Noch keine Crew-Rollen definiert.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {roleBindings.map((binding) => (
              <div key={binding.id} style={{ padding: 10, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{binding.role}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{binding.subject}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Offene / letzte Freigaben</div>
        {approvals.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Noch keine Approval-Eintraege vorhanden.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {approvals.slice(0, 6).map((approval) => (
              <div key={approval.id} style={{ padding: 10, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>{approval.approvalType}</strong>
                  <span style={{ fontSize: 11, color: approval.status === 'approved' ? 'var(--success)' : approval.status === 'rejected' ? 'var(--danger)' : 'var(--warning)' }}>{approval.status}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Angefragt: {formatTimestamp(approval.requestedAt)}
                </div>
                {approval.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn-sm" disabled={loading} onClick={() => void resolveApproval({ id: approval.id, status: 'approved', resolvedBy: 'manual-panel' })}>Genehmigen</button>
                    <button type="button" className="btn-sm" disabled={loading} onClick={() => void resolveApproval({ id: approval.id, status: 'rejected', resolvedBy: 'manual-panel', resolutionNote: 'Manuell abgelehnt' })}>Ablehnen</button>
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