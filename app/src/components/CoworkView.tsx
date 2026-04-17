import { useRef, useEffect, useMemo, useState } from 'react'
import type { ClipboardEvent, DragEvent, FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useChatStore, getActiveThread } from '../stores/chatStore'
import { useConfigStore } from '../stores/configStore'
import { useTaskStore } from '../stores/taskStore'
import { useLogStore } from '../stores/logStore'
import { useCoworkStore, type ClaudePermissionMode } from '../stores/coworkStore'
import type { TaskStep } from '../stores/taskStore'
import {
  extractFileAttachmentsFromFileList,
  extractFileAttachmentsFromUriList,
  getPathName,
  mergeAttachments,
  normalizeDialogSelection,
  type ChatAttachment,
} from '../utils/chatAttachments'
import { buildAttachmentPromptContext } from '../utils/attachmentPromptContext'
import {
  buildClaudeSystemAddendum,
  buildSlashHelpText,
  compactHistoryForPrompt,
  isToolDeniedByRules,
  parseSlashCommand,
} from '../utils/claudeBridge'

type ChatTurnResponse = {
  endpoint: string
  model: string
  assistantMessage: string
  requiresApproval: boolean
  proposedPlan: string[]
}

type SubAgentItemResult = {
  path: string
  success: boolean
  summary: string
  charsProcessed: number
  durationMs: number
  error: string | null
}

type SubAgentRunResponse = {
  prompt: string
  parallelism: number
  totalItems: number
  successfulItems: number
  failedItems: number
  durationMs: number
  results: SubAgentItemResult[]
}

type WebFetchResponse = {
  url: string
  status: number
  ok: boolean
  title: string | null
  content: string
  truncated: boolean
}

type McpCallResponse = {
  serverName: string
  toolName: string
  success: boolean
  result: string
  error: string | null
}

type EnabledPluginSkill = {
  pluginName: string
  skillName: string
  command: string
  promptTemplate: string
  runMode: 'plan' | 'execute'
}

const VALID_PERMISSION_MODES: ClaudePermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'dontAsk',
  'plan',
]

