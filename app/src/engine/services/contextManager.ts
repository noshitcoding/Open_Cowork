// ── Context Manager Service (ported from Claude Code) ──────────────────────
// Mirrors: claude-code-main/src/services/context/
// Tracks token budgets, manages context window, triggers compaction

import type { Message } from '../types'
import { estimateConversationTokens } from './compact'
import {
  type TokenBudgetState,
  createTokenBudget,
  shouldAutoCompact,
  getTokenWarningLevel,
  autoCompact,
  applyToolResultBudget,
  getMessagesAfterCompactBoundary,
} from './compact'
import type { OllamaEngineConfig } from '../api/ollamaClient'

// ── Context Manager ────────────────────────────────────────────────────────

export type ContextManagerConfig = {
  /** Maximum context tokens before compaction */
  maxContextTokens: number
  /** Number of recent messages to keep during compaction */
  keepLastN: number
  /** Enable auto-compaction */
  autoCompactEnabled: boolean
  /** Enable tool result budget (truncating large tool results) */
  toolResultBudgetEnabled: boolean
  /** Maximum retries for prompt-too-long errors */
  maxPromptTooLongRetries: number
}

export const DEFAULT_CONTEXT_MANAGER_CONFIG: ContextManagerConfig = {
  maxContextTokens: 120000,
  keepLastN: 10,
  autoCompactEnabled: true,
  toolResultBudgetEnabled: true,
  maxPromptTooLongRetries: 2,
}

export type ContextSnapshot = {
  totalTokens: number
  warningLevel: 'none' | 'warning' | 'critical'
  compactionCount: number
  lastCompactionAt: number | null
  messageCount: number
  activeMessageCount: number
}

export class ContextManager {
  private config: ContextManagerConfig
  private budget: TokenBudgetState
  private compactionCount = 0

  constructor(
    config: Partial<ContextManagerConfig> = {},
    maxContextTokens?: number,
  ) {
    this.config = { ...DEFAULT_CONTEXT_MANAGER_CONFIG, ...config }
    if (maxContextTokens) {
      this.config.maxContextTokens = maxContextTokens
    }
    this.budget = createTokenBudget(this.config.maxContextTokens)
  }

  /** Get current context status snapshot */
  getSnapshot(messages: Message[]): ContextSnapshot {
    const totalTokens = estimateConversationTokens(messages)
    const activeMessages = getMessagesAfterCompactBoundary(messages)
    return {
      totalTokens,
      warningLevel: getTokenWarningLevel(messages, this.budget),
      compactionCount: this.compactionCount,
      lastCompactionAt: this.budget.lastCompactionAt || null,
      messageCount: messages.length,
      activeMessageCount: activeMessages.length,
    }
  }

  /** Check if auto-compaction should trigger */
  shouldCompact(messages: Message[]): boolean {
    if (!this.config.autoCompactEnabled) return false
    return shouldAutoCompact(messages, this.budget)
  }

  /** Run auto-compaction on messages if needed */
  async compactIfNeeded(
    messages: Message[],
    ollamaConfig: OllamaEngineConfig,
    signal?: AbortSignal,
  ): Promise<{ messages: Message[]; didCompact: boolean; summary?: string }> {
    if (!this.shouldCompact(messages)) {
      return { messages, didCompact: false }
    }

    const result = await autoCompact(messages, ollamaConfig, {
      keepLastN: this.config.keepLastN,
      signal,
    })

    if (result.removedCount > 0) {
      this.compactionCount++
      this.budget = {
        ...this.budget,
        lastCompactionAt: Date.now(),
        promptTooLongCount: 0,
      }
    }

    return {
      messages: result.messages,
      didCompact: result.removedCount > 0,
      summary: result.summary,
    }
  }

  /** Apply tool result budget to messages */
  applyBudget(messages: Message[]): Message[] {
    if (!this.config.toolResultBudgetEnabled) return messages
    return applyToolResultBudget(messages)
  }

  /**
   * Handle prompt-too-long error.
   * Returns compacted messages if retry is possible, null if retries exhausted.
   */
  async handlePromptTooLong(
    messages: Message[],
    ollamaConfig: OllamaEngineConfig,
    signal?: AbortSignal,
  ): Promise<Message[] | null> {
    this.budget = {
      ...this.budget,
      promptTooLongCount: this.budget.promptTooLongCount + 1,
    }

    if (this.budget.promptTooLongCount > this.config.maxPromptTooLongRetries) {
      return null
    }

    // Force compaction with aggressive settings
    const result = await autoCompact(messages, ollamaConfig, {
      keepLastN: Math.min(5, this.config.keepLastN),
      signal,
    })

    if (result.removedCount > 0) {
      this.compactionCount++
      this.budget = { ...this.budget, lastCompactionAt: Date.now() }
      return result.messages
    }

    return null
  }

  /** Reset prompt-too-long counter (call after successful API response) */
  resetPromptTooLongCount(): void {
    this.budget = { ...this.budget, promptTooLongCount: 0 }
  }

  /** Update max context tokens (e.g. when switching models) */
  updateMaxTokens(maxTokens: number): void {
    this.config.maxContextTokens = maxTokens
    this.budget = createTokenBudget(maxTokens)
  }
}
