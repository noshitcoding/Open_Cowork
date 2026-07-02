import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore, type CrewLiveState, type CrewLiveStatus } from '../stores/chatStore'
import { useConfigStore } from '../stores/configStore'
import { useCoworkStore, type ScheduledTask } from '../stores/coworkStore'
import { resolveCrewAgentsWithProfiles, useCrewStore, type Crew, type CrewPersonalityProfile } from '../stores/crewStore'
import { usePersonalityStore } from '../stores/personalityStore'
import { useTaskTemplatesStore } from '../stores/taskTemplatesStore'
import { useUiStore } from '../stores/uiStore'
import { useWorkTasksStore, type WorkTask, type WorkTaskRunner, type WorkTaskStatus } from '../stores/workTasksStore'
import { tr } from '../i18n'
import { safeInvoke, safeInvokeVoid } from '../utils/safeInvoke'
import { streamChatTurn } from '../utils/ollamaStreaming'
import {
  appendCrewLiveEntry,
  applyCrewDefaultModel,
  augmentCrewToolsForTask,
  buildCrewLiveMessageContent,
  buildCrewRuntimeTasks,
  buildWorkTaskCrewGuidelines,
  createCrewLiveEntry,
  resolveCrewRuntimeConfig,
  resolveExternalProviderConfig,
  type CrewExecutionLog,
  type CrewExecutionLogEvent,
  type CrewExecutionResponse,
} from '../engine/crew/workTaskCrewRuntime'

type CrewDefinitionVersionRow = {
  id: string
  crewId: string
  versionNumber: number
  changeSummary: string | null
  definitionJson: string
  createdAt: string
}

type CrewScheduleSnapshotMetadata = {
  snapshotSource: 'live' | 'saved-version'
  definitionVersionId?: string
  definitionVersionNumber?: number
  definitionChangeSummary?: string | null
  definitionSavedAt?: string | null
}

function buildCrewRunOutput(response: CrewExecutionResponse, fallbackTaskId: string): string {
  const directResult = response.taskResults.find((result) => result.taskId === fallbackTaskId)
  if (directResult?.output?.trim()) {
    return directResult.output
  }

  const renderedResults = response.taskResults
    .filter((result) => result.output?.trim())
    .map((result) => [
      `Task: ${result.taskId}`,
      `Agent: ${result.agentId}`,
      result.output?.trim() ?? '',
    ].filter(Boolean).join('\n'))

  if (renderedResults.length > 0) {
    return renderedResults.join('\n\n---\n\n')
  }

  return response.error ?? 'Crew run completed without text output.'
}

function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '-'
  try {
    return new Date(ts).toLocaleString('de-DE')
  } catch {
    return String(ts)
  }
}

function formatWorkTaskStatus(status: WorkTaskStatus): string {
  switch (status) {
    case 'idle':
      return tr('Idle')
    case 'waiting_approval':
      return tr('Waiting for approval')
    case 'running':
      return tr('Running')
    case 'completed':
      return tr('Completed')
    case 'failed':
      return tr('Failed')
    case 'canceled':
      return tr('Canceled')
  }
}

function deriveTaskName(task: WorkTask): string {
  const title = task.title.trim()
  if (title) return title
  const prompt = task.prompt.trim()
  if (!prompt) return task.id
  const singleLine = prompt.replace(/\s+/g, ' ').trim()
  return singleLine.length > 48 ? `${singleLine.slice(0, 48)}...` : singleLine
}

function findScheduledTask(scheduledTasks: ScheduledTask[], taskId: string): ScheduledTask | null {
  return scheduledTasks.find((entry) => entry.id === taskId) ?? null
}

function isAbsolutePath(path: string): boolean {
  const trimmed = path.trim()
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(trimmed)
}

function createCrewStreamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `crew-${crypto.randomUUID()}`
  }

  return `crew-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function buildTaskThreadSummary(task: WorkTask): string {
  const lines = [
    `${tr('Task created')}: ${deriveTaskName(task)}`,
    `${tr('Runner')}: ${task.runner === 'crew' ? tr('Crew') : tr('Model')}`,
    task.expectedOutput.trim() ? `${tr('Expected output')}: ${task.expectedOutput.trim()}` : '',
    task.workDir.trim() ? `${tr('Working folder')}: ${task.workDir.trim()}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function buildTaskPromptMessage(task: WorkTask): string {
  const parts = [task.prompt.trim()]

  if (task.expectedOutput.trim()) {
    parts.push(`${tr('Expected output')}:\n${task.expectedOutput.trim()}`)
  }

  if (task.workDir.trim()) {
    parts.push(`${tr('Working folder')}:\n${task.workDir.trim()}`)
  }

  return parts.filter(Boolean).join('\n\n')
}

function hydrateCrewFromDefinition(baseCrew: Crew, rawDefinition: string): Crew | null {
  try {
    const parsed = JSON.parse(rawDefinition) as Partial<Crew>
    return {
      ...baseCrew,
      ...parsed,
      providerProfiles: parsed.providerProfiles ?? baseCrew.providerProfiles,
      agents: Array.isArray(parsed.agents) ? parsed.agents : baseCrew.agents,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : baseCrew.tasks,
      runtimeConfig: parsed.runtimeConfig ?? baseCrew.runtimeConfig,
      status: baseCrew.status,
      createdAt: baseCrew.createdAt,
      updatedAt: baseCrew.updatedAt,
    }
  } catch {
    return null
  }
}

