import { useEffect, useState } from 'react'
import { useCrewStore, type CrewAgent, type Crew } from '../stores/crewStore'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function CrewPanel() {
  const {
    crews, agents, activeCrewId, executionLogs,
    createCrew, deleteCrew, setActiveCrew,
    addAgent, removeAgent, installDefaultAgents,
    addTask, removeTask,
    runCrew, stopCrew,
  } = useCrewStore()

  const [tab, setTab] = useState<'agents' | 'crews' | 'logs'>('agents')
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [showAddCrew, setShowAddCrew] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [agentForm, setAgentForm] = useState({
    name: '', role: 'custom' as CrewAgent['role'], goal: '', backstory: '',
    tools: 'read_file,grep,glob', maxIterations: '10',
  })
  const [crewForm, setCrewForm] = useState({ name: '', process: 'sequential' as Crew['process'] })
  const [taskForm, setTaskForm] = useState({ description: '', expectedOutput: '', agentId: '' })

  useEffect(() => {
    if (agents.length === 0) installDefaultAgents()
  }, [agents.length, installDefaultAgents])

  const handleAddAgent = () => {
    if (!agentForm.name.trim() || !agentForm.goal.trim()) return
    addAgent({
      id: `agent-${uid()}`,
      name: agentForm.name.trim(),
      role: agentForm.role,
      goal: agentForm.goal,
      backstory: agentForm.backstory,
      personalityId: null,
      modelOverride: null,
      tools: agentForm.tools.split(',').map(t => t.trim()).filter(Boolean),
      allowDelegation: true,
      verbose: true,
      maxIterations: Number.parseInt(agentForm.maxIterations, 10) || 10,
    })
    setAgentForm({ name: '', role: 'custom', goal: '', backstory: '', tools: 'read_file,grep,glob', maxIterations: '10' })
    setShowAddAgent(false)
  }

  const handleAddCrew = () => {
    if (!crewForm.name.trim()) return
    createCrew(`crew-${uid()}`, crewForm.name.trim(), agents.map(a => a.id))
    setCrewForm({ name: '', process: 'sequential' })
    setShowAddCrew(false)
  }

  const handleAddTask = () => {
    if (!taskForm.description.trim() || !activeCrewId || !taskForm.agentId) return
    addTask(activeCrewId, {
      id: `task-${uid()}`,
      description: taskForm.description,
      expectedOutput: taskForm.expectedOutput,
      agentId: taskForm.agentId,
      context: [],
      dependencies: [],
      asyncExecution: false,
      status: 'pending',
      output: null,
    })
    setTaskForm({ description: '', expectedOutput: '', agentId: '' })
    setShowAddTask(false)
  }

  return (
    <div className="panel">
      <div className="panel-heading-row">
        <h2>🚀 CrewAI Multi-Agent</h2>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['agents', 'crews', 'logs'] as const).map(t => (
          <button key={t} type="button" className={`btn-sm${tab === t ? ' btn-active' : ''}`}
            onClick={() => setTab(t)}
            style={{ fontWeight: tab === t ? 700 : 400, textDecoration: tab === t ? 'underline' : 'none' }}>
            {t === 'agents' ? 'Agenten' : t === 'crews' ? 'Crews' : 'Logs'}
          </button>
        ))}
      </div>

      {tab === 'agents' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" className="btn-sm" onClick={() => setShowAddAgent(!showAddAgent)}>+ Agent</button>
            <button type="button" className="btn-sm" onClick={installDefaultAgents}>Standard-Agenten laden</button>
          </div>

          {showAddAgent && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ fontSize: 13 }}>
                  Name
                  <input type="text" value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })}
                    style={{ width: '100%', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 13 }}>
                  Rolle
                  <select value={agentForm.role} onChange={e => setAgentForm({ ...agentForm, role: e.target.value as CrewAgent['role'] })}
                    style={{ width: '100%', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }}>
                    <option value="researcher">Forscher</option>
                    <option value="writer">Autor</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="planner">Planer</option>
                    <option value="executor">Ausfuehrer</option>
                    <option value="analyst">Analyst</option>
                    <option value="custom">Benutzerdefiniert</option>
                  </select>
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
                Ziel
                <input type="text" value={agentForm.goal} onChange={e => setAgentForm({ ...agentForm, goal: e.target.value })}
                  style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
                Hintergrund
                <textarea value={agentForm.backstory} onChange={e => setAgentForm({ ...agentForm, backstory: e.target.value })} rows={2}
                  style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
                Tools (kommagetrennt)
                <input type="text" value={agentForm.tools} onChange={e => setAgentForm({ ...agentForm, tools: e.target.value })}
                  style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
              </label>
              <button type="button" className="btn-sm" onClick={handleAddAgent}>Speichern</button>
            </div>
          )}

          {agents.length === 0 ? (
            <p className="panel-empty">Keine Agenten konfiguriert.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {agents.map(a => (
                <div key={a.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {a.name} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({a.role})</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{a.goal}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Tools: {a.tools.join(', ')} | Max: {a.maxIterations} Iterationen
                      </div>
                    </div>
                    <button type="button" onClick={() => removeAgent(a.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14 }}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'crews' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" className="btn-sm" onClick={() => setShowAddCrew(!showAddCrew)}>+ Crew</button>
          </div>

          {showAddCrew && (
            <div className="card" style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
                Crew-Name
                <input type="text" value={crewForm.name} onChange={e => setCrewForm({ ...crewForm, name: e.target.value })}
                  style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
                Prozess
                <select value={crewForm.process} onChange={e => setCrewForm({ ...crewForm, process: e.target.value as Crew['process'] })}
                  style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }}>
                  <option value="sequential">Sequenziell</option>
                  <option value="hierarchical">Hierarchisch</option>
                </select>
              </label>
              <button type="button" className="btn-sm" onClick={handleAddCrew}>Erstellen</button>
            </div>
          )}

          {crews.length === 0 ? (
            <p className="panel-empty">Keine Crews erstellt. Erstelle eine Crew um Agenten zu orchestrieren.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {crews.map(c => (
                <div key={c.id} className="card" style={{
                  border: activeCrewId === c.id ? '2px solid var(--accent)' : '1px solid transparent',
                  cursor: 'pointer',
                }} onClick={() => setActiveCrew(c.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {c.name}
                        <span style={{ fontSize: 11, marginLeft: 8, color: c.status === 'running' ? 'var(--success)' : 'var(--text-muted)' }}>
                          {c.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {c.agents.length} Agenten | {c.tasks.length} Aufgaben | {c.process}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {c.status === 'running' ? (
                        <button type="button" className="btn-sm" onClick={e => { e.stopPropagation(); stopCrew(c.id) }}
                          style={{ color: 'var(--danger)' }}>Stop</button>
                      ) : (
                        <button type="button" className="btn-sm" onClick={e => { e.stopPropagation(); runCrew(c.id) }}>Start</button>
                      )}
                      <button type="button" onClick={e => { e.stopPropagation(); deleteCrew(c.id) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14 }}>×</button>
                    </div>
                  </div>

                  {activeCrewId === c.id && (
                    <div style={{ marginTop: 8, borderTop: '1px solid var(--border-color)', paddingTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Aufgaben</span>
                        <button type="button" className="btn-sm" onClick={e => { e.stopPropagation(); setShowAddTask(!showAddTask) }}>+ Aufgabe</button>
                      </div>

                      {showAddTask && (
                        <div style={{ marginBottom: 8, padding: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}
                          onClick={e => e.stopPropagation()}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 6 }}>
                            Beschreibung
                            <textarea value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} rows={2}
                              style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 6 }}>
                            Erwartetes Ergebnis
                            <input type="text" value={taskForm.expectedOutput} onChange={e => setTaskForm({ ...taskForm, expectedOutput: e.target.value })}
                              style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 6 }}>
                            Agent
                            <select value={taskForm.agentId} onChange={e => setTaskForm({ ...taskForm, agentId: e.target.value })}
                              style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: 13 }}>
                              <option value="">Agent waehlen...</option>
                              {c.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </label>
                          <button type="button" className="btn-sm" onClick={handleAddTask}>Hinzufuegen</button>
                        </div>
                      )}

                      {c.tasks.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Keine Aufgaben definiert.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {c.tasks.map(t => {
                            const agent = c.agents.find(a => a.id === t.agentId)
                            return (
                              <div key={t.id} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg)',
                                fontSize: 12,
                              }}>
                                <div>
                                  <span style={{
                                    color: t.status === 'completed' ? 'var(--success)' : t.status === 'running' ? 'var(--accent)' : t.status === 'failed' ? 'var(--danger)' : 'var(--text-secondary)',
                                    marginRight: 6,
                                  }}>
                                    {t.status === 'completed' ? '✓' : t.status === 'running' ? '⟳' : t.status === 'failed' ? '✗' : '○'}
                                  </span>
                                  {t.description.slice(0, 60)}
                                  {agent && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>→ {agent.name}</span>}
                                </div>
                                <button type="button" onClick={e => { e.stopPropagation(); removeTask(c.id, t.id) }}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 12 }}>×</button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div>
          {executionLogs.length === 0 ? (
            <p className="panel-empty">Keine Ausfuehrungslogs vorhanden.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflow: 'auto' }}>
              {executionLogs.slice(0, 50).map(log => (
                <div key={log.id} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{new Date(log.timestamp).toLocaleTimeString('de-DE')}</span>
                  {' '}
                  <span style={{ fontWeight: 600 }}>{log.action}</span>
                  {' '}
                  <span style={{ color: 'var(--text-secondary)' }}>{log.result.slice(0, 100)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
