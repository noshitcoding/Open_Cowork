import { useRef, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useChatStore, getActiveThread } from '../stores/chatStore'
import { useConfigStore } from '../stores/configStore'
import { useTaskStore } from '../stores/taskStore'
import { useLogStore } from '../stores/logStore'
import type { TaskStep } from '../stores/taskStore'
import {
  getPathName,
  mergeAttachments,
  normalizeDialogSelection,
  type ChatAttachment,
} from '../utils/chatAttachments'
import { buildAttachmentPromptContext } from '../utils/attachmentPromptContext'
import { compactHistoryForPrompt } from '../utils/claudeBridge'
import { resolveAssistantPresentation } from '../utils/messageDisplay'
import { streamChatTurn } from '../utils/ollamaStreaming'
import { MessageThinking, MessageVerbose, StreamingPlaceholder } from './MessageThinking'
import { HighlightedChatText } from './HighlightedChatText'
import { writeAuditEvent } from '../utils/audit'
import { buildSystemPromptFromPersonality } from '../utils/defaultSeeds'
import { useCommandRegistry } from '../stores/commandRegistryStore'
import { usePersonalityStore } from '../stores/personalityStore'
import { useCoworkStore } from '../stores/coworkStore'
import { useMemoryStore } from '../stores/memoryStore'

export default function ChatView() {
  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const verboseMode = useConfigStore((s) => s.preferences.verboseMode)
  const limitThinkingWindow = useConfigStore((s) => s.preferences.limitThinkingWindow)
  const superVerboseAuditLogging = useConfigStore((s) => s.preferences.superVerboseAuditLogging)
  const setOllama = useConfigStore((s) => s.setOllama)
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
  const selectableModels = Array.isArray(availableModels) ? availableModels : []
  const approvalSteps = Array.isArray(pendingApproval) ? pendingApproval : []
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const [slashSuggestions, setSlashSuggestions] = useState<string[]>([])

  const personalities = usePersonalityStore((s) => s.personalities)
  const globalInstruction = useCoworkStore((s) => s.globalInstruction)
  const memoryHints = useMemoryStore((s) => s.hints)
  const registryCommands = useCommandRegistry((s) => s.commands)
  const executeSlashCommand = useCommandRegistry((s) => s.executeCommand)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [activeMessages.length])

  const handleInputChange = (value: string) => {
    if (value.startsWith('/')) {
      const partial = value.toLowerCase()
      const matches = registryCommands
        .filter(c => c.command.startsWith(partial))
        .slice(0, 8)
        .map(c => c.command)
      setSlashSuggestions(matches)
    } else {
      setSlashSuggestions([])
    }
  }

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const text = inputRef.current?.value?.trim()
    if (!text || busy || !activeThreadId) return

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
    const attachmentBuild = await buildAttachmentPromptContext(mergedForSend.next, text)
    const attachmentContext = attachmentBuild.context
    const promptWithAttachments = attachmentContext ? `${text}\n\n${attachmentContext}` : text

    const userMessage = {
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
      attachments: mergedForSend.next,
      debugContent: promptWithAttachments,
    }
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

    addMessage(activeThreadId, userMessage)
    if (inputRef.current) inputRef.current.value = ''
    setAttachments([])
    setAttachmentNotice(null)
    setBusy(true)
    setError(null)

    let assistantMessageId: string | null = null

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
      const createdAssistantMessageId = addMessage(activeThreadId, {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
      })
      assistantMessageId = createdAssistantMessageId

      const response = await streamChatTurn(
        {
          prompt: promptWithAttachments,
          history: compactedHistory.compacted,
          config: ollama,
        },
        (chunk) => {
          rawAssistantMessage += chunk
          const presentation = resolveAssistantPresentation(rawAssistantMessage, {
            verboseMode,
          })
          updateMessage(activeThreadId, createdAssistantMessageId, {
            content: presentation.content,
            thinkingContent: presentation.thinkingContent,
          })
        },
      )

      const proposedPlan = Array.isArray(response.proposedPlan) ? response.proposedPlan : []
      const requiresApproval = Boolean(response.requiresApproval)

      const fallbackText = requiresApproval && proposedPlan.length > 0
        ? `Plan erstellt. Bitte Freigabe prüfen:\n- ${proposedPlan.join('\n- ')}`
        : 'Das Modell hat keine sichtbare Antwort geliefert. Bitte erneut versuchen oder Modell/Prompt prüfen.'
      const presentation = resolveAssistantPresentation(response.assistantMessage, {
        verboseMode,
        fallbackText,
      })
      updateMessage(activeThreadId, createdAssistantMessageId, {
        content: presentation.content,
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
          endpoint: response.endpoint,
          model: response.model,
          durationMs: Date.now() - started,
          responseChars: response.assistantMessage.length,
        },
      })
      if (superVerboseAuditLogging) {
        void writeAuditEvent('super_verbose', 'chat_llm_request_finished', {
          view: 'chat',
          threadId: activeThreadId,
          prompt: text,
          promptWithAttachments,
          assistantRawResponse: response.assistantMessage,
          assistantVisibleResponse: presentation.content,
          endpoint: response.endpoint,
          model: response.model,
          requiresApproval,
          proposedPlan,
        })
      }

      if (requiresApproval) {
        setPendingApproval(proposedPlan)
        const taskId = createTask(text, text.slice(0, 60), activeThreadId)
        const steps: TaskStep[] = proposedPlan.map((title, i) => ({
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
    addMessage(activeThreadId, {
      role: 'system',
      content: `Plan freigegeben: ${approvalSteps.join(' | ')}`,
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

  const handleRemoveAttachment = (target: ChatAttachment) => {
    setAttachments((prev) => prev.filter((item) => !(item.path === target.path && item.kind === target.kind)))
    setAttachmentNotice(null)
  }

  if (!activeThread) return null

  return (
    <div className="chat-view">
      <div className="chat-log" ref={logRef}>
        {activeMessages.map((msg, index) => {
          const content = typeof msg.content === 'string' ? msg.content : ''
          const hasLiveVerbose = verboseMode && !!msg.verboseContent?.trim()
          const hasLiveThinking = verboseMode && !!msg.thinkingContent?.trim()
          const attachmentsForMessage = Array.isArray(msg.attachments) ? msg.attachments : []
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
                {content ? <HighlightedChatText content={content} /> : (msg.streaming && !hasLiveVerbose && !hasLiveThinking ? <StreamingPlaceholder /> : null)}
              </div>
              {verboseMode && (
                <MessageThinking
                  content={msg.thinkingContent}
                  limitToRollingWindow={limitThinkingWindow}
                />
              )}
              {verboseMode && (
                <MessageVerbose
                  content={msg.verboseContent}
                  limitToRollingWindow={limitThinkingWindow}
                />
              )}
              {attachmentsForMessage.length > 0 && (
                <div className="message-attachments">
                  {attachmentsForMessage.map((item) => (
                    <span key={`${item.kind}-${item.path}`} className="message-attachment-chip" title={item.path}>
                      {item.kind === 'folder' ? '📁' : '📄'} {getPathName(item.path)}
                    </span>
                  ))}
                </div>
              )}
              {verboseMode && msg.debugContent && msg.debugContent !== content && (
                <details className="message-debug">
                  <summary>Verbose: interner Prompt</summary>
                  <pre>{msg.debugContent}</pre>
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
            <button type="button" className="btn-reject" onClick={clearApproval} disabled={busy}>
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
            </select>
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
