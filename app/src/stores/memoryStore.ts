import { create } from 'zustand'
import { safeInvoke } from '../utils/safeInvoke'

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

/* ── Local fallback storage (when Tauri is not available) ─────────────── */

const LOCAL_STORAGE_KEY = 'open-cowork-memory-local'

function getLocalEntries(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function setLocalEntries(entries: MemoryEntry[]): void {
  try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries)) } catch { /* noop */ }
}

const LOCAL_PROFILE_KEY = 'open-cowork-profile-local'

function getLocalProfile(): UserProfileEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function setLocalProfile(entries: UserProfileEntry[]): void {
  try { localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(entries)) } catch { /* noop */ }
}

const LOCAL_PROVIDER_KEY = 'open-cowork-providers-local'

function getLocalProviders(): MemoryProvider[] {
  try {
    const raw = localStorage.getItem(LOCAL_PROVIDER_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function setLocalProviders(providers: MemoryProvider[]): void {
  try { localStorage.setItem(LOCAL_PROVIDER_KEY, JSON.stringify(providers)) } catch { /* noop */ }
}

/* ── Store ────────────────────────────────────────────────────────────── */

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

export const useMemoryStore = create<MemoryState>()((set, get) => ({
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
      const entries = await safeInvoke<MemoryEntry[]>('memory_search', {
        scope: scope ?? null,
        category: category ?? null,
        keyword: null,
        limit,
      }, getLocalEntries())
      set({ entries, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  searchEntries: async (query, limit = 50) => {
    set({ loading: true, error: null })
    try {
      const searchResults = await safeInvoke<MemoryEntry[]>('memory_search', {
        scope: null,
        category: null,
        keyword: query,
        limit,
      }, getLocalEntries().filter(e =>
        e.content.toLowerCase().includes(query.toLowerCase()) ||
        e.key.toLowerCase().includes(query.toLowerCase())
      ))
      set({ searchResults, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  upsertEntry: async (entry) => {
    try {
      await safeInvoke('memory_upsert', {
        id: entry.id,
        scope: entry.scope,
        category: entry.category,
        key: entry.key,
        content: entry.content,
        confidence: entry.confidence ?? 1.0,
      }, undefined)
    } catch {
      // Fallback: save locally
      const local = getLocalEntries()
      const now = new Date().toISOString()
      const existing = local.findIndex(e => e.id === entry.id)
      const full: MemoryEntry = {
        id: entry.id,
        scope: entry.scope,
        category: entry.category,
        key: entry.key,
        content: entry.content,
        confidence: entry.confidence ?? 1.0,
        source_session_id: null,
        access_count: 0,
        last_accessed_at: now,
        created_at: now,
        updated_at: now,
      }
      if (existing >= 0) local[existing] = full
      else local.unshift(full)
      setLocalEntries(local)
    }
  },

  deleteEntry: async (id) => {
    try {
      await safeInvoke('memory_delete', { id }, undefined)
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
    } catch {
      // Fallback: remove locally
      const local = getLocalEntries().filter(e => e.id !== id)
      setLocalEntries(local)
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
    }
  },

  compactEntries: async (scope, minConfidence) => {
    try {
      return await safeInvoke<{ removed: number; remaining: number }>('memory_compact', {
        scope,
        minConfidence,
      }, { removed: 0, remaining: get().entries.length })
    } catch {
      return { removed: 0, remaining: get().entries.length }
    }
  },

  createSnapshot: async () => {
    try {
      const json = await safeInvoke<string>('memory_snapshot', undefined, JSON.stringify({
        timestamp: new Date().toISOString(),
        entries: getLocalEntries(),
        profile: getLocalProfile(),
        total_entries: getLocalEntries().length,
        total_profile_keys: getLocalProfile().length,
      }))
      const snapshot = JSON.parse(json) as FrozenSnapshot
      set({ lastSnapshot: snapshot })
      return snapshot
    } catch {
      const snapshot: FrozenSnapshot = {
        timestamp: new Date().toISOString(),
        entries: get().entries,
        profile: get().profileEntries,
        total_entries: get().entries.length,
        total_profile_keys: get().profileEntries.length,
      }
      set({ lastSnapshot: snapshot })
      return snapshot
    }
  },

  loadHints: async () => {
    try {
      const hints = await safeInvoke<MemoryHint[]>('memory_hints', undefined, [])
      set({ hints })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  loadProfile: async () => {
    try {
      const profileEntries = await safeInvoke<UserProfileEntry[]>('user_profile_list', undefined, getLocalProfile())
      set({ profileEntries })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  upsertProfile: async (key, value, source = 'manual', confidence = 1.0) => {
    const id = `prof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      await safeInvoke('user_profile_upsert', { id, key, value, source, confidence }, undefined)
    } catch {
      // Fallback: save locally
      const local = getLocalProfile()
      const now = new Date().toISOString()
      const existing = local.findIndex(p => p.key === key)
      const full: UserProfileEntry = { id, key, value, source, confidence, created_at: now, updated_at: now }
      if (existing >= 0) local[existing] = full
      else local.unshift(full)
      setLocalProfile(local)
    }
  },

  deleteProfile: async (key) => {
    try {
      await safeInvoke('user_profile_delete', { key }, undefined)
      set((s) => ({ profileEntries: s.profileEntries.filter((p) => p.key !== key) }))
    } catch {
      const local = getLocalProfile().filter(p => p.key !== key)
      setLocalProfile(local)
      set((s) => ({ profileEntries: s.profileEntries.filter((p) => p.key !== key) }))
    }
  },

  loadProviders: async () => {
    try {
      const providers = await safeInvoke<MemoryProvider[]>('memory_provider_list', undefined, getLocalProviders())
      set({ providers })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  upsertProvider: async (p) => {
    try {
      await safeInvoke('memory_provider_upsert', {
        id: p.id,
        name: p.name,
        providerType: p.provider_type,
        configJson: p.config_json,
        enabled: p.enabled ?? true,
      }, undefined)
    } catch {
      // Fallback: save locally
      const local = getLocalProviders()
      const now = new Date().toISOString()
      const existing = local.findIndex(pr => pr.id === p.id)
      const full: MemoryProvider = {
        id: p.id, name: p.name, provider_type: p.provider_type,
        config_json: p.config_json, enabled: p.enabled ?? true,
        last_sync_at: null, created_at: now, updated_at: now,
      }
      if (existing >= 0) local[existing] = full
      else local.unshift(full)
      setLocalProviders(local)
    }
  },

  deleteProvider: async (id) => {
    try {
      await safeInvoke('memory_provider_delete', { id }, undefined)
      set((s) => ({ providers: s.providers.filter((p) => p.id !== id) }))
    } catch {
      const local = getLocalProviders().filter(p => p.id !== id)
      setLocalProviders(local)
      set((s) => ({ providers: s.providers.filter((p) => p.id !== id) }))
    }
  },
}))
