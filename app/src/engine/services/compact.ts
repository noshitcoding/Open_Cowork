// ── Context Compaction Service (ported from Claude Code) ────────────────────
// Mirrors: claude-code-main/src/services/compact/
// Handles: auto-compaction, reactive compaction, token budget tracking
//
// When the conversation grows too long, this module compacts older messages
// into a concise summary, keeping the most recent context intact.

import type { Message } from '../types'
import { extractTextContent, createSystemMessage } from '../types'
import type { OllamaEngineConfig } from '../api/ollamaClient'
import { sampleOllamaMessage } from '../api/ollamaClient'

// ── Token Budget Tracker ───────────────────────────────────────────────────

export type TokenBudgetState = {
  /** Estimated total context tokens */
  estimatedContextTokens: number
  /** Maximum context tokens before compaction triggers */
  compactionThreshold: number
  /** Warning threshold (percentage of max) */
  warningThreshold: number
  /** Consecutive prompt-too-long errors */
  promptTooLongCount: number
  /** Last compaction timestamp */
  lastCompactionAt: number
}

export function createTokenBudget(maxTokens: number): TokenBudgetState {
  return {
    estimatedContextTokens: 0,
    compactionThreshold: Math.floor(maxTokens * 0.8),
    warningThreshold: 0.7,
    promptTooLongCount: 0,
    lastCompactionAt: 0,
  }
}

/** Rough token estimation: ~4 chars per token for mixed text/code */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Estimate total tokens in conversation */
export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => {
    return sum + estimateTokens(extractTextContent(msg))
  }, 0)
}

/** Check if compaction is needed */
export function shouldAutoCompact(
  messages: Message[],
  budget: TokenBudgetState,
): boolean {
  const currentTokens = estimateConversationTokens(messages)
  return currentTokens >= budget.compactionThreshold
}

/** Check token warning state (Claude Code: calculateTokenWarningState) */
export function getTokenWarningLevel(
  messages: Message[],
  budget: TokenBudgetState,
): 'none' | 'warning' | 'critical' {
  const currentTokens = estimateConversationTokens(messages)
  const ratio = currentTokens / budget.compactionThreshold
  if (ratio >= 1.0) return 'critical'
  if (ratio >= budget.warningThreshold) return 'warning'
  return 'none'
}

// ── Auto-Compaction ────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/services/compact/autoCompact.ts
// When context exceeds threshold, summarize older messages via LLM call.

const COMPACTION_PROMPT = `Du bist ein Kontext-Komprimierer. Fasse die bisherige Konversation praezise zusammen. Behalte:

1. **Aufgabe/Ziel**: Was der Benutzer erreichen will
2. **Getroffene Entscheidungen**: Welche Ans??tze gewaehlt wurden
3. **Ausgefuehrte Aenderungen**: Welche Dateien bearbeitet, welche Tools genutzt
4. **Offene Punkte**: Was noch zu tun ist
5. **Wichtiger Kontext**: Dateipfade, Konfigurationen, Fehlermeldungen

Antworte NUR mit der Zusammenfassung, keine Meta-Kommentare.`

/**
 * Compact conversation using LLM-based summarization.
 * Returns new message array with compact boundary.
 */
export async function autoCompact(
  messages: Message[],
  ollamaConfig: OllamaEngineConfig,
  options?: {
    keepLastN?: number
    maxSummaryTokens?: number
    signal?: AbortSignal
  },
): Promise<{ messages: Message[]; summary: string; removedCount: number }> {
  const keepLastN = options?.keepLastN ?? 10

  if (messages.length <= keepLastN) {
    return { messages, summary: '', removedCount: 0 }
  }

  const toSummarize = messages.slice(0, messages.length - keepLastN)
  const toKeep = messages.slice(messages.length - keepLastN)

  // Build conversation text for summarization
  const conversationText = toSummarize
    .map(msg => {
      const role = msg.type === 'assistant' ? 'Assistant' : msg.type === 'user' ? 'User' : 'System'
      const text = extractTextContent(msg)
      if (!text.trim()) return null

      // Include tool use info
      if (msg.type === 'assistant') {
        const toolUses = msg.content
          .filter(b => b.type === 'tool_use')
          .map(b => {
            if (b.type === 'tool_use') {
              return `[Tool: ${b.name}(${JSON.stringify(b.input).slice(0, 150)})]`
            }
            return ''
          })
        const parts = [text.slice(0, 500)]
        if (toolUses.length > 0) parts.push(toolUses.join('\n'))
        return `[${role}]: ${parts.join('\n')}`
      }

      return `[${role}]: ${text.slice(0, 300)}`
    })
    .filter(Boolean)
    .join('\n\n')

  // Call LLM for summary
  try {
    const result = await sampleOllamaMessage(
      ollamaConfig,
      [{ role: 'user', content: `Fasse die folgende Konversation zusammen:\n\n${conversationText}` }],
      COMPACTION_PROMPT,
      undefined,
      options?.signal,
    )

    const summary = result.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    // Create compact boundary message
    const boundaryMessage = createSystemMessage(
      `[Kontext komprimiert — ${toSummarize.length} Nachrichten zusammengefasst]\n\n${summary}`,
      'compact_boundary',
    )

    return {
      messages: [boundaryMessage, ...toKeep],
      summary,
      removedCount: toSummarize.length,
    }
  } catch {
    // Fallback: simple text-based compaction without LLM
    return fallbackCompact(messages, keepLastN)
  }
}

