import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useConfigStore } from '../stores/configStore'
import {
  PLUGIN_EXAMPLES,
  useCoworkStore,
  type ClaudePermissionMode,
  type ClaudeToolPreset,
  type ConnectorKey,
  type FolderInstruction,
  type Plugin,
  type ScheduledTask,
} from '../stores/coworkStore'

type ProOutputResponse = {
  csvPath: string
  outputDir: string
  generatedFiles: string[]
  rows: number
  columns: number
  numericColumns: number
  totals: [string, number][]
}

type ScheduledTaskRow = {
  id: string
  name: string
  prompt: string
  scheduleExpr: string
  active: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

type ScheduledRunRow = {
  id: string
  taskId: string
  status: string
  startedAt: string
  finishedAt: string | null
  result: string | null
  error: string | null
}

type McpCallResponse = {
  serverName: string
  toolName: string
  success: boolean
  result: string
  error: string | null
}

type McpProbeResponse = {
  serverName: string
  protocolVersion: string | null
  serverInfo: string | null
  tools: Array<{ name: string; description: string }>
}

type PolicyStateResponse = {
  flags: {
    strictPolicyEnforcement: boolean
    allowToolDispatcher: boolean
    allowMcpToolCalls: boolean
    allowShellExecution: boolean
    allowWebFetch: boolean
    allowWebSearch: boolean
    allowFileReadExtraction: boolean
    autoCompactLongContext: boolean
  }
  denyRules: string[]
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return path
  const dir = normalized.slice(0, index)
  return path.includes('\\') ? dir.replace(/\//g, '\\') : dir
}

export default function CoworkFeaturesPanel() {
  const mcpServer = useConfigStore((state) => state.mcpServer)
  const {
    globalInstruction,
    folderInstructions,
    connectors,
    plugins,
    setGlobalInstruction,
    upsertFolderInstruction,
    removeFolderInstruction,
    toggleConnector,
    setConnectorNote,
    upsertPlugin,
    togglePlugin,
    removePlugin,
    installPluginExamples,
    upsertScheduledTask,
    toggleScheduledTask,
    markScheduledTaskRun,
    removeScheduledTask,
    claudePlanMode,
    claudePermissionMode,
    claudeToolPreset,
    claudeTools,
    enabledClaudeToolIds,
    setClaudePlanMode,
    setClaudePermissionMode,
    setClaudeToolPreset,
    toggleClaudeTool,
    toolDenyRules,
    addToolDenyRule,
    removeToolDenyRule,
    policyFlags,
    setPolicyFlag,
    setPolicySnapshot,
  } = useCoworkStore()

  const [folderPath, setFolderPath] = useState('')
  const [folderInstruction, setFolderInstruction] = useState('')
  const [pluginName, setPluginName] = useState('')
  const [pluginDomain, setPluginDomain] = useState<Plugin['domain']>('custom')
  const [skillName, setSkillName] = useState('')
  const [skillCommand, setSkillCommand] = useState('')
  const [skillDescription, setSkillDescription] = useState('')
  const [skillRunMode, setSkillRunMode] = useState<'plan' | 'execute'>('execute')
  const [skillPromptTemplate, setSkillPromptTemplate] = useState('')
  const [taskName, setTaskName] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [taskCronLike, setTaskCronLike] = useState('Montag 08:00')
  const [csvPath, setCsvPath] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [baseName, setBaseName] = useState('cowork-export')
  const [denyRuleInput, setDenyRuleInput] = useState('')
  const [proOutput, setProOutput] = useState<ProOutputResponse | null>(null)
  const [scheduledTaskRows, setScheduledTaskRows] = useState<ScheduledTaskRow[]>([])
  const [scheduledRunRows, setScheduledRunRows] = useState<ScheduledRunRow[]>([])
  const [schedulerBusy, setSchedulerBusy] = useState(false)
  const [connectorBusyKey, setConnectorBusyKey] = useState<ConnectorKey | null>(null)
  const [connectorResult, setConnectorResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

  const connectorCount = useMemo(
    () => connectors.filter((connector) => connector.enabled).length,
    [connectors]
  )

  const pluginSkillPreview = useMemo(() => {
    if (!skillName.trim() || !skillCommand.trim()) return []
    return [
      {
        id: randomId('skill-preview'),
        name: skillName.trim(),
        command: skillCommand.trim(),
        description: skillDescription.trim(),
        promptTemplate: skillPromptTemplate.trim(),
        runMode: skillRunMode,
      },
    ]
  }, [skillCommand, skillDescription, skillName, skillPromptTemplate, skillRunMode])

  const pickFolderForRule = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected === 'string') {
      setFolderPath(selected)
    }
  }

  const syncScheduledTaskToStore = (task: ScheduledTaskRow) => {
    upsertScheduledTask({
      id: task.id,
      name: task.name,
      prompt: task.prompt,
      cronLike: task.scheduleExpr,
      active: task.active,
      lastRunAt: task.lastRunAt ? Date.parse(task.lastRunAt) : null,
    })
  }

  const loadScheduledTasks = async () => {
    const rows = await invoke<ScheduledTaskRow[]>('scheduler_list_tasks')
    setScheduledTaskRows(rows)
    rows.forEach(syncScheduledTaskToStore)
  }

  const loadScheduledRuns = async () => {
    const rows = await invoke<ScheduledRunRow[]>('scheduler_list_runs', { limit: 30 })
    setScheduledRunRows(rows)
  }

  useEffect(() => {
    if (!hasTauriRuntime) return

    void (async () => {
      try {
        await loadScheduledTasks()
        await loadScheduledRuns()

        const backendPolicy = await invoke<PolicyStateResponse>('policy_get')
        setPolicySnapshot(backendPolicy.flags, backendPolicy.denyRules)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [hasTauriRuntime])

  const parseMcpArgs = (raw: string): string[] => {
    const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
    return matches.map((part) => part.replace(/^["']|["']$/g, ''))
  }

  const addFolderRule = () => {
    if (!folderPath.trim() || !folderInstruction.trim()) return

    const item: FolderInstruction = {
      id: randomId('folder-rule'),
      folderPath: folderPath.trim(),
      instruction: folderInstruction.trim(),
    }

    upsertFolderInstruction(item)
    setFolderPath('')
    setFolderInstruction('')
  }

  const addPlugin = () => {
    if (!pluginName.trim()) return
    const plugin: Plugin = {
      id: randomId('plugin'),
      name: pluginName.trim(),
      domain: pluginDomain,
      enabled: true,
      skills: pluginSkillPreview,
    }
    upsertPlugin(plugin)
    setPluginName('')
    setSkillName('')
    setSkillCommand('')
    setSkillDescription('')
    setSkillRunMode('execute')
    setSkillPromptTemplate('')
  }

  const addScheduledTask = async () => {
    if (!taskName.trim() || !taskPrompt.trim()) return
    const task: ScheduledTask = {
      id: randomId('schedule'),
      name: taskName.trim(),
      prompt: taskPrompt.trim(),
      cronLike: taskCronLike.trim() || 'manuell',
      active: true,
      lastRunAt: null,
    }

    setSchedulerBusy(true)
    setError(null)
    try {
      const saved = await invoke<ScheduledTaskRow>('scheduler_upsert_task', {
        request: {
          id: task.id,
          name: task.name,
          prompt: task.prompt,
          scheduleExpr: task.cronLike,
          active: task.active,
        },
      })
      syncScheduledTaskToStore(saved)
      await loadScheduledTasks()
      await loadScheduledRuns()
      setTaskName('')
      setTaskPrompt('')
      setTaskCronLike('Montag 08:00')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSchedulerBusy(false)
    }
  }

  const runScheduledTaskNow = async (taskId: string) => {
    setSchedulerBusy(true)
    setError(null)
    try {
      await invoke('scheduler_run_task_now', { id: taskId })
      markScheduledTaskRun(taskId, Date.now())
      await loadScheduledTasks()
      await loadScheduledRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSchedulerBusy(false)
    }
  }

  const setScheduledTaskActive = async (taskId: string, active: boolean) => {
    setSchedulerBusy(true)
    setError(null)
    try {
      await invoke('scheduler_set_task_active', {
        request: {
          id: taskId,
          active,
        },
      })
      toggleScheduledTask(taskId, active)
      await loadScheduledTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSchedulerBusy(false)
    }
  }

  const deleteScheduledTask = async (taskId: string) => {
    setSchedulerBusy(true)
    setError(null)
    try {
      await invoke('scheduler_delete_task', { id: taskId })
      removeScheduledTask(taskId)
      await loadScheduledTasks()
      await loadScheduledRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSchedulerBusy(false)
    }
  }

  const runConnectorCheck = async (key: ConnectorKey, label: string) => {
    setConnectorBusyKey(key)
    setConnectorResult(null)
    setError(null)

    try {
      const probe = await invoke<McpProbeResponse>('mcp_probe', {
        request: {
          name: mcpServer.name,
          command: mcpServer.command,
          args: parseMcpArgs(mcpServer.args),
          env: mcpServer.env,
        },
      })

      let callResult = ''
      const localDocsTool = probe.tools.find((tool) => tool.name === 'list_allowed_folders')
      if (localDocsTool) {
        const response = await invoke<McpCallResponse>('mcp_call_tool', {
          request: {
            name: mcpServer.name,
            command: mcpServer.command,
            args: parseMcpArgs(mcpServer.args),
            env: mcpServer.env,
            toolName: localDocsTool.name,
            toolArgs: {},
          },
        })
        callResult = response.success
          ? `\nTool-Call ${localDocsTool.name}: ok\n${response.result}`
          : `\nTool-Call ${localDocsTool.name}: failed\n${response.error ?? response.result}`
      }

      setConnectorResult(
        [
          `${label}: ok`,
          `MCP Server: ${probe.serverName}`,
          `Protocol: ${probe.protocolVersion ?? '-'}`,
          `Tools: ${probe.tools.length}`,
          probe.serverInfo ? `Info: ${probe.serverInfo}` : null,
          callResult || null,
        ]
          .filter(Boolean)
          .join('\n'),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnectorBusyKey(null)
    }
  }

  const chooseCsvFile = async () => {
    const selected = await open({ directory: false, multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (typeof selected === 'string') {
      setCsvPath(selected)
    }
  }

  const chooseOutputDir = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected === 'string') {
      setOutputDir(selected)
    }
  }

  const generateProOutputs = async () => {
    if (!csvPath.trim() || !outputDir.trim()) return

    setBusy(true)
    setError(null)
    setProOutput(null)
    try {
      const response = await invoke<ProOutputResponse>('fs_generate_pro_outputs', {
        request: {
          csvPath,
          outputDir,
          baseName: baseName.trim() || null,
        },
      })
      // Persist each generated document as an artifact version in the app DB.
      for (const generatedPath of response.generatedFiles) {
        try {
          await invoke('fs_add_allowed_folder', { path: parentDir(generatedPath) })
          await invoke('fs_save_artifact_version', {
            path: generatedPath,
            runId: null,
            label: `pro-output:${baseName.trim() || 'cowork-export'}`,
          })
        } catch {
          // Artifact persistence is best-effort; generation result remains available.
        }
      }
      setProOutput(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2>Cowork Features</h2>

      <div className="card">
        <p><strong>Claude-Kompatibilitaet (Ollama + UI)</strong></p>
        <div className="grid">
          <label>
            Plan-Mode
            <select
              value={claudePlanMode ? 'on' : 'off'}
              onChange={(event) => setClaudePlanMode(event.target.value === 'on')}
            >
              <option value="off">Execute</option>
              <option value="on">Plan only</option>
            </select>
          </label>
          <label>
            Permission-Modus
            <select
              value={claudePermissionMode}
              onChange={(event) => setClaudePermissionMode(event.target.value as ClaudePermissionMode)}
            >
              <option value="default">default</option>
              <option value="acceptEdits">acceptEdits</option>
              <option value="bypassPermissions">bypassPermissions</option>
              <option value="dontAsk">dontAsk</option>
              <option value="plan">plan</option>
            </select>
          </label>
          <label>
            Tool-Preset
            <select
              value={claudeToolPreset}
              onChange={(event) => setClaudeToolPreset(event.target.value as ClaudeToolPreset)}
            >
              <option value="default">default</option>
              <option value="safe">safe</option>
              <option value="extended">extended</option>
            </select>
          </label>
        </div>

        <p><strong>Aktive Tool-Familien</strong></p>
        <ul className="tool-list">
          {claudeTools.map((tool) => (
            <li className="tool-item" key={tool.id}>
              <span>
                <strong>{tool.label}</strong> - {tool.description}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={enabledClaudeToolIds.includes(tool.id)}
                  onChange={(event) => toggleClaudeTool(tool.id, event.target.checked)}
                />
                aktiv
              </label>
            </li>
          ))}
        </ul>

        <p><strong>Policy-Flags</strong></p>
        <ul className="tool-list">
          <li className="tool-item">
            <span><strong>strictPolicyEnforcement</strong> - Regeln hart durchsetzen</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.strictPolicyEnforcement}
                onChange={(event) => setPolicyFlag('strictPolicyEnforcement', event.target.checked)}
              />
              aktiv
            </label>
          </li>
          <li className="tool-item">
            <span><strong>allowToolDispatcher</strong> - /tool Dispatcher erlauben</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.allowToolDispatcher}
                onChange={(event) => setPolicyFlag('allowToolDispatcher', event.target.checked)}
              />
              aktiv
            </label>
          </li>
          <li className="tool-item">
            <span><strong>allowMcpToolCalls</strong> - MCP Tool Calls erlauben</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.allowMcpToolCalls}
                onChange={(event) => setPolicyFlag('allowMcpToolCalls', event.target.checked)}
              />
              aktiv
            </label>
          </li>
          <li className="tool-item">
            <span><strong>allowShellExecution</strong> - Shell-Ausfuehrung erlauben</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.allowShellExecution}
                onChange={(event) => setPolicyFlag('allowShellExecution', event.target.checked)}
              />
              aktiv
            </label>
          </li>
          <li className="tool-item">
            <span><strong>allowWebFetch</strong> - Web Fetch erlauben</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.allowWebFetch}
                onChange={(event) => setPolicyFlag('allowWebFetch', event.target.checked)}
              />
              aktiv
            </label>
          </li>
          <li className="tool-item">
            <span><strong>allowWebSearch</strong> - Web Search erlauben</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.allowWebSearch}
                onChange={(event) => setPolicyFlag('allowWebSearch', event.target.checked)}
              />
              aktiv
            </label>
          </li>
          <li className="tool-item">
            <span><strong>allowFileReadExtraction</strong> - Dateiextraktion erlauben</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.allowFileReadExtraction}
                onChange={(event) => setPolicyFlag('allowFileReadExtraction', event.target.checked)}
              />
              aktiv
            </label>
          </li>
          <li className="tool-item">
            <span><strong>autoCompactLongContext</strong> - Kontext kompaktieren</span>
            <label>
              <input
                type="checkbox"
                checked={policyFlags.autoCompactLongContext}
                onChange={(event) => setPolicyFlag('autoCompactLongContext', event.target.checked)}
              />
              aktiv
            </label>
          </li>
        </ul>

        <p><strong>Deny-Rules</strong></p>
        <div className="grid">
          <label>
            Neue Regel
            <input
              value={denyRuleInput}
              onChange={(event) => setDenyRuleInput(event.target.value)}
              placeholder="z. B. mcp:* oder web_fetch:*example.com*"
            />
          </label>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              addToolDenyRule(denyRuleInput)
              setDenyRuleInput('')
            }}
            disabled={!denyRuleInput.trim()}
          >
            Rule hinzufuegen
          </button>
        </div>
        {toolDenyRules.length > 0 && (
          <ul className="tool-list">
            {toolDenyRules.map((rule) => (
              <li className="tool-item" key={rule}>
                <span>{rule}</span>
                <button type="button" className="btn-secondary" onClick={() => removeToolDenyRule(rule)}>
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p><strong>Globale Anweisungen</strong></p>
        <textarea
          rows={4}
          value={globalInstruction}
          onChange={(event) => setGlobalInstruction(event.target.value)}
          placeholder="Definiere Markenstimme, Antwortformat und Rollen-Kontext..."
        />
      </div>

      <div className="card">
        <p><strong>Ordner-Anweisungen</strong></p>
        <div className="actions">
          <button type="button" onClick={pickFolderForRule}>Ordner auswaehlen</button>
        </div>
        <div className="grid">
          <label>
            Ordnerpfad
            <input
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              placeholder="C:\\Clients"
            />
          </label>
          <label>
            Regel
            <input
              value={folderInstruction}
              onChange={(event) => setFolderInstruction(event.target.value)}
              placeholder="YYYY-MM-DD_ClientName Schema erzwingen"
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={addFolderRule}>Regel speichern</button>
        </div>
        {folderInstructions.length > 0 && (
          <ul className="tool-list">
            {folderInstructions.map((item) => (
              <li className="tool-item" key={item.id}>
                <span><strong>{item.folderPath}</strong> - {item.instruction}</span>
                <button type="button" className="btn-secondary" onClick={() => removeFolderInstruction(item.id)}>Entfernen</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p><strong>Connector: Claude in Chrome</strong> ({connectorCount} aktiv)</p>
        <div className="tool-list">
          {connectors.map((connector) => (
            <div key={connector.key} className="tool-item">
              <span>{connector.label}</span>
              <label>
                <input
                  type="checkbox"
                  checked={connector.enabled}
                  onChange={(event) => toggleConnector(connector.key as ConnectorKey, event.target.checked)}
                />
                aktiv
              </label>
              <input
                value={connector.note}
                onChange={(event) => setConnectorNote(connector.key as ConnectorKey, event.target.value)}
                placeholder="Notiz / Mapping"
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => runConnectorCheck(connector.key as ConnectorKey, connector.label)}
                disabled={connectorBusyKey === connector.key || !connector.enabled}
              >
                {connectorBusyKey === connector.key ? 'Teste...' : 'Live-Test'}
              </button>
            </div>
          ))}
        </div>
        {connectorResult && <pre className="tool-result">{connectorResult}</pre>}
      </div>

      <div className="card">
        <p><strong>Plugins & Skills</strong></p>
        <p>
          <small>Skills sind als Slash-Commands im Cowork-Chat nutzbar (z. B. /campaign-brief Q2 Launch).</small>
        </p>
        <div className="actions">
          <button type="button" className="btn-secondary" onClick={installPluginExamples}>
            3 Beispiel-Plugins installieren
          </button>
          <span>
            {PLUGIN_EXAMPLES.length} Beispiele enthalten: {PLUGIN_EXAMPLES.map((plugin) => plugin.name).join(', ')}
          </span>
        </div>
        <div className="grid">
          <label>
            Plugin Name
            <input value={pluginName} onChange={(event) => setPluginName(event.target.value)} placeholder="Finance Toolkit" />
          </label>
          <label>
            Domain
            <select value={pluginDomain} onChange={(event) => setPluginDomain(event.target.value as Plugin['domain'])}>
              <option value="marketing">Marketing</option>
              <option value="sales">Sales</option>
              <option value="finance">Finance</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Skill Name
            <input value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="Weekly Recap" />
          </label>
          <label>
            Slash-Befehl
            <input value={skillCommand} onChange={(event) => setSkillCommand(event.target.value)} placeholder="/weekly-recap" />
          </label>
          <label>
            Skill-Beschreibung
            <input
              value={skillDescription}
              onChange={(event) => setSkillDescription(event.target.value)}
              placeholder="Kurzer Zweck des Skills"
            />
          </label>
          <label>
            Skill-Modus
            <select
              value={skillRunMode}
              onChange={(event) => setSkillRunMode(event.target.value as 'plan' | 'execute')}
            >
              <option value="execute">execute</option>
              <option value="plan">plan</option>
            </select>
          </label>
          <label>
            Prompt-Template
            <textarea
              rows={4}
              value={skillPromptTemplate}
              onChange={(event) => setSkillPromptTemplate(event.target.value)}
              placeholder={'Nutze {{input}} fuer den Slash-Input und optional {{skill_name}} oder {{plugin_name}}.'}
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={addPlugin}>Plugin erstellen</button>
        </div>
        {plugins.length > 0 && (
          <ul className="tool-list">
            {plugins.map((plugin) => (
              <li className="tool-item" key={plugin.id}>
                <span>
                  <strong>{plugin.name}</strong> ({plugin.domain})
                  {plugin.skills.length > 0 && ` - ${plugin.skills.length} Skill(s)`}
                </span>
                {plugin.skills.length > 0 && (
                  <div>
                    {plugin.skills.map((skill) => (
                      <p key={skill.id}>
                        <strong>{skill.name}</strong> {skill.command} [{skill.runMode}]
                        {skill.description ? ` - ${skill.description}` : ''}
                      </p>
                    ))}
                  </div>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    onChange={(event) => togglePlugin(plugin.id, event.target.checked)}
                  />
                  aktiv
                </label>
                <button type="button" className="btn-secondary" onClick={() => removePlugin(plugin.id)}>
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p><strong>Geplante Aufgaben</strong></p>
        <div className="grid">
          <label>
            Name
            <input value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="Montags-Report" />
          </label>
          <label>
            Rhythmus
            <input value={taskCronLike} onChange={(event) => setTaskCronLike(event.target.value)} placeholder="Montag 08:00" />
          </label>
          <label>
            Prompt
            <textarea rows={3} value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="Fasse Slack-Updates zusammen" />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={() => void addScheduledTask()} disabled={schedulerBusy}>Task planen</button>
        </div>
        {scheduledTaskRows.length > 0 && (
          <ul className="tool-list">
            {scheduledTaskRows.map((task) => (
              <li className="tool-item" key={task.id}>
                <span>
                  <strong>{task.name}</strong> - {task.scheduleExpr}
                  {task.lastRunAt ? ` | Letzter Lauf: ${new Date(task.lastRunAt).toLocaleString('de-DE')}` : ''}
                  {task.nextRunAt ? ` | Naechster Lauf: ${new Date(task.nextRunAt).toLocaleString('de-DE')}` : ''}
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={task.active}
                    onChange={(event) => void setScheduledTaskActive(task.id, event.target.checked)}
                  />
                  aktiv
                </label>
                <button type="button" className="btn-secondary" onClick={() => void runScheduledTaskNow(task.id)}>
                  Jetzt ausfuehren
                </button>
                <button type="button" className="btn-secondary" onClick={() => void deleteScheduledTask(task.id)}>
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
        {scheduledRunRows.length > 0 && (
          <div className="card">
            <p><strong>Run-Historie</strong></p>
            <ul className="tool-list">
              {scheduledRunRows.map((run) => (
                <li key={run.id} className="tool-item">
                  <span>
                    <strong>{run.taskId}</strong> - {run.status} - {new Date(run.startedAt).toLocaleString('de-DE')}
                  </span>
                  {run.error ? <span className="error">{run.error}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <p><strong>Pro-Ausgaben (Excel, Word, PowerPoint, PDF)</strong></p>
        <div className="grid">
          <label>
            CSV-Quelle
            <input value={csvPath} onChange={(event) => setCsvPath(event.target.value)} placeholder="C:\\...\\belege.csv" />
          </label>
          <label>
            Ausgabeordner
            <input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} placeholder="C:\\...\\exports" />
          </label>
          <label>
            Basisname
            <input value={baseName} onChange={(event) => setBaseName(event.target.value)} placeholder="kunden-report" />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={chooseCsvFile}>CSV auswaehlen</button>
          <button type="button" className="btn-secondary" onClick={chooseOutputDir}>Ausgabeordner</button>
          <button type="button" onClick={generateProOutputs} disabled={busy || !csvPath.trim() || !outputDir.trim()}>
            {busy ? 'Erzeuge Dateien...' : 'Pro-Ausgaben erzeugen'}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {proOutput && (
          <div className="card">
            <p>Zeilen: {proOutput.rows} | Spalten: {proOutput.columns} | Numerische Spalten: {proOutput.numericColumns}</p>
            <p><strong>Dateien:</strong></p>
            <ul className="tool-list">
              {proOutput.generatedFiles.map((file) => (
                <li className="tool-item" key={file}><span>{file}</span></li>
              ))}
            </ul>
            {proOutput.totals.length > 0 && (
              <pre className="tool-result">{JSON.stringify(proOutput.totals, null, 2)}</pre>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
