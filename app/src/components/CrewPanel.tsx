import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfigStore, type OllamaConfig } from '../stores/configStore'
import { useCoworkStore } from '../stores/coworkStore'
import { useCrewStore, type AgentRole, type CrewExternalProviderConfig, type CrewOutputMode, type CrewProcess, type CrewProviderKind } from '../stores/crewStore'
import { safeInvoke } from '../utils/safeInvoke'

const ROLE_OPTIONS: AgentRole[] = ['researcher', 'writer', 'reviewer', 'planner', 'executor', 'analyst', 'custom']
const PROCESS_OPTIONS: Array<{ value: CrewProcess; label: string }> = [
  { value: 'sequential', label: 'Sequenziell' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'hierarchical', label: 'Hierarchisch' },
]
const PROVIDER_OPTIONS: Array<{ value: CrewProviderKind; label: string }> = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai-compatible', label: 'OpenAI-kompatibel' },
  { value: 'openrouter', label: 'OpenRouter' },
]

function toggleStringValue(values: string[], nextValue: string): string[] {
  return values.includes(nextValue)
    ? values.filter((value) => value !== nextValue)
    : [...values, nextValue]
}

function resolveCrewRuntimeConfig(
  runtimeConfig: { enabled: boolean; baseUrl: string; model: string; timeoutMs: number } | undefined,
  fallbackConfig: OllamaConfig,
): OllamaConfig {
  if (!runtimeConfig?.enabled) {
    return fallbackConfig
  }

  return {
    ...fallbackConfig,
    baseUrl: runtimeConfig.baseUrl.trim() || fallbackConfig.baseUrl,
    model: runtimeConfig.model.trim() || fallbackConfig.model,
    timeoutMs: Math.max(1000, runtimeConfig.timeoutMs || fallbackConfig.timeoutMs),
  }
}

function resolveExternalProviderConfig(
  config: CrewExternalProviderConfig | undefined,
  fallbackConfig: { baseUrl?: string; model?: string; apiKey?: string } | undefined,
  fallbackBaseUrl: string,
) {
  if (!config?.enabled) {
    return undefined
  }

  return {
    baseUrl: config.baseUrl.trim() || fallbackConfig?.baseUrl?.trim() || fallbackBaseUrl,
    model: config.model.trim() || fallbackConfig?.model?.trim() || '',
    apiKey: config.apiKey.trim() || fallbackConfig?.apiKey?.trim() || '',
    timeoutMs: Math.max(1000, config.timeoutMs || 600000),
  }
}

