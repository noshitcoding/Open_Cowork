import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppLogLevel = 'info' | 'warn' | 'error'

export type AppLogEntry = {
  id: string
  timestamp: number
  level: AppLogLevel
  area: string
  message: string
  details?: Record<string, unknown>
}

type LogState = {
  entries: AppLogEntry[]
  addLog: (entry: Omit<AppLogEntry, 'id' | 'timestamp'>) => void
  clearLogs: () => void
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useLogStore = create<LogState>()(
  persist(
    (set) => ({
      entries: [],
      addLog: (entry) =>
        set((state) => ({
          entries: [
            {
              ...entry,
              id: generateId(),
              timestamp: Date.now(),
            },
            ...state.entries,
          ].slice(0, 200),
        })),
      clearLogs: () => set({ entries: [] }),
    }),
    { name: 'open-cowork-logs' }
  )
)
