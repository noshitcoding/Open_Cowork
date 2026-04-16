import { useEffect, useState } from 'react'
import { useTaskStore } from '../stores/taskStore'
import { useConfigStore } from '../stores/configStore'
import type { Task, TaskStatus } from '../stores/taskStore'

const STATUS_LABELS: Record<TaskStatus, string> = {
  created: 'Erstellt',
  planned: 'Geplant',
  waiting_approval: 'Warte auf Freigabe',
  running: 'Läuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  created: '#6b7280',
  planned: '#3b82f6',
  waiting_approval: '#f59e0b',
  running: '#8b5cf6',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#9ca3af',
}

function TaskCard({ task }: { task: Task }) {
  const { updateTaskStatus } = useTaskStore()

  return (
    <div className="card task-card">
      <div className="task-header">
        <h3>{task.title}</h3>
        <span
          className="task-status-badge"
          style={{ background: STATUS_COLORS[task.status] }}
        >
          {STATUS_LABELS[task.status]}
        </span>
      </div>
      <p className="task-prompt">{task.prompt}</p>

      {task.steps.length > 0 && (
        <div className="task-steps">
          <h4>Schritte</h4>
          <ol>
            {task.steps.map((step) => (
              <li key={step.id} className={`step-${step.state}`}>
                <span className="step-title">{step.title}</span>
                {step.riskLevel !== 'low' && (
                  <span className={`risk-badge risk-${step.riskLevel}`}>
                    {step.riskLevel}
                  </span>
                )}
                {step.output && <pre className="step-output">{step.output}</pre>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {task.error && <p className="error">{task.error}</p>}

      <div className="task-actions">
        {task.status === 'waiting_approval' && (
          <>
            <button
              type="button"
              onClick={() => updateTaskStatus(task.id, 'running')}
            >
              Freigeben & Starten
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => updateTaskStatus(task.id, 'cancelled')}
            >
              Abbrechen
            </button>
          </>
        )}
        {task.status === 'running' && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => updateTaskStatus(task.id, 'cancelled')}
          >
            Abbrechen
          </button>
        )}
      </div>

      <div className="task-meta">
        Erstellt: {new Date(task.createdAt).toLocaleString('de-DE')}
      </div>
    </div>
  )
}

export default function TaskView() {
  const tasks = useTaskStore((s) => s.tasks)
  const loadFromDb = useTaskStore((s) => s.loadFromDb)
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus)
  const multiSelectEnabled = useConfigStore((s) => s.preferences.taskBatchMultiSelectEnabled)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => { loadFromDb() }, [loadFromDb])

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
    )
  }

  const applyBatchStatus = (status: TaskStatus) => {
    selectedIds.forEach((id) => updateTaskStatus(id, status))
    setSelectedIds([])
  }

  return (
    <div className="task-view">
      <h1>Tasks</h1>
      {multiSelectEnabled && tasks.length > 0 && (
        <div className="actions" style={{ marginBottom: '12px' }}>
          <button type="button" className="btn-secondary" onClick={() => setSelectedIds(tasks.map((task) => task.id))}>
            Alle auswaehlen
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSelectedIds([])}>
            Auswahl aufheben
          </button>
          <button type="button" onClick={() => applyBatchStatus('completed')} disabled={selectedIds.length === 0}>
            Auswahl abschliessen
          </button>
          <button type="button" className="btn-secondary" onClick={() => applyBatchStatus('cancelled')} disabled={selectedIds.length === 0}>
            Auswahl abbrechen
          </button>
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <p>Noch keine Tasks vorhanden. Tasks werden automatisch aus dem Chat erstellt, wenn ein Plan Freigabe erfordert.</p>
        </div>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <div key={task.id} className="task-select-wrapper">
              {multiSelectEnabled && (
                <label className="task-select-toggle">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(task.id)}
                    onChange={() => toggleSelected(task.id)}
                  />
                  markieren
                </label>
              )}
              <TaskCard task={task} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
