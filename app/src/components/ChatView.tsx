import { useRef, useEffect, useState } from 'react'
import type { ClipboardEvent, FormEvent } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useChatStore, getActiveThread } from '../stores/chatStore'
import type { LiveToolCall, LiveToolCallStatus } from '../stores/chatStore'
import { CheckCircle2, Clock3, Loader2, ShieldAlert, Wrench, XCircle } from 'lucide-react'
import { useConfigStore } from '../stores/configStore'
import { useTaskStore } from '../stores/taskStore'
import { useLogStore } from '../stores/logStore'
import type { TaskStep } from '../stores/taskStore'
import type { ContentBlock } from '../engine'
import {
  createInlineImageAttachment,
  getAttachmentDisplayName,
  getAttachmentPreviewSrcForAttachment,
  hasLocalAttachmentPath,
  isImageAttachment,
  mergeAttachments,
  normalizeDialogSelection,
  toImageContentBlocks,
  type ChatAttachment,
} from '../utils/chatAttachments'
import { buildAttachmentPromptContext } from '../utils/attachmentPromptContext'
import { compactHistoryForPrompt } from '../utils/claudeBridge'
import { resolveAssistantPresentation, resolveDisplayedAssistantContent, resolveDisplayedThinkingContent, splitPromptDebugContent } from '../utils/messageDisplay'
import { appendWebSearchSources, mergeWebSearchSources, parseWebSearchSourcesFromToolResult, type WebSearchSource } from '../utils/webSearchSources'
import { detectModelCapabilities } from '../engine/api/ollamaClient'
import { MessageThinking, MessageVerbose } from './MessageThinking'
import { HighlightedChatText } from './HighlightedChatText'
import { writeAuditEvent } from '../utils/audit'
import { buildSystemPromptFromPersonality } from '../utils/defaultSeeds'
import { getSlashCommandSuggestions, useCommandRegistry } from '../stores/commandRegistryStore'
import { usePersonalityStore } from '../stores/personalityStore'
import { useCoworkStore } from '../stores/coworkStore'
import { useMemoryStore } from '../stores/memoryStore'
import { safeInvoke } from '../utils/safeInvoke'
import { useEngineStore } from '../stores/engineStore'

function getParentDirectory(path: string): string {
  const normalized = path.trim()
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  if (lastSeparatorIndex < 0) return '.'
  if (lastSeparatorIndex === 0) return normalized.slice(0, 1)
  if (lastSeparatorIndex === 2 && /^[a-zA-Z]:[\\/]/.test(normalized)) {
    return normalized.slice(0, 3)
  }
  return normalized.slice(0, lastSeparatorIndex)
}

function getEffectiveChatCwd(
  attachments: ChatAttachment[],
  workspaceDefaultPath: string,
): string {
  for (const attachment of attachments) {
    if (!hasLocalAttachmentPath(attachment)) continue
    const normalized = attachment.path.trim()
    if (normalized && attachment.kind === 'folder') {
      return normalized
    }
  }

  for (const attachment of attachments) {
    if (!hasLocalAttachmentPath(attachment)) continue
    const normalized = attachment.path.trim()
    if (normalized && attachment.kind === 'file') {
      return getParentDirectory(normalized)
    }
  }

  return workspaceDefaultPath.trim() || '.'
}

async function buildEngineUserInput(promptWithAttachments: string, attachments: ChatAttachment[]): Promise<string | ContentBlock[]> {
  const imageBlocks = await toImageContentBlocks(attachments)
  if (imageBlocks.length === 0) {
    return promptWithAttachments
  }

  return [
    { type: 'text', text: promptWithAttachments },
    ...imageBlocks,
  ]
}

type LiveToolCallPatch = Partial<Omit<LiveToolCall, 'id' | 'startedAt'>> & {
  id: string
  toolName: string
  input: Record<string, unknown>
}

function upsertLiveToolCall(calls: LiveToolCall[], patch: LiveToolCallPatch): LiveToolCall[] {
  const now = Date.now()
  const existingIndex = calls.findIndex((call) => call.id === patch.id)
  if (existingIndex < 0) {
    return [
      ...calls,
      {
        id: patch.id,
        toolName: patch.toolName,
        input: patch.input,
        status: patch.status ?? 'requested',
        result: patch.result,
        error: patch.error,
        startedAt: now,
        finishedAt: patch.finishedAt,
      },
    ]
  }

  return calls.map((call, index) => {
    if (index !== existingIndex) return call
    return {
      ...call,
      ...patch,
      startedAt: call.startedAt,
      finishedAt: patch.finishedAt ?? call.finishedAt,
    }
  })
}

