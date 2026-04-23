import { useEffect, useState } from 'react'
import { usePersonalityStore, type Personality } from '../stores/personalityStore'
import { useConfigStore } from '../stores/configStore'

function randomId() {
  return `pers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function PersonalitySelector() {
  const { personalities, activeId, loading, error, loadPersonalities, upsertPersonality, deletePersonality, setActive } = usePersonalityStore()
  const availableModels = useConfigStore((s) => s.availableModels)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', systemPrompt: '', icon: '🤖', modelOverride: '', temperature: '' })

  useEffect(() => {
    loadPersonalities()
  }, [loadPersonalities])

  const handleAdd = async () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return
    await upsertPersonality({
      id: randomId(),
      name: form.name.trim(),
      description: form.description,
      systemPrompt: form.systemPrompt,
      icon: form.icon || undefined,
      modelOverride: form.modelOverride || undefined,
      temperature: form.temperature ? Number(form.temperature) : undefined,
    })
    setForm({ name: '', description: '', systemPrompt: '', icon: '🤖', modelOverride: '', temperature: '' })
    setShowAdd(false)
    loadPersonalities()
  }

  return (
    <div className="panel">
      <div className="panel-heading-row">
        <h2>🎭 Persoenlichkeiten verwalten</h2>
        <button type="button" className="btn-sm" onClick={() => setShowAdd(!showAdd)}>+ Neu</button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}

      {showAdd && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: '60px 1fr 1fr', marginBottom: 8 }}>
            <label>
              Icon
              <input type="text" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} maxLength={4} />
            </label>
            <label>
              Name
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Modell-Override
              <select value={form.modelOverride} onChange={(e) => setForm({ ...form, modelOverride: e.target.value })}>
                <option value="">Standard</option>
                {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
            Beschreibung
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
            System-Prompt
            <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} rows={4}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13 }}>
              Temperatur
              <input type="number" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} min={0} max={2} step={0.1}
                style={{ width: 80, marginLeft: 8, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
            </label>
          </div>
          <button type="button" className="btn-sm" onClick={handleAdd}>Speichern</button>
        </div>
      )}

      {loading ? (
        <p className="panel-empty">Laden...</p>
      ) : personalities.length === 0 ? (
        <p className="panel-empty">Keine Persoenlichkeiten konfiguriert. Erstelle eine, um den Agent-Stil anzupassen.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {personalities.map((p: Personality) => (
            <div key={p.id} className="card" style={{
              border: activeId === p.id ? '2px solid var(--accent)' : '1px solid transparent',
              cursor: 'pointer',
            }} onClick={() => setActive(p.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 24 }}>{p.icon || '🤖'}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {p.name}
                      {activeId === p.id && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 6 }}>aktiv</span>}
                      {p.is_default && <span style={{ fontSize: 10, color: 'var(--info)', marginLeft: 6 }}>Standard</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{p.description}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 10 }}>
                      {p.model_override && <span>Modell: {p.model_override}</span>}
                      {p.temperature != null && <span>Temp: {p.temperature}</span>}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); deletePersonality(p.id); loadPersonalities() }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14 }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
