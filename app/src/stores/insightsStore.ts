import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type InsightsEvent = {
  id: string
  event_type: string
  category: string
  value_num: number | null
  value_text: string | null
  session_id: string | null
  metadata_json: string | null
  created_at: string
}

export type CategoryCount = {
  category: string
  count: number
}

export type EventSummary = {
  eventType: string
  category: string
  valueText: string | null
  createdAt: string
}

export type InsightsSummary = {
  totalEvents: number
  totalSessions: number
  totalMessagesSent: number
  totalTokensEst: number
  avgSessionDurationMin: number
  topCategories: CategoryCount[]
  recentEvents: EventSummary[]
  skillUsageCount: number
  memoryEntryCount: number
}

type RawRecord = Record<string, unknown>

const asRecord = (value: unknown): RawRecord =>
  value && typeof value === 'object' ? value as RawRecord : {}

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const asArray = <T>(value: unknown, mapItem: (item: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(mapItem) : []

const normalizeEvent = (value: unknown): InsightsEvent => {
  const event = asRecord(value)
  return {
    id: asString(event.id),
    event_type: asString(event.event_type ?? event.eventType),
    category: asString(event.category),
    value_num: typeof (event.value_num ?? event.valueNum) === 'number' ? event.value_num as number : null,
    value_text: asNullableString(event.value_text ?? event.valueText),
    session_id: asNullableString(event.session_id ?? event.sessionId),
    metadata_json: asNullableString(event.metadata_json ?? event.metadataJson),
    created_at: asString(event.created_at ?? event.createdAt),
  }
}

const normalizeSummaryEvent = (value: unknown): EventSummary => {
  const event = asRecord(value)
  return {
    eventType: asString(event.eventType ?? event.event_type),
    category: asString(event.category),
    valueText: asNullableString(event.valueText ?? event.value_text),
    createdAt: asString(event.createdAt ?? event.created_at),
  }
}

const normalizeCategory = (value: unknown): CategoryCount => {
  const category = asRecord(value)
  return {
    category: asString(category.category),
    count: asNumber(category.count),
  }
}

const normalizeSummary = (value: unknown): InsightsSummary => {
  const summary = asRecord(value)
  return {
    totalEvents: asNumber(summary.totalEvents ?? summary.total_events),
    totalSessions: asNumber(summary.totalSessions ?? summary.total_sessions),
    totalMessagesSent: asNumber(summary.totalMessagesSent ?? summary.total_messages_sent),
    totalTokensEst: asNumber(summary.totalTokensEst ?? summary.total_tokens_est),
    avgSessionDurationMin: asNumber(summary.avgSessionDurationMin ?? summary.avg_session_duration_min),
    topCategories: asArray(summary.topCategories ?? summary.top_categories, normalizeCategory),
    recentEvents: asArray(summary.recentEvents ?? summary.recent_events, normalizeSummaryEvent),
    skillUsageCount: asNumber(summary.skillUsageCount ?? summary.skill_usage_count),
    memoryEntryCount: asNumber(summary.memoryEntryCount ?? summary.memory_entry_count),
  }
}

type InsightsState = {
  events: InsightsEvent[]
  summary: InsightsSummary | null
  loading: boolean
  error: string | null

  loadEvents: (category?: string, limit?: number) => Promise<void>
  recordEvent: (e: {
    eventType: string; category: string
    valueNum?: number; valueText?: string
    sessionId?: string; metadataJson?: string
  }) => Promise<string>
  loadSummary: () => Promise<void>
}

export const useInsightsStore = create<InsightsState>()((set) => ({
  events: [],
  summary: null,
  loading: false,
  error: null,

  loadEvents: async (category, limit = 100) => {
    set({ loading: true, error: null })
    try {
      const events = await invoke<unknown[]>('insights_list', {
        category: category ?? null,
        limit,
      })
      set({ events: asArray(events, normalizeEvent), loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  recordEvent: async (e) => {
    const id = await invoke<string>('insights_record', {
      eventType: e.eventType,
      category: e.category,
      valueNum: e.valueNum ?? null,
      valueText: e.valueText ?? null,
      sessionId: e.sessionId ?? null,
      metadataJson: e.metadataJson ?? null,
    })
    return id
  },

  loadSummary: async () => {
    set({ loading: true, error: null })
    try {
      const summary = await invoke<unknown>('insights_summary')
      set({ summary: normalizeSummary(summary), loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },
}))
