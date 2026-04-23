import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FolderInstruction = {
  id: string
  folderPath: string
  instruction: string
}

export type ConnectorKey = 'chrome'

export type ConnectorConfig = {
  key: ConnectorKey
  label: string
  enabled: boolean
  note: string
}

export type PluginSkill = {
  id: string
  name: string
  command: string
  description: string
  promptTemplate: string
  runMode: 'plan' | 'execute'
}

export type Plugin = {
  id: string
  name: string
  domain: 'marketing' | 'sales' | 'finance' | 'custom'
  enabled: boolean
  skills: PluginSkill[]
}

export type ScheduledTask = {
  id: string
  name: string
  prompt: string
  cronLike: string
  active: boolean
  lastRunAt: number | null
}

export type ClaudePermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'plan'

export type ClaudeToolPreset = 'default' | 'safe' | 'extended'

export type ClaudeToolCapability = {
  id: string
  label: string
  description: string
}

export type CoworkPolicyFlags = {
  strictPolicyEnforcement: boolean
  allowToolDispatcher: boolean
  allowMcpToolCalls: boolean
  allowShellExecution: boolean
  allowWebFetch: boolean
  allowWebSearch: boolean
  allowFileReadExtraction: boolean
  autoCompactLongContext: boolean
}

type PolicySyncRequest = {
  flags: CoworkPolicyFlags
  denyRules: string[]
}

type CoworkState = {
  globalInstruction: string
  folderInstructions: FolderInstruction[]
  connectors: ConnectorConfig[]
  plugins: Plugin[]
  scheduledTasks: ScheduledTask[]
  claudePlanMode: boolean
  claudePermissionMode: ClaudePermissionMode
  claudeToolPreset: ClaudeToolPreset
  claudeTools: ClaudeToolCapability[]
  enabledClaudeToolIds: string[]
  toolDenyRules: string[]
  policyFlags: CoworkPolicyFlags
  setGlobalInstruction: (instruction: string) => void
  upsertFolderInstruction: (item: FolderInstruction) => void
  removeFolderInstruction: (id: string) => void
  toggleConnector: (key: ConnectorKey, enabled: boolean) => void
  setConnectorNote: (key: ConnectorKey, note: string) => void
  upsertPlugin: (plugin: Plugin) => void
  togglePlugin: (id: string, enabled: boolean) => void
  removePlugin: (id: string) => void
  installPluginExamples: () => void
  upsertScheduledTask: (task: ScheduledTask) => void
  toggleScheduledTask: (id: string, active: boolean) => void
  markScheduledTaskRun: (id: string, at: number) => void
  removeScheduledTask: (id: string) => void
  setClaudePlanMode: (enabled: boolean) => void
  setClaudePermissionMode: (mode: ClaudePermissionMode) => void
  setClaudeToolPreset: (preset: ClaudeToolPreset) => void
  toggleClaudeTool: (toolId: string, enabled: boolean) => void
  addToolDenyRule: (rule: string) => void
  removeToolDenyRule: (rule: string) => void
  setPolicyFlag: <K extends keyof CoworkPolicyFlags>(key: K, value: CoworkPolicyFlags[K]) => void
  setPolicySnapshot: (flags: Partial<CoworkPolicyFlags>, denyRules: string[]) => void
}

const DEFAULT_CONNECTORS: ConnectorConfig[] = [
  { key: 'chrome', label: 'Claude in Chrome', enabled: false, note: '' },
]

const CLAUDE_TOOL_CAPABILITIES: ClaudeToolCapability[] = [
  { id: 'bash', label: 'Bash / PowerShell', description: 'Shell-Befehle ausfuehren' },
  { id: 'read_file', label: 'Dateien lesen', description: 'Workspace-Dateien einlesen' },
  { id: 'edit_file', label: 'Dateien bearbeiten', description: 'Dateien gezielt aendern' },
  { id: 'glob', label: 'Dateisuche', description: 'Dateien per Pattern finden' },
  { id: 'grep', label: 'Textsuche', description: 'Regex-/String-Suche ueber Dateien' },
  { id: 'web_fetch', label: 'Web Fetch', description: 'Inhalte einer URL laden' },
  { id: 'web_search', label: 'Web Search', description: 'Web-Suche ueber Suchanfragen' },
  { id: 'todo', label: 'Task/Todo', description: 'Todo-Liste und Arbeitsplan pflegen' },
  { id: 'ask_user', label: 'Rueckfragen', description: 'Gezielte Rueckfragen fuer Klarheit' },
  { id: 'mcp', label: 'MCP Tools', description: 'MCP-Server und Tools nutzen' },
]

