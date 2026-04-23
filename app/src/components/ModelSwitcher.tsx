import { useEffect } from 'react'
import { useConfigStore } from '../stores/configStore'
import { usePersonalityStore } from '../stores/personalityStore'

export default function ModelSwitcher() {
  const { ollama, availableModels, setOllama } = useConfigStore()
  const { personalities, activeId, loadPersonalities, setActive } = usePersonalityStore()

  useEffect(() => {
    loadPersonalities()
  }, [loadPersonalities])

  const activePersonality = personalities.find((p) => p.id === activeId) ?? null
  const effectiveModel = activePersonality?.model_override || ollama.model

  return (
    <div className="panel">
      <h2>🔄 Modell &amp; Ollama</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Active model display */}
        <div className="card" style={{ background: 'var(--bg-tertiary)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Aktives Modell</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{effectiveModel}</div>
          {activePersonality?.model_override && (
            <div style={{ fontSize: 11, color: 'var(--info)', marginTop: 2 }}>
              ueberschrieben durch Persoenlichkeit &quot;{activePersonality.name}&quot;
            </div>
          )}
        </div>

        {/* Model selector */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>Standard-Modell</label>
          <select
            value={ollama.model}
            onChange={(e) => setOllama({ model: e.target.value })}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', fontSize: 13,
            }}
          >
            {availableModels.length === 0 && <option value={ollama.model}>{ollama.model}</option>}
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Base URL */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>Ollama-URL</label>
          <input
            type="text"
            value={ollama.baseUrl}
            onChange={(e) => setOllama({ baseUrl: e.target.value })}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', fontSize: 13,
            }}
          />
        </div>

        {/* Temperature */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>
            Temperature: {ollama.temperature.toFixed(2)}
          </label>
          <input
            type="range" min={0} max={2} step={0.05}
            value={ollama.temperature}
            onChange={(e) => setOllama({ temperature: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>

        {/* Context window */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>
            Context-Window: {ollama.contextWindow.toLocaleString('de-DE')}
          </label>
          <input
            type="range" min={2048} max={131072} step={1024}
            value={ollama.contextWindow}
            onChange={(e) => setOllama({ contextWindow: parseInt(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>

        {/* Personality quick switch */}
        {personalities.length > 0 && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>Persoenlichkeit Schnellwechsel</label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Auswahl der aktiven Persoenlichkeit. Vollstaendige Verwaltung unten im Bereich &quot;Persoenlichkeiten&quot;.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button
                type="button"
                className={`btn-sm${activeId == null ? ' active' : ''}`}
                onClick={() => setActive(null)}
              >
                Standard
              </button>
              {personalities.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`btn-sm${activeId === p.id ? ' active' : ''}`}
                  onClick={() => setActive(p.id)}
                  title={p.model_override ? `Modell: ${p.model_override}` : undefined}
                >
                  {p.icon || '🤖'} {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
