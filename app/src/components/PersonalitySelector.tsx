import { useEffect, useState } from 'react'
import { usePersonalityStore, type Personality } from '../stores/personalityStore'
import { useConfigStore } from '../stores/configStore'

type PersonalityForm = {
  name: string
  description: string
  systemPrompt: string
  icon: string
  modelOverride: string
  temperature: string
  isDefault: boolean
}

const EMPTY_FORM: PersonalityForm = {
  name: '',
  description: '',
  systemPrompt: '',
  icon: 'AI',
  modelOverride: '',
  temperature: '',
  isDefault: false,
}

function randomId() {
  return `pers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toForm(personality: Personality): PersonalityForm {
  return {
    name: personality.name,
    description: personality.description,
    systemPrompt: personality.system_prompt,
    icon: personality.icon || 'AI',
    modelOverride: personality.model_override || '',
    temperature: personality.temperature != null ? String(personality.temperature) : '',
    isDefault: personality.is_default,
  }
}

function PersonalityEditor({
  form,
  availableModels,
  onChange,
  onSave,
  onCancel,
  showDefaultToggle,
}: {
  form: PersonalityForm
  availableModels: string[]
  onChange: (form: PersonalityForm) => void
  onSave: () => void
  onCancel?: () => void
  showDefaultToggle: boolean
}) {
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: '80px 1fr 1fr', marginBottom: 8 }}>
        <label>
          Icon
          <input type="text" value={form.icon} onChange={(e) => onChange({ ...form, icon: e.target.value })} maxLength={4} />
        </label>
        <label>
          Name
          <input type="text" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
        </label>
        <label>
          Modell-Override
          <select value={form.modelOverride} onChange={(e) => onChange({ ...form, modelOverride: e.target.value })}>
            <option value="">Standard</option>
            {availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
            {form.modelOverride && !availableModels.includes(form.modelOverride) && (
              <option value={form.modelOverride}>{form.modelOverride}</option>
            )}
          </select>
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
        Beschreibung
        <input type="text" value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
        System-Prompt
        <textarea
          value={form.systemPrompt}
          onChange={(e) => onChange({ ...form, systemPrompt: e.target.value })}
          rows={8}
          style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical', fontFamily: 'monospace' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontSize: 13 }}>
          Temperatur
          <input
            type="number"
            value={form.temperature}
            onChange={(e) => onChange({ ...form, temperature: e.target.value })}
            min={0}
            max={2}
            step={0.1}
            style={{ width: 80, marginLeft: 8, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }}
          />
        </label>
        {showDefaultToggle && (
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={form.isDefault} onChange={(e) => onChange({ ...form, isDefault: e.target.checked })} />
            Als Standard verwenden
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn-sm" onClick={onSave}>Speichern</button>
        {onCancel && <button type="button" className="btn-sm" onClick={onCancel}>Abbrechen</button>}
      </div>
    </div>
  )
}

export default function PersonalitySelector() {
  const { personalities, activeId, loading, error, loadPersonalities, upsertPersonality, deletePersonality, setActive } = usePersonalityStore()
  const availableModels = useConfigStore((s) => s.availableModels)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<PersonalityForm>(EMPTY_FORM)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<PersonalityForm>(EMPTY_FORM)

  useEffect(() => {
    loadPersonalities()
  }, [loadPersonalities])

  const savePersonality = async (id: string, source: PersonalityForm) => {
    if (!source.name.trim() || !source.systemPrompt.trim()) return
    await upsertPersonality({
      id,
      name: source.name.trim(),
      description: source.description,
      systemPrompt: source.systemPrompt,
      icon: source.icon || undefined,
      modelOverride: source.modelOverride || undefined,
      temperature: source.temperature ? Number(source.temperature) : undefined,
      isDefault: source.isDefault,
    })
    await loadPersonalities()
  }

  const handleAdd = async () => {
    await savePersonality(randomId(), form)
    setForm(EMPTY_FORM)
    setShowAdd(false)
  }

  const handleEdit = async () => {
    if (!editId) return
    await savePersonality(editId, editForm)
    setEditId(null)
    setEditForm(EMPTY_FORM)
  }

  const startEdit = (personality: Personality) => {
    setEditId(personality.id)
    setEditForm(toForm(personality))
  }

  return (
    <div className="panel">
      <div className="panel-heading-row">
        <h2>Persoenlichkeiten verwalten</h2>
        <button type="button" className="btn-sm" onClick={() => setShowAdd(!showAdd)}>+ Neu</button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}

      {showAdd && (
        <div className="card" style={{ marginBottom: 12 }}>
          <PersonalityEditor
            form={form}
            availableModels={availableModels}
            onChange={setForm}
            onSave={handleAdd}
            onCancel={() => setShowAdd(false)}
            showDefaultToggle
          />
        </div>
      )}

      {loading ? (
        <p className="panel-empty">Laden...</p>
      ) : personalities.length === 0 ? (
        <p className="panel-empty">Keine Persoenlichkeiten konfiguriert. Erstelle eine, um den Agent-Stil anzupassen.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {personalities.map((personality) => (
            <div
              key={personality.id}
              className="card"
              style={{
                border: activeId === personality.id ? '2px solid var(--accent)' : '1px solid transparent',
                cursor: 'pointer',
              }}
              onClick={() => setActive(personality.id)}
            >
              {editId === personality.id ? (
                <div onClick={(event) => event.stopPropagation()}>
                  <PersonalityEditor
                    form={editForm}
                    availableModels={availableModels}
                    onChange={setEditForm}
                    onSave={handleEdit}
                    onCancel={() => {
                      setEditId(null)
                      setEditForm(EMPTY_FORM)
                    }}
                    showDefaultToggle
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 18, minWidth: 28 }}>{personality.icon || 'AI'}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {personality.name}
                        {activeId === personality.id && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 6 }}>aktiv</span>}
                        {personality.is_default && <span style={{ fontSize: 10, color: 'var(--info)', marginLeft: 6 }}>Standard</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{personality.description}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 10 }}>
                        {personality.model_override && <span>Modell: {personality.model_override}</span>}
                        {personality.temperature != null && <span>Temp: {personality.temperature}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn-sm" onClick={(event) => { event.stopPropagation(); startEdit(personality) }}>
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); void deletePersonality(personality.id).then(loadPersonalities) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14 }}
                    >
                      x
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
