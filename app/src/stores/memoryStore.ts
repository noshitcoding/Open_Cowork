import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type MemoryEntry = {
  id: string
  scope: string
  category: string
  key: string
  content: string
  source_session_id: string | null
  confidence: number
  access_count: number
  last_accessed_at: string
  created_at: string
  updated_at: string
}

export type UserProfileEntry = {
  id: string
  key: string
  value: string
  source: string
  confidence: number
  created_at: string
  updated_at: string
}

export type MemoryProvider = {
  id: string
  name: string
  provider_type: string
  config_json: string
  enabled: boolean
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export type FrozenSnapshot = {
  timestamp: string
  entries: MemoryEntry[]
  profile: UserProfileEntry[]
  total_entries: number
  total_profile_keys: number
}

export type MemoryHint = {
  key: string
  content: string
  scope: string
  relevance: string
}

type MemoryState = {
  entries: MemoryEntry[]
  searchResults: MemoryEntry[]
  profileEntries: UserProfileEntry[]
  providers: MemoryProvider[]
  hints: MemoryHint[]
  lastSnapshot: FrozenSnapshot | null
  loading: boolean
  error: string | null

  loadEntries: (scope?: string, category?: string, limit?: number) => Promise<void>
  searchEntries: (query: string, limit?: number) => Promise<void>
  upsertEntry: (entry: { id: string; scope: string; category: string; key: string; content: string; confidence?: number }) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  compactEntries: (scope: string, minConfidence: number) => Promise<{ removed: number; remaining: number }>
  createSnapshot: () => Promise<FrozenSnapshot>
  loadHints: () => Promise<void>

  loadProfile: () => Promise<void>
  upsertProfile: (key: string, value: string, source?: string, confidence?: number) => Promise<void>
  deleteProfile: (key: string) => Promise<void>

  loadProviders: () => Promise<void>
  upsertProvider: (p: { id: string; name: string; provider_type: string; config_json: string; enabled?: boolean }) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
}

export const useMemoryStore = create<MemoryState>()((set) => ({
  entries: [],
  searchResults: [],
  profileEntries: [],
  providers: [],
  hints: [],
  lastSnapshot: null,
  loading: false,
  error: null,

  loadEntries: async (scope, category, limit = 200) => {
    set({ loading: true, error: null })
    try {
      const entries = await invoke<MemoryEntry[]>('memory_search', {
        scope: scope ?? null,
        category: category ?? null,
        keyword: null,
        limit,
      })
      set({ entries, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  searchEntries: async (query, limit = 50) => {
    set({ loading: true, error: null })
    try {
      const searchResults = await invoke<MemoryEntry[]>('memory_search', {
        scope: null,
        category: null,
        keyword: query,
        limit,
      })
      set({ searchResults, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  upsertEntry: async (entry) => {
    try {
      await invoke('memory_upsert', {
        id: entry.id,
        scope: entry.scope,
        category: entry.category,
        key: entry.key,
        content: entry.content,
        confidence: entry.confidence ?? 1.0,
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deleteEntry: async (id) => {
    try {
      await invoke('memory_delete', { id })
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
    } catch (e) {
      set({ error: String(e) })
    }
  },

  compactEntries: async (scope, minConfidence) => {
    const result = await invoke<{ removed: number; remaining: number }>('memory_compact', {
      scope,
      minConfidence,
    })
    return result
  },

  createSnapshot: async () => {
    const json = await invoke<string>('memory_snapshot')
    const snapshot = JSON.parse(json) as FrozenSnapshot
    set({ lastSnapshot: snapshot })
    return snapshot
  },

  loadHints: async () => {
    try {
      const hints = await invoke<MemoryHint[]>('memory_hints')
      set({ hints })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  loadProfile: async () => {
    try {
      const profileEntries = await invoke<UserProfileEntry[]>('user_profile_list')
      set({ profileEntries })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  upsertProfile: async (key, value, source = 'manual', confidence = 1.0) => {
    const id = `prof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      await invoke('user_profile_upsert', { id, key, value, source, confidence })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deleteProfile: async (key) => {
    try {
      await invoke('user_profile_delete', { key })
      set((s) => ({ profileEntries: s.profileEntries.filter((p) => p.key !== key) }))
    } catch (e) {
      set({ error: String(e) })
    }
  },

  loadProviders: async () => {
    try {
      const providers = await invoke<MemoryProvider[]>('memory_provider_list')
      set({ providers })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  upsertProvider: async (p) => {
    try {
      await invoke('memory_provider_upsert', {
        id: p.id,
        name: p.name,
        providerType: p.provider_type,
        configJson: p.config_json,
        enabled: p.enabled ?? true,
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deleteProvider: async (id) => {
    try {
      await invoke('memory_provider_delete', { id })
      set((s) => ({ providers: s.providers.filter((p) => p.id !== id) }))
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
