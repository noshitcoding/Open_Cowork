import { useTaskStore } from '../stores/taskStore'
import { useUiStore } from '../stores/uiStore'
import { useConfigStore } from '../stores/configStore'
import { useCoworkStore } from '../stores/coworkStore'
import type { Task } from '../stores/taskStore'

export function ProgressPanel({ task }: { task: Task | undefined }) {
  if (!task || task.steps.length === 0) {
    return (
      <div className="right-panel">
        <h3 className="right-panel-title">
          Fortschritt
        </h3>
        <p className="panel-empty">Kein aktiver Task</p>
      </div>
    )
  }

  const completedCount = task.steps.filter((s) => s.state === 'completed').length
  const progress = Math.round((completedCount / task.steps.length) * 100)

  return (
    <div className="right-panel">
      <h3 className="right-panel-title">
        Fortschritt
      </h3>
      <div className="progress-bar-wrapper">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="progress-label">{progress}%</span>
      </div>
      <ul className="step-checklist">
        {task.steps.map((step) => (
          <li key={step.id} className={`step-check-item step-${step.state}`}>
            <span className="step-check-icon">
              {step.state === 'completed'
                ? 'OK'
                : step.state === 'running'
                  ? '...'
                  : step.state === 'failed'
                    ? 'X'
                    : '-'}
            </span>
            <span className="step-check-label">{step.title}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WorkingFolderPanel() {
  const workingFolder = useUiStore((s) => s.workingFolder)
  const workingPathKind = useUiStore((s) => s.workingPathKind)

  return (
    <div className="right-panel">
      <h3 className="right-panel-title">
        Arbeitsordner
      </h3>
      {workingFolder ? (
        <div className="folder-display">
          <span className="folder-kind">
            {workingPathKind === 'file' ? 'Datei' : 'Ordner'}
          </span>
          <span className="folder-path">{workingFolder}</span>
        </div>
      ) : (
        <p className="panel-empty">Kein Ordner ausgewaehlt</p>
      )}
    </div>
  )
}

export function OutputsPanel({ task }: { task: Task | undefined }) {
  const outputs = task?.steps.filter((s) => s.output) ?? []

  return (
    <div className="right-panel">
      <h3 className="right-panel-title">
        Ausgaben
      </h3>
      {outputs.length === 0 ? (
        <p className="panel-empty">Noch keine Ausgaben</p>
      ) : (
        <ul className="output-list">
          {outputs.map((step) => (
            <li key={step.id} className="output-item">
              <span className="output-name">{step.title}</span>
              <pre className="output-preview">{step.output}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ContextPanel() {
  const mcpServer = useConfigStore((s) => s.mcpServer)
  const ollama = useConfigStore((s) => s.ollama)
  const connectors = useCoworkStore((s) => s.connectors)
  const plugins = useCoworkStore((s) => s.plugins)
  const scheduledTasks = useCoworkStore((s) => s.scheduledTasks)

  const enabledConnectors = connectors.filter((entry) => entry.enabled).length
  const enabledPlugins = plugins.filter((entry) => entry.enabled).length
  const activeSchedules = scheduledTasks.filter((entry) => entry.active).length

  return (
    <div className="right-panel">
      <h3 className="right-panel-title">
        Kontext
      </h3>
      <div className="context-items">
        <div className="context-item">
          <span className="context-label">Modell</span>
          <span className="context-value">{ollama.model}</span>
        </div>
        <div className="context-item">
          <span className="context-label">MCP Server</span>
          <span className="context-value">{mcpServer.name}</span>
        </div>
        <div className="context-item">
          <span className="context-label">Endpoint</span>
          <span className="context-value">{ollama.baseUrl}</span>
        </div>
        <div className="context-item">
          <span className="context-label">Connectors</span>
          <span className="context-value">{enabledConnectors} aktiv</span>
        </div>
        <div className="context-item">
          <span className="context-label">Plugins</span>
          <span className="context-value">{enabledPlugins} aktiv</span>
        </div>
        <div className="context-item">
          <span className="context-label">Geplante Tasks</span>
          <span className="context-value">{activeSchedules} aktiv</span>
        </div>
      </div>
    </div>
  )
}

export default function RightSidebar() {
  const tasks = useTaskStore((s) => s.tasks)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const activeTask = tasks.find((t) => t.id === activeTaskId)

  return (
    <aside className="right-sidebar">
      <ProgressPanel task={activeTask} />
      <WorkingFolderPanel />
      <OutputsPanel task={activeTask} />
      <ContextPanel />
    </aside>
  )
}
