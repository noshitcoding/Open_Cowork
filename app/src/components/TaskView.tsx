import { useEffect, useState } from 'react'
import { useTaskStore } from '../stores/taskStore'
import { useConfigStore } from '../stores/configStore'
import type { Task, TaskStatus } from '../stores/taskStore'
import i18n, { tr } from '../i18n'

function formatTaskStatus(status: TaskStatus): string {
  switch (status) {
    case 'created': return tr('Created')
    case 'planned': return tr('Planned')
    case 'waiting_approval': return tr('Waiting for approval')
    case 'running': return tr('Running')
    case 'completed': return tr('Completed')
    case 'failed': return tr('Failed')
    case 'cancelled': return tr('Canceled')
  }
}

function TaskCard({ task }: { task: Task }) {
  const { updateTaskStatus } = useTaskStore()

  return (
    <div className="card task-card">
      <div className="task-header">
        <h3>{task.title}</h3>
        <span
          className={`task-status-badge status-${task.status}`}
        >
          {formatTaskStatus(task.status)}
        </span>
      </div>
      <p className="task-prompt">{task.prompt}</p>

      {task.steps.length > 0 && (
        <div className="task-steps">
          <h4>{tr("Steps")}</h4>
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
            >{tr("Approve and start")}</button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => updateTaskStatus(task.id, 'cancelled')}
            >{tr("Cancel")}</button>
          </>
        )}
        {task.status === 'running' && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => updateTaskStatus(task.id, 'cancelled')}
          >{tr("Cancel")}</button>
        )}
      </div>

      <div className="task-meta">{tr("Created:")}{new Date(task.createdAt).toLocaleString(i18n.resolvedLanguage ?? i18n.language ?? 'en')}
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
      <h1>{tr("Tasks")}</h1>
      {multiSelectEnabled && tasks.length > 0 && (
        <div className="actions task-batch-actions">
          <button type="button" className="btn-secondary" onClick={() => setSelectedIds(tasks.map((task) => task.id))}>{tr("Select all")}</button>
          <button type="button" className="btn-secondary" onClick={() => setSelectedIds([])}>{tr("Clear selection")}</button>
          <button type="button" onClick={() => applyBatchStatus('completed')} disabled={selectedIds.length === 0}>{tr("Finish selection")}</button>
          <button type="button" className="btn-secondary" onClick={() => applyBatchStatus('cancelled')} disabled={selectedIds.length === 0}>{tr("Cancel selection")}</button>
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <p>{tr("No tasks available yet. Tasks are created automatically from chat when a plan requires approval.")}</p>
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
                  />{tr("select")}</label>
              )}
              <TaskCard task={task} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
