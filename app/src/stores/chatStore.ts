import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
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
  setActiveThread: (id: string | null) => void
  addMessage: (threadId: string, message: Omit<ChatMessage, 'id'>) => void
  setPendingApproval: (steps: string[]) => void
  clearApproval: () => void
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  deleteThread: (id: string) => void
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
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
        threads.push({
          id: dt.id,
          title: dt.title,
          messages: dbMsgs.map((m) => ({
            id: m.id,
            role: m.role as ChatMessage['role'],
            content: m.content,
            timestamp: m.timestamp,
          })),
          createdAt: new Date(dt.created_at).getTime(),
          updatedAt: new Date(dt.updated_at).getTime(),
        })
      }
      set({ threads })
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
    invoke('db_save_thread', { id, title, createdAt: isoNow }).catch(() => {})
    invoke('db_save_message', {
      id: systemMsg.id, threadId: id, role: systemMsg.role, content: systemMsg.content, timestamp: systemMsg.timestamp,
    }).catch(() => {})
    return id
  },

  setActiveThread: (id) => set({ activeThreadId: id }),

  addMessage: (threadId, message) => {
    const msgId = generateId()
    const full: ChatMessage = { ...message, id: msgId }
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? { ...t, messages: [...t.messages, full], updatedAt: Date.now() }
          : t
      ),
    }))
    invoke('db_save_message', {
      id: msgId, threadId, role: message.role, content: message.content, timestamp: message.timestamp,
    }).catch(() => {})
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
    invoke('db_delete_thread', { id }).catch(() => {})
  },
}))

export function getActiveThread(state: ChatState): ChatThread | undefined {
  return state.threads.find((t) => t.id === state.activeThreadId)
}
