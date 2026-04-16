import { useRef, useEffect } from 'react'
import type { FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useChatStore, getActiveThread } from '../stores/chatStore'
import { useConfigStore } from '../stores/configStore'
import { useTaskStore } from '../stores/taskStore'
import type { TaskStep } from '../stores/taskStore'

type ChatTurnResponse = {
  endpoint: string
  model: string
  assistantMessage: string
  requiresApproval: boolean
  proposedPlan: string[]
}

export default function ChatView() {
  const ollama = useConfigStore((s) => s.ollama)
  const {
    threads,
    activeThreadId,
    pendingApproval,
    busy,
    error,
    loadFromDb,
    addThread,
    setActiveThread,
    addMessage,
    setPendingApproval,
    clearApproval,
    setBusy,
    setError,
    deleteThread,
  } = useChatStore()

  const { createTask, updateTaskStatus, setTaskSteps } = useTaskStore()
  const activeThread = useChatStore(getActiveThread)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadFromDb() }, [loadFromDb])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [activeThread?.messages.length])

  const handleNewThread = () => {
    addThread('Neuer Chat')
  }

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const text = inputRef.current?.value?.trim()
    if (!text || busy || !activeThreadId) return

    const userMessage = { role: 'user' as const, content: text, timestamp: Date.now() }
    const history = (activeThread?.messages ?? [])
      .filter((m) => m.role !== 'system')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }))

    addMessage(activeThreadId, userMessage)
    if (inputRef.current) inputRef.current.value = ''
    setBusy(true)
    setError(null)

    try {
      const response = await invoke<ChatTurnResponse>('chat_turn', {
        request: {
          prompt: text,
          history,
          config: ollama,
        },
      })

      addMessage(activeThreadId, {
        role: 'assistant',
        content: response.assistantMessage,
        timestamp: Date.now(),
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

  return (
    <div className="chat-view">
      <aside className="thread-list">
        <button type="button" className="btn-new-thread" onClick={handleNewThread}>
          + Neuer Chat
        </button>
        {threads.map((t) => (
          <div
            key={t.id}
            className={`thread-item ${t.id === activeThreadId ? 'active' : ''}`}
          >
            <button
              type="button"
              className="thread-select"
              onClick={() => setActiveThread(t.id)}
            >
              {t.title}
            </button>
            <button
              type="button"
              className="thread-delete"
              onClick={() => deleteThread(t.id)}
              title="Thread loeschen"
            >
              ×
            </button>
          </div>
        ))}
      </aside>

      <section className="chat-main">
        {!activeThread ? (
          <div className="chat-empty">
            <h2>Willkommen bei Open_Cowork</h2>
            <p>Erstelle einen neuen Chat, um zu beginnen.</p>
            <button type="button" onClick={handleNewThread}>
              Neuen Chat starten
            </button>
          </div>
        ) : (
          <>
            <div className="chat-log" ref={logRef}>
              {activeThread.messages.map((msg, index) => (
                <div key={`${msg.timestamp}-${index}`} className={`chat-msg ${msg.role}`}>
                  <strong>{msg.role === 'user' ? 'Du' : msg.role === 'assistant' ? 'Agent' : 'System'}</strong>
                  <p>{msg.content}</p>
                </div>
              ))}
              {busy && (
                <div className="chat-msg system">
                  <strong>System</strong>
                  <p>Agent antwortet...</p>
                </div>
              )}
            </div>

            {pendingApproval.length > 0 && (
              <div className="approval-box">
                <p>Diese Schritte erfordern Freigabe:</p>
                <ol>
                  {pendingApproval.map((step, idx) => (
                    <li key={`${step}-${idx}`}>{step}</li>
                  ))}
                </ol>
                <div className="approval-actions">
                  <button type="button" onClick={handleApprove} disabled={busy}>
                    Plan freigeben
                  </button>
                  <button type="button" onClick={clearApproval} disabled={busy} className="btn-secondary">
                    Ablehnen
                  </button>
                </div>
              </div>
            )}

            {error && <p className="error">{error}</p>}

            <form onSubmit={handleSend} className="chat-input-form">
              <textarea
                ref={inputRef}
                rows={3}
                placeholder="Beschreibe die naechste Aufgabe..."
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend(e)
                  }
                }}
              />
              <button type="submit" disabled={busy}>
                {busy ? 'Senden...' : 'Senden'}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