function downloadCrewJson(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildDefaultCrewName(existingNames: string[]): string {
  let index = 1
  while (existingNames.some((name) => name.trim().toLowerCase() === `crew ${index}`.toLowerCase())) {
    index += 1
  }
  return `Crew ${index}`
}

type CrewProviderHealthCheckResult = {
  reachable: boolean
  status: number | null
  endpoint: string
  message: string
  checkedAt: string
}

type CrewProviderModelsResult = {
  endpoint: string
  models: string[]
}
function getCrewDiagnostics(crew: {
  process: CrewProcess
  managerAgentId: string | null
  agents: Array<{ id: string; name: string; enabled: boolean; providerKind?: CrewProviderKind; modelOverride?: string | null }>
  providerProfiles?: {
    openAICompatible: CrewExternalProviderConfig
    openRouter: CrewExternalProviderConfig
  }
},
openAIProfile?: { baseUrl?: string; model?: string; apiKey?: string },
openRouterProfile?: { baseUrl?: string; model?: string; apiKey?: string }) {
  const errors: string[] = []
  const warnings: string[] = []
  const enabledAgentIds = new Set(crew.agents.filter((agent) => agent.enabled).map((agent) => agent.id))
  const enabledAgents = crew.agents.filter((agent) => agent.enabled)

  if (enabledAgentIds.size === 0) {
    errors.push('Keine aktiven Crew-Mitglieder vorhanden.')
  }

  const openAiAgents = enabledAgents.filter((agent) => agent.providerKind === 'openai-compatible')
  if (openAiAgents.length > 0) {
    const profile = crew.providerProfiles?.openAICompatible
    const effectiveApiKey = profile?.apiKey.trim() || openAIProfile?.apiKey?.trim() || ''
    const effectiveBaseUrl = profile?.baseUrl.trim() || openAIProfile?.baseUrl?.trim() || ''
    const effectiveModel = profile?.model.trim() || openAIProfile?.model?.trim() || ''
    const needsFallbackModel = openAiAgents.some((agent) => !agent.modelOverride?.trim())
    if (!profile?.enabled) {
      errors.push('Aktive Crew-Mitglieder nutzen OpenAI-kompatibles Routing, aber das Crew-Profil ist nicht aktiviert.')
    }
    if (!effectiveApiKey) {
      errors.push('OpenAI-kompatibles Crew-Profil hat keinen API-Key.')
    }
    if (!effectiveBaseUrl) {
      errors.push('OpenAI-kompatibles Crew-Profil hat keinen Endpoint.')
    }
    if (needsFallbackModel && !effectiveModel) {
      errors.push('OpenAI-kompatibles Crew-Profil hat kein Modell und mindestens ein Agent besitzt keinen Model-Override.')
    }
  }

  const openRouterAgents = enabledAgents.filter((agent) => agent.providerKind === 'openrouter')
  if (openRouterAgents.length > 0) {
    const profile = crew.providerProfiles?.openRouter
    const effectiveApiKey = profile?.apiKey.trim() || openRouterProfile?.apiKey?.trim() || ''
    const effectiveBaseUrl = profile?.baseUrl.trim() || openRouterProfile?.baseUrl?.trim() || 'https://openrouter.ai/api/v1'
    const effectiveModel = profile?.model.trim() || openRouterProfile?.model?.trim() || ''
    const needsFallbackModel = openRouterAgents.some((agent) => !agent.modelOverride?.trim())
    if (!profile?.enabled) {
      errors.push('Aktive Crew-Mitglieder nutzen OpenRouter, aber das Crew-Profil ist nicht aktiviert.')
    }
    if (!effectiveApiKey) {
      errors.push('OpenRouter-Crew-Profil hat keinen API-Key.')
    }
    if (!effectiveBaseUrl) {
      errors.push('OpenRouter-Crew-Profil hat keinen Endpoint.')
    }
    if (needsFallbackModel && !effectiveModel) {
      errors.push('OpenRouter-Crew-Profil hat kein Modell und mindestens ein Agent besitzt keinen Model-Override.')
    }
  }

  if (crew.process === 'hierarchical') {
    if (!crew.managerAgentId) {
      errors.push('Hierarchische Crew benoetigt einen Manager-Agenten.')
    } else if (!enabledAgentIds.has(crew.managerAgentId)) {
      errors.push('Der gewaehlte Manager-Agent ist deaktiviert oder fehlt.')
    }
  }

  return { errors, warnings }
}

export default function CrewPanel() {
  const {
    crews,
    activeCrewId,
    createCrew,
    updateCrew,
    deleteCrew,
    setActiveCrew,
    loadAgents,
    installDefaultAgents,
    updateCrewAgent,
  } = useCrewStore()
  const { availableModels, defaultLlmProfileIds, llmProfiles, mcpServer, mcpServers, ollama } = useConfigStore()
  const claudeTools = useCoworkStore((state) => state.claudeTools)

  const [crewName, setCrewName] = useState('')
  const [providerHealthChecks, setProviderHealthChecks] = useState<Record<string, { loading: boolean; result?: CrewProviderHealthCheckResult }>>({})
  const [providerModelOptions, setProviderModelOptions] = useState<Record<string, { loading: boolean; endpoint?: string; models: string[]; error?: string }>>({})
  const [pendingScrollCrewId, setPendingScrollCrewId] = useState<string | null>(null)
  const importCrewInputRef = useRef<HTMLInputElement | null>(null)
  const activeCrewDetailsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    loadAgents()
    installDefaultAgents()
  }, [installDefaultAgents, loadAgents])

  const activeCrew = useMemo(
    () => crews.find((crew) => crew.id === activeCrewId) ?? crews[0],
    [activeCrewId, crews],
  )
  const defaultOpenAICompatibleProfile = useMemo(
    () => llmProfiles.find((profile) => profile.id === defaultLlmProfileIds['openai-compatible'] && profile.provider === 'openai-compatible')
      ?? llmProfiles.find((profile) => profile.provider === 'openai-compatible'),
    [defaultLlmProfileIds, llmProfiles],
  )
  const defaultOpenRouterProfile = useMemo(
    () => llmProfiles.find((profile) => profile.id === defaultLlmProfileIds.openrouter && profile.provider === 'openrouter')
      ?? llmProfiles.find((profile) => profile.provider === 'openrouter'),
    [defaultLlmProfileIds.openrouter, llmProfiles],
  )
  const activeCrewDiagnostics = useMemo(
    () => (activeCrew ? getCrewDiagnostics(activeCrew, defaultOpenAICompatibleProfile, defaultOpenRouterProfile) : { errors: [], warnings: [] }),
    [activeCrew, defaultOpenAICompatibleProfile, defaultOpenRouterProfile],
  )
  const resolvedActiveCrewConfig = useMemo(
    () => (activeCrew ? resolveCrewRuntimeConfig(activeCrew.runtimeConfig, ollama) : ollama),
    [activeCrew, ollama],
  )
  const resolvedActiveProviderConfigs = useMemo(
    () => activeCrew ? {
      openAICompatible: resolveExternalProviderConfig(
        activeCrew.providerProfiles.openAICompatible,
        defaultOpenAICompatibleProfile,
        defaultOpenAICompatibleProfile?.baseUrl || activeCrew.providerProfiles.openAICompatible.baseUrl || 'https://api.openai.com/v1',
      ),
      openRouter: resolveExternalProviderConfig(
        activeCrew.providerProfiles.openRouter,
        defaultOpenRouterProfile,
        defaultOpenRouterProfile?.baseUrl || activeCrew.providerProfiles.openRouter.baseUrl || 'https://openrouter.ai/api/v1',
      ),
    } : { openAICompatible: undefined, openRouter: undefined },
    [activeCrew, defaultOpenAICompatibleProfile, defaultOpenRouterProfile],
  )
  const configuredMcpServers = mcpServers.length > 0 ? mcpServers : [mcpServer]

  const getProviderModelCatalog = (providerKind: CrewProviderKind) => {
    if (providerKind === 'ollama') {
      return {
        models: availableModels,
        authoritative: true,
      }
    }

    const providerState = providerKind === 'openai-compatible'
      ? providerModelOptions.openAICompatible
      : providerModelOptions.openRouter

    return {
      models: providerState?.models ?? [],
      authoritative: Boolean(providerState && !providerState.loading && !providerState.error),
    }
  }

  const getCrewDefaultModelLabel = (providerKind: CrewProviderKind) => {
    if (providerKind === 'ollama') {
      return resolvedActiveCrewConfig.model || ollama.model || 'nicht gesetzt'
    }

    if (providerKind === 'openai-compatible') {
      return resolvedActiveProviderConfigs.openAICompatible?.model || defaultOpenAICompatibleProfile?.model || 'nicht gesetzt'
    }

    return resolvedActiveProviderConfigs.openRouter?.model || 'nicht gesetzt'
  }

  const isProviderEnabledForCrew = (providerKind: CrewProviderKind) => {
    if (providerKind === 'ollama') {
      return true
    }

    if (!activeCrew) {
      return false
    }

    return providerKind === 'openai-compatible'
      ? activeCrew.providerProfiles.openAICompatible.enabled
      : activeCrew.providerProfiles.openRouter.enabled
  }

  const getAgentModelOptions = (agent: { providerKind: CrewProviderKind; modelOverride?: string | null }) => {
    const catalog = getProviderModelCatalog(agent.providerKind)
    const modelOverride = agent.modelOverride?.trim()

    if (!modelOverride || catalog.authoritative || catalog.models.includes(modelOverride)) {
      return catalog.models
    }

    return [modelOverride, ...catalog.models]
  }

  const handleAgentProviderKindChange = (agentId: string, providerKind: CrewProviderKind) => {
    const agent = activeCrew?.agents.find((candidate) => candidate.id === agentId)
    if (!agent) return
    if (providerKind !== 'ollama' && !isProviderEnabledForCrew(providerKind)) return

    const currentModelOverride = agent.modelOverride?.trim()
    const nextCatalog = getProviderModelCatalog(providerKind)

    updateActiveCrewAgent(agentId, {
      providerKind,
      modelOverride: currentModelOverride && nextCatalog.models.includes(currentModelOverride) ? currentModelOverride : null,
    })

    if (providerKind === 'ollama') {
      return
    }

    const providerKey = providerKind === 'openai-compatible' ? 'openAICompatible' : 'openRouter'
    const providerState = providerModelOptions[providerKey]

    if (providerState?.loading || providerState?.models.length) {
      return
    }

    void handleLoadProviderModels(providerKey)
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    fontSize: 13,
    width: '100%',
  }
  const textAreaStyle: React.CSSProperties = {
    ...inputStyle,
    resize: 'vertical',
    minHeight: 72,
  }

  useEffect(() => {
    setProviderHealthChecks({})
    setProviderModelOptions({})
  }, [activeCrew?.id])

  useEffect(() => {
    if (!pendingScrollCrewId || activeCrew?.id !== pendingScrollCrewId) return
    activeCrewDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPendingScrollCrewId(null)
  }, [activeCrew?.id, pendingScrollCrewId])

  useEffect(() => {
    if (!activeCrew) return

    const invalidAgentIds = activeCrew.agents
      .filter((agent) => {
        const modelOverride = agent.modelOverride?.trim()
        if (!modelOverride) return false

        const catalog = getProviderModelCatalog(agent.providerKind)
        return catalog.authoritative && !catalog.models.includes(modelOverride)
      })
      .map((agent) => agent.id)

    if (invalidAgentIds.length === 0) return

    invalidAgentIds.forEach((agentId) => {
      updateCrewAgent(activeCrew.id, agentId, { modelOverride: null })
    })
  }, [activeCrew, availableModels, providerModelOptions, updateCrewAgent])

  const handleCreateCrew = () => {
    const nextName = crewName.trim() || buildDefaultCrewName(crews.map((crew) => crew.name))
    const id = crypto.randomUUID()
    createCrew(id, nextName, [])
    setActiveCrew(id)
    setPendingScrollCrewId(id)
    setCrewName('')
  }

  const updateActiveCrew = (patch: Parameters<typeof updateCrew>[1]) => {
    if (!activeCrew) return
    updateCrew(activeCrew.id, patch)
  }

  const updateActiveCrewAgent = (agentId: string, patch: Parameters<typeof updateCrewAgent>[2]) => {
    if (!activeCrew) return
    updateCrewAgent(activeCrew.id, agentId, patch)
  }

  const handleDuplicateCrew = () => {
    if (!activeCrew) return
    const newId = crypto.randomUUID()
    createCrew(newId, `${activeCrew.name} Kopie`, [])
    updateCrew(newId, {
      description: activeCrew.description,
      executionGuidelines: activeCrew.executionGuidelines,
      outputMode: activeCrew.outputMode,
      stopOnFailure: activeCrew.stopOnFailure,
      retryCount: activeCrew.retryCount,
      managerReviewEnabled: activeCrew.managerReviewEnabled,
      managerReviewGuidelines: activeCrew.managerReviewGuidelines,
      shareAllTaskOutputs: activeCrew.shareAllTaskOutputs,
      sharedOutputCharLimit: activeCrew.sharedOutputCharLimit,
      providerProfiles: activeCrew.providerProfiles,
      process: activeCrew.process,
      managerAgentId: activeCrew.managerAgentId,
      verbose: activeCrew.verbose,
      maxRpm: activeCrew.maxRpm,
      maxParallelTasks: activeCrew.maxParallelTasks,
      runtimeConfig: activeCrew.runtimeConfig,
      agents: activeCrew.agents.map((agent) => ({
        ...agent,
        tools: [...agent.tools],
        mcpServerNames: [...(agent.mcpServerNames ?? [])],
      })),
      tasks: [],
      status: 'idle',
    })
    setActiveCrew(newId)
    setPendingScrollCrewId(newId)
  }

  const handleExportCrew = () => {
    if (!activeCrew) return
    const fileName = `${activeCrew.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'crew'}.json`
    downloadCrewJson(fileName, {
      name: activeCrew.name,
      description: activeCrew.description,
      executionGuidelines: activeCrew.executionGuidelines,
      outputMode: activeCrew.outputMode,
      stopOnFailure: activeCrew.stopOnFailure,
      retryCount: activeCrew.retryCount,
      managerReviewEnabled: activeCrew.managerReviewEnabled,
      managerReviewGuidelines: activeCrew.managerReviewGuidelines,
      shareAllTaskOutputs: activeCrew.shareAllTaskOutputs,
      sharedOutputCharLimit: activeCrew.sharedOutputCharLimit,
      providerProfiles: activeCrew.providerProfiles,
      process: activeCrew.process,
      managerAgentId: activeCrew.managerAgentId,
      verbose: activeCrew.verbose,
      maxRpm: activeCrew.maxRpm,
      maxParallelTasks: activeCrew.maxParallelTasks,
      runtimeConfig: activeCrew.runtimeConfig,
      agents: activeCrew.agents,
    })
  }

  const handleImportCrew = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const raw = await file.text()
      const imported = JSON.parse(raw) as {
        name?: unknown
        description?: unknown
        executionGuidelines?: unknown
        outputMode?: unknown
        stopOnFailure?: unknown
        retryCount?: unknown
        managerReviewEnabled?: unknown
        managerReviewGuidelines?: unknown
        shareAllTaskOutputs?: unknown
        sharedOutputCharLimit?: unknown
        providerProfiles?: unknown
        process?: unknown
        managerAgentId?: unknown
        verbose?: unknown
        maxRpm?: unknown
        maxParallelTasks?: unknown
        runtimeConfig?: unknown
        agents?: unknown
      }
      const newId = crypto.randomUUID()
      const importedName = typeof imported.name === 'string' && imported.name.trim() ? imported.name : 'Importierte Crew'
      createCrew(newId, importedName, [])
      const patch: Parameters<typeof updateCrew>[1] = { tasks: [], status: 'idle' }
      if (typeof imported.description === 'string') patch.description = imported.description
      if (typeof imported.executionGuidelines === 'string') patch.executionGuidelines = imported.executionGuidelines
      if (imported.outputMode === 'standard' || imported.outputMode === 'bullet-report' || imported.outputMode === 'json') {
        patch.outputMode = imported.outputMode
      }
      if (typeof imported.stopOnFailure === 'boolean') patch.stopOnFailure = imported.stopOnFailure
      if (typeof imported.retryCount === 'number') patch.retryCount = imported.retryCount
      if (typeof imported.managerReviewEnabled === 'boolean') patch.managerReviewEnabled = imported.managerReviewEnabled
      if (typeof imported.managerReviewGuidelines === 'string') patch.managerReviewGuidelines = imported.managerReviewGuidelines
      if (typeof imported.shareAllTaskOutputs === 'boolean') patch.shareAllTaskOutputs = imported.shareAllTaskOutputs
      if (typeof imported.sharedOutputCharLimit === 'number') patch.sharedOutputCharLimit = imported.sharedOutputCharLimit
      if (
        imported.providerProfiles
        && typeof imported.providerProfiles === 'object'
        && imported.providerProfiles !== null
        && 'openAICompatible' in imported.providerProfiles
        && 'openRouter' in imported.providerProfiles
      ) {
        patch.providerProfiles = imported.providerProfiles as any
      }
      if (imported.process === 'sequential' || imported.process === 'parallel' || imported.process === 'hierarchical') {
        patch.process = imported.process
      }
      if (typeof imported.managerAgentId === 'string' || imported.managerAgentId === null) {
        patch.managerAgentId = imported.managerAgentId as any
      }
      if (typeof imported.verbose === 'boolean') patch.verbose = imported.verbose
      if (typeof imported.maxRpm === 'number') patch.maxRpm = imported.maxRpm
      if (typeof imported.maxParallelTasks === 'number') patch.maxParallelTasks = imported.maxParallelTasks
      if (
        imported.runtimeConfig
        && typeof imported.runtimeConfig === 'object'
        && imported.runtimeConfig !== null
        && 'enabled' in imported.runtimeConfig
        && 'baseUrl' in imported.runtimeConfig
        && 'model' in imported.runtimeConfig
        && 'timeoutMs' in imported.runtimeConfig
      ) {
        patch.runtimeConfig = imported.runtimeConfig as any
      }
      if (Array.isArray(imported.agents)) {
        patch.agents = imported.agents.map((agent) => ({
          id: typeof (agent as any)?.id === 'string' ? (agent as any).id : crypto.randomUUID(),
          name: typeof (agent as any)?.name === 'string' ? (agent as any).name : 'Agent',
          role: ROLE_OPTIONS.includes((agent as any)?.role) ? (agent as any).role : 'custom',
          goal: typeof (agent as any)?.goal === 'string' ? (agent as any).goal : '',
          backstory: typeof (agent as any)?.backstory === 'string' ? (agent as any).backstory : '',
          skillsMarkdown: typeof (agent as any)?.skillsMarkdown === 'string' ? (agent as any).skillsMarkdown : '',
          personalityId: typeof (agent as any)?.personalityId === 'string' ? (agent as any).personalityId : null,
          modelOverride: typeof (agent as any)?.modelOverride === 'string' ? (agent as any).modelOverride : null,
          providerKind:
            (agent as any)?.providerKind === 'ollama'
            || (agent as any)?.providerKind === 'openai-compatible'
            || (agent as any)?.providerKind === 'openrouter'
              ? (agent as any).providerKind
              : 'ollama',
          tools: Array.isArray((agent as any)?.tools) ? (agent as any).tools.filter((tool: unknown) => typeof tool === 'string') : [],
          mcpServerNames: Array.isArray((agent as any)?.mcpServerNames) ? (agent as any).mcpServerNames.filter((name: unknown) => typeof name === 'string') : [],
          enabled: typeof (agent as any)?.enabled === 'boolean' ? (agent as any).enabled : true,
          allowDelegation: typeof (agent as any)?.allowDelegation === 'boolean' ? (agent as any).allowDelegation : true,
          verbose: typeof (agent as any)?.verbose === 'boolean' ? (agent as any).verbose : false,
          maxIterations: typeof (agent as any)?.maxIterations === 'number' ? (agent as any).maxIterations : 10,
        }))
      }

      updateCrew(newId, patch)
      setActiveCrew(newId)
      setPendingScrollCrewId(newId)
    } finally {
      event.target.value = ''
    }
  }

  const handleTestProviderProfile = async (providerKey: 'openAICompatible' | 'openRouter') => {
    const config = resolvedActiveProviderConfigs[providerKey]
    if (!config) return

    setProviderHealthChecks((current) => ({
      ...current,
      [providerKey]: {
        loading: true,
        result: current[providerKey]?.result,
      },
    }))

    try {
      const result = await safeInvoke<CrewProviderHealthCheckResult>('crew_provider_health_check', {
        request: {
          providerKind: providerKey === 'openAICompatible' ? 'openai-compatible' : 'openrouter',
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
        },
      })

      setProviderHealthChecks((current) => ({
        ...current,
        [providerKey]: {
          loading: false,
          result,
        },
      }))
    } catch (error) {
      setProviderHealthChecks((current) => ({
        ...current,
        [providerKey]: {
          loading: false,
          result: {
            reachable: false,
            status: null,
            endpoint: config.baseUrl,
            message: error instanceof Error ? error.message : String(error),
            checkedAt: new Date().toISOString(),
          },
        },
      }))
    }
  }

  const handleLoadProviderModels = async (providerKey: 'openAICompatible' | 'openRouter') => {
    const config = resolvedActiveProviderConfigs[providerKey]
    if (!config) return

    setProviderModelOptions((current) => ({
      ...current,
      [providerKey]: {
        loading: true,
        endpoint: current[providerKey]?.endpoint,
        models: current[providerKey]?.models ?? [],
      },
    }))

    try {
      const result = await safeInvoke<CrewProviderModelsResult>('crew_provider_models_list', {
        request: {
          providerKind: providerKey === 'openAICompatible' ? 'openai-compatible' : 'openrouter',
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
        },
      })

      setProviderModelOptions((current) => ({
        ...current,
        [providerKey]: {
          loading: false,
          endpoint: result.endpoint,
          models: result.models,
        },
      }))
    } catch (error) {
      setProviderModelOptions((current) => ({
        ...current,
        [providerKey]: {
          loading: false,
          endpoint: config.baseUrl,
          models: current[providerKey]?.models ?? [],
          error: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }

  return (
    <div className="panel">
      <h2>🚀 Crew AI</h2>
      <input ref={importCrewInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(event) => void handleImportCrew(event)} />

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <input
          placeholder="Neue Crew"
          value={crewName}
          onChange={(event) => setCrewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleCreateCrew()
            }
          }}
          style={inputStyle}
        />
        <button type="button" className="btn-sm" onClick={handleCreateCrew}>Crew anlegen</button>
        <button type="button" className="btn-sm" onClick={handleDuplicateCrew} disabled={!activeCrew}>Crew duplizieren</button>
        <button type="button" className="btn-sm" onClick={handleExportCrew} disabled={!activeCrew}>JSON exportieren</button>
        <button type="button" className="btn-sm" onClick={() => importCrewInputRef.current?.click()}>JSON importieren</button>
      </div>

      {crews.length === 0 ? (
        <p className="panel-empty">Noch keine Crew vorhanden.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {crews.map((crew) => (
              (() => {
                const diagnostics = getCrewDiagnostics(crew, defaultOpenAICompatibleProfile, defaultOpenRouterProfile)
                return (
                  <div
                    key={crew.id}
                    className="card"
                    style={{ border: activeCrew?.id === crew.id ? '1px solid var(--accent)' : '1px solid var(--border-color)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <button type="button" className="btn-sm" onClick={() => setActiveCrew(crew.id)}>
                        {crew.name}
                      </button>
                      <button type="button" className="btn-sm" onClick={() => deleteCrew(crew.id)} style={{ color: 'var(--danger)' }}>
                        ✕
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                      {crew.process} · {crew.agents.filter((agent) => agent.enabled).length}/{crew.agents.length} aktiv
                      {diagnostics.errors.length > 0 ? ` · ${diagnostics.errors.length} Blocker` : ''}
                    </div>
                  </div>
                )
              })()
            ))}
          </div>

          <div className="card" ref={activeCrewDetailsRef}>
            {activeCrew ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label>
                      Crew-Name
                      <input value={activeCrew.name} onChange={(event) => updateActiveCrew({ name: event.target.value })} style={inputStyle} />
                    </label>
                    <label>
                      Beschreibung
                      <textarea value={activeCrew.description} onChange={(event) => updateActiveCrew({ description: event.target.value })} style={textAreaStyle} />
                    </label>
                    <label>
                      Crew-Zusatzanweisungen
                      <textarea
                        value={activeCrew.executionGuidelines}
                        onChange={(event) => updateActiveCrew({ executionGuidelines: event.target.value })}
                        style={textAreaStyle}
                        placeholder="z. B. Antworte mit Risiken, Annahmen und naechsten Schritten"
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label>
                      Ausfuehrungsmodus
                      <select value={activeCrew.process} onChange={(event) => updateActiveCrew({ process: event.target.value as CrewProcess })} style={inputStyle}>
                        {PROCESS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Manager-Agent
                      <select value={activeCrew.managerAgentId ?? ''} onChange={(event) => updateActiveCrew({ managerAgentId: event.target.value || null })} style={inputStyle}>
                        <option value="">Keiner</option>
                        {activeCrew.agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Max RPM
                      <input type="number" min={1} max={600} value={activeCrew.maxRpm} onChange={(event) => updateActiveCrew({ maxRpm: Number(event.target.value) || 1 })} style={inputStyle} />
                    </label>
                    <label>
                      Max parallele Tasks
                      <input type="number" min={1} max={24} value={activeCrew.maxParallelTasks} onChange={(event) => updateActiveCrew({ maxParallelTasks: Number(event.target.value) || 1 })} style={inputStyle} />
                    </label>
                    <label>
                      Retry-Versuche pro Task
                      <input type="number" min={0} max={5} value={activeCrew.retryCount} onChange={(event) => updateActiveCrew({ retryCount: Math.max(0, Number(event.target.value) || 0) })} style={inputStyle} />
                    </label>
                    <label>
                      Ausgabeformat
                      <select
                        value={activeCrew.outputMode}
                        onChange={(event) => updateActiveCrew({ outputMode: event.target.value as CrewOutputMode })}
                        style={inputStyle}
                      >
                        <option value="standard">Standard</option>
                        <option value="bullet-report">Stichpunkt-Report</option>
                        <option value="json">JSON</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={activeCrew.verbose} onChange={(event) => updateActiveCrew({ verbose: event.target.checked })} />
                      Verbose Crew-Logging aktivieren
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={activeCrew.stopOnFailure} onChange={(event) => updateActiveCrew({ stopOnFailure: event.target.checked })} />
                      Crew bei Task-Fehler sofort stoppen
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={activeCrew.managerReviewEnabled} onChange={(event) => updateActiveCrew({ managerReviewEnabled: event.target.checked })} />
                      Manager-Review nach Task-Batches aktivieren
                    </label>
                    {activeCrew.managerReviewEnabled && (
                      <label>
                        Manager-Review-Anweisungen
                        <textarea
                          value={activeCrew.managerReviewGuidelines}
                          onChange={(event) => updateActiveCrew({ managerReviewGuidelines: event.target.value })}
                          style={textAreaStyle}
                          placeholder="z. B. Beurteile Risiken strenger und eskaliere fruehzeitig"
                        />
                      </label>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={activeCrew.shareAllTaskOutputs} onChange={(event) => updateActiveCrew({ shareAllTaskOutputs: event.target.checked })} />
                      Vorherige Task-Ergebnisse global als Kontext teilen
                    </label>
                    <label>
                      Zeichenlimit fuer geteilte Task-Ergebnisse
                      <input type="number" min={0} max={50000} value={activeCrew.sharedOutputCharLimit} onChange={(event) => updateActiveCrew({ sharedOutputCharLimit: Math.max(0, Number(event.target.value) || 0) })} style={inputStyle} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={activeCrew.providerProfiles.openAICompatible.enabled}
                        onChange={(event) => updateActiveCrew({
                          providerProfiles: {
                            ...activeCrew.providerProfiles,
                            openAICompatible: {
                              ...activeCrew.providerProfiles.openAICompatible,
                              enabled: event.target.checked,
                            },
                          },
                        })}
                      />
                      OpenAI-kompatibles Provider-Profil aktivieren
                    </label>
                    {activeCrew.providerProfiles.openAICompatible.enabled && (
                      <>
                        <label>
                          OpenAI-kompatibler Endpoint
                          <input
                            value={activeCrew.providerProfiles.openAICompatible.baseUrl}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openAICompatible: {
                                  ...activeCrew.providerProfiles.openAICompatible,
                                  baseUrl: event.target.value,
                                },
                              },
                            })}
                            style={inputStyle}
                            placeholder={defaultOpenAICompatibleProfile?.baseUrl || 'https://api.openai.com/v1'}
                          />
                        </label>
                        <label>
                          OpenAI-kompatibles Modell
                          <select
                            value={activeCrew.providerProfiles.openAICompatible.model}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openAICompatible: {
                                  ...activeCrew.providerProfiles.openAICompatible,
                                  model: event.target.value,
                                },
                              },
                            })}
                            style={inputStyle}
                          >
                            <option value="">Crew-Default ({getCrewDefaultModelLabel('openai-compatible')})</option>
                            {providerModelOptions.openAICompatible?.models.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                            {activeCrew.providerProfiles.openAICompatible.model && 
                              !providerModelOptions.openAICompatible?.models.includes(activeCrew.providerProfiles.openAICompatible.model) && (
                              <option value={activeCrew.providerProfiles.openAICompatible.model}>{activeCrew.providerProfiles.openAICompatible.model}</option>
                            )}
                          </select>
                        </label>
                        <label>
                          OpenAI-kompatibler API-Key
                          <input
                            type="password"
                            value={activeCrew.providerProfiles.openAICompatible.apiKey}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openAICompatible: {
                                  ...activeCrew.providerProfiles.openAICompatible,
                                  apiKey: event.target.value,
                                },
                              },
                            })}
                            style={inputStyle}
                            placeholder="sk-..."
                          />
                        </label>
                        <label>
                          OpenAI-kompatibler Timeout (ms)
                          <input
                            type="number"
                            min={1000}
                            max={3600000}
                            value={activeCrew.providerProfiles.openAICompatible.timeoutMs}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openAICompatible: {
                                  ...activeCrew.providerProfiles.openAICompatible,
                                  timeoutMs: Math.max(1000, Number(event.target.value) || 600000),
                                },
                              },
                            })}
                            style={inputStyle}
                          />
                        </label>
                        <button type="button" className="btn-sm" onClick={() => void handleTestProviderProfile('openAICompatible')}>
                          {providerHealthChecks.openAICompatible?.loading ? 'Teste...' : 'OpenAI-Profil testen'}
                        </button>
                        <button type="button" className="btn-sm" onClick={() => void handleLoadProviderModels('openAICompatible')}>
                          {providerModelOptions.openAICompatible?.loading ? 'Lade Modelle...' : 'Modelle laden'}
                        </button>
                        {providerHealthChecks.openAICompatible?.result && (
                          <div style={{ fontSize: 12, color: providerHealthChecks.openAICompatible.result.reachable ? 'var(--success)' : 'var(--danger)' }}>
                            {providerHealthChecks.openAICompatible.result.message} ({providerHealthChecks.openAICompatible.result.endpoint})
                          </div>
                        )}
                        {providerModelOptions.openAICompatible?.models.length ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {providerModelOptions.openAICompatible.models.length} Modell(e) geladen von {providerModelOptions.openAICompatible.endpoint}
                          </div>
                        ) : null}
                        {providerModelOptions.openAICompatible?.error && (
                          <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                            {providerModelOptions.openAICompatible.error}
                          </div>
                        )}
                      </>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={activeCrew.providerProfiles.openRouter.enabled}
                        onChange={(event) => updateActiveCrew({
                          providerProfiles: {
                            ...activeCrew.providerProfiles,
                            openRouter: {
                              ...activeCrew.providerProfiles.openRouter,
                              enabled: event.target.checked,
                            },
                          },
                        })}
                      />
                      OpenRouter-Profil aktivieren
                    </label>
                    {activeCrew.providerProfiles.openRouter.enabled && (
                      <>
                        <label>
                          OpenRouter-Endpoint
                          <input
                            value={activeCrew.providerProfiles.openRouter.baseUrl}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openRouter: {
                                  ...activeCrew.providerProfiles.openRouter,
                                  baseUrl: event.target.value,
                                },
                              },
                            })}
                            style={inputStyle}
                            placeholder={defaultOpenRouterProfile?.baseUrl || 'https://openrouter.ai/api/v1'}
                          />
                        </label>
                        <label>
                          OpenRouter-Modell
                          <select
                            value={activeCrew.providerProfiles.openRouter.model}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openRouter: {
                                  ...activeCrew.providerProfiles.openRouter,
                                  model: event.target.value,
                                },
                              },
                            })}
                            style={inputStyle}
                          >
                            <option value="">Crew-Default ({getCrewDefaultModelLabel('openrouter')})</option>
                            {providerModelOptions.openRouter?.models.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                            {activeCrew.providerProfiles.openRouter.model && 
                              !providerModelOptions.openRouter?.models.includes(activeCrew.providerProfiles.openRouter.model) && (
                              <option value={activeCrew.providerProfiles.openRouter.model}>{activeCrew.providerProfiles.openRouter.model}</option>
                            )}
                          </select>
                        </label>
                        <label>
                          OpenRouter-API-Key
                          <input
                            type="password"
                            value={activeCrew.providerProfiles.openRouter.apiKey}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openRouter: {
                                  ...activeCrew.providerProfiles.openRouter,
                                  apiKey: event.target.value,
                                },
                              },
                            })}
                            style={inputStyle}
                            placeholder={defaultOpenRouterProfile?.apiKey ? 'Globales Standardprofil verwenden' : 'sk-or-v1-...'}
                          />
                        </label>
                        <label>
                          OpenRouter-Timeout (ms)
                          <input
                            type="number"
                            min={1000}
                            max={3600000}
                            value={activeCrew.providerProfiles.openRouter.timeoutMs}
                            onChange={(event) => updateActiveCrew({
                              providerProfiles: {
                                ...activeCrew.providerProfiles,
                                openRouter: {
                                  ...activeCrew.providerProfiles.openRouter,
                                  timeoutMs: Math.max(1000, Number(event.target.value) || 600000),
                                },
                              },
                            })}
                            style={inputStyle}
                          />
                        </label>
                        <button type="button" className="btn-sm" onClick={() => void handleTestProviderProfile('openRouter')}>
                          {providerHealthChecks.openRouter?.loading ? 'Teste...' : 'OpenRouter-Profil testen'}
                        </button>
                        <button type="button" className="btn-sm" onClick={() => void handleLoadProviderModels('openRouter')}>
                          {providerModelOptions.openRouter?.loading ? 'Lade Modelle...' : 'Modelle laden'}
                        </button>
                        {providerHealthChecks.openRouter?.result && (
                          <div style={{ fontSize: 12, color: providerHealthChecks.openRouter.result.reachable ? 'var(--success)' : 'var(--danger)' }}>
                            {providerHealthChecks.openRouter.result.message} ({providerHealthChecks.openRouter.result.endpoint})
                          </div>
                        )}
                        {providerModelOptions.openRouter?.models.length ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {providerModelOptions.openRouter.models.length} Modell(e) geladen von {providerModelOptions.openRouter.endpoint}
                          </div>
                        ) : null}
                        {providerModelOptions.openRouter?.error && (
                          <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                            {providerModelOptions.openRouter.error}
                          </div>
                        )}
                      </>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={activeCrew.runtimeConfig.enabled}
                        onChange={(event) => updateActiveCrew({
                          runtimeConfig: {
                            ...activeCrew.runtimeConfig,
                            enabled: event.target.checked,
                          },
                        })}
                      />
                      Crew-eigene Runtime-Konfiguration nutzen
                    </label>
                    {activeCrew.runtimeConfig.enabled && (
                      <>
                        <label>
                          Crew-Endpoint
                          <input
                            value={activeCrew.runtimeConfig.baseUrl}
                            onChange={(event) => updateActiveCrew({
                              runtimeConfig: {
                                ...activeCrew.runtimeConfig,
                                baseUrl: event.target.value,
                              },
                            })}
                            style={inputStyle}
                            placeholder={ollama.baseUrl}
                          />
                        </label>
                        <label>
                          Crew-Modell
                          <select
                            value={activeCrew.runtimeConfig.model}
                            onChange={(event) => updateActiveCrew({
                              runtimeConfig: {
                                ...activeCrew.runtimeConfig,
                                model: event.target.value,
                              },
                            })}
                            style={inputStyle}
                          >
                            <option value="">Globales Modell ({ollama.model})</option>
                            {availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
                            {activeCrew.runtimeConfig.model && !availableModels.includes(activeCrew.runtimeConfig.model) && (
                              <option value={activeCrew.runtimeConfig.model}>{activeCrew.runtimeConfig.model}</option>
                            )}
                          </select>
                        </label>
                        <label>
                          Crew-Timeout (ms)
                          <input
                            type="number"
                            min={1000}
                            max={3600000}
                            value={activeCrew.runtimeConfig.timeoutMs}
                            onChange={(event) => updateActiveCrew({
                              runtimeConfig: {
                                ...activeCrew.runtimeConfig,
                                timeoutMs: Number(event.target.value) || ollama.timeoutMs,
                              },
                            })}
                            style={inputStyle}
                          />
                        </label>
                      </>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Effektive Runtime: {resolvedActiveCrewConfig.baseUrl} · {resolvedActiveCrewConfig.model} · {resolvedActiveCrewConfig.timeoutMs} ms
                    </div>
                  </div>
                </div>

                <div className="card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <strong>Crew-Diagnostik</strong>
                  {activeCrewDiagnostics.errors.length === 0 && activeCrewDiagnostics.warnings.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--success)' }}>Keine Blocker gefunden. Crew ist startbereit.</div>
                  ) : (
                    <>
                      {activeCrewDiagnostics.errors.map((entry) => (
                        <div key={`error-${entry}`} style={{ fontSize: 12, color: 'var(--danger)' }}>Blocker: {entry}</div>
                      ))}
                      {activeCrewDiagnostics.warnings.map((entry) => (
                        <div key={`warning-${entry}`} style={{ fontSize: 12, color: 'var(--text-muted)' }}>Hinweis: {entry}</div>
                      ))}
                    </>
                  )}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <strong style={{ display: 'block', marginBottom: 8 }}>Crew-Mitglieder</strong>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeCrew.agents.map((agent) => {
                      const providerModelCatalog = getProviderModelCatalog(agent.providerKind)
                      const agentModelOptions = getAgentModelOptions(agent)
                      const selectedModelOverride = agent.modelOverride?.trim() && agentModelOptions.includes(agent.modelOverride.trim())
                        ? agent.modelOverride.trim()
                        : ''

                      return (
                      <div key={agent.id} className="card" style={{ border: agent.enabled ? '1px solid var(--accent)' : '1px solid var(--border-color)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 0.8fr', gap: 10, alignItems: 'start' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <label>
                              Name
                              <input value={agent.name} onChange={(event) => updateActiveCrewAgent(agent.id, { name: event.target.value })} style={inputStyle} />
                            </label>
                            <label>
                              Rolle
                              <select value={agent.role} onChange={(event) => updateActiveCrewAgent(agent.id, { role: event.target.value as AgentRole })} style={inputStyle}>
                                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                              </select>
                            </label>
                            <label>
                              Ziel / Prompt-Fokus
                              <textarea value={agent.goal} onChange={(event) => updateActiveCrewAgent(agent.id, { goal: event.target.value })} style={textAreaStyle} />
                            </label>
                            <label>
                              Hintergrund
                              <textarea value={agent.backstory} onChange={(event) => updateActiveCrewAgent(agent.id, { backstory: event.target.value })} style={textAreaStyle} />
                            </label>
                            <label>
                              skills.md
                              <textarea
                                value={agent.skillsMarkdown}
                                onChange={(event) => updateActiveCrewAgent(agent.id, { skillsMarkdown: event.target.value })}
                                style={textAreaStyle}
                                placeholder="# skills.md\n- Projektkontext\n- Arbeitsstil\n- Regeln"
                              />
                            </label>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="checkbox" checked={agent.enabled} onChange={(event) => updateActiveCrewAgent(agent.id, { enabled: event.target.checked })} />
                              Aktiviert
                            </label>
                            <label>
                              Provider
                              <select value={agent.providerKind} onChange={(event) => handleAgentProviderKindChange(agent.id, event.target.value as CrewProviderKind)} style={inputStyle}>
                                {PROVIDER_OPTIONS.map((option) => {
                                  const isSelectable = option.value === agent.providerKind || isProviderEnabledForCrew(option.value)
                                  return (
                                    <option key={option.value} value={option.value} disabled={!isSelectable}>
                                      {isSelectable ? option.label : `${option.label} (Crew-Profil aktivieren)`}
                                    </option>
                                  )
                                })}
                              </select>
                              {agent.providerKind !== 'ollama' && !isProviderEnabledForCrew(agent.providerKind) && (
                                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--danger)' }}>
                                  Dieser Provider ist fuer die Crew noch nicht aktiviert. Aktiviere zuerst das passende Crew-Profil.
                                </div>
                              )}
                            </label>
                            <label>
                              Modell
                              <select value={selectedModelOverride} onChange={(event) => updateActiveCrewAgent(agent.id, { modelOverride: event.target.value || null })} style={inputStyle}>
                                <option value="">Crew-Default ({getCrewDefaultModelLabel(agent.providerKind)})</option>
                                {agentModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                              </select>
                              {agent.providerKind !== 'ollama' && providerModelCatalog.models.length === 0 && (
                                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                  Fuer diesen Provider sind noch keine Modelle geladen. Bis dahin bleibt nur das Crew-Default aktiv.
                                </div>
                              )}
                            </label>
                            <label>
                              Max Iterationen
                              <input type="number" min={1} max={100} value={agent.maxIterations} onChange={(event) => updateActiveCrewAgent(agent.id, { maxIterations: Number(event.target.value) || 1 })} style={inputStyle} />
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="checkbox" checked={agent.allowDelegation} onChange={(event) => updateActiveCrewAgent(agent.id, { allowDelegation: event.target.checked })} />
                              Delegation erlaubt
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="checkbox" checked={agent.verbose} onChange={(event) => updateActiveCrewAgent(agent.id, { verbose: event.target.checked })} />
                              Verbose Agent-Logs
                            </label>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div>
                              <strong style={{ display: 'block', marginBottom: 6 }}>Tools</strong>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
                                {claudeTools.map((tool) => (
                                  <label key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                    <input
                                      type="checkbox"
                                      checked={agent.tools.includes(tool.id)}
                                      onChange={() => updateActiveCrewAgent(agent.id, { tools: toggleStringValue(agent.tools, tool.id) })}
                                    />
                                    {tool.label}
                                  </label>
                                ))}
                              </div>
                            </div>

                            <div>
                              <strong style={{ display: 'block', marginBottom: 6 }}>MCP-Zugriffe</strong>
                              {configuredMcpServers.length === 0 ? (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Keine MCP-Server konfiguriert.</div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
                                  {configuredMcpServers.map((server) => (
                                    <label key={server.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                      <input
                                        type="checkbox"
                                        checked={agent.mcpServerNames.includes(server.name)}
                                        onChange={() => updateActiveCrewAgent(agent.id, { mcpServerNames: toggleStringValue(agent.mcpServerNames, server.name) })}
                                      />
                                      {server.name}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </div>

                <div className="card" style={{ marginBottom: 16 }}>
                  <strong style={{ display: 'block', marginBottom: 6 }}>Tasks</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Tasks werden unter /tasks erstellt, ausgefuehrt und geplant.
                  </div>
                </div>
              </>
            ) : (
              <p className="panel-empty">Keine Crew ausgewaehlt.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}