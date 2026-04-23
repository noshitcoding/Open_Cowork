// ── Session Persistence Service (ported from Claude Code) ──────────────────
// Mirrors: claude-code-main/src/services/session/
// Saves and restores conversation sessions via Tauri DB

import { invoke } from '@tauri-apps/api/core'
import type { Message, TokenUsage, AppState } from '../types'
import { generateUUID } from '../types'

// ── Types ──────────────────────────────────────────────────────────────────

export type SessionRecord = {
  id: string
  title: string
  cwd: string
  messages: Message[]
  totalUsage: TokenUsage
  totalCostUsd: number
  appState: Partial<AppState>
  createdAt: number
  updatedAt: number
}

export type SessionSummary = {
  id: string
  title: string
  cwd: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

type RawRecord = Record<string, unknown>

const asRecord = (value: unknown): RawRecord =>
  value && typeof value === 'object' ? value as RawRecord : {}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsedAsNumber = Number(value)
    if (Number.isFinite(parsedAsNumber)) return parsedAsNumber
    const parsedAsDate = Date.parse(value)
    if (Number.isFinite(parsedAsDate)) return parsedAsDate
  }
  return fallback
}

const normalizeSummary = (value: unknown): SessionSummary | null => {
  const row = asRecord(value)
  const id = asString(row.id)
  if (!id) return null

  const title = asString(row.title, 'Unbenannte Session')
  const cwd = asString(row.cwd)
  const messageCount = asNumber(row.messageCount ?? row.message_count, 0)
  const createdAt = asNumber(row.createdAt ?? row.created_at, Date.now())
  const updatedAt = asNumber(row.updatedAt ?? row.updated_at, createdAt)

  return {
    id,
    title,
    cwd,
    messageCount,
    createdAt,
    updatedAt,
  }
}

const parseMessage = (content: string): Message | null => {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') return null

    const message = parsed as RawRecord
    const type = asString(message.type)

    if (type) {
      return message as Message
    }

    // Backward compatibility: older rows may store { role, content, timestamp }
    const role = asString(message.role)
    const timestamp = asNumber(message.timestamp, Date.now())
    const uuid = asString(message.uuid, generateUUID())
    const textContent = asString(message.content)

    if (role === 'user') {
      return {
        type: 'user',
        uuid,
        content: [{ type: 'text', text: textContent }],
        timestamp,
      }
    }

    if (role === 'assistant') {
      return {
        type: 'assistant',
        uuid,
        content: [{ type: 'text', text: textContent }],
        model: asString(message.model, 'legacy'),
        stopReason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
        timestamp,
      }
    }

    if (role === 'system') {
      return {
        type: 'system',
        uuid,
        content: textContent,
        timestamp,
      }
    }

    return null
  } catch {
    return null
  }
}

// ── Save/Load ──────────────────────────────────────────────────────────────

/**
 * Save a session to the database.
 * Uses Tauri's db_save_thread + db_save_message to persist.
 */
export async function saveSession(session: SessionRecord): Promise<void> {
  // Save thread record
  await invoke('db_save_thread', {
    id: session.id,
    title: session.title,
    createdAt: new Date(session.createdAt).toISOString(),
  })

  // Save messages
  for (let i = 0; i < session.messages.length; i++) {
    const msg = session.messages[i]
    await invoke('db_save_message', {
      id: 'uuid' in msg ? (msg as { uuid: string }).uuid : `${session.id}-msg-${i}`,
      threadId: session.id,
      role: msg.type,
      content: JSON.stringify(msg),
      timestamp: 'timestamp' in msg ? (msg as { timestamp: number }).timestamp : Date.now(),
    })
  }
}

/**
 * Load a session from the database.
 */
export async function loadSession(sessionId: string): Promise<SessionRecord | null> {
  try {
    const threads = await invoke<unknown[]>('db_list_threads')
    const thread = Array.isArray(threads)
      ? threads
        .map(asRecord)
        .find((entry) => asString(entry.id) === sessionId)
      : undefined

    if (!thread) return null

    const rawMessages = await invoke<unknown[]>('db_list_messages', { threadId: sessionId })
    const parsedMessages = Array.isArray(rawMessages)
      ? rawMessages
        .map(asRecord)
        .sort((a, b) => asNumber(a.timestamp) - asNumber(b.timestamp))
        .map((m) => parseMessage(asString(m.content)))
        .filter((msg): msg is Message => msg !== null)
      : []

    const createdAt = asNumber(thread.createdAt ?? thread.created_at, Date.now())
    const updatedAt = asNumber(thread.updatedAt ?? thread.updated_at, createdAt)

    return {
      id: asString(thread.id),
      title: asString(thread.title, 'Unbenannte Session'),
      cwd: asString(thread.cwd),
      messages: parsedMessages,
      totalUsage: { input_tokens: 0, output_tokens: 0 },
      totalCostUsd: 0,
      appState: {},
      createdAt,
      updatedAt,
    }
  } catch {
    return null
  }
}

/**
 * List all saved sessions.
 */
export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const threads = await invoke<unknown[]>('db_list_threads')
    if (!Array.isArray(threads)) return []
    return threads
      .map(normalizeSummary)
      .filter((thread): thread is SessionSummary => thread !== null)
  } catch {
    return []
  }
}

/**
 * Delete a session from the database.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await invoke('db_delete_thread', { id: sessionId })
}

/**
 * Generate a title for a session from its first user message.
 */
export function generateSessionTitle(messages: Message[]): string {
  const firstUser = messages.find(m => m.type === 'user')
  if (!firstUser) return 'Neue Sitzung'

  const text = firstUser.type === 'user'
    ? firstUser.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join(' ')
    : ''

  if (!text) return 'Neue Sitzung'
  return text.length > 60 ? text.slice(0, 60) + '...' : text
}

/**
 * Auto-save current session (called periodically during conversation).
 */
export async function autoSaveSession(
  sessionId: string,
  title: string,
  cwd: string,
  messages: Message[],
  totalUsage: TokenUsage,
  totalCostUsd: number,
  appState: Partial<AppState>,
): Promise<void> {
  await saveSession({
    id: sessionId,
    title,
    cwd,
    messages,
    totalUsage,
    totalCostUsd,
    appState,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}
