import { useRef, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
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

type ChatTurnResponse = {
  endpoint: string
  model: string
  assistantMessage: string
  requiresApproval: boolean
  proposedPlan: string[]
}

export default function ChatView() {
  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const setOllama = useConfigStore((s) => s.setOllama)
  const {
    activeThreadId,
    pendingApproval,
    busy,
    error,
    addMessage,
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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [activeThread?.messages.length])

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const text = inputRef.current?.value?.trim()
    if (!text || busy || !activeThreadId) return

    const mergedForSend = mergeAttachments([], attachments)
    const attachmentBuild = await buildAttachmentPromptContext(mergedForSend.next)
    const attachmentContext = attachmentBuild.context
    const promptWithAttachments = attachmentContext ? `${text}\n\n${attachmentContext}` : text

    const userMessage = { role: 'user' as const, content: promptWithAttachments, timestamp: Date.now() }
    const history = (activeThread?.messages ?? [])
      .filter((m) => m.role !== 'system')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }))

    addMessage(activeThreadId, userMessage)
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
          promptChars: promptWithAttachments.length,
          parsedAttachments: attachmentBuild.parsedFiles,
          failedAttachments: attachmentBuild.failedFiles.length,
          source: 'chat',
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
          history,
          config: ollama,
        },
      })

      addMessage(activeThreadId, {
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
        const taskId = createTask(text, text.slice(0, 60), activeThreadId)
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
      addMessage(activeThreadId, {
        role: 'assistant',
        content: `LLM-Anfrage fehlgeschlagen: ${message}\n\nPrüfe unter Einstellungen den Ollama-Endpoint, das Modell und den Timeout.`,
        timestamp: Date.now(),
      })
    } finally {
      setBusy(false)
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
        {activeThread.messages.map((msg, index) => (
          <div key={`${msg.timestamp}-${index}`} className={`cowork-msg ${msg.role}`}>
            <div className="msg-avatar">
              {msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '✦' : '⚙️'}
            </div>
            <div className="msg-body">
              <div className="msg-role">
                {msg.role === 'user' ? 'Du' : msg.role === 'assistant' ? 'Open_Cowork' : 'System'}
              </div>
              <div className="msg-content">{msg.content}</div>
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

          <textarea
            ref={inputRef}
            rows={2}
            placeholder="Nachricht senden..."
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend(e)
              }
            }}
          />
        </div>

        <button type="submit" disabled={busy} className="btn-send">
          {busy ? '⟳' : '→'}
        </button>
      </form>
    </div>
  )
}