function findLiveToolCallId(calls: LiveToolCall[], toolName: string, input: Record<string, unknown>): string {
  const inputJson = JSON.stringify(input ?? {})
  const exact = calls.find((call) => call.toolName === toolName && JSON.stringify(call.input ?? {}) === inputJson)
  if (exact) return exact.id

  const active = [...calls].reverse().find((call) =>
    call.toolName === toolName && (call.status === 'requested' || call.status === 'running' || call.status === 'approval')
  )
  if (active) return active.id

  return `approval-${toolName}-${Date.now()}`
}

function formatToolPayload(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getToolStatusLabel(status: LiveToolCallStatus): string {
  switch (status) {
    case 'requested':
      return 'Tool Call erkannt'
    case 'running':
      return 'Tool laeuft'
    case 'approval':
      return 'Freigabe erforderlich'
    case 'completed':
      return 'Abgeschlossen'
    case 'failed':
      return 'Fehlgeschlagen'
  }
}

function getToolStatusIcon(status: LiveToolCallStatus) {
  switch (status) {
    case 'requested':
      return <Clock3 size={15} />
    case 'running':
      return <Loader2 size={15} className="tool-call-spin" />
    case 'approval':
      return <ShieldAlert size={15} />
    case 'completed':
      return <CheckCircle2 size={15} />
    case 'failed':
      return <XCircle size={15} />
  }
}

function LiveToolCalls({ calls }: { calls?: LiveToolCall[] }) {
  if (!Array.isArray(calls) || calls.length === 0) return null

  return (
    <div className="live-tool-call-list" aria-label="Live Tool Calls">
      {calls.map((call) => {
        const inputPreview = formatToolPayload(call.input)
        const resultPreview = formatToolPayload(call.error ?? call.result)
        return (
          <div key={call.id} className={`live-tool-call ${call.status}`}>
            <div className="live-tool-call-header">
              <span className="live-tool-call-icon" aria-hidden="true">
                {getToolStatusIcon(call.status)}
              </span>
              <span className="live-tool-call-name">
                <Wrench size={14} aria-hidden="true" />
                {call.toolName}
              </span>
              <span className="live-tool-call-status">{getToolStatusLabel(call.status)}</span>
            </div>
            {inputPreview && (
              <details className="live-tool-call-detail" open={call.status === 'requested' || call.status === 'running' || call.status === 'approval'}>
                <summary>Input</summary>
                <pre>{inputPreview}</pre>
              </details>
            )}
            {resultPreview && (
              <details className="live-tool-call-detail" open={call.status === 'failed'}>
                <summary>{call.error ? 'Fehler' : 'Ergebnis'}</summary>
                <pre>{resultPreview}</pre>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function ChatView() {
  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const verboseMode = useConfigStore((s) => s.preferences.verboseMode)
  const limitThinkingWindow = useConfigStore((s) => s.preferences.limitThinkingWindow)
  const superVerboseAuditLogging = useConfigStore((s) => s.preferences.superVerboseAuditLogging)
  const workspaceDefaultPath = useConfigStore((s) => s.preferences.workspaceDefaultPath)
  const setOllama = useConfigStore((s) => s.setOllama)
  const setAvailableModels = useConfigStore((s) => s.setAvailableModels)
  const engineSendMessage = useEngineStore((s) => s.sendMessage)
  const resolveEngineApproval = useEngineStore((s) => s.resolveApproval)
  const liveThinkingText = useEngineStore((s) => s.thinkingText)
  const {
    activeThreadId,
    pendingApproval,
    busy,
    error,
    addMessage,
    updateMessage,
    setPendingApproval,
    clearApproval,
    setBusy,
    setError,
  } = useChatStore()

  const { createTask, updateTaskStatus, setTaskSteps } = useTaskStore()
  const addLog = useLogStore((s) => s.addLog)
  const activeThread = useChatStore(getActiveThread)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const activeMessages = Array.isArray(activeThread?.messages) ? activeThread.messages : []
  const lastActiveMessage = activeMessages[activeMessages.length - 1]
  const selectableModels = Array.isArray(availableModels) ? availableModels : []
  const approvalSteps = Array.isArray(pendingApproval) ? pendingApproval : []
  const visibleMessages = activeMessages.filter((message) => message.role !== 'system' || message.visibleInChat)
  const modelCapabilities = detectModelCapabilities(ollama.model)
  const selectedModelAvailable = selectableModels.length === 0 || selectableModels.includes(ollama.model)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [slashSuggestions, setSlashSuggestions] = useState<string[]>([])

  const personalities = usePersonalityStore((s) => s.personalities)
  const globalInstruction = useCoworkStore((s) => s.globalInstruction)
  const memoryHints = useMemoryStore((s) => s.hints)
  const registryCommands = useCommandRegistry((s) => s.commands)
  const executeSlashCommand = useCommandRegistry((s) => s.executeCommand)

  useEffect(() => {
    const node = logRef.current
    if (!node) return

    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })

    return () => window.cancelAnimationFrame(frame)
  }, [
    activeThreadId,
    activeMessages.length,
    lastActiveMessage?.id,
    lastActiveMessage?.streaming,
    lastActiveMessage?.content,
    lastActiveMessage?.thinkingContent,
    lastActiveMessage?.verboseContent,
  ])

  useEffect(() => {
    let cancelled = false

    const refreshModels = async () => {
      try {
        const health = await safeInvoke<{
          ok: boolean
          models: string[]
        }>('ollama_health_check', { config: ollama }, { ok: false, models: [] })

        if (cancelled) return

        const models = Array.isArray(health.models) ? health.models : []
        setAvailableModels(models)

        if (!health.ok) {
          setModelNotice(`Ollama-Endpunkt aktuell nicht erreichbar: ${ollama.baseUrl}`)
          return
        }

        if (models.length > 0 && !models.includes(ollama.model)) {
          const fallbackModel = models[0]
          setOllama({ model: fallbackModel })
          setModelNotice(`Modell ${ollama.model} ist auf ${ollama.baseUrl} nicht verfuegbar. Wechsel zu ${fallbackModel}.`)
          return
        }

        setModelNotice(null)
      } catch {
        if (!cancelled) {
          setModelNotice(`Modellliste konnte fuer ${ollama.baseUrl} nicht aktualisiert werden.`)
        }
      }
    }

    void refreshModels()

    return () => {
      cancelled = true
    }
  }, [ollama.baseUrl, ollama.model, setAvailableModels, setOllama])

  const handleInputChange = (value: string) => {
    const matches = getSlashCommandSuggestions(registryCommands, value).map((command) => command.command)
    setSlashSuggestions(matches)
  }

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const text = inputRef.current?.value?.trim() ?? ''
    const hasAttachments = attachments.length > 0
    if ((!text && !hasAttachments) || busy || !activeThreadId) return
    const fallbackAttachmentPrompt = 'Bitte analysiere die angehaengten Bilder oder Dateien und fuehre die Aufgabe aus.'
    const effectiveInput = text || fallbackAttachmentPrompt

    // Slash command detection: if input starts with / and matches a registered command
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/)
      const cmdName = parts[0]
      const cmdArgs = parts.slice(1).join(' ')
      const matchedCmd = registryCommands.find(c => c.command === cmdName)
      if (matchedCmd) {
        addMessage(activeThreadId, {
          role: 'user',
          content: text,
          timestamp: Date.now(),
        })
        addMessage(activeThreadId, {
          role: 'assistant',
          content: `⚡ Command ${cmdName} ausgefuehrt: ${matchedCmd.label}`,
          timestamp: Date.now(),
        })
        executeSlashCommand(matchedCmd.id, cmdArgs || undefined)
        if (inputRef.current) inputRef.current.value = ''
        setSlashSuggestions([])
        return
      }
    }
    setSlashSuggestions([])

    const mergedForSend = mergeAttachments([], attachments)
    const attachmentBuild = await buildAttachmentPromptContext(mergedForSend.next, effectiveInput)
    const attachmentContext = attachmentBuild.context
    const promptWithAttachments = attachmentContext ? `${effectiveInput}\n\n${attachmentContext}` : effectiveInput
    const engineUserInput = await buildEngineUserInput(promptWithAttachments, mergedForSend.next)

    const userMessage = {
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
      attachments: mergedForSend.next,
      debugContent: promptWithAttachments,
    }
    let userMessageId: string | null = null
    const history = activeMessages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
      .filter((m) => m.content.trim().length > 0 || m.role === 'user')

    const compactedHistory = compactHistoryForPrompt(history, 12)

    // Inject system prompt from active personality
    const activePersonality = personalities.find(p => p.is_default) ?? personalities[0]
    if (activePersonality) {
      const systemPrompt = buildSystemPromptFromPersonality(activePersonality, globalInstruction, memoryHints)
      if (systemPrompt) {
        compactedHistory.compacted.unshift({ role: 'system', content: systemPrompt })
      }
    }

    if (superVerboseAuditLogging) {
      void writeAuditEvent('super_verbose', 'chat_user_prompt', {
        view: 'chat',
        threadId: activeThreadId,
        prompt: text,
        promptWithAttachments,
        attachments: mergedForSend.next,
        history,
      })
    }

    userMessageId = addMessage(activeThreadId, userMessage)
    if (inputRef.current) inputRef.current.value = ''
    setAttachments([])
    setAttachmentNotice(null)
    const effectiveTimeoutMs = Math.max(ollama.timeoutMs, 600000)
    if (effectiveTimeoutMs !== ollama.timeoutMs) {
      setOllama({ timeoutMs: effectiveTimeoutMs })
    }
    setBusy(true)
    setError(null)

    let assistantMessageId: string | null = null
    let requestPreviewMessageId: string | null = null

    try {
      const started = Date.now()
      addLog({
        level: 'info',
        area: 'llm',
        message: 'LLM-Anfrage gestartet',
        details: {
          endpoint: ollama.baseUrl,
          model: ollama.model,
          timeoutMs: effectiveTimeoutMs,
          historyItems: history.length,
          compactedHistoryItems: compactedHistory.compacted.length,
          compactedDroppedItems: compactedHistory.droppedCount,
          promptChars: promptWithAttachments.length,
          parsedAttachments: attachmentBuild.parsedFiles,
          failedAttachments: attachmentBuild.failedFiles.length,
          source: 'chat',
        },
      })
      if (superVerboseAuditLogging) {
        void writeAuditEvent('super_verbose', 'chat_llm_request_started', {
          view: 'chat',
          threadId: activeThreadId,
          prompt: text,
          promptWithAttachments,
          history,
          ollama,
        })
      }
      if (attachmentBuild.failedFiles.length > 0) {
        addLog({
          level: 'warn',
          area: 'file_safety',
          message: 'Anhang-Analyse teilweise fehlgeschlagen',
          details: {
            failures: attachmentBuild.failedFiles,
          },
        })
      }
      let rawAssistantMessage = ''
      let rawThinkingMessage = ''
      let engineErrorMessage = ''
      let approvalSummary = ''
      let approvalTaskCreated = false
      let webSearchSources: WebSearchSource[] = []
      const usedToolNames = new Set<string>()
      let liveToolCalls: LiveToolCall[] = []
      const createdAssistantMessageId = addMessage(activeThreadId, {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
      })
      assistantMessageId = createdAssistantMessageId

      const cwd = getEffectiveChatCwd(mergedForSend.next, workspaceDefaultPath)
      const updateLiveToolCall = (patch: LiveToolCallPatch) => {
        liveToolCalls = upsertLiveToolCall(liveToolCalls, patch)
        updateMessage(activeThreadId, createdAssistantMessageId, {
          liveToolCalls,
        })
      }

      await engineSendMessage(engineUserInput, cwd, (event) => {
        switch (event.type) {
          case 'text_delta': {
            rawAssistantMessage += event.text
            const presentation = resolveAssistantPresentation(rawAssistantMessage, {
              verboseMode,
              thinkingContent: rawThinkingMessage,
            })
            updateMessage(activeThreadId, createdAssistantMessageId, {
              content: presentation.content,
              thinkingContent: presentation.thinkingContent,
            })
            break
          }
          case 'thinking_delta':
            rawThinkingMessage += event.thinking
            updateMessage(activeThreadId, createdAssistantMessageId, {
              thinkingContent: rawThinkingMessage,
            })
            break
          case 'request_debug':
            if (userMessageId) {
              updateMessage(activeThreadId, userMessageId, {
                debugContent: `${promptWithAttachments}\n\n[OLLAMA REQUEST PREVIEW]\n${event.payload}`,
              })
            }
            if (requestPreviewMessageId) {
              updateMessage(activeThreadId, requestPreviewMessageId, {
                content: `Ollama Request Preview\n${event.payload}`,
              })
            } else {
              requestPreviewMessageId = addMessage(activeThreadId, {
                role: 'system',
                content: `Ollama Request Preview\n${event.payload}`,
                visibleInChat: true,
                timestamp: Date.now(),
              })
            }
            break
          case 'assistant_message': {
            const blocks = Array.isArray(event.message.content) ? event.message.content : []
            const textFromEvent = blocks
              .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
              .map((block) => block.text)
              .join('\n')
              .trim()
            const thinkingFromEvent = blocks
              .filter((block): block is { type: 'thinking'; thinking: string } => block.type === 'thinking')
              .map((block) => block.thinking)
              .join('\n\n')
              .trim()
            const toolUseBlocks = blocks
              .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
                block.type === 'tool_use'
                && typeof block.id === 'string'
                && typeof block.name === 'string'
                && typeof block.input === 'object'
                && block.input !== null,
              )

            if (!rawAssistantMessage && textFromEvent) {
              rawAssistantMessage = textFromEvent
            }
            if (!rawThinkingMessage && thinkingFromEvent) {
              rawThinkingMessage = thinkingFromEvent
            }
            for (const block of toolUseBlocks) {
              updateLiveToolCall({
                id: block.id,
                toolName: block.name,
                input: block.input,
                status: 'requested',
              })
            }

            const presentation = resolveAssistantPresentation(rawAssistantMessage, {
              verboseMode,
              thinkingContent: rawThinkingMessage,
            })
            updateMessage(activeThreadId, createdAssistantMessageId, {
              content: presentation.content,
              thinkingContent: presentation.thinkingContent,
            })
            break
          }
          case 'tool_call_delta':
            updateLiveToolCall({
              id: event.toolUseId,
              toolName: event.toolName,
              input: event.input,
              status: 'requested',
            })
            break
          case 'approval_required': {
            approvalSummary = `${event.request.toolName}: ${event.request.description}`
            setPendingApproval([approvalSummary])
            setBusy(false)
            updateLiveToolCall({
              id: findLiveToolCallId(liveToolCalls, event.request.toolName, event.request.input),
              toolName: event.request.toolName,
              input: event.request.input,
              status: 'approval',
              result: event.request.description,
            })

            if (!approvalTaskCreated) {
              const taskId = createTask(text, text.slice(0, 60), activeThreadId)
              const steps: TaskStep[] = [{
                id: `${taskId}-step-0`,
                index: 0,
                title: approvalSummary,
                state: 'pending',
                requiresApproval: true,
                riskLevel: event.request.riskLevel,
                output: null,
              }]
              setTaskSteps(taskId, steps)
              updateTaskStatus(taskId, 'waiting_approval')
              approvalTaskCreated = true
            }

            addLog({
              level: 'warn',
              area: 'llm',
              message: `Freigabe erforderlich: ${event.request.toolName}`,
              details: event.request,
            })
            break
          }
          case 'tool_use_start':
            usedToolNames.add(event.toolName)
            updateLiveToolCall({
              id: event.toolUseId,
              toolName: event.toolName,
              input: event.input,
              status: 'running',
            })
            addLog({
              level: 'info',
              area: 'llm',
              message: `Tool gestartet: ${event.toolName}`,
              details: { toolName: event.toolName, input: event.input },
            })
            break
          case 'tool_use_complete':
            usedToolNames.add(event.toolName)
            updateLiveToolCall({
              id: event.toolUseId,
              toolName: event.toolName,
              input: liveToolCalls.find((call) => call.id === event.toolUseId)?.input ?? {},
              status: event.result.trim().toLowerCase().startsWith('fehler:') ? 'failed' : 'completed',
              result: event.result,
              error: event.result.trim().toLowerCase().startsWith('fehler:') ? event.result : undefined,
              finishedAt: Date.now(),
            })
            if (event.toolName === 'WebSearch') {
              webSearchSources = mergeWebSearchSources(
                webSearchSources,
                parseWebSearchSourcesFromToolResult(event.result),
              )
            }
            addLog({
              level: 'info',
              area: 'llm',
              message: `Tool fertig: ${event.toolName}`,
              details: { toolName: event.toolName, result: event.result.slice(0, 500) },
            })
            break
          case 'error':
            engineErrorMessage = event.error
            addLog({ level: 'error', area: 'llm', message: event.error })
            break
        }
      }, {
        threadId: activeThreadId,
        messages: activeMessages.map((message) => ({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : '',
          debugContent: message.debugContent,
        })),
      })

      const fallbackText = engineErrorMessage
        ? `LLM-Anfrage fehlgeschlagen: ${engineErrorMessage}\n\nPrüfe unter Einstellungen den Ollama-Endpoint, das Modell und den Timeout.`
        : approvalSummary
          ? `Freigabe erforderlich: ${approvalSummary}`
          : usedToolNames.size > 0
            ? `Die Engine hat Tools verwendet (${Array.from(usedToolNames).join(', ')}), aber keinen sichtbaren Abschlusstext geliefert.`
            : 'Das Modell hat keine sichtbare Antwort geliefert. Bitte erneut versuchen oder Modell/Prompt prüfen.'
      const presentation = resolveAssistantPresentation(rawAssistantMessage, {
        verboseMode,
        thinkingContent: rawThinkingMessage,
        fallbackText,
      })
      const finalContent = appendWebSearchSources(presentation.content, webSearchSources)
      updateMessage(activeThreadId, createdAssistantMessageId, {
        content: finalContent,
        debugContent: presentation.debugContent,
        thinkingContent: presentation.thinkingContent,
        streaming: false,
      }, {
        persist: true,
      })
      addLog({
        level: 'info',
        area: 'llm',
        message: 'LLM-Anfrage erfolgreich',
        details: {
          endpoint: ollama.baseUrl,
          model: ollama.model,
          cwd,
          durationMs: Date.now() - started,
          responseChars: rawAssistantMessage.length,
          usedTools: Array.from(usedToolNames),
        },
      })
      if (superVerboseAuditLogging) {
        void writeAuditEvent('super_verbose', 'chat_llm_request_finished', {
          view: 'chat',
          threadId: activeThreadId,
          prompt: text,
          promptWithAttachments,
          assistantRawResponse: rawAssistantMessage,
          assistantVisibleResponse: presentation.content,
          endpoint: ollama.baseUrl,
          model: ollama.model,
          cwd,
          usedTools: Array.from(usedToolNames),
          approvalSummary,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog({
        level: 'error',
        area: 'llm',
        message: 'LLM-Anfrage fehlgeschlagen',
        details: {
          endpoint: ollama.baseUrl,
          model: ollama.model,
          timeoutMs: effectiveTimeoutMs,
          error: message,
          source: 'chat',
        },
      })
      if (superVerboseAuditLogging) {
        void writeAuditEvent('super_verbose', 'chat_llm_request_failed', {
          view: 'chat',
          threadId: activeThreadId,
          prompt: text,
          promptWithAttachments,
          error: message,
          ollama,
        })
      }
      const failureContent = `LLM-Anfrage fehlgeschlagen: ${message}\n\nPrüfe unter Einstellungen den Ollama-Endpoint, das Modell und den Timeout.`
      if (assistantMessageId) {
        updateMessage(activeThreadId, assistantMessageId, { content: failureContent, streaming: false }, { persist: true })
      } else {
        addMessage(activeThreadId, {
          role: 'assistant',
          content: failureContent,
          timestamp: Date.now(),
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const handleApprove = () => {
    if (approvalSteps.length === 0 || !activeThreadId) return
    setBusy(true)
    resolveEngineApproval({ allowed: true })
    addMessage(activeThreadId, {
      role: 'system',
      content: `Plan freigegeben: ${approvalSteps.join(' | ')}`,
      timestamp: Date.now(),
    })
    clearApproval()
  }

  const handleReject = () => {
    if (approvalSteps.length === 0 || !activeThreadId) return
    resolveEngineApproval({ allowed: false, reason: 'Vom Benutzer abgelehnt.' })
    addMessage(activeThreadId, {
      role: 'system',
      content: `Plan abgelehnt: ${approvalSteps.join(' | ')}`,
      timestamp: Date.now(),
    })
    clearApproval()
    setBusy(false)
  }

  const handleModelChange = (model: string) => {
    setOllama({ model })
    addLog({
      level: 'info',
      area: 'llm',
      message: 'Modell im Chat gewechselt',
      details: {
        previousModel: ollama.model,
        nextModel: model,
        endpoint: ollama.baseUrl,
      },
    })
  }

  const addNewAttachments = (newItems: ChatAttachment[]) => {
    if (newItems.length === 0) return
    setAttachments((prev) => {
      const merged = mergeAttachments(prev, newItems)
      if (merged.rejectedCount > 0) {
        setAttachmentNotice('Maximal 25 verbundene Elemente pro Nachricht erreicht.')
      } else {
        setAttachmentNotice(null)
      }
      return merged.next
    })
  }

  const handleAttachFiles = async () => {
    const selected = await open({
      directory: false,
      multiple: true,
      filters: [
        { name: 'Dokumente', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'rtf', 'csv'] },
        { name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    })
    const selectedPaths = normalizeDialogSelection(selected)
    addNewAttachments(selectedPaths.map((path) => ({ path, kind: 'file' })))
  }

  const handleInputPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (imageFiles.length === 0) {
      return
    }

    event.preventDefault()
    void Promise.all(imageFiles.map((file) => createInlineImageAttachment(file)))
      .then((inlineAttachments) => {
        addNewAttachments(inlineAttachments)
        setAttachmentNotice(null)
      })
      .catch(() => {
        setAttachmentNotice('Bild aus Zwischenablage konnte nicht gelesen werden.')
      })
  }

  const handleRemoveAttachment = (target: ChatAttachment) => {
    setAttachments((prev) => prev.filter((item) => !(item.path === target.path && item.kind === target.kind)))
    setAttachmentNotice(null)
  }

  if (!activeThread) return null

  return (
    <div className="chat-view">
      <div className="chat-log" ref={logRef}>
        {visibleMessages.map((msg, index) => {
          const content = typeof msg.content === 'string' ? msg.content : ''
          const { promptDebug, ollamaRequestPreview } = splitPromptDebugContent(msg.debugContent)
          const attachmentsForMessage = Array.isArray(msg.attachments) ? msg.attachments : []
          const imageAttachments = attachmentsForMessage.filter((item) => item.kind === 'file' && isImageAttachment(item))
          const displayedThinkingContent = resolveDisplayedThinkingContent(
            msg.thinkingContent,
            liveThinkingText,
            {
              streaming: msg.streaming,
              preferLive: msg.streaming && index === visibleMessages.length - 1,
            },
          )
          const displayedContent = resolveDisplayedAssistantContent(content, displayedThinkingContent)
          return (
          <div key={`${msg.timestamp}-${index}`} className={`cowork-msg ${msg.role}`}>
            <div className="msg-avatar">
              {msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '✦' : '⚙️'}
            </div>
            <div className="msg-body">
              <div className="msg-role">
                {msg.role === 'user' ? 'Du' : msg.role === 'assistant' ? 'Open_Cowork' : 'System'}
              </div>
              <div className="msg-content">
                {displayedContent ? <HighlightedChatText content={displayedContent} /> : null}
              </div>
              <MessageThinking
                content={displayedThinkingContent}
                limitToRollingWindow={limitThinkingWindow}
                streaming={msg.streaming}
              />
              <LiveToolCalls calls={msg.liveToolCalls} />
              {verboseMode && (
                <MessageVerbose
                  content={msg.verboseContent}
                  limitToRollingWindow={limitThinkingWindow}
                />
              )}
              {attachmentsForMessage.length > 0 && (
                <>
                  {imageAttachments.length > 0 && (
                    <div className="message-attachment-previews">
                      {imageAttachments.map((item) => (
                        <div key={`preview-${item.kind}-${item.path}`} className="message-attachment-preview" title={item.label ?? item.path}>
                          <img
                            src={getAttachmentPreviewSrcForAttachment(item)}
                            alt={getAttachmentDisplayName(item)}
                            className="message-attachment-image"
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="message-attachments">
                    {attachmentsForMessage.map((item) => (
                      <span key={`${item.kind}-${item.path}`} className="message-attachment-chip" title={item.label ?? item.path}>
                        {item.kind === 'folder' ? '📁' : isImageAttachment(item) ? '🖼️' : '📄'} {getAttachmentDisplayName(item)}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {ollamaRequestPreview && (
                <details className="message-debug">
                  <summary>Ollama Request Preview</summary>
                  <pre>{ollamaRequestPreview}</pre>
                </details>
              )}
              {verboseMode && promptDebug && promptDebug !== content && (
                <details className="message-debug">
                  <summary>Verbose: interner Prompt</summary>
                  <pre>{promptDebug}</pre>
                </details>
              )}
            </div>
          </div>
          )
        })}
        {busy && !activeMessages.some((msg) => msg.streaming) && (
          <div className="cowork-msg assistant">
            <div className="msg-avatar">✦</div>
            <div className="msg-body">
              <div className="msg-role">Open_Cowork</div>
              <div className="msg-content typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}
      </div>

      {approvalSteps.length > 0 && (
        <div className="approval-banner">
          <div className="approval-header">
            <span className="approval-icon">⚠️</span>
            <span>Diese Schritte erfordern deine Freigabe:</span>
          </div>
          <ol className="approval-steps">
            {approvalSteps.map((step, idx) => (
              <li key={`${step}-${idx}`}>{step}</li>
            ))}
          </ol>
          <div className="approval-actions">
            <button type="button" className="btn-approve" onClick={handleApprove} disabled={busy}>
              ✓ Freigeben
            </button>
            <button type="button" className="btn-reject" onClick={handleReject} disabled={busy}>
              ✗ Ablehnen
            </button>
          </div>
        </div>
      )}

      {error && <p className="error cowork-error">{error}</p>}

      <form className="cowork-input" onSubmit={handleSend}>
        <div className="chat-input-toolbar">
          <label>
            Modell
            <select
              className="model-selector chat-model-selector"
              value={ollama.model}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={busy}
            >
              {selectableModels.length > 0 ? (
                selectableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              ) : (
                <option value={ollama.model}>{ollama.model}</option>
              )}
              {selectableModels.length > 0 && !selectableModels.includes(ollama.model) && (
                <option value={ollama.model}>{ollama.model}</option>
              )}
            </select>
            <p
              className="hint-text"
              style={{
                marginTop: 6,
                maxWidth: 460,
                color: (modelNotice || !selectedModelAvailable) ? 'var(--danger)' : 'var(--text-muted)',
              }}
            >
              {modelNotice
                ?? `Endpoint: ${ollama.baseUrl} | Modellfamilie: ${modelCapabilities.family} | ${modelCapabilities.supportsTools ? 'Tool-Calls aktiviert' : 'Tool-Calls deaktiviert'}`}
            </p>
          </label>
          <div className="attachment-actions">
            <button type="button" className="btn-attach" onClick={handleAttachFiles} disabled={busy}>
              Datei/Bild
            </button>
          </div>
        </div>

        <div className="chat-input-main">
          {attachments.length > 0 && (
            <div className="attachment-list" aria-label="Verbundene Elemente">
              {attachments.map((item) => (
                  <span key={`${item.kind}-${item.path}`} className="attachment-chip" title={item.label ?? item.path}>
                  <span className="attachment-chip-label">
                      {item.kind === 'folder' ? 'Ordner' : isImageAttachment(item) ? 'Bild' : 'Datei'}: {getAttachmentDisplayName(item)}
                  </span>
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => handleRemoveAttachment(item)}
                      aria-label={`Anhang entfernen: ${getAttachmentDisplayName(item)}`}
                    disabled={busy}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {attachmentNotice && <p className="attachment-notice">{attachmentNotice}</p>}

          {slashSuggestions.length > 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, right: 0,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', marginBottom: 4, maxHeight: 200, overflow: 'auto',
              zIndex: 10,
            }}>
              {slashSuggestions.map(cmd => {
                const full = registryCommands.find(c => c.command === cmd)
                return (
                  <button key={cmd} type="button" style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--text-primary)', fontSize: 13,
                  }}
                  onClick={() => {
                    if (inputRef.current) inputRef.current.value = cmd + ' '
                    setSlashSuggestions([])
                    inputRef.current?.focus()
                  }}>
                    <span style={{ color: 'var(--accent)', fontFamily: 'monospace', marginRight: 8 }}>{cmd}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{full?.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          <textarea
            ref={inputRef}
            rows={2}
            placeholder="Nachricht senden oder /command..."
            disabled={busy}
            onChange={(e) => handleInputChange(e.target.value)}
            onPaste={handleInputPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend(e)
              }
            }}
          />
        </div>

        <button type="submit" disabled={busy} className="btn-send">
          {busy ? '⟳' : 'Senden →'}
        </button>
      </form>
    </div>
  )
}