const DEFAULT_ENABLED_CLAUDE_TOOLS = CLAUDE_TOOL_CAPABILITIES.map((tool) => tool.id)

const TOOL_PRESET_MAP: Record<ClaudeToolPreset, string[]> = {
  default: DEFAULT_ENABLED_CLAUDE_TOOLS,
  safe: ['read_file', 'glob', 'grep', 'todo', 'ask_user', 'web_fetch', 'web_search'],
  extended: DEFAULT_ENABLED_CLAUDE_TOOLS,
}

const DEFAULT_POLICY_FLAGS: CoworkPolicyFlags = {
  strictPolicyEnforcement: true,
  allowToolDispatcher: true,
  allowMcpToolCalls: true,
  allowShellExecution: true,
  allowWebFetch: true,
  allowWebSearch: true,
  allowFileReadExtraction: true,
  autoCompactLongContext: true,
}

let policySyncReady = false
let suppressPolicySync = false
let lastSyncedPolicyKey: string | null = null
let queuedPolicySync: PolicySyncRequest | null = null
let queuedPolicySyncKey: string | null = null
let policySyncInFlight = false

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function normalizePolicyDenyRules(denyRules: string[]): string[] {
  return denyRules
    .map((rule) => rule.trim())
    .filter((rule, index, arr) => rule.length > 0 && arr.indexOf(rule) === index)
    .slice(0, 80)
}

function buildPolicySyncRequest(
  policyFlags: CoworkPolicyFlags,
  toolDenyRules: string[]
): PolicySyncRequest {
  return {
    flags: policyFlags,
    denyRules: normalizePolicyDenyRules(toolDenyRules),
  }
}

function getPolicySyncKey(request: PolicySyncRequest): string {
  return JSON.stringify(request)
}

async function flushQueuedPolicySync(): Promise<void> {
  if (policySyncInFlight || !policySyncReady || !hasTauriRuntime() || !queuedPolicySync || !queuedPolicySyncKey) {
    return
  }

  const request = queuedPolicySync
  const requestKey = queuedPolicySyncKey
  let queuedDuringFlightKey: string | null = null
  queuedPolicySync = null
  queuedPolicySyncKey = null
  policySyncInFlight = true

  try {
    await invoke('policy_set', { request })
    lastSyncedPolicyKey = requestKey
  } catch (error) {
    if (!queuedPolicySyncKey) {
      queuedPolicySync = request
      queuedPolicySyncKey = requestKey
    }
    console.error('Failed to sync cowork policy to backend', error)
  } finally {
    queuedDuringFlightKey = queuedPolicySyncKey
    policySyncInFlight = false
    if (
      queuedDuringFlightKey &&
      queuedDuringFlightKey !== requestKey &&
      queuedDuringFlightKey !== lastSyncedPolicyKey
    ) {
      void flushQueuedPolicySync()
    }
  }
}

function queuePolicySync(request: PolicySyncRequest): void {
  if (!policySyncReady || !hasTauriRuntime()) return

  const requestKey = getPolicySyncKey(request)
  if (requestKey === lastSyncedPolicyKey || requestKey === queuedPolicySyncKey) {
    if (requestKey === queuedPolicySyncKey) {
      void flushQueuedPolicySync()
    }
    return
  }

  queuedPolicySync = request
  queuedPolicySyncKey = requestKey
  void flushQueuedPolicySync()
}

function markPolicySyncAsCurrent(request: PolicySyncRequest): void {
  lastSyncedPolicyKey = getPolicySyncKey(request)
  queuedPolicySync = null
  queuedPolicySyncKey = null
}

export const PLUGIN_EXAMPLES: Plugin[] = [
  {
    id: 'plugin-marketing-toolkit',
    name: 'Marketing Toolkit',
    domain: 'marketing',
    enabled: true,
    skills: [
      {
        id: 'skill-campaign-brief',
        name: 'Campaign Brief',
        command: '/campaign-brief',
        description: 'Erstellt ein kompaktes Kampagnen-Briefing auf Basis von {{input}}.',
        promptTemplate: 'Erstelle ein Kampagnen-Briefing fuer: {{input}}. Nutze Zielgruppe, Nutzenversprechen, Channels und KPI.',
        runMode: 'execute',
      },
    ],
  },
  {
    id: 'plugin-sales-toolkit',
    name: 'Sales Toolkit',
    domain: 'sales',
    enabled: true,
    skills: [
      {
        id: 'skill-discovery-plan',
        name: 'Discovery Plan',
        command: '/discovery-plan',
        description: 'Strukturiert Discovery-Fragen und naechste Schritte.',
        promptTemplate: 'Formuliere einen Discovery-Plan fuer {{input}} mit Fragen, Risiken und naechsten Schritten.',
        runMode: 'plan',
      },
    ],
  },
  {
    id: 'plugin-finance-toolkit',
    name: 'Finance Toolkit',
    domain: 'finance',
    enabled: true,
    skills: [
      {
        id: 'skill-kpi-recap',
        name: 'KPI Recap',
        command: '/kpi-recap',
        description: 'Fasst KPI-Entwicklungen aus dem Input zusammen.',
        promptTemplate: 'Analysiere {{input}} und gib eine KPI-Zusammenfassung mit Trends, Ausreissern und Handlungsempfehlungen.',
        runMode: 'execute',
      },
    ],
  },
]

