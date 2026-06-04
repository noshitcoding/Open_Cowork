import { useEffect } from 'react'
import { useConfigStore } from '../stores/configStore'
import { usePersonalityStore } from '../stores/personalityStore'
import { tr } from '../i18n'

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
      <h2>{tr("🔄 Model &amp; Ollama")}</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Active model display */}
        <div className="card" style={{ background: 'var(--bg-tertiary)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{tr("Active model")}</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{effectiveModel}</div>
          {activePersonality?.model_override && (
            <div style={{ fontSize: 11, color: 'var(--info)', marginTop: 2 }}>{tr("overridden by personality &quot;")}{activePersonality.name}{tr("&quot;")}</div>
          )}
        </div>

        {/* Model selector */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>{tr("Default model")}</label>
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
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>{tr("Ollama-URL")}</label>
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
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>{tr("Temperature:")}{ollama.temperature.toFixed(2)}
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
          <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>{tr("Context-Window:")}{ollama.contextWindow.toLocaleString('en-US')}
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
            <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>{tr("Quick personality switch")}</label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{tr("Select the active personality. Full management is available below in the &quot;Personalities&quot; section.")}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button
                type="button"
                className={`btn-sm${activeId == null ? ' active' : ''}`}
                onClick={() => setActive(null)}
              >{tr("Standard")}</button>
              {personalities.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`btn-sm${activeId === p.id ? ' active' : ''}`}
                  onClick={() => setActive(p.id)}
                  title={p.model_override ? `Model: ${p.model_override}` : undefined}
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
