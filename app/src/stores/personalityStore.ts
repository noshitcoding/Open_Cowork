import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type Personality = {
  id: string
  name: string
  description: string
  system_prompt: string
  temperature: number | null
  model_override: string | null
  icon: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

type PersonalityState = {
  personalities: Personality[]
  activeId: string | null
  loading: boolean
  error: string | null

  loadPersonalities: () => Promise<void>
  upsertPersonality: (p: {
    id: string; name: string; description: string; systemPrompt: string
    temperature?: number; modelOverride?: string; icon?: string; isDefault?: boolean
  }) => Promise<void>
  deletePersonality: (id: string) => Promise<void>
  setActive: (id: string | null) => void
}

export const usePersonalityStore = create<PersonalityState>()((set) => ({
  personalities: [],
  activeId: null,
  loading: false,
  error: null,

  loadPersonalities: async () => {
    set({ loading: true, error: null })
    try {
      const personalities = await invoke<Personality[]>('personality_list')
      set({ personalities, loading: false })
      const def = personalities.find((p) => p.is_default)
      if (def) set({ activeId: def.id })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  upsertPersonality: async (p) => {
    try {
      await invoke('personality_upsert', {
        id: p.id,
        name: p.name,
        description: p.description,
        systemPrompt: p.systemPrompt,
        temperature: p.temperature ?? null,
        modelOverride: p.modelOverride ?? null,
        icon: p.icon ?? null,
        isDefault: p.isDefault ?? false,
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deletePersonality: async (id) => {
    try {
      await invoke('personality_delete', { id })
      set((s) => ({
        personalities: s.personalities.filter((p) => p.id !== id),
        activeId: s.activeId === id ? null : s.activeId,
      }))
    } catch (e) {
      set({ error: String(e) })
    }
  },

  setActive: (id) => set({ activeId: id }),
}))