/**
 * Simple compaction without LLM (fallback when API is unavailable).
 * Mirrors the basic approach in the existing memorySystem.ts.
 */
export function fallbackCompact(
  messages: Message[],
  keepLastN: number = 10,
): { messages: Message[]; summary: string; removedCount: number } {
  if (messages.length <= keepLastN) {
    return { messages, summary: '', removedCount: 0 }
  }

  const toSummarize = messages.slice(0, messages.length - keepLastN)
  const toKeep = messages.slice(messages.length - keepLastN)

  const summaryParts: string[] = []
  const toolSummaries: string[] = []

  for (const msg of toSummarize) {
    if (msg.type === 'assistant') {
      const text = extractTextContent(msg)
      if (text.length > 100) {
        summaryParts.push(`[Assistant]: ${text.slice(0, 200)}...`)
      }
      const toolUses = msg.content.filter(b => b.type === 'tool_use')
      for (const tu of toolUses) {
        if (tu.type === 'tool_use') {
          toolSummaries.push(`${tu.name}(${JSON.stringify(tu.input).slice(0, 100)})`)
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
    `[Komprimiert: ${toSummarize.length} Nachrichten]`,
    '',
    ...summaryParts.slice(0, 20),
    toolSummaries.length > 0 ? `\nTools: ${toolSummaries.slice(0, 15).join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const boundaryMessage = createSystemMessage(summary, 'compact_boundary')

  return {
    messages: [boundaryMessage, ...toKeep],
    summary,
    removedCount: toSummarize.length,
  }
}

// ── Tool Result Budget ─────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/utils/toolResultStorage.ts
// Truncates large tool results to save tokens.

const MAX_TOOL_RESULT_CHARS = 30000
const TRUNCATION_NOTICE = '\n\n[... Ergebnis abgeschnitten (zu lang) ...]'

/**
 * Apply a budget to tool results in messages.
 * Large tool results are truncated to save context tokens.
 */
export function applyToolResultBudget(messages: Message[]): Message[] {
  return messages.map(msg => {
    if (msg.type !== 'user') return msg

    const hasToolResults = msg.content.some(b => b.type === 'tool_result')
    if (!hasToolResults) return msg

    const budgetedContent = msg.content.map(block => {
      if (block.type !== 'tool_result') return block
      if (block.content.length <= MAX_TOOL_RESULT_CHARS) return block
      return {
        ...block,
        content: block.content.slice(0, MAX_TOOL_RESULT_CHARS) + TRUNCATION_NOTICE,
      }
    })

    return { ...msg, content: budgetedContent }
  })
}

// ── Tool Use Summary Generation ────────────────────────────────────────────
// Mirrors: claude-code-main/src/services/toolUseSummary/
// Creates compact summaries of tool executions for token efficiency.

export function generateToolUseSummary(
  toolName: string,
  input: Record<string, unknown>,
  result: string,
): string {
  const inputSnippet = JSON.stringify(input).slice(0, 100)
  const resultSnippet = result.slice(0, 200)

  switch (toolName) {
    case 'Read':
    case 'read_file':
      return `[Read ${input.file_path ?? '?'}]: ${resultSnippet}…`
    case 'Write':
    case 'write_file':
      return `[Write ${input.file_path ?? '?'}]: Geschrieben`
    case 'Edit':
    case 'edit_file':
      return `[Edit ${input.file_path ?? '?'}]: Bearbeitet`
    case 'Bash':
    case 'bash':
      return `[Bash]: ${(input.command as string)?.slice(0, 80) ?? '?'} → ${resultSnippet}`
    case 'Grep':
    case 'grep':
      return `[Grep ${input.pattern ?? '?'}]: ${resultSnippet}`
    case 'Glob':
    case 'glob':
      return `[Glob ${input.pattern ?? '?'}]: ${resultSnippet}`
    default:
      return `[${toolName}(${inputSnippet})]: ${resultSnippet}`
  }
}

// ── Messages After Compact Boundary ────────────────────────────────────────
// Mirrors: claude-code-main helper — only query messages after last compact boundary

export function getMessagesAfterCompactBoundary(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'system' &&
        (messages[i] as { injectionPoint?: string }).injectionPoint === 'compact_boundary') {
      return messages.slice(i)
    }
  }
  return messages
}
