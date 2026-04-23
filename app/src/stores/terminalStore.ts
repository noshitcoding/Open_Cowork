import { create } from 'zustand'
import { safeInvoke } from '../utils/safeInvoke'

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

const LOCAL_DEFAULT_BACKEND: TerminalBackend = {
  id: 'local',
  name: 'Local',
  backend_type: 'local',
  config_json: '{}',
  status: 'connected',
  last_connected_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export const useTerminalStore = create<TerminalState>()((set) => ({
  backends: [],
  loading: false,
  error: null,

  loadBackends: async () => {
    set({ loading: true, error: null })
    try {
      const backends = await safeInvoke<TerminalBackend[]>('backend_list', undefined, [])
      set({ backends, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  upsertBackend: async (b) => {
    try {
      await safeInvoke('backend_upsert', {
        id: b.id,
        name: b.name,
        backendType: b.backendType,
        configJson: b.configJson,
      }, undefined)
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deleteBackend: async (id) => {
    try {
      await safeInvoke('backend_delete', { id }, undefined)
      set((s) => ({ backends: s.backends.filter((b) => b.id !== id) }))
    } catch (e) {
      set({ error: String(e) })
    }
  },

  execCommand: async (backendId, command, workingDir, timeoutMs) => {
    try {
      return await safeInvoke<BackendExecResponse>('backend_exec', {
        backendId,
        command,
        workingDir: workingDir ?? null,
        timeoutMs: timeoutMs ?? null,
      }, {
        backendId,
        stdout: 'Terminal-Ausfuehrung ist nur in der Desktop-App verfuegbar.',
        stderr: '',
        exitCode: 1,
        timedOut: false,
      })
    } catch (e) {
      return {
        backendId,
        stdout: '',
        stderr: String(e),
        exitCode: 1,
        timedOut: false,
      }
    }
  },

  ensureLocalBackend: async () => {
    try {
      const backend = await safeInvoke<TerminalBackend>(
        'backend_ensure_local', undefined, LOCAL_DEFAULT_BACKEND
      )
      set((s) => {
        const exists = s.backends.some(b => b.id === backend.id)
        return { backends: exists ? s.backends : [backend, ...s.backends] }
      })
      return backend
    } catch {
      set((s) => {
        const exists = s.backends.some(b => b.id === LOCAL_DEFAULT_BACKEND.id)
        return { backends: exists ? s.backends : [LOCAL_DEFAULT_BACKEND, ...s.backends] }
      })
      return LOCAL_DEFAULT_BACKEND
    }
  },
}))
