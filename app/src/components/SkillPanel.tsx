import { useEffect, useState } from 'react'
import { useSkillStore, type Skill } from '../stores/skillStore'
import { tr } from '../i18n'

function randomId() {
  return `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function SkillPanel() {
  const {
    skills, learnings, loading, error,
    loadSkills, upsertSkill, deleteSkill, improveSkill,
    loadLearnings,
  } = useSkillStore()

  const [tab, setTab] = useState<'skills' | 'learnings'>('skills')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', promptTemplate: '', triggerPattern: '', runMode: 'execute' })
  const [improveId, setImproveId] = useState<string | null>(null)
  const [improveTemplate, setImproveTemplate] = useState('')
  const [improveReason, setImproveReason] = useState('')

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  useEffect(() => {
    if (tab === 'learnings') loadLearnings()
  }, [tab, loadLearnings])

  const handleAdd = async () => {
    if (!form.name.trim() || !form.promptTemplate.trim()) return
    await upsertSkill({
      id: randomId(),
      name: form.name.trim(),
      description: form.description,
      promptTemplate: form.promptTemplate,
      triggerPattern: form.triggerPattern || undefined,
      runMode: form.runMode,
    })
    setForm({ name: '', description: '', promptTemplate: '', triggerPattern: '', runMode: 'execute' })
    setShowAdd(false)
    loadSkills()
  }

  const handleImprove = async () => {
    if (!improveId || !improveTemplate.trim()) return
    await improveSkill(improveId, improveTemplate, improveReason)
    setImproveId(null)
    setImproveTemplate('')
    setImproveReason('')
    loadSkills()
  }

  return (
    <div className="panel">
      <h2>{tr("⚡ Skills & Learning history")}</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" className={`btn-sm${tab === 'skills' ? ' active' : ''}`} onClick={() => setTab('skills')}>{tr("Skills")}</button>
        <button type="button" className={`btn-sm${tab === 'learnings' ? ' active' : ''}`} onClick={() => setTab('learnings')}>{tr("Learning history")}</button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}

      {tab === 'skills' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{skills.length}{tr("Skills registriert")}</span>
            <button type="button" className="btn-sm" onClick={() => setShowAdd(!showAdd)}>{tr("+ New skill")}</button>
          </div>

          {showAdd && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 8 }}>
                <label>{tr("Name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label>{tr("Mode")}<select value={form.runMode} onChange={(e) => setForm({ ...form, runMode: e.target.value })}>
                    <option value="execute">{tr("Ausfuehren")}</option>
                    <option value="plan">{tr("Planen")}</option>
                    <option value="hybrid">{tr("Hybrid")}</option>
                  </select>
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>{tr("Description")}<input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>{tr("Prompt-Template")}<textarea value={form.promptTemplate} onChange={(e) => setForm({ ...form, promptTemplate: e.target.value })} rows={3}
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>{tr("Trigger-Pattern (optional)")}<input type="text" value={form.triggerPattern} onChange={(e) => setForm({ ...form, triggerPattern: e.target.value })}
                  placeholder={tr("e.g. *test*, *deploy*")}
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
              </label>
              <button type="button" className="btn-sm" onClick={handleAdd}>{tr("Save")}</button>
            </div>
          )}

          {loading ? (
            <p className="panel-empty">{tr("Loading...")}</p>
          ) : skills.length === 0 ? (
            <p className="panel-empty">{tr("No skills created yet")}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {skills.map((skill: Skill) => (
                <div key={skill.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {skill.name}
                        {skill.auto_generated && <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--info)', fontWeight: 400 }}>{tr("auto")}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{skill.description}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>{tr("Mode:")}{skill.run_mode}</span>
                        <span>{tr("Nutzung:")}{skill.usage_count}{tr("x")}</span>
                        <span>{tr("Erfolg:")}{skill.success_count}/{skill.usage_count}</span>
                        <span>{tr("quality:")}{skill.avg_quality.toFixed(1)}</span>
                        {skill.trigger_pattern && <span>{tr("Trigger:")}{skill.trigger_pattern}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="btn-sm" onClick={() => {
                        setImproveId(skill.id)
                        setImproveTemplate(skill.prompt_template)
                      }} title={tr("Verbessern")}>✏️</button>
                      <button type="button" onClick={() => { deleteSkill(skill.id); loadSkills() }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14 }}>{tr("×")}</button>
                    </div>
                  </div>

                  {improveId === skill.id && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>{tr("New prompt template")}<textarea value={improveTemplate} onChange={(e) => setImproveTemplate(e.target.value)} rows={3}
                          style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical' }} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>{tr("Grund")}<input type="text" value={improveReason} onChange={(e) => setImproveReason(e.target.value)}
                          style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn-sm" onClick={handleImprove}>{tr("Uebernehmen")}</button>
                        <button type="button" className="btn-sm" onClick={() => setImproveId(null)}>{tr("Cancel")}</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'learnings' && (
        <>
          {loading ? (
            <p className="panel-empty">{tr("Loading...")}</p>
          ) : learnings.length === 0 ? (
            <p className="panel-empty">{tr("No learning entries yet")}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {learnings.map((l) => (
                <div key={l.id} className="card">
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    {l.outcome_type}{tr("&middot; Conf:")}{l.confidence.toFixed(2)}{tr("&middot;")}{new Date(l.created_at).toLocaleString('en-US')}
                  </div>
                  <div style={{ fontSize: 13 }}>{l.description}</div>
                  {l.learned_pattern && (
                    <div style={{ fontSize: 12, color: 'var(--info)', marginTop: 4 }}>{tr("Pattern:")}{l.learned_pattern}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
