// ── Memory System (ported from Claude Code) ─────────────────────────────────
// Mirrors: claude-code-main/src/memory/ + memdir/
// Handles: CLAUDE.md loading, memory entries, conversation compaction
//
// Enhanced with:
// - Recursive CLAUDE.md discovery (parent directory walking)
// - LLM-powered compaction via Ollama
// - Memory hierarchy (session → project → global)
// - .claude/settings.json preferences loading

import { invoke } from '@tauri-apps/api/core'
import type { Message } from '../types'
import { extractTextContent, createSystemMessage } from '../types'

// ── Memory Configuration ───────────────────────────────────────────────────

export type MemoryConfig = {
  /** Project root directory */
  projectDir: string
  /** Global memory directory */
  globalMemoryDir?: string
  /** Maximum context size before compaction */
  maxContextTokens?: number
  /** Enable auto-compaction */
  autoCompact?: boolean
  /** Walk parent directories for CLAUDE.md files */
  walkParents?: boolean
  /** Maximum parent levels to walk */
  maxParentLevels?: number
}

// ── CLAUDE.md / Project Memory ─────────────────────────────────────────────
// Mirrors: claude-code-main/src/memory/claudemd.ts

const MEMORY_FILES = [
  'CLAUDE.md',
  '.claude/memory.md',
  '.claude/settings.json',
  'AGENTS.md',
]

/** Additional memory files for OpenCowork-specific features */
const COWORK_MEMORY_FILES = [
  '.cowork/memory.md',
  '.cowork/config.json',
  '.cowork/agents.md',
]

/**
 * Load project memory from standard files (CLAUDE.md, .claude/memory.md, etc.)
 * Enhanced: Also loads .cowork/* files and walks parent directories.
 */
export async function loadProjectMemory(
  projectDir: string,
  options?: { walkParents?: boolean; maxParentLevels?: number },
): Promise<string> {
  const parts: string[] = []
  const allFiles = [...MEMORY_FILES, ...COWORK_MEMORY_FILES]

  // Load from project directory
  for (const file of allFiles) {
    const fullPath = `${projectDir}/${file}`
    try {
      const content = await invoke<string>('fs_extract_text', { path: fullPath })
      if (content && content.trim().length > 0) {
        parts.push(`# ${file}\n\n${content.trim()}`)
      }
    } catch {
      // File doesn't exist — skip silently
    }
  }

  // Walk parent directories for CLAUDE.md (Claude Code feature)
  if (options?.walkParents !== false) {
    const maxLevels = options?.maxParentLevels ?? 3
    let currentDir = projectDir

    for (let i = 0; i < maxLevels; i++) {
      // Go up one directory
      const parentDir = getParentDir(currentDir)
      if (!parentDir || parentDir === currentDir) break
      currentDir = parentDir

      try {
        const content = await invoke<string>('fs_extract_text', { path: `${currentDir}/CLAUDE.md` })
        if (content && content.trim().length > 0) {
          parts.push(`# CLAUDE.md (${currentDir})\n\n${content.trim()}`)
        }
      } catch {
        // File doesn't exist — skip
      }
    }
  }

  return parts.join('\n\n---\n\n')
}

/**
 * Load global memory from the user's home directory
 */
export async function loadGlobalMemory(globalDir?: string): Promise<string> {
  if (!globalDir) return ''
  const parts: string[] = []

  for (const file of ['CLAUDE.md', '.cowork/memory.md']) {
    try {
      const content = await invoke<string>('fs_extract_text', { path: `${globalDir}/${file}` })
      if (content?.trim()) {
        parts.push(content.trim())
      }
    } catch {
      // skip
    }
  }

  return parts.join('\n\n')
}

/**
 * Load .claude/settings.json preferences
 */
export async function loadProjectSettings(projectDir: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await invoke<string>('fs_extract_text', { path: `${projectDir}/.claude/settings.json` })
    if (content) return JSON.parse(content)
  } catch {
    // no settings file
  }
  return null
}

/**
 * Save content to a project memory file
 */
export async function saveProjectMemory(projectDir: string, filename: string, content: string): Promise<void> {
  const fullPath = `${projectDir}/${filename}`
  await invoke('fs_write_text_file', {
    path: fullPath,
    content,
    createBackup: true,
  })
}

// ── Database-backed Memory ─────────────────────────────────────────────────

export type MemoryEntry = {
  id: string
  scope: 'global' | 'project' | 'session'
  key: string
  content: string
  category: string
  confidence: number
  createdAt: number
  updatedAt: number
}

type MemoryEntryRow = {
  id: string
  scope: string
  category: string
  key: string
  content: string
  confidence: number
  createdAt: string
  updatedAt: string
}

function toBackendMemoryScope(scope: MemoryEntry['scope'] | string | undefined): string | undefined {
  if (!scope) return undefined
  if (scope === 'project') return 'agent'
  if (scope === 'global') return 'shared'
  return scope
}

function fromBackendMemoryScope(scope: string): MemoryEntry['scope'] {
  if (scope === 'agent') return 'project'
  if (scope === 'shared') return 'global'
  return 'session'
}

export type RuntimeInstruction = {
  id: string
  scopeType: string
  scopeRef: string | null
  title: string
  content: string
  enabled: boolean
  priority: number
}

/**
 * Store a memory entry in the database
 */
export async function storeMemoryEntry(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const id = crypto.randomUUID()
  await invoke('memory_upsert', {
    id,
    scope: toBackendMemoryScope(entry.scope),
    key: entry.key,
    content: entry.content,
    category: entry.category,
    sourceSessionId: null,
    confidence: entry.confidence,
  })
  return id
}

/**
 * Retrieve memory entries from the database
 */
