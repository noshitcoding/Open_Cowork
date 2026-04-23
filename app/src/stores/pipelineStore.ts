import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type RpcPipeline = {
  id: string
  name: string
  description: string | null
  steps_json: string
  zero_context: boolean
  created_at: string
  updated_at: string
}

export type ToolGatewayEntry = {
  id: string
  tool_type: string
  name: string
  config_json: string
  enabled: boolean
  created_at: string
  updated_at: string
}

type PipelineState = {
  pipelines: RpcPipeline[]
  toolGateway: ToolGatewayEntry[]
  loading: boolean
  error: string | null

  loadPipelines: () => Promise<void>
  upsertPipeline: (p: {
    id: string; name: string; description?: string
    stepsJson: string; zeroContext?: boolean
  }) => Promise<void>
  deletePipeline: (id: string) => Promise<void>

  loadToolGateway: () => Promise<void>
  upsertToolGateway: (t: {
    id: string; toolType: string; name: string
    configJson: string; enabled?: boolean
  }) => Promise<void>
  deleteToolGateway: (id: string) => Promise<void>
}

export const usePipelineStore = create<PipelineState>()((set) => ({
  pipelines: [],
  toolGateway: [],
  loading: false,
  error: null,

  loadPipelines: async () => {
    set({ loading: true, error: null })
    try {
      const pipelines = await invoke<RpcPipeline[]>('pipeline_list')
      set({ pipelines, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  upsertPipeline: async (p) => {
    try {
      await invoke('pipeline_upsert', {
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        stepsJson: p.stepsJson,
        zeroContext: p.zeroContext ?? false,
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deletePipeline: async (id) => {
    try {
      await invoke('pipeline_delete', { id })
      set((s) => ({ pipelines: s.pipelines.filter((p) => p.id !== id) }))
    } catch (e) {
      set({ error: String(e) })
    }
  },

  loadToolGateway: async () => {
    set({ loading: true, error: null })
    try {
      const toolGateway = await invoke<ToolGatewayEntry[]>('tool_gateway_list')
      set({ toolGateway, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  upsertToolGateway: async (t) => {
    try {
      await invoke('tool_gateway_upsert', {
        id: t.id,
        toolType: t.toolType,
        name: t.name,
        configJson: t.configJson,
        enabled: t.enabled ?? true,
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deleteToolGateway: async (id) => {
    try {
      await invoke('tool_gateway_delete', { id })
      set((s) => ({ toolGateway: s.toolGateway.filter((t) => t.id !== id) }))
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
