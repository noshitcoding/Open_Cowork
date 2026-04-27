import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { hydrateStoredMessage } from '../utils/sessionThreads'
import type { ChatAttachment } from '../utils/chatAttachments'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  attachments?: ChatAttachment[]
  visibleInChat?: boolean
  debugContent?: string
  thinkingContent?: string
  verboseContent?: string
  liveToolCalls?: LiveToolCall[]
  streaming?: boolean
}

export type LiveToolCallStatus = 'requested' | 'running' | 'completed' | 'failed' | 'approval'

export type LiveToolCall = {
  id: string
  toolName: string
  input: Record<string, unknown>
  status: LiveToolCallStatus
  result?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

export type ChatThread = {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

type ChatState = {
  threads: ChatThread[]
  activeThreadId: string | null
  pendingApproval: string[]
  busy: boolean
  error: string | null
  loadFromDb: () => Promise<void>
  addThread: (title: string) => string
  hydrateThread: (thread: ChatThread) => void
  setActiveThread: (id: string | null) => void
  addMessage: (threadId: string, message: Omit<ChatMessage, 'id'>) => string
  updateMessage: (
    threadId: string,
    messageId: string,
    patch: Partial<Pick<ChatMessage, 'content' | 'debugContent' | 'thinkingContent' | 'verboseContent' | 'liveToolCalls' | 'streaming'>>,
    options?: { persist?: boolean },
  ) => void
  setPendingApproval: (steps: string[]) => void
  clearApproval: () => void
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  deleteThread: (id: string) => void
  removeLastMessagePairs: (threadId: string, pairCount: number) => { pairsRemoved: number; messagesRemoved: number }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function persistInvoke(command: string, args: Record<string, unknown>, context: string): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }
  try {
    await invoke(command, args)
  } catch (error) {
    console.error(`[chatStore] ${context} failed`, error)
  }
}

export const useChatStore = create<ChatState>()((set) => ({
  threads: [],
  activeThreadId: null,
  pendingApproval: [],
  busy: false,
  error: null,

  loadFromDb: async () => {
    try {
      type DbThread = { id: string; title: string; created_at: string; updated_at: string }
      type DbMessage = { id: string; role: string; content: string; timestamp: number }
      const dbThreads = await invoke<DbThread[]>('db_list_threads')
      const threads: ChatThread[] = []
      for (const dt of dbThreads) {
        const dbMsgs = await invoke<DbMessage[]>('db_list_messages', { threadId: dt.id })
        const messages = Array.isArray(dbMsgs) ? dbMsgs : []
        threads.push({
          id: dt.id,
          title: dt.title,
          messages: messages.map((m) => hydrateStoredMessage(m)),
          createdAt: new Date(dt.created_at).getTime(),
          updatedAt: new Date(dt.updated_at).getTime(),
        })
      }
      set({
        threads: threads.map((thread) => ({
          ...thread,
          messages: Array.isArray(thread.messages) ? thread.messages : [],
        })),
      })
    } catch {
      // DB not available (e.g. in tests) - keep in-memory state
    }
  },

  addThread: (title: string) => {
    const id = generateId()
    const now = Date.now()
    const systemMsg: ChatMessage = {
      id: generateId(),
      role: 'system',
      content: 'Open_Cowork ist bereit. Sende eine Aufgabe, um Planung und Ausfuehrung im Chatmodus zu starten.',
      timestamp: now,
    }
    const thread: ChatThread = {
      id,
      title,
      messages: [systemMsg],
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({
      threads: [thread, ...state.threads],
      activeThreadId: id,
    }))
    const isoNow = new Date(now).toISOString()
    void persistInvoke('db_save_thread', { id, title, createdAt: isoNow }, 'db_save_thread')
    void persistInvoke('db_save_message', {
      id: systemMsg.id, threadId: id, role: systemMsg.role, content: systemMsg.content, timestamp: systemMsg.timestamp,
    }, 'db_save_message system')
    return id
  },

  hydrateThread: (thread) => {
    const normalized: ChatThread = {
      ...thread,
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      updatedAt: thread.updatedAt || Date.now(),
    }
    set((state) => {
      const remaining = state.threads.filter((item) => item.id !== normalized.id)
      return {
        threads: [normalized, ...remaining],
        activeThreadId: normalized.id,
      }
    })
  },

  setActiveThread: (id) => set({ activeThreadId: id }),

  addMessage: (threadId, message) => {
    const msgId = generateId()
    const full: ChatMessage = {
      ...message,
      id: msgId,
      content: typeof message.content === 'string' ? message.content : '',
      attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
    }
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? { ...t, messages: [...t.messages, full], updatedAt: Date.now() }
          : t
      ),
    }))
    void persistInvoke('db_save_message', {
      id: msgId, threadId, role: message.role, content: full.content, timestamp: message.timestamp,
    }, 'db_save_message addMessage')
    return msgId
  },

  updateMessage: (threadId, messageId, patch, options) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId ? { ...m, ...patch } : m
              ),
              updatedAt: Date.now(),
            }
          : t
      ),
    }))

    if (options?.persist && typeof patch.content === 'string') {
      void persistInvoke('db_update_message_content', {
        id: messageId,
        content: patch.content,
      }, 'db_update_message_content')
    }
  },

  setPendingApproval: (steps) => set({ pendingApproval: steps }),
  clearApproval: () => set({ pendingApproval: [] }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),

  deleteThread: (id) => {
    set((state) => ({
      threads: state.threads.filter((t) => t.id !== id),
      activeThreadId: state.activeThreadId === id ? null : state.activeThreadId,
    }))
    void persistInvoke('db_delete_thread', { id }, 'db_delete_thread')
  },

  removeLastMessagePairs: (threadId, pairCount) => {
    let pairsRemoved = 0
    let messagesRemoved = 0
    let removedIds: string[] = []

    set((state) => ({
      threads: state.threads.map((t) => {
        if (t.id !== threadId) return t

        const idsToRemove = new Set<string>()
        let cursor = t.messages.length - 1

        while (cursor >= 0 && pairsRemoved < pairCount) {
          while (cursor >= 0 && t.messages[cursor]?.role === 'system') {
            cursor--
          }

          if (cursor < 0) break
          if (t.messages[cursor]?.role !== 'assistant') {
            cursor--
            continue
          }

          const assistantMessage = t.messages[cursor]
          cursor--

          while (cursor >= 0 && t.messages[cursor]?.role === 'system') {
            cursor--
          }

          if (cursor < 0 || t.messages[cursor]?.role !== 'user') {
            continue
          }

          const userMessage = t.messages[cursor]
          idsToRemove.add(assistantMessage.id)
          idsToRemove.add(userMessage.id)
          pairsRemoved++
          cursor--
        }

        removedIds = Array.from(idsToRemove)
        messagesRemoved = removedIds.length

        if (removedIds.length === 0) {
          return t
        }

        return {
          ...t,
          messages: t.messages.filter((message) => !idsToRemove.has(message.id)),
          updatedAt: Date.now(),
        }
      }),
    }))

    if (removedIds.length > 0) {
      void persistInvoke('db_delete_messages', { ids: removedIds }, 'db_delete_messages rewind')
    }

    return { pairsRemoved, messagesRemoved }
  },
}))

export function getActiveThread(state: ChatState): ChatThread | undefined {
  return state.threads.find((t) => t.id === state.activeThreadId)
}