export async function getMemoryEntries(scope?: string, category?: string): Promise<MemoryEntry[]> {
  try {
    const rows = await invoke<MemoryEntryRow[]>('memory_search', {
      scope: toBackendMemoryScope(scope),
      category: category ?? null,
      keyword: null,
      limit: 200,
    })
    return rows.map((row) => ({
      id: row.id,
      scope: fromBackendMemoryScope(row.scope),
      key: row.key,
      content: row.content,
      category: row.category,
      confidence: row.confidence,
      createdAt: Date.parse(row.createdAt),
      updatedAt: Date.parse(row.updatedAt),
    }))
  } catch {
    return []
  }
}

export async function loadEffectiveRuntimeInstructions(projectDir: string): Promise<RuntimeInstruction[]> {
  try {
    return await invoke<RuntimeInstruction[]>('runtime_instruction_effective', { cwd: projectDir })
  } catch {
    return []
  }
}

export async function recallRelevantMemory(query: string, limit: number = 6): Promise<string[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  try {
    const rows = await invoke<Array<{ key: string; content: string; category: string }>>('memory_search', {
      keyword: trimmed,
      limit,
    })
    return rows
      .map((row) => `[${row.category}] ${row.key}: ${row.content}`)
      .filter(Boolean)
  } catch {
    return []
  }
}

// ── Conversation Compaction ────────────────────────────────────────────────
// Now delegates to services/compact.ts for LLM-powered compaction.
// This function is kept for backward compatibility.
// For advanced compaction, use ContextManager from services/contextManager.ts.

/**
 * Estimate token count for a message (rough: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Estimate total token count for a conversation
 */
export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => {
    return sum + estimateTokens(extractTextContent(msg))
  }, 0)
}

/**
 * Compact a conversation by summarizing older messages.
 * Returns a new message list with a summary system message replacing older messages.
 *
 * Note: For LLM-powered compaction, use autoCompact() from services/compact.ts
 */
export function compactConversation(
  messages: Message[],
  maxTokens: number = 100000,
): Message[] {
  const totalTokens = estimateConversationTokens(messages)
  if (totalTokens <= maxTokens) return messages

  // Find the split point — keep at least the last 10 messages
  const keepCount = Math.max(10, Math.floor(messages.length * 0.3))
  const toSummarize = messages.slice(0, messages.length - keepCount)
  const toKeep = messages.slice(messages.length - keepCount)

  // Summarize the older messages
  const summaryParts: string[] = []
  const toolUseSummaries: string[] = []

  for (const msg of toSummarize) {
    if (msg.type === 'assistant') {
      const text = extractTextContent(msg)
      if (text.length > 100) {
        summaryParts.push(`[Assistant]: ${text.slice(0, 200)}...`)
      }
      // Track tool uses
      const toolUses = msg.content.filter(b => b.type === 'tool_use')
      for (const tu of toolUses) {
        if (tu.type === 'tool_use') {
          toolUseSummaries.push(`${tu.name}(${JSON.stringify(tu.input).slice(0, 100)})`)
        }
      }
    } else if (msg.type === 'user') {
      const text = extractTextContent(msg)
      if (text.length > 50) {
        summaryParts.push(`[User]: ${text.slice(0, 150)}...`)
      }
    }
  }

  const summary = [
    `[Komprimierter Chatverlauf — ${toSummarize.length} Nachrichten zusammengefasst]`,
    '',
    'Zusammenfassung der bisherigen Konversation:',
    ...summaryParts.slice(0, 20),
    '',
    toolUseSummaries.length > 0 ? `Ausgefuehrte Tools: ${toolUseSummaries.slice(0, 15).join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const summaryMessage = createSystemMessage(summary, 'compact_boundary')

  return [summaryMessage, ...toKeep]
}

// ── System Prompt Builder ──────────────────────────────────────────────────

/**
 * Build the full system prompt including project memory and context.
 * Enhanced: Also loads .cowork/* files and project settings.
 */
export async function buildSystemPromptWithMemory(
  projectDir: string,
  basePrompt: string,
  options?: {
    globalDir?: string
    userInput?: string
  },
): Promise<{
  systemPrompt: string
  memoryContent: string
  settings: Record<string, unknown> | null
  runtimeInstructions: RuntimeInstruction[]
  recalledMemory: string[]
}> {
  const [projectMemory, globalMemory, settings, runtimeInstructions, recalledMemory] = await Promise.all([
    loadProjectMemory(projectDir),
    loadGlobalMemory(options?.globalDir),
    loadProjectSettings(projectDir),
    loadEffectiveRuntimeInstructions(projectDir),
    recallRelevantMemory(options?.userInput ?? ''),
  ])

  const instructionBlock = runtimeInstructions.length > 0
    ? runtimeInstructions
      .map((item) => `# ${item.title}\n${item.content}`)
      .join('\n\n---\n\n')
    : ''

  const recallBlock = recalledMemory.length > 0
    ? recalledMemory.join('\n')
    : ''

  const memoryContent = [globalMemory, projectMemory, instructionBlock, recallBlock]
    .filter(Boolean)
    .join('\n\n---\n\n')

  const systemPrompt = memoryContent
    ? `${basePrompt}\n\n<memory>\n${memoryContent}\n</memory>`
    : basePrompt

  return { systemPrompt, memoryContent, settings, runtimeInstructions, recalledMemory }
}

// ── Helper ─────────────────────────────────────────────────────────────────

function getParentDir(dir: string): string | null {
  // Windows path
  const winParts = dir.split('\\')
  if (winParts.length > 1) {
    winParts.pop()
    return winParts.join('\\')
  }
  // Unix path fallback
  const parts = dir.split('/')
  if (parts.length > 1) {
    parts.pop()
    return parts.join('/') || '/'
  }
  return null
}
