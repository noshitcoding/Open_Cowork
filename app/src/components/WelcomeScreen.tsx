import { useRef, useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useConfigStore } from '../stores/configStore'
import { useUiStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { useTaskStore } from '../stores/taskStore'
import { useLogStore } from '../stores/logStore'
import type { WorkingPathKind } from '../stores/uiStore'
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

const QUICK_ACTIONS = [
  { icon: '📄', title: 'Datei erstellen', prompt: 'Erstelle eine neue Datei' },
  { icon: '📊', title: 'Daten analysieren', prompt: 'Analysiere Daten' },
  { icon: '🎨', title: 'Prototyp bauen', prompt: 'Baue einen Prototyp' },
  { icon: '📂', title: 'Dateien organisieren', prompt: 'Organisiere meine Dateien' },
  { icon: '📝', title: 'Meeting vorbereiten', prompt: 'Bereite ein Meeting vor' },
  { icon: '✉️', title: 'Nachricht entwerfen', prompt: 'Entwirf eine Nachricht' },
]

export default function WelcomeScreen() {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useFolder, setUseFolder] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)

  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const setOllama = useConfigStore((s) => s.setOllama)
  const setAvailableModels = useConfigStore((s) => s.setAvailableModels)

  const { workingFolder, workingPathKind, setWorkingPath } = useUiStore()
  const { addThread, setActiveThread, addMessage } = useChatStore()
  const { createTask, setTaskSteps, updateTaskStatus } = useTaskStore()
  const addLog = useLogStore((s) => s.addLog)

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const health = await invoke<{
          ok: boolean
          models: string[]
        }>('ollama_health_check', { config: ollama })
        if (health.ok && health.models.length > 0) {
          setAvailableModels(health.models)
        }
      } catch {
        // Ollama not available
      }
    }
    fetchModels()
  }, [ollama.baseUrl, setAvailableModels, ollama])

  const handlePathSelect = async (kind: WorkingPathKind) => {
    try {
      const selected = await open({
        directory: kind === 'folder',
        multiple: false,
      })
      if (typeof selected === 'string') {
        setWorkingPath(selected, kind)
        setUseFolder(true)
      }
    } catch {
      const label = kind === 'folder' ? 'Ordnerpfad' : 'Dateipfad'
      const path = window.prompt(`${label} eingeben:`)
      if (path) {
        setWorkingPath(path, kind)
        setUseFolder(true)
      }
    }
  }

  const selectedPathName = workingFolder
    ? workingFolder.split(/[\\/]/).filter(Boolean).pop() ?? workingFolder
    : null

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

  const handleSubmit = async (event: FormEvent, quickPrompt?: string) => {
    event.preventDefault()
    const text = quickPrompt ?? inputRef.current?.value?.trim()
    if (!text || busy) return

    setBusy(true)
    setError(null)

    const pathAttachment: ChatAttachment[] = useFolder && workingFolder
      ? [{ path: workingFolder, kind: workingPathKind === 'file' ? 'file' : 'folder' }]
      : []
    const mergedForSend = mergeAttachments(pathAttachment, attachments)
    const attachmentBuild = await buildAttachmentPromptContext(mergedForSend.next)
    const attachmentContext = attachmentBuild.context
    const promptWithAttachments = attachmentContext ? `${text}\n\n${attachmentContext}` : text

    // Create a new thread for this task
    const threadId = addThread(text.slice(0, 50))
    setActiveThread(threadId)

    const userMessage = { role: 'user' as const, content: promptWithAttachments, timestamp: Date.now() }
    addMessage(threadId, userMessage)

    if (inputRef.current) inputRef.current.value = ''
    setAttachments([])
    setAttachmentNotice(null)

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
          promptChars: promptWithAttachments.length,
          parsedAttachments: attachmentBuild.parsedFiles,
          failedAttachments: attachmentBuild.failedFiles.length,
          source: 'welcome',
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
          history: [],
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
          source: 'welcome',
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

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-hero">
          <div className="welcome-icon">✦</div>
          <h1 className="welcome-heading">
            Was sollen wir heute erledigen?
          </h1>
          <p className="welcome-subheading">
            Open_Cowork kann Aufgaben planen, ausführen und Dateien verwalten — alles lokal auf deinem Rechner.
          </p>
        </div>

        <div className="quick-actions-grid">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.title}
              type="button"
              className="quick-action-card"
              onClick={(e) => handleSubmit(e, action.prompt)}
              disabled={busy}
            >
              <span className="quick-action-icon">{action.icon}</span>
              <span className="quick-action-title">{action.title}</span>
            </button>
          ))}
        </div>

        <form className="welcome-input-bar" onSubmit={handleSubmit}>
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              rows={2}
              placeholder="Wie kann ich dir heute helfen?"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
            />
          </div>

          <div className="input-bar-footer">
            <div className="input-bar-left">
              <label className="folder-toggle">
                <input
                  type="checkbox"
                  checked={useFolder}
                  onChange={(e) => {
                    setUseFolder(e.target.checked)
                    if (!e.target.checked) setWorkingPath(null)
                  }}
                />
                <span>Lokalen Pfad nutzen</span>
              </label>
              {useFolder && (
                <div className="path-actions">
                  <button
                    type="button"
                    className="btn-folder-select"
                    onClick={() => handlePathSelect('folder')}
                  >
                    Ordner wählen
                  </button>
                  <button
                    type="button"
                    className="btn-folder-select"
                    onClick={() => handlePathSelect('file')}
                  >
                    Datei wählen
                  </button>
                  {selectedPathName && (
                    <span className="selected-path" title={workingFolder ?? undefined}>
                      {workingPathKind === 'file' ? 'Datei' : 'Ordner'}: {selectedPathName}
                    </span>
                  )}
                </div>
              )}
              <div className="attachment-actions">
                <button
                  type="button"
                  className="btn-attach"
                  onClick={handleAttachFiles}
                  disabled={busy}
                >
                  Dateien
                </button>
                <button
                  type="button"
                  className="btn-attach"
                  onClick={handleAttachFolders}
                  disabled={busy}
                >
                  Ordner
                </button>
              </div>
            </div>

            <div className="input-bar-right">
              <select
                className="model-selector"
                value={ollama.model}
                onChange={(e) => setOllama({ model: e.target.value })}
              >
                {availableModels.length > 0 ? (
                  availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                ) : (
                  <option value={ollama.model}>{ollama.model}</option>
                )}
              </select>

              <button type="submit" className="btn-go" disabled={busy}>
                {busy ? 'Läuft...' : "Los geht's →"}
              </button>
            </div>
          </div>

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
        </form>

        {error && <p className="error welcome-error">{error}</p>}

        <div className="connectors-section">
          <p className="connectors-title">Verbinde deine Tools mit Open_Cowork</p>
          <div className="connector-icons">
            <span className="connector-badge" title="MCP Server">🔌 MCP</span>
            <span className="connector-badge" title="Dateisystem">📂 Dateien</span>
            <span className="connector-badge" title="Ollama">🤖 Ollama</span>
          </div>
        </div>
      </div>
    </div>
  )
}
