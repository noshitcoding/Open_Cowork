import { create } from 'zustand'
import { safeInvoke } from '../utils/safeInvoke'
import { DEFAULT_PERSONALITIES } from '../utils/defaultSeeds'

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

function buildFallbackPersonalities(): Personality[] {
  const timestamp = new Date().toISOString()

  return DEFAULT_PERSONALITIES.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    system_prompt: entry.systemPrompt,
    temperature: entry.temperature,
    model_override: null,
    icon: entry.icon,
    is_default: entry.isDefault,
    created_at: timestamp,
    updated_at: timestamp,
  }))
}

export const usePersonalityStore = create<PersonalityState>()((set) => ({
  personalities: [],
  activeId: null,
  loading: false,
  error: null,

  loadPersonalities: async () => {
    set({ loading: true, error: null })
    try {
      const personalities = await safeInvoke<Personality[]>('personality_list', undefined, [])
      const resolvedPersonalities = personalities.length > 0 ? personalities : buildFallbackPersonalities()
      set({ personalities: resolvedPersonalities, loading: false })
      const def = resolvedPersonalities.find((p) => p.is_default)
      if (def) set({ activeId: def.id })
    } catch (e) {
      const fallbackPersonalities = buildFallbackPersonalities()
      set({
        personalities: fallbackPersonalities,
        error: String(e),
        loading: false,
      })
      const def = fallbackPersonalities.find((p) => p.is_default)
      if (def) set({ activeId: def.id })
    }
  },

  upsertPersonality: async (p) => {
    try {
      await safeInvoke('personality_upsert', {
        id: p.id,
        name: p.name,
        description: p.description,
        systemPrompt: p.systemPrompt,
        temperature: p.temperature ?? null,
        modelOverride: p.modelOverride ?? null,
        icon: p.icon ?? null,
        isDefault: p.isDefault ?? false,
      }, undefined)
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deletePersonality: async (id) => {
    try {
      await safeInvoke('personality_delete', { id }, undefined)
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