function normalizePlugins(items: Plugin[] | undefined): Plugin[] {
  if (!items) return []
  return items.map((plugin) => ({
    ...plugin,
    skills: (plugin.skills ?? []).map((skill) => ({
      ...skill,
      promptTemplate: skill.promptTemplate ?? '',
      runMode: skill.runMode ?? 'execute',
    })),
  }))
}

function mergeConnectors(items: ConnectorConfig[] | undefined): ConnectorConfig[] {
  if (!items || items.length === 0) return DEFAULT_CONNECTORS

  const byKey = new Map(items.map((connector) => [connector.key, connector]))
  return DEFAULT_CONNECTORS.map((base) => ({
    ...base,
    ...(byKey.get(base.key) ?? {}),
  }))
}

export const useCoworkStore = create<CoworkState>()(
  persist(
    (set) => ({
      globalInstruction: '',
      folderInstructions: [],
      connectors: DEFAULT_CONNECTORS,
      plugins: [],
      scheduledTasks: [],
      claudePlanMode: false,
      claudePermissionMode: 'default',
      claudeToolPreset: 'default',
      claudeTools: CLAUDE_TOOL_CAPABILITIES,
      enabledClaudeToolIds: DEFAULT_ENABLED_CLAUDE_TOOLS,
      toolDenyRules: [],
      policyFlags: DEFAULT_POLICY_FLAGS,
      setGlobalInstruction: (instruction) => set({ globalInstruction: instruction }),
      upsertFolderInstruction: (item) =>
        set((state) => {
          const existingIndex = state.folderInstructions.findIndex((entry) => entry.id === item.id)
          if (existingIndex >= 0) {
            const next = [...state.folderInstructions]
            next[existingIndex] = item
            return { folderInstructions: next }
          }
          return { folderInstructions: [item, ...state.folderInstructions] }
        }),
      removeFolderInstruction: (id) =>
        set((state) => ({
          folderInstructions: state.folderInstructions.filter((entry) => entry.id !== id),
        })),
      toggleConnector: (key, enabled) =>
        set((state) => ({
          connectors: state.connectors.map((connector) =>
            connector.key === key ? { ...connector, enabled } : connector
          ),
        })),
      setConnectorNote: (key, note) =>
        set((state) => ({
          connectors: state.connectors.map((connector) =>
            connector.key === key ? { ...connector, note } : connector
          ),
        })),
      upsertPlugin: (plugin) =>
        set((state) => {
          const hasPlugin = state.plugins.some((entry) => entry.id === plugin.id)
          return {
            plugins: hasPlugin
              ? state.plugins.map((entry) => (entry.id === plugin.id ? plugin : entry))
              : [plugin, ...state.plugins],
          }
        }),
      togglePlugin: (id, enabled) =>
        set((state) => ({
          plugins: state.plugins.map((plugin) =>
            plugin.id === id ? { ...plugin, enabled } : plugin
          ),
        })),
      removePlugin: (id) =>
        set((state) => ({
          plugins: state.plugins.filter((plugin) => plugin.id !== id),
        })),
      installPluginExamples: () =>
        set((state) => {
          const existing = new Map(state.plugins.map((plugin) => [plugin.id, plugin]))
          for (const example of PLUGIN_EXAMPLES) {
            if (!existing.has(example.id)) {
              existing.set(example.id, example)
            }
          }
          return {
            plugins: Array.from(existing.values()),
          }
        }),
      upsertScheduledTask: (task) =>
        set((state) => {
          const hasTask = state.scheduledTasks.some((entry) => entry.id === task.id)
          return {
            scheduledTasks: hasTask
              ? state.scheduledTasks.map((entry) => (entry.id === task.id ? task : entry))
              : [task, ...state.scheduledTasks],
          }
        }),
      toggleScheduledTask: (id, active) =>
        set((state) => ({
          scheduledTasks: state.scheduledTasks.map((task) =>
            task.id === id ? { ...task, active } : task
          ),
        })),
      markScheduledTaskRun: (id, at) =>
        set((state) => ({
          scheduledTasks: state.scheduledTasks.map((task) =>
            task.id === id ? { ...task, lastRunAt: at } : task
          ),
        })),
      removeScheduledTask: (id) =>
        set((state) => ({
          scheduledTasks: state.scheduledTasks.filter((task) => task.id !== id),
        })),
      setClaudePlanMode: (enabled) => set({ claudePlanMode: enabled }),
      setClaudePermissionMode: (mode) => set({ claudePermissionMode: mode }),
      setClaudeToolPreset: (preset) =>
        set(() => ({
          claudeToolPreset: preset,
          enabledClaudeToolIds: TOOL_PRESET_MAP[preset],
        })),
      toggleClaudeTool: (toolId, enabled) =>
        set((state) => {
          const isKnownTool = state.claudeTools.some((tool) => tool.id === toolId)
          if (!isKnownTool) return {}

          if (enabled) {
            if (state.enabledClaudeToolIds.includes(toolId)) return {}
            return {
              enabledClaudeToolIds: [...state.enabledClaudeToolIds, toolId],
              claudeToolPreset: 'default' as ClaudeToolPreset,
            }
          }

          return {
            enabledClaudeToolIds: state.enabledClaudeToolIds.filter((id) => id !== toolId),
            claudeToolPreset: 'default' as ClaudeToolPreset,
          }
        }),
      addToolDenyRule: (rule) =>
        set((state) => {
          const normalized = rule.trim()
          if (!normalized) return {}
          if (state.toolDenyRules.includes(normalized)) return {}
          return {
            toolDenyRules: [normalized, ...state.toolDenyRules].slice(0, 80),
          }
        }),
      removeToolDenyRule: (rule) =>
        set((state) => ({
          toolDenyRules: state.toolDenyRules.filter((entry) => entry !== rule),
        })),
      setPolicyFlag: (key, value) =>
        set((state) => ({
          policyFlags: {
            ...state.policyFlags,
            [key]: value,
          },
        })),
      setPolicySnapshot: (flags, denyRules) => {
        suppressPolicySync = true
        set((state) => {
          const policyFlags = {
            ...state.policyFlags,
            ...flags,
          }
          const toolDenyRules = normalizePolicyDenyRules(denyRules)
          markPolicySyncAsCurrent(buildPolicySyncRequest(policyFlags, toolDenyRules))
          return {
            policyFlags,
            toolDenyRules,
          }
        })
        suppressPolicySync = false
      },
    }),
    {
      name: 'open-cowork-features',
      onRehydrateStorage: () => () => {
        policySyncReady = true
        queuePolicySync(buildPolicySyncRequest(
          useCoworkStore.getState().policyFlags,
          useCoworkStore.getState().toolDenyRules
        ))
      },
      merge: (persisted, current) => {
        const state = persisted as Partial<CoworkState>
        const persistedTools = Array.isArray(state.enabledClaudeToolIds)
          ? state.enabledClaudeToolIds
          : DEFAULT_ENABLED_CLAUDE_TOOLS
        const knownTools = new Set(CLAUDE_TOOL_CAPABILITIES.map((tool) => tool.id))
        const normalizedTools = persistedTools.filter((id) => knownTools.has(id))
        return {
          ...current,
          ...state,
          folderInstructions: Array.isArray(state.folderInstructions) ? state.folderInstructions : [],
          connectors: mergeConnectors(state.connectors),
          plugins: normalizePlugins(state.plugins),
          scheduledTasks: Array.isArray(state.scheduledTasks) ? state.scheduledTasks : [],
          claudeTools: CLAUDE_TOOL_CAPABILITIES,
          enabledClaudeToolIds: normalizedTools.length > 0 ? normalizedTools : DEFAULT_ENABLED_CLAUDE_TOOLS,
          toolDenyRules: Array.isArray(state.toolDenyRules) ? state.toolDenyRules : [],
          policyFlags: {
            ...DEFAULT_POLICY_FLAGS,
            ...(state.policyFlags ?? {}),
          },
        }
      },
    }
  )
)

useCoworkStore.subscribe((state, previousState) => {
  if (suppressPolicySync) return

  if (
    state.policyFlags === previousState.policyFlags &&
    state.toolDenyRules === previousState.toolDenyRules
  ) {
    return
  }

  queuePolicySync(buildPolicySyncRequest(state.policyFlags, state.toolDenyRules))
})