export default function CoworkView() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const [dragOverInput, setDragOverInput] = useState(false)
  const [subAgentBusy, setSubAgentBusy] = useState(false)
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const setOllama = useConfigStore((s) => s.setOllama)
  const mcpServer = useConfigStore((s) => s.mcpServer)
  const showTimestamps = useConfigStore((s) => s.preferences.showTimestamps)
  const compactMode = useConfigStore((s) => s.preferences.compactMode)
  const {
    activeThreadId,
    pendingApproval,
    busy,
    error,
    addThread,
    setActiveThread,
    addMessage,
    setPendingApproval,
    clearApproval,
    setBusy,
    setError,
  } = useChatStore()

  const { createTask, updateTaskStatus, setTaskSteps } = useTaskStore()
  const tasks = useTaskStore((s) => s.tasks)
  const addLog = useLogStore((s) => s.addLog)
  const globalInstruction = useCoworkStore((s) => s.globalInstruction)
  const claudePlanMode = useCoworkStore((s) => s.claudePlanMode)
  const claudePermissionMode = useCoworkStore((s) => s.claudePermissionMode)
  const enabledClaudeToolIds = useCoworkStore((s) => s.enabledClaudeToolIds)
  const setClaudePlanMode = useCoworkStore((s) => s.setClaudePlanMode)
  const setClaudePermissionMode = useCoworkStore((s) => s.setClaudePermissionMode)
  const toolDenyRules = useCoworkStore((s) => s.toolDenyRules)
  const policyFlags = useCoworkStore((s) => s.policyFlags)
  const plugins = useCoworkStore((s) => s.plugins)
  const activeThread = useChatStore(getActiveThread)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const enabledPluginSkills = useMemo<EnabledPluginSkill[]>(() => {
    return plugins
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) =>
        plugin.skills.map((skill) => ({
          pluginName: plugin.name,
          skillName: skill.name,
          command: skill.command.trim().toLowerCase(),
          promptTemplate: skill.promptTemplate,
          runMode: skill.runMode,
        }))
      )
      .filter((skill) => skill.command.startsWith('/'))
  }, [plugins])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [activeThread?.messages.length])

  useEffect(() => {
    const node = logRef.current
    if (!node) return

    const onScroll = () => {
      const threshold = 80
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= threshold
      setShowScrollToBottom(!atBottom)
    }

    node.addEventListener('scroll', onScroll)
    onScroll()
    return () => node.removeEventListener('scroll', onScroll)
  }, [activeThreadId])

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

  const handleAttachFolders = async () => {
    const selected = await open({
      directory: true,
      multiple: true,
    })
    const selectedPaths = normalizeDialogSelection(selected)
    addNewAttachments(selectedPaths.map((path) => ({ path, kind: 'folder' })))
  }

  const handleRemoveAttachment = (target: ChatAttachment) => {
    setAttachments((prev) => prev.filter((item) => !(item.path === target.path && item.kind === target.kind)))
    setAttachmentNotice(null)
  }

  const handleInputDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    if (!dragOverInput) setDragOverInput(true)
  }

  const handleInputDragLeave = () => {
    if (dragOverInput) setDragOverInput(false)
  }

  const handleInputDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    setDragOverInput(false)

    const fromFiles = extractFileAttachmentsFromFileList(event.dataTransfer.files)
    const fromUriList = extractFileAttachmentsFromUriList(
      event.dataTransfer.getData('text/uri-list') || ''
    )
    const droppedItems = [...fromFiles, ...fromUriList]

    if (droppedItems.length > 0) {
      addNewAttachments(droppedItems)
      setAttachmentNotice(null)
      return
    }

    setAttachmentNotice('Drop erkannt, aber kein lokaler Dateipfad gefunden. Bitte Dateien ueber den Button auswaehlen.')
  }

  const handleInputPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const fromFiles = extractFileAttachmentsFromFileList(event.clipboardData.files)
    const fromUriList = extractFileAttachmentsFromUriList(
      event.clipboardData.getData('text/uri-list') || ''
    )
    const pastedItems = [...fromFiles, ...fromUriList]

    if (pastedItems.length === 0) {
      const hasImageData = Array.from(event.clipboardData.items).some((item) =>
        item.type.startsWith('image/')
      )
      if (hasImageData) {
        setAttachmentNotice('Bild aus Zwischenablage erkannt, aber ohne Dateipfad. Bitte als Datei speichern oder per Datei/Bild-Button anhaengen.')
      }
      return
    }

    event.preventDefault()
    addNewAttachments(pastedItems)
    setAttachmentNotice(null)
  }

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const text = inputRef.current?.value?.trim()
    if (!text || busy) return

    setPromptHistory((prev) => {
      const deduped = [text, ...prev.filter((entry) => entry !== text)]
      return deduped.slice(0, 30)
    })
    setHistoryIndex(-1)

    let threadId = activeThreadId
    if (!threadId) {
      threadId = addThread(text.slice(0, 50))
      setActiveThread(threadId)
    }

    const slash = parseSlashCommand(text)

    const parseArgs = (value: string): string[] => {
      const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
      return matches.map((part) => part.replace(/^["']|["']$/g, ''))
    }

    const validateToolPolicy = (toolId: string, target: string | null): string | null => {
      if (policyFlags.strictPolicyEnforcement && !enabledClaudeToolIds.includes(toolId)) {
        return `Tool ${toolId} ist im aktuellen Profil deaktiviert.`
      }

      if (policyFlags.strictPolicyEnforcement && isToolDeniedByRules(toolId, target, toolDenyRules)) {
        return `Tool-Aufruf durch deny-rule blockiert (${toolId}).`
      }

      if (toolId === 'web_fetch' && !policyFlags.allowWebFetch) {
        return 'Web Fetch ist per Policy deaktiviert.'
      }

      if (toolId === 'read_file' && !policyFlags.allowFileReadExtraction) {
        return 'Dateiextraktion ist per Policy deaktiviert.'
      }

      if (toolId === 'mcp' && !policyFlags.allowMcpToolCalls) {
        return 'MCP Tool Calls sind per Policy deaktiviert.'
      }

      return null
    }

    const appendAssistantMessage = (content: string) => {
      addMessage(threadId, {
        role: 'assistant',
        content,
        timestamp: Date.now(),
      })
    }

    const normalizeSlashCommand = (command: string): string => {
      const trimmed = command.trim().toLowerCase()
      if (!trimmed) return ''
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    }

    const renderSkillPrompt = (
      template: string,
      input: string,
      skill: EnabledPluginSkill,
    ): string => {
      const effectiveTemplate = template.trim() || 'Bearbeite diese Aufgabe: {{input}}'
      return effectiveTemplate
        .replace(/{{\s*input\s*}}/gi, input)
        .replace(/{{\s*skill_name\s*}}/gi, skill.skillName)
        .replace(/{{\s*plugin_name\s*}}/gi, skill.pluginName)
    }

    let skillPromptOverride: string | null = null
    let skillPlanMode = false
    let skillInvocationActive = false

    if (slash) {
      addMessage(threadId, { role: 'user', content: text, timestamp: Date.now() })
      if (inputRef.current) inputRef.current.value = ''

      if (slash.command === 'help') {
        appendAssistantMessage(
          buildSlashHelpText(
            enabledPluginSkills.map((skill) => `${skill.command} - ${skill.skillName} (${skill.pluginName})`)
          )
        )
        return
      }

      if (slash.command === 'tools') {
        appendAssistantMessage(
          [
            `Permission-Modus: ${claudePermissionMode}`,
            `Plan-Mode: ${claudePlanMode ? 'aktiv' : 'inaktiv'}`,
            `Aktive Tools: ${enabledClaudeToolIds.join(', ') || '(keine)'}`,
            `Deny-Rules: ${toolDenyRules.length}`,
            `Flags: dispatcher=${policyFlags.allowToolDispatcher}, mcp=${policyFlags.allowMcpToolCalls}, web=${policyFlags.allowWebFetch}, read=${policyFlags.allowFileReadExtraction}, compact=${policyFlags.autoCompactLongContext}`,
          ].join('\n')
        )
        return
      }

      if (slash.command === 'todo') {
        const args = parseArgs(slash.args)
        if (args.length === 0 || args[0].toLowerCase() === 'list') {
          const lines = tasks.slice(0, 12).map((task, index) => `${index + 1}. [${task.status}] ${task.title}`)
          appendAssistantMessage(lines.length > 0 ? lines.join('\n') : 'Keine offenen Todos/Tasks vorhanden.')
          return
        }

        if (args[0].toLowerCase() === 'add') {
          const title = args.slice(1).join(' ').trim()
          if (!title) {
            appendAssistantMessage('Bitte Titel angeben: /todo add <titel>')
            return
          }
          createTask(title, title.slice(0, 80), threadId)
          appendAssistantMessage(`Todo erstellt: ${title}`)
          return
        }

        appendAssistantMessage('Ungueltiger /todo Befehl. Nutze /todo list oder /todo add <titel>.')
        return
      }

      if (slash.command === 'tool') {
        if (!policyFlags.allowToolDispatcher) {
          appendAssistantMessage('Tool Dispatcher ist per Policy deaktiviert.')
          return
        }

        const args = parseArgs(slash.args)
        const toolName = (args[0] ?? '').toLowerCase()
        const rest = args.slice(1)

        if (!toolName) {
          appendAssistantMessage('Bitte Tool angeben: /tool <read_file|web_fetch|mcp_call> <args>')
          return
        }

        if (toolName === 'read_file') {
          const targetPath = rest.join(' ').trim()
          if (!targetPath) {
            appendAssistantMessage('Bitte Dateipfad angeben: /tool read_file C:\\pfad\\datei.txt')
            return
          }
          const violation = validateToolPolicy('read_file', targetPath)
          if (violation) {
            appendAssistantMessage(violation)
            return
          }

          setBusy(true)
          try {
            const textOut = await invoke<string>('fs_extract_text', { path: targetPath })
            appendAssistantMessage(`Datei gelesen: ${targetPath}\n\n${textOut.slice(0, 5000)}`)
          } catch (err) {
            appendAssistantMessage(`read_file fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            setBusy(false)
          }
          return
        }

        if (toolName === 'web_fetch') {
          const url = rest.join(' ').trim()
          if (!url) {
            appendAssistantMessage('Bitte URL angeben: /tool web_fetch https://example.com')
            return
          }
          const violation = validateToolPolicy('web_fetch', url)
          if (violation) {
            appendAssistantMessage(violation)
            return
          }

          setBusy(true)
          try {
            const response = await invoke<WebFetchResponse>('web_fetch_url', {
              request: { url, maxChars: 4000 },
            })
            appendAssistantMessage([
              `Web-Fetch: ${response.url}`,
              `Status: ${response.status}`,
              response.title ? `Titel: ${response.title}` : null,
              '',
              response.content,
            ].filter(Boolean).join('\n'))
          } catch (err) {
            appendAssistantMessage(`web_fetch fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            setBusy(false)
          }
          return
        }

        if (toolName === 'mcp_call') {
          const mcpToolName = rest[0]
          if (!mcpToolName) {
            appendAssistantMessage('Bitte MCP Toolnamen angeben: /tool mcp_call <toolName> {"arg":"value"}')
            return
          }

          const violation = validateToolPolicy('mcp', mcpToolName)
          if (violation) {
            appendAssistantMessage(violation)
            return
          }

          const jsonRaw = rest.slice(1).join(' ').trim()
          let parsedArgs: Record<string, unknown> = {}
          if (jsonRaw) {
            try {
              parsedArgs = JSON.parse(jsonRaw) as Record<string, unknown>
            } catch {
              appendAssistantMessage('MCP Args muessen gueltiges JSON sein.')
              return
            }
          }

          setBusy(true)
          try {
            const response = await invoke<McpCallResponse>('mcp_call_tool', {
              request: {
                name: mcpServer.name,
                command: mcpServer.command,
                args: parseArgs(mcpServer.args),
                env: mcpServer.env,
                toolName: mcpToolName,
                toolArgs: parsedArgs,
              },
            })
            appendAssistantMessage(
              response.success
                ? `MCP ${response.toolName} erfolgreich:\n\n${response.result}`
                : `MCP ${response.toolName} Fehler: ${response.error ?? response.result}`
            )
          } catch (err) {
            appendAssistantMessage(`mcp_call fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            setBusy(false)
          }
          return
        }

        appendAssistantMessage(`Unbekanntes Tool: ${toolName}. Erlaubt: read_file, web_fetch, mcp_call`)
        return
      }

      if (slash.command === 'mode') {
        const target = slash.args.toLowerCase()
        if (target === 'plan') {
          setClaudePlanMode(true)
          appendAssistantMessage('Plan-Mode aktiviert.')
        } else if (target === 'execute') {
          setClaudePlanMode(false)
          appendAssistantMessage('Plan-Mode deaktiviert (Execute).')
        } else {
          appendAssistantMessage('Ungueltiger Modus. Verwende: /mode plan oder /mode execute')
        }
        return
      }

      if (slash.command === 'permissions') {
        const target = slash.args as ClaudePermissionMode
        if (VALID_PERMISSION_MODES.includes(target)) {
          setClaudePermissionMode(target)
          appendAssistantMessage(`Permission-Modus gesetzt: ${target}`)
        } else {
          appendAssistantMessage('Ungueltiger Permission-Modus. Erlaubt: default, acceptEdits, bypassPermissions, dontAsk, plan')
        }
        return
      }

      if (slash.command === 'fetch') {
        if (!slash.args) {
          appendAssistantMessage('Bitte URL angeben: /fetch https://example.com')
          return
        }

        const violation = validateToolPolicy('web_fetch', slash.args)
        if (violation) {
          appendAssistantMessage(violation)
          return
        }

        setBusy(true)
        setError(null)
        try {
          const response = await invoke<WebFetchResponse>('web_fetch_url', {
            request: {
              url: slash.args,
              maxChars: 4000,
            },
          })

          appendAssistantMessage(
            [
              `Web-Fetch: ${response.url}`,
              `Status: ${response.status}`,
              response.title ? `Titel: ${response.title}` : null,
              '',
              response.content,
              response.truncated ? '\n[Ausgabe gekuerzt]' : null,
            ]
              .filter(Boolean)
              .join('\n')
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          setError(message)
          appendAssistantMessage(`Web-Fetch fehlgeschlagen: ${message}`)
        } finally {
          setBusy(false)
        }
        return
      }

      const normalizedSlashCommand = normalizeSlashCommand(slash.command)
      const matchedSkill = enabledPluginSkills.find(
        (skill) => normalizeSlashCommand(skill.command) === normalizedSlashCommand
      )

      if (matchedSkill) {
        skillPromptOverride = renderSkillPrompt(matchedSkill.promptTemplate, slash.args, matchedSkill)
        skillPlanMode = matchedSkill.runMode === 'plan'
        skillInvocationActive = true
      } else if (slash.command !== 'plan') {
        appendAssistantMessage(
          `Unbekannter Slash-Command: /${slash.command}. Nutze /help fuer verfuegbare Befehle.`
        )
        return
      }
    }

    const attachmentBuild = await buildAttachmentPromptContext(attachments)
    const attachmentContext = attachmentBuild.context
    const rawPrompt = skillPromptOverride ?? (slash?.command === 'plan' ? slash.args : text)
    const shouldRunInPlanMode = slash?.command === 'plan' || skillPlanMode || claudePlanMode
    const planWrappedPrompt = shouldRunInPlanMode
      ? `Erzeuge nur einen klaren, nummerierten Plan in Deutsch. Fuehre nichts aus.\n\nAufgabe:\n${rawPrompt}`
      : rawPrompt
    const systemAddendum = buildClaudeSystemAddendum({
      globalInstruction,
      planMode: shouldRunInPlanMode,
      permissionMode: claudePermissionMode,
      enabledTools: enabledClaudeToolIds,
    })
    const basePrompt = attachmentContext ? `${planWrappedPrompt}\n\n${attachmentContext}` : planWrappedPrompt
    const promptWithAttachments = systemAddendum ? `${systemAddendum}\n\n${basePrompt}` : basePrompt
    const userMessage = { role: 'user' as const, content: promptWithAttachments, timestamp: Date.now() }
    const history = (activeThread?.messages ?? [])
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const compactedHistory = policyFlags.autoCompactLongContext
      ? compactHistoryForPrompt(history, 12)
      : { compacted: history.slice(-12), droppedCount: 0 }

    if (!slash) {
      addMessage(threadId, userMessage)
    }
    if (inputRef.current) inputRef.current.value = ''
    setAttachments([])
    setAttachmentNotice(null)
    setBusy(true)
    setError(null)

    try {
      const started = Date.now()
      addLog({
        level: 'info',
        area: 'llm',
        message: 'LLM-Anfrage gestartet',
        details: {
          endpoint: ollama.baseUrl,
          model: ollama.model,
          timeoutMs: ollama.timeoutMs,
          historyItems: history.length,
          compactedHistoryItems: compactedHistory.compacted.length,
          compactedDroppedItems: compactedHistory.droppedCount,
          promptChars: promptWithAttachments.length,
          parsedAttachments: attachmentBuild.parsedFiles,
          failedAttachments: attachmentBuild.failedFiles.length,
          source: skillInvocationActive ? 'chat_skill' : 'chat',
        },
      })
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
      const response = await invoke<ChatTurnResponse>('chat_turn', {
        request: {
          prompt: promptWithAttachments,
          history: compactedHistory.compacted,
          config: ollama,
        },
      })

      addMessage(threadId, {
        role: 'assistant',
        content: response.assistantMessage,
        timestamp: Date.now(),
      })
      addLog({
        level: 'info',
        area: 'llm',
        message: 'LLM-Anfrage erfolgreich',
        details: {
          endpoint: response.endpoint,
          model: response.model,
          durationMs: Date.now() - started,
          responseChars: response.assistantMessage.length,
        },
      })

      if (response.requiresApproval) {
        setPendingApproval(response.proposedPlan)
        const taskId = createTask(text, text.slice(0, 60), threadId)
        const steps: TaskStep[] = response.proposedPlan.map((title, i) => ({
          id: `${taskId}-step-${i}`,
          index: i,
          title,
          state: 'pending',
          requiresApproval: true,
          riskLevel: 'medium',
          output: null,
        }))
        setTaskSteps(taskId, steps)
        updateTaskStatus(taskId, 'waiting_approval')
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
          timeoutMs: ollama.timeoutMs,
          error: message,
          source: 'chat',
        },
      })
      addMessage(threadId, {
        role: 'assistant',
        content: `LLM-Anfrage fehlgeschlagen: ${message}\n\nPrüfe unter Einstellungen den Ollama-Endpoint, das Modell und den Timeout.`,
        timestamp: Date.now(),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleRunSubAgents = async () => {
    if (busy || subAgentBusy) return
    const filePaths = attachments
      .filter((item) => item.kind === 'file')
      .map((item) => item.path)

    if (filePaths.length === 0) {
      setAttachmentNotice('Fuer Sub-Agents bitte zuerst Dateien anhaengen.')
      return
    }

    let threadId = activeThreadId
    if (!threadId) {
      threadId = addThread('Sub-Agent Lauf')
      setActiveThread(threadId)
    }

    setSubAgentBusy(true)
    setError(null)

    try {
      const response = await invoke<SubAgentRunResponse>('task_run_sub_agents', {
        request: {
          prompt: 'Parallele Dateianalyse',
          paths: filePaths,
          parallelism: Math.min(8, Math.max(2, Math.floor(filePaths.length / 3))),
        },
      })

      const summaryLines = [
        `Sub-Agent Lauf abgeschlossen (${response.totalItems} Elemente, ${response.successfulItems} OK, ${response.failedItems} Fehler, ${response.durationMs} ms).`,
        ...response.results.slice(0, 12).map((item) => `- ${getPathName(item.path)}: ${item.summary}`),
      ]

      addMessage(threadId, {
        role: 'assistant',
        content: summaryLines.join('\n'),
        timestamp: Date.now(),
      })

      const taskId = createTask('Sub-Agent Batch Analyse', 'Sub-Agent Batch Analyse', threadId)
      const steps: TaskStep[] = response.results.map((result, index) => ({
        id: `${taskId}-sub-${index}`,
        index,
        title: getPathName(result.path),
        state: result.success ? 'completed' : 'failed',
        requiresApproval: false,
        riskLevel: result.success ? 'low' : 'medium',
        output: result.error ?? result.summary,
      }))
      setTaskSteps(taskId, steps)
      updateTaskStatus(taskId, response.failedItems > 0 ? 'failed' : 'completed')

      addLog({
        level: response.failedItems > 0 ? 'warn' : 'info',
        area: 'task_engine',
        message: 'Sub-Agent Lauf beendet',
        details: {
          totalItems: response.totalItems,
          successfulItems: response.successfulItems,
          failedItems: response.failedItems,
          parallelism: response.parallelism,
          durationMs: response.durationMs,
        },
      })

      setAttachments([])
      setAttachmentNotice(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog({
        level: 'error',
        area: 'task_engine',
        message: 'Sub-Agent Lauf fehlgeschlagen',
        details: { error: message, itemCount: filePaths.length },
      })
    } finally {
      setSubAgentBusy(false)
    }
  }

  const handleApprove = () => {
    if (pendingApproval.length === 0 || !activeThreadId) return
    addMessage(activeThreadId, {
      role: 'system',
      content: `Plan freigegeben: ${pendingApproval.join(' | ')}`,
      timestamp: Date.now(),
    })
    clearApproval()
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

  if (!activeThread) {
    return null // WelcomeScreen handles the empty state
  }

  const quickPrompts = [
    'Erstelle einen klaren 5-Schritte-Plan fuer die aktuelle Aufgabe.',
    'Analysiere die letzten Aenderungen und nenne Risiken.',
    'Formuliere die naechsten konkreten ToDos mit Prioritaet.',
  ]

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

  const applyPromptToInput = (content: string) => {
    if (!inputRef.current) return
    inputRef.current.value = content
    inputRef.current.focus()
  }

  const scrollMessagesToBottom = () => {
    if (!logRef.current) return
    logRef.current.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className={`cowork-view ${compactMode ? 'compact-mode' : ''}`}>
      {/* Chat Pane */}
      <div className="cowork-pane">
        <div className="cowork-messages" ref={logRef}>
          {activeThread.messages
            .filter((m) => m.role !== 'system')
            .map((msg, index) => (
              <div key={`${msg.timestamp}-${index}`} className={`cowork-msg ${msg.role}`}>
                <div className="msg-avatar">
                  {msg.role === 'user' ? '👤' : '✦'}
                </div>
                <div className="msg-body">
                  <div className="msg-role">
                    {msg.role === 'user' ? 'Du' : 'Open_Cowork'}
                    {showTimestamps && <span className="msg-time">{formatTime(msg.timestamp)}</span>}
                  </div>
                  <div className="msg-content">{msg.content}</div>
                  <div className="msg-actions">
                    <button type="button" className="btn-msg-action" onClick={() => void navigator.clipboard.writeText(msg.content)}>
                      Kopieren
                    </button>
                    <button type="button" className="btn-msg-action" onClick={() => applyPromptToInput(msg.content)}>
                      Wiederverwenden
                    </button>
                  </div>
                </div>
              </div>
            ))}
          {busy && (
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

        {showScrollToBottom && (
          <button type="button" className="btn-scroll-bottom" onClick={scrollMessagesToBottom}>
            Neue Nachrichten ▾
          </button>
        )}

        {pendingApproval.length > 0 && (
          <div className="approval-banner">
            <div className="approval-header">
              <span className="approval-icon">⚠️</span>
              <span>Diese Schritte erfordern deine Freigabe:</span>
            </div>
            <ol className="approval-steps">
              {pendingApproval.map((step, idx) => (
                <li key={`${step}-${idx}`}>{step}</li>
              ))}
            </ol>
            <div className="approval-actions">
              <button type="button" className="btn-approve" onClick={handleApprove} disabled={busy}>
                ✓ Freigeben
              </button>
              <button type="button" className="btn-reject" onClick={clearApproval} disabled={busy}>
                ✗ Ablehnen
              </button>
            </div>
          </div>
        )}

        {error && <p className="error cowork-error">{error}</p>}

        <div className="quick-prompts">
          {quickPrompts.map((prompt) => (
            <button key={prompt} type="button" className="quick-prompt-btn" onClick={() => applyPromptToInput(prompt)}>
              {prompt}
            </button>
          ))}
        </div>

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
                {availableModels.length > 0 ? (
                  availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                ) : (
                  <option value={ollama.model}>{ollama.model}</option>
                )}
              </select>
            </label>
            <div className="attachment-actions">
              <button type="button" className="btn-attach" onClick={handleAttachFiles} disabled={busy}>
                Dateien
              </button>
              <button type="button" className="btn-attach" onClick={handleAttachFolders} disabled={busy}>
                Ordner
              </button>
              <button type="button" className="btn-attach" onClick={handleRunSubAgents} disabled={busy || subAgentBusy}>
                {subAgentBusy ? 'Sub-Agents laufen...' : 'Sub-Agents starten'}
              </button>
            </div>
          </div>
          <div className="chat-input-main">
            {attachments.length > 0 && (
              <div className="attachment-list" aria-label="Verbundene Elemente">
                {attachments.map((item) => (
                  <span key={`${item.kind}-${item.path}`} className="attachment-chip" title={item.path}>
                    <span className="attachment-chip-label">
                      {item.kind === 'folder' ? 'Ordner' : 'Datei'}: {getPathName(item.path)}
                    </span>
                    <button
                      type="button"
                      className="attachment-remove"
                      onClick={() => handleRemoveAttachment(item)}
                      aria-label={`Anhang entfernen: ${item.path}`}
                      disabled={busy}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {attachmentNotice && <p className="attachment-notice">{attachmentNotice}</p>}
            <textarea
              ref={inputRef}
              rows={2}
              placeholder="Nächste Anweisung..."
              disabled={busy}
              className={dragOverInput ? 'input-drop-active' : ''}
              onDragOver={handleInputDragOver}
              onDragLeave={handleInputDragLeave}
              onDrop={handleInputDrop}
              onPaste={handleInputPaste}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' && !e.shiftKey && (e.currentTarget.value.trim() === '' || e.currentTarget.selectionStart === 0)) {
                  e.preventDefault()
                  if (promptHistory.length === 0) return
                  const next = Math.min(historyIndex + 1, promptHistory.length - 1)
                  setHistoryIndex(next)
                  e.currentTarget.value = promptHistory[next]
                  e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)
                  return
                }

                if (e.key === 'ArrowDown' && historyIndex >= 0) {
                  e.preventDefault()
                  const next = historyIndex - 1
                  setHistoryIndex(next)
                  e.currentTarget.value = next >= 0 ? promptHistory[next] : ''
                  e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)
                  return
                }

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
    </div>
  )
}