async function resolveCrewScheduleSource(crew: Crew): Promise<{ crew: Crew; metadata: CrewScheduleSnapshotMetadata }> {
  try {
    const versions = await safeInvoke<CrewDefinitionVersionRow[]>('crew_definition_versions_list', { crewId: crew.id }, [])
    const latestVersion = Array.isArray(versions) ? versions[0] : undefined
    if (!latestVersion?.definitionJson?.trim()) {
      return {
        crew,
        metadata: { snapshotSource: 'live' },
      }
    }

    const hydrated = hydrateCrewFromDefinition(crew, latestVersion.definitionJson)
    if (!hydrated) {
      return {
        crew,
        metadata: { snapshotSource: 'live' },
      }
    }

    return {
      crew: hydrated,
      metadata: {
        snapshotSource: 'saved-version',
        definitionVersionId: latestVersion.id,
        definitionVersionNumber: latestVersion.versionNumber,
        definitionChangeSummary: latestVersion.changeSummary,
        definitionSavedAt: latestVersion.createdAt,
      },
    }
  } catch {
    return {
      crew,
      metadata: { snapshotSource: 'live' },
    }
  }
}

function readCrewScheduleSnapshotMetadata(snapshotJson: string | null | undefined): CrewScheduleSnapshotMetadata | null {
  if (!snapshotJson?.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(snapshotJson) as Partial<CrewScheduleSnapshotMetadata>
    if (parsed.snapshotSource !== 'live' && parsed.snapshotSource !== 'saved-version') {
      return null
    }

    return {
      snapshotSource: parsed.snapshotSource,
      definitionVersionId: typeof parsed.definitionVersionId === 'string' ? parsed.definitionVersionId : undefined,
      definitionVersionNumber: typeof parsed.definitionVersionNumber === 'number' ? parsed.definitionVersionNumber : undefined,
      definitionChangeSummary: typeof parsed.definitionChangeSummary === 'string' || parsed.definitionChangeSummary === null ? parsed.definitionChangeSummary : undefined,
      definitionSavedAt: typeof parsed.definitionSavedAt === 'string' || parsed.definitionSavedAt === null ? parsed.definitionSavedAt : undefined,
    }
  } catch {
    return null
  }
}

