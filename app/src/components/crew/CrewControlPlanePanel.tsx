import { useEffect, useState } from 'react'
import type { Crew } from '../../stores/crewStore'
import { useCrewControlPlaneStore } from '../../stores/crewControlPlaneStore'

type Props = {
  activeCrew: Crew
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE')
}

export default function CrewControlPlanePanel({ activeCrew }: Props) {
  const {
    definitions,
    versions,
    validation,
    loading,
    error,
    loadDefinitions,
    loadVersions,
    saveCrewDefinition,
    validateCrew,
  } = useCrewControlPlaneStore()
  const [changeSummary, setChangeSummary] = useState('')

  useEffect(() => {
    void loadDefinitions()
  }, [loadDefinitions])

  useEffect(() => {
    void loadVersions(activeCrew.id)
  }, [activeCrew.id, loadVersions])

  const activeDefinition = definitions.find((entry) => entry.id === activeCrew.id) ?? null

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Control Plane</div>
          <strong style={{ fontSize: 16 }}>Versionierte Crew-Definition</strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            Die aktive Crew wird als reproduzierbare Definition gespeichert und kann vor dem Lauf gegen die Python-Crew-Runtime validiert werden.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn-sm" disabled={loading} onClick={() => void validateCrew(activeCrew)}>
            {loading ? 'Pruefe…' : 'Definition validieren'}
          </button>
          <button type="button" className="btn-sm" disabled={loading} onClick={() => void saveCrewDefinition(activeCrew, changeSummary)}>
            {loading ? 'Speichere…' : 'Neue Version speichern'}
          </button>
        </div>
      </div>

      <input
        className="crew-toolbar-input"
        placeholder="Aenderungskommentar fuer die naechste Definition…"
        value={changeSummary}
        onChange={(event) => setChangeSummary(event.target.value)}
      />

      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aktive Definition</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{activeDefinition ? `Version ${activeDefinition.versionCount}` : 'noch nicht versioniert'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            {activeDefinition ? `Zuletzt aktualisiert: ${formatTimestamp(activeDefinition.updatedAt)}` : 'Noch kein persistierter DB-Stand fuer diese Crew.'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Validation</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{validation ? (validation.valid ? 'gueltig' : 'mit Problemen') : 'noch nicht geprueft'}</div>
          {validation && validation.issues.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
              {validation.issues.join(' • ')}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bibliothek</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{definitions.length} Definitionen gespeichert</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Die DB haelt versionierte Crew-Staende fuer Replay und Scheduling fest.</div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Neueste Versionen dieser Crew</div>
        {versions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Noch keine Versionen gespeichert.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {versions.slice(0, 5).map((version) => (
              <div key={version.id} style={{ padding: 10, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>Version {version.versionNumber}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatTimestamp(version.createdAt)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{version.changeSummary || 'ohne Kommentar'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}