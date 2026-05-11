// crewHandler.ts
// Handles crew task messages from the engine store

import { useWorkTasksStore } from '../../stores/workTasksStore'
import { resolveCrewAgentsWithProfiles, useCrewStore, type CrewPersonalityProfile } from '../../stores/crewStore'
import { useConfigStore } from '../../stores/configStore'
import { useChatStore } from '../../stores/chatStore'
import { usePersonalityStore } from '../../stores/personalityStore'
import { safeInvoke } from '../../utils/safeInvoke'
import type { EngineUserInput, ConversationHistorySeed } from '../../stores/engineStore'
import type { EngineEvent } from '../core/queryEngine'
import type { ChatProviderSelection } from '../../utils/chatProvider'
import type { PermissionMode } from '../types/tool'
// No-op: listen removed for simplicity

export interface CrewTaskMessageParams {
  userInput: EngineUserInput
  cwd: string
  onEvent?: (event: EngineEvent) => void
  historySeed?: ConversationHistorySeed
  providerSelection?: ChatProviderSelection
  permissionConfig?: { mode: PermissionMode; allowedDirectories: string[] }
  crewId: string | null
  threadId: string
  runId: string
}

export async function handleCrewTaskMessage(params: CrewTaskMessageParams): Promise<void> {
  const { crewId, threadId } = params
  
  const workTasksStore = useWorkTasksStore.getState()
  const crewStore = useCrewStore.getState()
  
  // Find task by threadId
  const task = workTasksStore.tasks.find(t => t.threadId === threadId)
  if (!task) {
    throw new Error('Task für diesen Chat nicht gefunden.')
  }
  
  // Update task status
  workTasksStore.updateTask(task.id, {
    status: 'running',
    output: '',
    error: null,
  })
  
  try {
    if (!crewId) {
      throw new Error('Bitte eine Crew auswaehlen.')
    }
    
    const crew = crewStore.crews.find(c => c.id === crewId)
    if (!crew) {
      throw new Error('Crew nicht gefunden (evtl. geloescht).')
    }
    const personalityState = usePersonalityStore.getState()
    if (personalityState.personalities.length === 0) {
      await personalityState.loadPersonalities()
    }
    const personalityProfiles: CrewPersonalityProfile[] = usePersonalityStore.getState().personalities.map((personality) => ({
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
    const resolvedAgents = resolveCrewAgentsWithProfiles(crew.agents, personalityProfiles)
    
    // Get Ollama config
    const configState = useConfigStore.getState()
    const ollamaConfig = configState?.ollama || { baseUrl: 'http://localhost:11434', model: 'llama3', timeoutMs: 600000 }
    
    // Execute crew
    const response = await safeInvoke<any>('crew_execute', {
      request: {
        id: crew.id,
        streamId: `crew-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: crew.name,
        description: crew.description,
        executionSubject: crew.executionSubject,
        knowledgeFocus: crew.knowledgeFocus,
        governanceMode: crew.governanceMode,
        outputMode: crew.outputMode,
        stopOnFailure: crew.stopOnFailure,
        retryCount: crew.retryCount,
        managerReviewEnabled: crew.managerReviewEnabled,
        managerReviewGuidelines: crew.managerReviewGuidelines,
        shareAllTaskOutputs: crew.shareAllTaskOutputs,
        sharedOutputCharLimit: crew.sharedOutputCharLimit,
        process: crew.process,
        managerAgentId: crew.managerAgentId,
        verbose: crew.verbose,
        maxRpm: crew.maxRpm,
        maxParallelTasks: crew.maxParallelTasks,
        agents: resolvedAgents.filter(a => a.enabled).map(agent => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          goal: agent.goal,
          backstory: agent.backstory,
          skillsMarkdown: agent.skillsMarkdown,
          personalityId: agent.personalityId,
          modelOverride: agent.modelOverride?.trim() ? agent.modelOverride : null,
          providerKind: crew.defaultProvider ?? 'ollama',
          tools: agent.tools,
          mcpServerNames: agent.mcpServerNames,
          enabled: agent.enabled,
          allowDelegation: agent.allowDelegation,
          verbose: agent.verbose,
          maxIterations: agent.maxIterations,
        })),
        tasks: crew.tasks.map(t => ({
          id: t.id,
          description: t.description,
          expectedOutput: t.expectedOutput,
          agentId: t.agentId,
          dependencies: t.dependencies,
          asyncExecution: t.asyncExecution,
          context: t.context,
        })),
        cwd: params.cwd || null,
        config: {
          baseUrl: ollamaConfig.baseUrl,
          model: ollamaConfig.model,
          timeoutMs: ollamaConfig.timeoutMs,
        },
      },
    })
    
    const mappedStatus = response.status === 'completed' ? 'completed' : 'failed'
    
    workTasksStore.updateTask(task.id, {
      status: mappedStatus,
      output: response.output || '',
      error: response.error ?? null,
      lastRunAt: Date.now(),
    })
    
    useChatStore.getState().addMessage(threadId, {
      role: 'assistant',
      content: response.output || 'Crew-Ausführung abgeschlossen.',
      timestamp: Date.now(),
    })
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    
    workTasksStore.updateTask(task.id, {
      status: 'failed',
      error: message,
      output: message,
      lastRunAt: Date.now(),
    })
    
    useChatStore.getState().addMessage(threadId, {
      role: 'assistant',
      content: `Fehler: ${message}`,
      timestamp: Date.now(),
    })
  }
}