export default function TasksView() {
  const navigate = useNavigate()
  const crews = useCrewStore((s) => s.crews)
  const personalities = usePersonalityStore((s) => s.personalities)
  const loadPersonalities = usePersonalityStore((s) => s.loadPersonalities)
  const { tasks, addTask, updateTask, removeTask, upsertMany } = useWorkTasksStore()
  const addThread = useChatStore((s) => s.addThread)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const setActiveThread = useChatStore((s) => s.setActiveThread)
  const addChatMessage = useChatStore((s) => s.addMessage)
  const updateChatMessage = useChatStore((s) => s.updateMessage)
  const setActiveMode = useUiStore((s) => s.setActiveMode)
  const setWorkingFolder = useUiStore((s) => s.setWorkingFolder)

  const templates = useTaskTemplatesStore((s) => s.templates)
  const removeTemplate = useTaskTemplatesStore((s) => s.removeTemplate)

  const {
    scheduledTasks,
    loadScheduledTasks,
    upsertScheduledTask,
    toggleScheduledTask,
    removeScheduledTask,
  } = useCoworkStore()

  const ollamaConfig = useConfigStore((s) => s.ollama)
  const defaultLlmProfileIds = useConfigStore((s) => s.defaultLlmProfileIds)
  const llmProfiles = useConfigStore((s) => s.llmProfiles)

  const personalityProfiles = useMemo<CrewPersonalityProfile[]>(() => (
    personalities.map((personality) => ({
      id: personality.id,
      name: personality.name,
      description: personality.description,
      role: personality.role,
      goal: personality.goal || personality.description,
      systemPrompt: personality.system_prompt,
      skillsMarkdown: personality.skills_markdown,
      modelOverride: personality.model_override,
      temperature: personality.temperature,
      icon: personality.icon,
      isDefault: personality.is_default,
    }))
  ), [personalities])

  const [newTitle, setNewTitle] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newExpectedOutput, setNewExpectedOutput] = useState('')
  const [newWorkDir, setNewWorkDir] = useState('')
  const [newRunner, setNewRunner] = useState<WorkTaskRunner>('crew')
  const [newCrewId, setNewCrewId] = useState<string>('')
  const [newModel, setNewModel] = useState<string>('')
  const runningTaskControllersRef = useRef(new Map<string, AbortController>())
  const runningCrewTaskIdsRef = useRef(new Map<string, string>())
  const canceledTaskIdsRef = useRef(new Set<string>())

  const normalizedNewWorkDir = newWorkDir.trim()
  const canCreateTask = newPrompt.trim().length > 0
    && (newRunner !== 'crew' || Boolean(newCrewId))
    && (!normalizedNewWorkDir || isAbsolutePath(normalizedNewWorkDir))

  useEffect(() => {
    void loadScheduledTasks()
  }, [loadScheduledTasks])

  useEffect(() => {
    void loadPersonalities()
  }, [loadPersonalities])

  useEffect(() => {
    if (newRunner !== 'crew') return
    if (newCrewId && crews.some((crew) => crew.id === newCrewId)) return
    setNewCrewId(crews[0]?.id ?? '')
  }, [crews, newCrewId, newRunner])

  useEffect(() => {
    // One-way migration helper: import legacy templates as runnable tasks.
    if (tasks.length > 0) return
    if (templates.length === 0) return

    const migrated: WorkTask[] = templates.map((template) => ({
      id: template.id,
      title: template.title ?? '',
      prompt: template.description ?? '',
      expectedOutput: template.expectedOutput ?? '',
      workDir: '',
      threadId: null,
      runner: 'model',
      crewId: null,
      model: '',
      scheduleExpr: '',
      scheduleEnabled: false,
      status: 'idle',
      output: null,
      error: null,
      lastRunAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))

    upsertMany(migrated)
  }, [tasks.length, templates, upsertMany])

  useEffect(() => {
    // One-way migration helper: import Crew-attached tasks into Work Tasks.
    const existingIds = new Set(tasks.map((task) => task.id))
    const legacyCrewTasks: WorkTask[] = []
    for (const crew of crews) {
      for (const crewTask of crew.tasks ?? []) {
        if (existingIds.has(crewTask.id)) continue
        legacyCrewTasks.push({
          id: crewTask.id,
          title: '',
          prompt: crewTask.description,
          expectedOutput: crewTask.expectedOutput,
          workDir: '',
          threadId: null,
          runner: 'crew',
          crewId: crew.id,
          model: '',
          scheduleExpr: '',
          scheduleEnabled: false,
          status: 'idle',
          output: crewTask.output ?? null,
          error: null,
          lastRunAt: null,
          createdAt: crew.updatedAt || Date.now(),
          updatedAt: crew.updatedAt || Date.now(),
        })
      }
    }

    if (legacyCrewTasks.length === 0) return
    upsertMany(legacyCrewTasks)
  }, [crews, tasks, upsertMany])

  const crewsById = useMemo(() => new Map(crews.map((crew) => [crew.id, crew])), [crews])

  const ensureAllowedTaskFolder = async (workDir: string) => {
    const normalized = workDir.trim()
    if (!normalized || !isAbsolutePath(normalized)) return
    await safeInvokeVoid('fs_add_allowed_folder', { path: normalized })
  }

  const createTaskThread = (task: WorkTask, preserveCurrentThread = true): string => {
    const existingThreadId = task.threadId && threads.some((thread) => thread.id === task.threadId)
      ? task.threadId
      : null

    if (existingThreadId) {
      return existingThreadId
    }

    const previousActiveThreadId = activeThreadId
    const threadId = addThread(
      deriveTaskName(task),
      undefined,
      undefined,
      task.runner,
      task.runner === 'crew' ? task.crewId : null,
    )
    addChatMessage(threadId, {
      role: 'system',
      content: buildTaskThreadSummary(task),
      visibleInChat: true,
      timestamp: Date.now(),
    })
    updateTask(task.id, { threadId })

    if (preserveCurrentThread) {
      setActiveThread(previousActiveThreadId)
    }

    return threadId
  }

  const applyTaskWorkingFolder = async (task: WorkTask) => {
    const normalizedWorkDir = task.workDir.trim()
    if (normalizedWorkDir && isAbsolutePath(normalizedWorkDir)) {
      await ensureAllowedTaskFolder(normalizedWorkDir)
      setWorkingFolder(normalizedWorkDir)
      return
    }

    setWorkingFolder(null)
  }

  const pickWorkDir = async (): Promise<string | null> => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      })
      return typeof selected === 'string' ? selected.trim() : null
    } catch {
      const path = window.prompt('Enter an absolute folder path:')
      return path ? path.trim() : null
    }
  }

  const handlePickNewWorkDir = async () => {
    const selected = await pickWorkDir()
    if (selected) {
      setNewWorkDir(selected)
      await ensureAllowedTaskFolder(selected)
    }
  }

  const handlePickTaskWorkDir = async (task: WorkTask) => {
    const selected = await pickWorkDir()
    if (selected === null) return

    updateTask(task.id, { workDir: selected })
    if (isAbsolutePath(selected)) {
      await ensureAllowedTaskFolder(selected)
    }
  }

  const handleOpenTaskChat = async (task: WorkTask) => {
    const threadId = createTaskThread(task, false)
    await applyTaskWorkingFolder(task)
    setActiveMode('work')
    setActiveThread(threadId)
    navigate('/')
  }

  const handleCreateTask = () => {
    if (!canCreateTask) return

    const id = addTask({
      title: newTitle,
      prompt: newPrompt,
      expectedOutput: newExpectedOutput,
      workDir: normalizedNewWorkDir,
      runner: newRunner,
      crewId: newRunner === 'crew' ? newCrewId : null,
      model: newRunner === 'model' ? newModel : '',
    })

    const createdTask = useWorkTasksStore.getState().tasks.find((task) => task.id === id)
    if (createdTask) {
      void ensureAllowedTaskFolder(createdTask.workDir)
      createTaskThread(createdTask, true)
    }

    setNewTitle('')
    setNewPrompt('')
    setNewExpectedOutput('')
    setNewWorkDir('')
  }

  const handleRunTask = async (task: WorkTask) => {
    const normalizedWorkDir = task.workDir.trim()
    if (normalizedWorkDir && !isAbsolutePath(normalizedWorkDir)) {
      const message = tr('Working folder must be absolute.')
      updateTask(task.id, {
        status: 'failed',
        error: message,
        output: message,
        lastRunAt: Date.now(),
      })
      return
    }

    const taskForRun = normalizedWorkDir ? { ...task, workDir: normalizedWorkDir } : task
    const threadId = createTaskThread(taskForRun, true)
    const startedAt = Date.now()

    updateTask(task.id, {
      status: 'running',
      output: '',
      error: null,
    })
    canceledTaskIdsRef.current.delete(task.id)
    const abortController = new AbortController()
    runningTaskControllersRef.current.set(task.id, abortController)

    await ensureAllowedTaskFolder(normalizedWorkDir)
    addChatMessage(threadId, {
      role: 'system',
      content: [
        tr('Task run started'),
        `${tr('Runner')}: ${task.runner === 'crew' ? tr('Crew') : tr('Model')}`,
        normalizedWorkDir ? `${tr('Working folder')}: ${normalizedWorkDir}` : '',
      ].filter(Boolean).join('\n'),
      visibleInChat: true,
      timestamp: startedAt,
    })
    addChatMessage(threadId, {
      role: 'user',
      content: buildTaskPromptMessage(taskForRun),
      timestamp: startedAt,
    })

    if (task.runner === 'model') {
      const model = task.model.trim() || ollamaConfig.model
      const config = {
        ...ollamaConfig,
        model,
      }
      const assistantMessageId = addChatMessage(threadId, {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
      })

      try {
        let buffered = ''
        const response = await streamChatTurn(
          {
            prompt: task.prompt,
            history: normalizedWorkDir ? [{ role: 'system', content: `Working directory: ${normalizedWorkDir}` }] : [],
            config,
          },
          (chunk) => {
            if (abortController.signal.aborted) return
            buffered += chunk
            updateTask(task.id, { output: buffered })
            updateChatMessage(threadId, assistantMessageId, { content: buffered })
          },
          { signal: abortController.signal },
        )

        if (abortController.signal.aborted || canceledTaskIdsRef.current.has(task.id)) {
          const message = tr('Task canceled.')
          updateTask(task.id, {
            status: 'canceled',
            error: null,
            output: buffered || message,
            lastRunAt: Date.now(),
          })
          updateChatMessage(threadId, assistantMessageId, {
            content: buffered ? `${buffered}\n\n${message}` : message,
            streaming: false,
          }, {
            persist: true,
          })
          return
        }

        updateTask(task.id, {
          status: 'completed',
          output: response.assistantMessage,
          lastRunAt: Date.now(),
        })
        updateChatMessage(threadId, assistantMessageId, {
          content: response.assistantMessage,
          streaming: false,
        }, {
          persist: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const aborted = abortController.signal.aborted || canceledTaskIdsRef.current.has(task.id)
        updateTask(task.id, {
          status: aborted ? 'canceled' : 'failed',
          error: aborted ? null : message,
          output: aborted ? tr('Task canceled.') : message,
          lastRunAt: Date.now(),
        })
        updateChatMessage(threadId, assistantMessageId, {
          content: aborted ? tr('Task canceled.') : message,
          streaming: false,
        }, {
          persist: true,
        })
      } finally {
        runningTaskControllersRef.current.delete(task.id)
        canceledTaskIdsRef.current.delete(task.id)
      }

      return
    }

    const crewStreamId = createCrewStreamId()
    const streamedCrewLogIds = new Set<string>()
    let unlistenCrewLogs: (() => void) | null = null
    let crewLiveState: CrewLiveState = {
      streamId: crewStreamId,
      title: `${deriveTaskName(taskForRun)} - Crew-Execution`,
      status: 'running',
      entries: [],
      agentColors: {},
      updatedAt: Date.now(),
    }
    const crewLiveMessageId = addChatMessage(threadId, {
      role: 'assistant',
      content: buildCrewLiveMessageContent(crewLiveState),
      timestamp: Date.now(),
      streaming: true,
      crewLive: crewLiveState,
    })
    const publishCrewLive = (persist = false) => {
      updateChatMessage(threadId, crewLiveMessageId, {
        content: buildCrewLiveMessageContent(crewLiveState),
        streaming: crewLiveState.status === 'running',
        crewLive: crewLiveState,
      }, {
        persist,
      })
    }
    const appendCrewLogToMonitor = (log: CrewExecutionLog) => {
      if (!log.id || streamedCrewLogIds.has(log.id)) return
      const entry = createCrewLiveEntry(log)
      if (!entry) return
      streamedCrewLogIds.add(log.id)
      crewLiveState = appendCrewLiveEntry(crewLiveState, entry)
      publishCrewLive()
    }
    const finishCrewLive = (status: CrewLiveStatus, persist = true) => {
      crewLiveState = {
        ...crewLiveState,
        status,
        updatedAt: Date.now(),
      }
      publishCrewLive(persist)
    }

    try {
      if (!task.crewId) {
        throw new Error('Please select a crew.')
      }

      const crew = crewsById.get(task.crewId)
      if (!crew) {
        throw new Error('Crew not found (possibly deleted).')
      }

      const resolvedCrewAgents = resolveCrewAgentsWithProfiles(crew.agents, personalityProfiles)
      const enabledAgents = resolvedCrewAgents.filter((agent) => agent.enabled)
      if (enabledAgents.length === 0) {
        throw new Error('No active crew members available.')
      }

      const enabledAgentIds = new Set(enabledAgents.map((agent) => agent.id))
      const runtimeTasks = buildCrewRuntimeTasks(crew, task, enabledAgentIds)

      const defaultOpenAICompatibleProfile = llmProfiles.find((profile) => profile.id === defaultLlmProfileIds['openai-compatible'] && profile.provider === 'openai-compatible')
        ?? llmProfiles.find((profile) => profile.provider === 'openai-compatible')
      const defaultOpenRouterProfile = llmProfiles.find((profile) => profile.id === defaultLlmProfileIds.openrouter && profile.provider === 'openrouter')
        ?? llmProfiles.find((profile) => profile.provider === 'openrouter')

      let providerConfigs = {
        openAICompatible: resolveExternalProviderConfig(
          crew.providerProfiles.openAICompatible,
          defaultOpenAICompatibleProfile,
          defaultOpenAICompatibleProfile?.baseUrl || crew.providerProfiles.openAICompatible.baseUrl || 'https://api.openai.com/v1',
        ),
        openRouter: resolveExternalProviderConfig(
          crew.providerProfiles.openRouter,
          defaultOpenRouterProfile,
          defaultOpenRouterProfile?.baseUrl || crew.providerProfiles.openRouter.baseUrl || 'https://openrouter.ai/api/v1',
        ),
      }

      let config = resolveCrewRuntimeConfig(crew, {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        timeoutMs: ollamaConfig.timeoutMs,
      })
      const appliedCrewDefault = applyCrewDefaultModel(crew, config, providerConfigs)
      config = appliedCrewDefault.config
      providerConfigs = appliedCrewDefault.providerConfigs
      const crewDefaultProvider = crew.defaultProvider ?? 'ollama'
      runningCrewTaskIdsRef.current.set(task.id, crew.id)

      try {
        unlistenCrewLogs = await listen<CrewExecutionLogEvent>('crew-execution-log', (event) => {
          const payload = event.payload
          if (!payload || payload.streamId !== crewStreamId) return
          appendCrewLogToMonitor(payload.log)
        })
      } catch {
        // In browser-only tests or fallback environments the Tauri event bus is unavailable.
      }

      const response = await safeInvoke<CrewExecutionResponse>('crew_execute', {
        request: {
          id: crew.id,
          streamId: crewStreamId,
          name: crew.name,
          description: crew.description,
          executionSubject: crew.executionSubject,
          executionGuidelines: buildWorkTaskCrewGuidelines(crew, taskForRun),
          knowledgeFocus: crew.knowledgeFocus,
          governanceMode: crew.governanceMode,
          outputMode: crew.outputMode,
          stopOnFailure: crew.stopOnFailure,
          retryCount: crew.retryCount,
          managerReviewEnabled: crew.managerReviewEnabled,
          managerReviewGuidelines: crew.managerReviewGuidelines,
          shareAllTaskOutputs: crew.shareAllTaskOutputs,
          sharedOutputCharLimit: crew.sharedOutputCharLimit,
          providerConfigs,
          process: crew.process,
          managerAgentId: crew.managerAgentId,
          verbose: crew.verbose,
          maxRpm: crew.maxRpm,
          maxParallelTasks: crew.maxParallelTasks,
          agents: enabledAgents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            goal: agent.goal,
            backstory: agent.backstory,
            skillsMarkdown: agent.skillsMarkdown,
            personalityId: agent.personalityId,
            modelOverride: agent.modelOverride?.trim() ? agent.modelOverride : null,
            providerKind: crewDefaultProvider,
            tools: augmentCrewToolsForTask(agent.tools, taskForRun),
            mcpServerNames: agent.mcpServerNames,
            enabled: agent.enabled,
            allowDelegation: agent.allowDelegation,
            verbose: agent.verbose,
            maxIterations: agent.maxIterations,
          })),
          tasks: runtimeTasks,
          cwd: normalizedWorkDir || null,
          config,
        },
      })

      const mappedStatus = response.status === 'completed' ? 'completed' : 'failed'
      if (canceledTaskIdsRef.current.has(task.id) || response.status === 'canceled') {
        finishCrewLive('canceled')
        updateTask(task.id, {
          status: 'canceled',
          output: tr('Task canceled.'),
          error: null,
          lastRunAt: Date.now(),
        })
        addChatMessage(threadId, {
          role: 'assistant',
          content: tr('Task canceled.'),
          timestamp: Date.now(),
        })
        return
      }
      const output = buildCrewRunOutput(response, task.id)

      for (const log of response.logs) {
        appendCrewLogToMonitor(log)
      }
      finishCrewLive(mappedStatus === 'completed' ? 'completed' : 'failed')

      addChatMessage(threadId, {
        role: 'assistant',
        content: output,
        timestamp: Date.now(),
      })

      updateTask(task.id, {
        status: mappedStatus,
        output,
        error: response.error ?? null,
        lastRunAt: Date.now(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const aborted = canceledTaskIdsRef.current.has(task.id) || abortController.signal.aborted
      const waitingForApproval = message.trim().toLowerCase().startsWith('crew waiting for approval:')
      finishCrewLive(aborted ? 'canceled' : 'failed')
      addChatMessage(threadId, {
        role: 'assistant',
        content: aborted ? tr('Task canceled.') : message,
        timestamp: Date.now(),
      })
      updateTask(task.id, {
        status: aborted ? 'canceled' : waitingForApproval ? 'waiting_approval' : 'failed',
        error: aborted ? null : message,
        output: aborted ? tr('Task canceled.') : message,
        lastRunAt: Date.now(),
      })
    } finally {
      unlistenCrewLogs?.()
      runningTaskControllersRef.current.delete(task.id)
      runningCrewTaskIdsRef.current.delete(task.id)
      canceledTaskIdsRef.current.delete(task.id)
    }
  }

  const handleCancelTask = async (task: WorkTask) => {
    canceledTaskIdsRef.current.add(task.id)
    runningTaskControllersRef.current.get(task.id)?.abort()
    const crewId = runningCrewTaskIdsRef.current.get(task.id)
    if (crewId) {
      await safeInvoke('crew_stop', { request: { crewId } }, null)
    }
    updateTask(task.id, {
      status: 'canceled',
      error: null,
      output: task.output?.trim() ? `${task.output}\n\n${tr('Task canceled.')}` : tr('Task canceled.'),
      lastRunAt: Date.now(),
    })
  }

  const handleUpsertSchedule = async (task: WorkTask) => {
    const scheduleExpr = task.scheduleExpr.trim()
    if (!scheduleExpr) {
      updateTask(task.id, { scheduleEnabled: false })
      return
    }

    const normalizedWorkDir = task.workDir.trim()
    if (normalizedWorkDir && !isAbsolutePath(normalizedWorkDir)) {
      updateTask(task.id, { scheduleEnabled: false })
      return
    }
    if (normalizedWorkDir) {
      await ensureAllowedTaskFolder(normalizedWorkDir)
    }

    let scheduled: ScheduledTask | null = findScheduledTask(scheduledTasks, task.id)

    if (task.runner === 'crew') {
      if (!task.crewId) {
        updateTask(task.id, { scheduleEnabled: false })
        return
      }

      const currentCrew = crewsById.get(task.crewId)
      if (!currentCrew) {
        updateTask(task.id, { scheduleEnabled: false })
        return
      }

      const { crew, metadata } = await resolveCrewScheduleSource(currentCrew)

      const enabledAgents = crew.agents.filter((agent) => agent.enabled)
      if (enabledAgents.length === 0) {
        updateTask(task.id, { scheduleEnabled: false })
        return
      }
      const enabledAgentIds = new Set(enabledAgents.map((agent) => agent.id))
      let runtimeTasks
      try {
        runtimeTasks = buildCrewRuntimeTasks(crew, task, enabledAgentIds)
      } catch {
        updateTask(task.id, { scheduleEnabled: false })
        return
      }

      const defaultOpenAICompatibleProfile = llmProfiles.find((profile) => profile.id === defaultLlmProfileIds['openai-compatible'] && profile.provider === 'openai-compatible')
        ?? llmProfiles.find((profile) => profile.provider === 'openai-compatible')
      const defaultOpenRouterProfile = llmProfiles.find((profile) => profile.id === defaultLlmProfileIds.openrouter && profile.provider === 'openrouter')
        ?? llmProfiles.find((profile) => profile.provider === 'openrouter')

      let providerConfigs = {
        openAICompatible: resolveExternalProviderConfig(
          crew.providerProfiles.openAICompatible,
          defaultOpenAICompatibleProfile,
          defaultOpenAICompatibleProfile?.baseUrl || crew.providerProfiles.openAICompatible.baseUrl || 'https://api.openai.com/v1',
        ),
        openRouter: resolveExternalProviderConfig(
          crew.providerProfiles.openRouter,
          defaultOpenRouterProfile,
          defaultOpenRouterProfile?.baseUrl || crew.providerProfiles.openRouter.baseUrl || 'https://openrouter.ai/api/v1',
        ),
      }

      let config = resolveCrewRuntimeConfig(crew, {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        timeoutMs: ollamaConfig.timeoutMs,
      })
      const appliedCrewDefault = applyCrewDefaultModel(crew, config, providerConfigs)
      config = appliedCrewDefault.config
      providerConfigs = appliedCrewDefault.providerConfigs
      const crewDefaultProvider = crew.defaultProvider ?? 'ollama'

      const crewSnapshotJson = JSON.stringify({
        id: crew.id,
        name: crew.name,
        description: crew.description,
        executionSubject: crew.executionSubject,
        executionGuidelines: buildWorkTaskCrewGuidelines(crew, task),
        knowledgeFocus: crew.knowledgeFocus,
        governanceMode: crew.governanceMode,
        outputMode: crew.outputMode,
        stopOnFailure: crew.stopOnFailure,
        retryCount: crew.retryCount,
        managerReviewEnabled: crew.managerReviewEnabled,
        managerReviewGuidelines: crew.managerReviewGuidelines,
        shareAllTaskOutputs: crew.shareAllTaskOutputs,
        sharedOutputCharLimit: crew.sharedOutputCharLimit,
        providerConfigs,
        process: crew.process,
        managerAgentId: crew.managerAgentId,
        verbose: crew.verbose,
        maxRpm: crew.maxRpm,
        maxParallelTasks: crew.maxParallelTasks,
        agents: enabledAgents.map((agent) => ({
          ...agent,
          tools: augmentCrewToolsForTask(agent.tools, task),
          modelOverride: agent.modelOverride?.trim() ? agent.modelOverride : null,
          providerKind: crewDefaultProvider,
        })),
        tasks: runtimeTasks,
        config,
        cwd: normalizedWorkDir || null,
        snapshotSource: metadata.snapshotSource,
        definitionVersionId: metadata.definitionVersionId,
        definitionVersionNumber: metadata.definitionVersionNumber,
        definitionChangeSummary: metadata.definitionChangeSummary,
        definitionSavedAt: metadata.definitionSavedAt,
      })

      scheduled = {
        id: task.id,
        name: deriveTaskName(task),
        prompt: task.prompt,
        cronLike: scheduleExpr,
        taskKind: 'crew',
        crewId: crew.id,
        crewSnapshotJson,
        modelConfigJson: null,
        priority: scheduled?.priority ?? 100,
        dependsOnTaskIds: scheduled?.dependsOnTaskIds ?? [],
        active: Boolean(task.scheduleEnabled),
        lastRunAt: scheduled?.lastRunAt ?? null,
        nextRunAt: scheduled?.nextRunAt ?? null,
      }
    } else {
      scheduled = {
        id: task.id,
        name: deriveTaskName(task),
        prompt: task.prompt,
        cronLike: scheduleExpr,
        taskKind: 'prompt',
        crewId: null,
        crewSnapshotJson: null,
        modelConfigJson: JSON.stringify({
          ...ollamaConfig,
          model: task.model.trim() || ollamaConfig.model,
          cwd: normalizedWorkDir || null,
        }),
        priority: scheduled?.priority ?? 100,
        dependsOnTaskIds: scheduled?.dependsOnTaskIds ?? [],
        active: Boolean(task.scheduleEnabled),
        lastRunAt: scheduled?.lastRunAt ?? null,
        nextRunAt: scheduled?.nextRunAt ?? null,
      }
    }

    await upsertScheduledTask(scheduled)
  }

  const handleToggleSchedule = async (task: WorkTask, enabled: boolean) => {
    updateTask(task.id, { scheduleEnabled: enabled })
    const scheduled = findScheduledTask(scheduledTasks, task.id)
    if (scheduled) {
      await toggleScheduledTask(task.id, enabled)
    }
  }

  const handleRemoveSchedule = async (task: WorkTask) => {
    updateTask(task.id, { scheduleEnabled: false, scheduleExpr: '' })
    const scheduled = findScheduledTask(scheduledTasks, task.id)
    if (scheduled) {
      await removeScheduledTask(task.id)
    }
  }

  const handleRemoveLegacyTemplate = (templateId: string) => {
    // Templates are legacy; keep deletion available so users can clean up old storage.
    removeTemplate(templateId)
  }

  return (
    <div className="task-view">
      <h1>{tr("Tasks")}</h1>
      <p className="hint-text">{tr("Create tasks, assign a crew or model, start them, and schedule each task.")}</p>

      <div className="panel">
        <h2>{tr("New task")}</h2>
        <div className="grid">
          <label>
            {tr("Title (optional)")}
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={tr("e.g. Weekly Report")} />
          </label>
          <label>
            {tr("Execution")}
            <select value={newRunner} onChange={(e) => setNewRunner(e.target.value as WorkTaskRunner)}>
              <option value="crew">{tr("Crew")}</option>
              <option value="model">{tr("Model")}</option>
            </select>
          </label>
          {newRunner === 'crew' ? (
            <label>
              {tr("Crew")}
              <select value={newCrewId} onChange={(e) => setNewCrewId(e.target.value)}>
                {crews.length === 0 && (
                  <option value="">{tr("No crews available")}</option>
                )}
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>{crew.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              {tr("Model (optional)")}
              <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder={`${tr("Default")}: ${ollamaConfig.model || '-'}`} />
            </label>
          )}
          <label>
            {tr("Expected output (optional)")}
            <input value={newExpectedOutput} onChange={(e) => setNewExpectedOutput(e.target.value)} placeholder={tr("e.g. Bullet report")} />
          </label>
          <label className="task-field-full">
            {tr("Working folder (optional, absolute)")}
            <div className="task-inline-field">
              <input value={newWorkDir} onChange={(e) => setNewWorkDir(e.target.value)} placeholder="C:\\Projects\\my-task" />
              <button type="button" className="btn-secondary" onClick={() => void handlePickNewWorkDir()}>
                {tr("Choose folder")}
              </button>
            </div>
            {normalizedNewWorkDir && !isAbsolutePath(normalizedNewWorkDir) ? (
              <div className="hint-text">{tr("Working folder must be absolute.")}</div>
            ) : null}
          </label>
          <label className="task-field-full">
            {tr("Task")}
            <textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} rows={4} placeholder={tr("What should the task do?")} />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={handleCreateTask} disabled={!canCreateTask}>
            {tr("Create task")}
          </button>
        </div>
        {newRunner === 'crew' && crews.length === 0 && (
          <p className="hint-text">{tr("Create a crew in settings first to run crew tasks.")}</p>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading-row">
          <h2>{tr("Your tasks")}</h2>
          <span className="hint-text">{tasks.length} {tr("task(s)")}</span>
        </div>

        {tasks.length === 0 ? (
          <p className="hint-text">{tr("No tasks yet. Create your first task above.")}</p>
        ) : (
          <div className="task-list">
            {tasks.map((task) => {
              const scheduled = findScheduledTask(scheduledTasks, task.id)
              const crewName = task.crewId ? crewsById.get(task.crewId)?.name : null
              const crewScheduleMetadata = task.runner === 'crew'
                ? readCrewScheduleSnapshotMetadata(scheduled?.crewSnapshotJson)
                : null

              return (
                <div key={task.id} className="work-task-card">
                  <div className="work-task-card-header">
                    <div className="work-task-title-row">
                      <strong>{deriveTaskName(task)}</strong>
                      <span className="task-pill task-pill-runner">
                        {task.runner === 'crew' ? tr('Crew') : tr('Model')}
                      </span>
                      <span className={`task-pill task-status task-status-${task.status}`}>
                        {formatWorkTaskStatus(task.status)}
                      </span>
                    </div>
                    <div className="actions work-task-card-actions">
                      <button type="button" onClick={() => void handleOpenTaskChat(task)}>
                        {tr("Chat")}
                      </button>
                      <button type="button" onClick={() => void handleRunTask(task)} disabled={(task.status === 'running' || task.status === 'waiting_approval') || !task.prompt.trim() || (task.runner === 'crew' && !task.crewId) || Boolean(task.workDir.trim() && !isAbsolutePath(task.workDir))}>
                        {tr("Start")}
                      </button>
                      {task.status === 'running' && (
                        <button type="button" className="btn-stop" onClick={() => void handleCancelTask(task)}>
                          {tr("Stop")}
                        </button>
                      )}
                      <button type="button" className="btn-secondary" onClick={() => removeTask(task.id)} disabled={task.status === 'running'}>
                        {tr("Delete")}
                      </button>
                    </div>
                  </div>

                  <div className="grid task-edit-grid">
                    <label>
                      {tr("Title")}
                      <input value={task.title} onChange={(e) => updateTask(task.id, { title: e.target.value })} />
                    </label>
                    <label>
                      {tr("Execution")}
                      <select value={task.runner} onChange={(e) => updateTask(task.id, { runner: e.target.value as WorkTaskRunner })}>
                        <option value="crew">{tr("Crew")}</option>
                        <option value="model">{tr("Model")}</option>
                      </select>
                    </label>
                    {task.runner === 'crew' ? (
                      <label>
                        {tr("Crew")}
                        <select value={task.crewId ?? ''} onChange={(e) => updateTask(task.id, { crewId: e.target.value || null })}>
                          <option value="">{tr("Select crew")}</option>
                          {crews.map((crew) => (
                            <option key={crew.id} value={crew.id}>{crew.name}</option>
                          ))}
                        </select>
                        {task.crewId && !crewName ? (
                          <div className="hint-text">{tr("Assigned crew no longer exists.")}</div>
                        ) : null}
                      </label>
                    ) : (
                      <label>
                        {tr("Model (optional)")}
                        <input
                          value={task.model}
                          onChange={(e) => updateTask(task.id, { model: e.target.value })}
                          placeholder={`${tr("Default")}: ${ollamaConfig.model || '-'}`}
                        />
                      </label>
                    )}
                    <label>
                      {tr("Expected output")}
                      <input value={task.expectedOutput} onChange={(e) => updateTask(task.id, { expectedOutput: e.target.value })} />
                    </label>
                    <label className="task-field-full">
                      {tr("Working folder (absolute)")}
                      <div className="task-inline-field">
                        <input value={task.workDir} onChange={(e) => updateTask(task.id, { workDir: e.target.value })} placeholder="C:\\Projects\\my-task" />
                        <button type="button" className="btn-secondary" onClick={() => void handlePickTaskWorkDir(task)}>
                          {tr("Choose folder")}
                        </button>
                      </div>
                      {task.workDir.trim() && !isAbsolutePath(task.workDir) ? (
                        <div className="hint-text">{tr("Working folder must be absolute.")}</div>
                      ) : null}
                    </label>
                    <label className="task-field-full">
                      {tr("Task")}
                      <textarea value={task.prompt} onChange={(e) => updateTask(task.id, { prompt: e.target.value })} rows={3} />
                    </label>
                  </div>

                  <div className="task-scheduler-panel">
                    <div className="task-scheduler-header">
                      <strong>{tr("Scheduler")}</strong>
                      <div className="task-scheduler-meta">
                        {tr("Last run")}: {formatTimestamp(scheduled?.lastRunAt ?? null)} / {tr("Next run")}: {formatTimestamp(scheduled?.nextRunAt ?? null)}
                      </div>
                    </div>

                    <div className="grid task-scheduler-grid">
                      <label>
                        {tr("Expression")}
                        <input
                          value={task.scheduleExpr}
                          onChange={(e) => updateTask(task.id, { scheduleExpr: e.target.value })}
                          placeholder={tr("e.g. daily 09:00")}
                        />
                      </label>
                      <label>
                        {tr("Active")}
                        <div className="task-checkbox-row">
                          <input
                            type="checkbox"
                            checked={task.scheduleEnabled}
                            onChange={(e) => void handleToggleSchedule(task, e.target.checked)}
                          />
                          <span className="hint-text">{task.scheduleEnabled ? tr('Job active') : tr('Job paused')}</span>
                        </div>
                      </label>
                    </div>
                    <div className="actions task-scheduler-actions">
                      <button type="button" className="btn-sm" onClick={() => void handleUpsertSchedule(task)} disabled={!task.scheduleExpr.trim()}>
                        {tr("Save")}
                      </button>
                      <button type="button" className="btn-sm" onClick={() => void handleRemoveSchedule(task)} disabled={!scheduled && !task.scheduleExpr.trim()}>
                        {tr("Remove")}
                      </button>
                      {task.runner === 'crew' && !task.crewId ? (
                        <span className="hint-text">{tr("Crew required for crew schedule")}</span>
                      ) : null}
                    </div>
                    {task.runner === 'crew' && crewScheduleMetadata ? (
                      <div className="hint-text task-scheduler-source">
                        {crewScheduleMetadata.snapshotSource === 'saved-version'
                          ? `${tr("Source")}: ${tr("saved crew version")} v${crewScheduleMetadata.definitionVersionNumber ?? '-'}${crewScheduleMetadata.definitionSavedAt ? ` ${tr("from")} ${new Date(crewScheduleMetadata.definitionSavedAt).toLocaleString('de-DE')}` : ''}${crewScheduleMetadata.definitionChangeSummary ? ` / ${crewScheduleMetadata.definitionChangeSummary}` : ''}`
                          : `${tr("Source")}: ${tr("current crew editor state")}`}
                      </div>
                    ) : null}
                  </div>

                  {(task.output || task.error) && (
                    <pre className="task-output-preview">
                      {(task.error ?? task.output ?? '').slice(0, 6000)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {templates.length > 0 && (
        <div className="panel">
          <div className="panel-heading-row">
            <h2>{tr("Legacy: Templates")}</h2>
            <span className="hint-text">{templates.length} {tr("template(s) in legacy storage")}</span>
          </div>
          <p className="hint-text">{tr("These templates are no longer used actively. You can clean them up here if needed.")}</p>

          <div className="task-list">
            {templates.map((template) => (
              <div key={template.id} className="work-task-card">
                <strong>{template.title?.trim() ? template.title : template.id}</strong>
                <div className="task-template-description">{template.description}</div>
                <div className="actions work-task-card-actions">
                  <button type="button" className="btn-secondary" onClick={() => handleRemoveLegacyTemplate(template.id)}>
                    {tr("Delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
