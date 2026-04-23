import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type TerminalBackend = {
  id: string
  name: string
  backend_type: string
  config_json: string
  status: string
  last_connected_at: string | null
  created_at: string
  updated_at: string
}

export type BackendExecResponse = {
  backendId: string
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

type TerminalState = {
  backends: TerminalBackend[]
  loading: boolean
  error: string | null

  loadBackends: () => Promise<void>
  upsertBackend: (b: { id: string; name: string; backendType: string; configJson: string }) => Promise<void>
  deleteBackend: (id: string) => Promise<void>
  execCommand: (backendId: string, command: string, workingDir?: string, timeoutMs?: number) => Promise<BackendExecResponse>
  ensureLocalBackend: () => Promise<TerminalBackend>
}

export const useTerminalStore = create<TerminalState>()((set) => ({
  backends: [],
  loading: false,
  error: null,

  loadBackends: async () => {
    set({ loading: true, error: null })
    try {
      const backends = await invoke<TerminalBackend[]>('backend_list')
      set({ backends, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  upsertBackend: async (b) => {
    try {
      await invoke('backend_upsert', {
        id: b.id,
        name: b.name,
        backendType: b.backendType,
        configJson: b.configJson,
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deleteBackend: async (id) => {
    try {
      await invoke('backend_delete', { id })
      set((s) => ({ backends: s.backends.filter((b) => b.id !== id) }))
    } catch (e) {
      set({ error: String(e) })
    }
  },

  execCommand: async (backendId, command, workingDir, timeoutMs) => {
    const result = await invoke<BackendExecResponse>('backend_exec', {
      backendId,
      command,
      workingDir: workingDir ?? null,
      timeoutMs: timeoutMs ?? null,
    })
    return result
  },

  ensureLocalBackend: async () => {
    const backend = await invoke<TerminalBackend>('backend_ensure_local')
    return backend
  },
}))
