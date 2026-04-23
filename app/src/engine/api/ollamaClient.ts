// ── Ollama API Client (browser-compatible) ──────────────────────────────────
// Talks to Ollama's /api/chat endpoint with tool support.
// Returns the same StreamEvent + SampleResult types as anthropicClient.ts
// so QueryEngine can use either backend interchangeably.
//
// Enhanced with:
// - Retry logic for connection failures
// - Thinking/reasoning support (reflexion models)
// - Better tool call edge case handling
// - Model capability detection

import type {
  ContentBlock,
  StreamEvent,
  TokenUsage,
  ToolInputSchema,
} from '../types'
import { EMPTY_USAGE } from '../types'
import { invoke } from '@tauri-apps/api/core'

// ── Configuration ──────────────────────────────────────────────────────────

export type OllamaEngineConfig = {
  baseUrl: string
  model: string
  temperature?: number
  contextWindow?: number
  timeoutMs?: number
  /** Enable thinking/reasoning mode if model supports it */
  thinkingEnabled?: boolean
  /** Keep-alive duration for model in memory */
  keepAlive?: string
}

// ── Model Capabilities ─────────────────────────────────────────────────────

export type OllamaModelCapabilities = {
  supportsTools: boolean
  supportsThinking: boolean
  contextLength: number
  family: string
}

/** Known model families and their capabilities */
const MODEL_CAPABILITIES: Record<string, Partial<OllamaModelCapabilities>> = {
  'gpt-oss': { supportsTools: true, supportsThinking: true },
  'qwen': { supportsTools: true, supportsThinking: true },
  'llama': { supportsTools: true, supportsThinking: false },
  'mistral': { supportsTools: true, supportsThinking: false },
  'deepseek': { supportsTools: true, supportsThinking: true },
  'command-r': { supportsTools: true, supportsThinking: false },
  'gemma': { supportsTools: false, supportsThinking: false },
  'phi': { supportsTools: true, supportsThinking: false },
  'codellama': { supportsTools: false, supportsThinking: false },
}

/**
 * Detect model capabilities from model name.
 */
export function detectModelCapabilities(model: string): OllamaModelCapabilities {
  const lower = model.toLowerCase()

  for (const [family, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (lower.includes(family)) {
      return {
        supportsTools: caps.supportsTools ?? true,
        supportsThinking: caps.supportsThinking ?? false,
        contextLength: 0,
        family,
      }
    }
  }

  // Default: assume tools supported
  return {
    supportsTools: true,
    supportsThinking: false,
    contextLength: 0,
    family: 'unknown',
  }
}

// ── API Types (Ollama /api/chat format) ────────────────────────────────────

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: OllamaToolCall[]
}

type OllamaToolCall = {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

type OllamaToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolInputSchema
  }
}

type OllamaStreamChunk = {
  model: string
  message: {
    role: string
    content?: string
    thinking?: string
    reasoning_content?: string
    tool_calls?: OllamaToolCall[]
  }
  done: boolean
  done_reason?: string
  total_duration?: number
  eval_count?: number
  prompt_eval_count?: number
}

// ── Re-export SampleResult for compatibility ───────────────────────────────

export type SampleResult = {
  content: ContentBlock[]
  model: string
  stopReason: string | null
  usage: TokenUsage
  costUsd: number
}

type TauriChatTurnResponse = {
  endpoint: string
  model: string
  assistantMessage: string
  requiresApproval: boolean
  proposedPlan: string[]
}

type TauriOllamaHealthResponse = {
  ok: boolean
  endpoint: string
  model: string
  latencyMs: number
  version?: string | null
  models: string[]
  error?: string | null
}

type TauriChatHistoryItem = {
  role: string
  content: string
}

type EngineToolDef = {
  name: string
  description: string
  input_schema: ToolInputSchema
}

const TEXTUAL_TOOL_NAME_ALIASES: Record<string, string> = {
  webfetch: 'WebFetch',
  web_fetch: 'WebFetch',
  websearch: 'WebSearch',
  web_search: 'WebSearch',
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  listdir: 'ListDir',
  list_dir: 'ListDir',
  askuser: 'AskUser',
  ask_user: 'AskUser',
  enterplanmode: 'EnterPlanMode',
  enter_plan_mode: 'EnterPlanMode',
  exitplanmode: 'ExitPlanMode',
  exit_plan_mode: 'ExitPlanMode',
  mcptool: 'MCPTool',
}

function getPrimaryToolInputKey(tool: EngineToolDef): string | null {
  const required = Array.isArray(tool.input_schema.required)
    ? tool.input_schema.required.find((key) => typeof key === 'string' && key.trim().length > 0)
    : null

  if (required) return required

  const properties = tool.input_schema.properties ?? {}
  const [firstKey] = Object.keys(properties)
  return firstKey ?? null
}

function stripWrappingQuotes(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length < 2) return null

  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (!((first === '"' && last === '"') || (first === '\'' && last === '\''))) {
    return null
  }

  const inner = trimmed.slice(1, -1)
  if (first === '"') {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return inner
    }
  }

  return inner.replace(/\\'/g, '\'').replace(/\\"/g, '"')
}

function buildToolLookup(tools?: EngineToolDef[]): Map<string, EngineToolDef> {
  const lookup = new Map<string, EngineToolDef>()

  for (const tool of tools ?? []) {
    lookup.set(tool.name.toLowerCase(), tool)
    lookup.set(tool.name.replace(/[^a-z0-9]/gi, '').toLowerCase(), tool)
  }

  for (const [alias, canonical] of Object.entries(TEXTUAL_TOOL_NAME_ALIASES)) {
    const tool = lookup.get(canonical.toLowerCase())
      ?? lookup.get(canonical.replace(/[^a-z0-9]/gi, '').toLowerCase())
    if (tool) {
      lookup.set(alias.toLowerCase(), tool)
    }
  }

  return lookup
}

function parseTextualToolCallLine(
  line: string,
  toolLookup: Map<string, EngineToolDef>,
): OllamaToolCall | null {
  const normalized = line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^`(.+)`$/u, '$1')

  const match = normalized.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/)
  if (!match) return null

  const rawToolName = match[1]
  const rawArgs = match[2].trim()
  const tool = toolLookup.get(rawToolName.toLowerCase())
    ?? toolLookup.get(rawToolName.replace(/[^a-z0-9]/gi, '').toLowerCase())
  if (!tool) return null

  if (rawArgs.length === 0) {
    return {
      function: {
        name: tool.name,
        arguments: {},
      },
    }
  }

  if (rawArgs.startsWith('{') && rawArgs.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawArgs) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          function: {
            name: tool.name,
            arguments: parsed,
          },
        }
      }
    } catch {
      // Fall through to simpler parsers.
    }
  }

  const primaryKey = getPrimaryToolInputKey(tool)
  if (!primaryKey) return null

  const quotedValue = stripWrappingQuotes(rawArgs)
  if (quotedValue !== null) {
    return {
      function: {
        name: tool.name,
        arguments: { [primaryKey]: quotedValue },
      },
    }
  }

  const namedMatch = rawArgs.match(/^([A-Za-z][A-Za-z0-9_]*)\s*[:=]\s*(.+)$/)
  if (namedMatch) {
    return {
      function: {
        name: tool.name,
        arguments: {
          [namedMatch[1]]: stripWrappingQuotes(namedMatch[2]) ?? namedMatch[2].trim(),
        },
      },
    }
  }

  return {
    function: {
      name: tool.name,
      arguments: { [primaryKey]: rawArgs },
    },
  }
}

function extractTextualToolCalls(
  fullText: string,
  tools?: EngineToolDef[],
): { text: string; toolCalls: OllamaToolCall[] } {
  if (!fullText.trim() || !tools || tools.length === 0) {
    return { text: fullText, toolCalls: [] }
  }

  const toolLookup = buildToolLookup(tools)
  const lines = fullText.split(/\r?\n/)
  const toolCalls: OllamaToolCall[] = []
  const keptLines: string[] = []

  for (const line of lines) {
    const parsed = parseTextualToolCallLine(line, toolLookup)
    if (parsed) {
      toolCalls.push(parsed)
      continue
    }
    keptLines.push(line)
  }

  if (toolCalls.length === 0) {
    const singleLineCall = parseTextualToolCallLine(fullText.trim(), toolLookup)
    if (!singleLineCall) {
      return { text: fullText, toolCalls: [] }
    }
    return { text: '', toolCalls: [singleLineCall] }
  }

  return {
    text: keptLines.join('\n').trim(),
    toolCalls,
  }
}

// ── Streaming API ──────────────────────────────────────────────────────────

/**
 * Stream a message from Ollama's /api/chat endpoint.
 * Returns the same async generator interface as anthropicClient.streamMessages()
 *
 * Enhanced with:
 * - Connection retry logic
 * - Better tool call parsing (handles edge cases)
 * - Thinking/reasoning content support
 */
export async function* streamOllamaMessages(
  config: OllamaEngineConfig,
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>,
  systemPrompt: string,
  tools?: EngineToolDef[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, SampleResult> {
  const baseUrl = config.baseUrl.replace(/\/$/, '')

  // Detect model capabilities
  const capabilities = detectModelCapabilities(config.model)

  // Convert messages to Ollama format
  const ollamaMessages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const msg of messages) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content
          .map((block) => {
            if (block.type === 'text') return block.text
            if (block.type === 'tool_result') return `[Tool Result ${block.tool_use_id}]: ${block.content}`
            if (block.type === 'thinking') return '' // skip thinking blocks in history
            return ''
          })
          .filter(Boolean)
          .join('\n')

    // Check if this message contains tool results
    if (typeof msg.content !== 'string') {
      const toolResults = msg.content.filter(
        (b): b is { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean } =>
          b.type === 'tool_result',
      )
      if (toolResults.length > 0) {
        // Insert tool results as tool role messages
        for (const tr of toolResults) {
          ollamaMessages.push({
            role: 'tool',
            content: tr.content,
          })
        }
        continue
      }
    }

    ollamaMessages.push({ role: msg.role, content })
  }

  // Convert tools to Ollama format (only if model supports tools)
  const ollamaTools: OllamaToolDef[] | undefined = (tools && capabilities.supportsTools)
    ? tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }))
    : undefined

  const body: Record<string, unknown> = {
    model: config.model,
    messages: ollamaMessages,
    stream: true,
  }

  const requestedThinking = config.thinkingEnabled ?? capabilities.supportsThinking
  if (requestedThinking) {
    body.think = capabilities.family === 'gpt-oss' ? 'medium' : true
  } else if (config.thinkingEnabled === false && capabilities.family !== 'gpt-oss') {
    body.think = false
  }

  if (ollamaTools && ollamaTools.length > 0) {
    body.tools = ollamaTools
  }

  const options: Record<string, unknown> = {}
  if (config.temperature !== undefined) {
    options.temperature = config.temperature
  }
  if (config.contextWindow) {
    options.num_ctx = config.contextWindow
  }
  if (Object.keys(options).length > 0) {
    body.options = options
  }

  if (config.keepAlive) {
    body.keep_alive = config.keepAlive
  }

  const controller = new AbortController()
  if (signal) {
    signal.addEventListener('abort', () => controller.abort())
  }

  const timeoutMs = Math.max(1000, config.timeoutMs ?? 200_000)
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  // ── Retry Logic ─────────────────────────────────────────────────────────
  let response: Response
  const maxRetries = 2
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Ollama API Error ${response.status}: ${errorBody}`)
      }

      lastError = null
      break
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Don't retry on abort or non-retriable errors
      if (controller.signal.aborted) throw lastError
      if (lastError.message.includes('API Error 4')) throw lastError // 4xx errors

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  if (lastError) {
    clearTimeout(timeoutHandle)
    const fallbackResult = await invokeTauriChatFallback(config, messages, systemPrompt, tools)
    return fallbackResult
  }
  response = response!

  const reader = response.body?.getReader()
  if (!reader) {
    clearTimeout(timeoutHandle)
    const fallbackResult = await invokeTauriChatFallback(config, messages, systemPrompt, tools)
    return fallbackResult
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let thinkingText = ''
  let isInThinkingBlock = false
  const toolCalls: OllamaToolCall[] = []
  let modelId = config.model
  let promptTokens = 0
  let completionTokens = 0
  let stopReason: string | null = null

  // Emit message_start
  yield {
    type: 'message_start',
    message: { id: `ollama-${Date.now()}`, model: modelId, usage: { ...EMPTY_USAGE } },
  }

  // Start a text content block
  let blockIndex = 0
  yield {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        let chunk: OllamaStreamChunk
        try {
          chunk = JSON.parse(line)
        } catch {
          continue
        }

        modelId = chunk.model || modelId

        // Native thinking field (Ollama thinking API)
        const thinkingChunk = chunk.message?.thinking ?? chunk.message?.reasoning_content
        if (thinkingChunk) {
          thinkingText += thinkingChunk
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: thinkingChunk },
          }
        }

        // Text content — with fallback <think> tag detection for older models
        if (chunk.message?.content) {
          let text = chunk.message.content

          // Detect <think>...</think> blocks for reasoning models
          if (requestedThinking) {
            if (text.includes('<think>')) {
              isInThinkingBlock = true
              text = text.replace('<think>', '')
            }
            if (isInThinkingBlock && text.includes('</think>')) {
              isInThinkingBlock = false
              const parts = text.split('</think>')
              thinkingText += parts[0]
              // Emit thinking block
              yield {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: parts[0] },
              }
              // Remaining text after </think> is normal content
              text = parts.slice(1).join('')
            }

            if (isInThinkingBlock) {
              thinkingText += text
              yield {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: text },
              }
              continue
            }
          }

          if (text) {
            fullText += text
            yield {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text },
            }
          }
        }

        // Tool calls
        if (chunk.message?.tool_calls) {
          toolCalls.push(...chunk.message.tool_calls)
        }

        // Final chunk
        if (chunk.done) {
          promptTokens = chunk.prompt_eval_count ?? 0
          completionTokens = chunk.eval_count ?? 0
          stopReason = chunk.done_reason ?? 'stop'
        }
      }
    }
  } finally {
    clearTimeout(timeoutHandle)
    reader.releaseLock()
  }

  // Close text content block
  yield { type: 'content_block_stop', index: 0 }

  if (!fullText.trim() && !thinkingText.trim() && toolCalls.length === 0) {
    return await invokeTauriChatFallback(config, messages, systemPrompt, tools)
  }

  // Build result content blocks
  const resultContent: ContentBlock[] = []

  // Add thinking block if present
  if (thinkingText) {
    resultContent.push({ type: 'thinking', thinking: thinkingText })
  }

  if (toolCalls.length === 0 && fullText.trim()) {
    const extracted = extractTextualToolCalls(fullText, tools)
    if (extracted.toolCalls.length > 0) {
      fullText = extracted.text
      toolCalls.push(...extracted.toolCalls)
    }
  }

  if (fullText) {
    resultContent.push({ type: 'text', text: fullText })
  }

  // Convert tool calls to ContentBlock tool_use format
  if (toolCalls.length > 0) {
    stopReason = 'tool_use'
    for (const tc of toolCalls) {
      blockIndex++
      const toolUseId = `ollama-tool-${Date.now()}-${blockIndex}`
      const toolBlock: ContentBlock = {
        type: 'tool_use',
        id: toolUseId,
        name: tc.function.name,
        input: tc.function.arguments,
      }
      resultContent.push(toolBlock)

      // Emit tool_use as a content block
      yield {
        type: 'content_block_start',
        index: blockIndex,
        content_block: toolBlock,
      }
      yield { type: 'content_block_stop', index: blockIndex }
    }
  }

  // Final usage
  const usage: TokenUsage = {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
  }

  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason ?? 'stop' },
    usage,
  }
  yield { type: 'message_stop' }

  return {
    content: resultContent,
    model: modelId,
    stopReason,
    usage,
    costUsd: 0, // Local models have no cost
  }
}

function blockContentToText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'tool_result') return `[Tool Result ${block.tool_use_id}]: ${block.content}`
      if (block.type === 'thinking') return block.thinking
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

async function invokeTauriChatFallback(
  config: OllamaEngineConfig,
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>,
  systemPrompt: string,
  tools?: EngineToolDef[],
): Promise<SampleResult> {
  const history: TauriChatHistoryItem[] = messages.map((msg) => ({
    role: msg.role,
    content: blockContentToText(msg.content),
  }))

  const lastUserIndex = [...history].map((m, i) => ({ ...m, i })).reverse().find((m) => m.role === 'user')?.i
  const prompt = lastUserIndex !== undefined ? history[lastUserIndex].content : (history.at(-1)?.content ?? '')
  const promptWithSystem = systemPrompt.trim().length > 0
    ? `System:\n${systemPrompt}\n\nUser:\n${prompt}`
    : prompt
  const priorHistory = lastUserIndex !== undefined
    ? history.slice(0, lastUserIndex)
    : history.slice(0, Math.max(0, history.length - 1))

  const fallback = await invoke<TauriChatTurnResponse>('chat_turn', {
    request: {
      prompt: promptWithSystem,
      history: priorHistory,
      config: {
        baseUrl: config.baseUrl,
        model: config.model,
        timeoutMs: Math.max(1000, config.timeoutMs ?? 200_000),
      },
    },
  })

  const extracted = extractTextualToolCalls(fallback.assistantMessage, tools)
  const content: ContentBlock[] = []

  if (extracted.text) {
    content.push({ type: 'text', text: extracted.text })
  }

  for (const [index, toolCall] of extracted.toolCalls.entries()) {
    content.push({
      type: 'tool_use',
      id: `ollama-fallback-tool-${Date.now()}-${index + 1}`,
      name: toolCall.function.name,
      input: toolCall.function.arguments,
    })
  }

  return {
    content: content.length > 0 ? content : [{ type: 'text', text: fallback.assistantMessage }],
    model: fallback.model || config.model,
    stopReason: extracted.toolCalls.length > 0 ? 'tool_use' : 'stop',
    usage: { ...EMPTY_USAGE },
    costUsd: 0,
  }
}

/**
 * Non-streaming single message call.
 */
export async function sampleOllamaMessage(
  config: OllamaEngineConfig,
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>,
  systemPrompt: string,
  tools?: EngineToolDef[],
  signal?: AbortSignal,
): Promise<SampleResult> {
  const gen = streamOllamaMessages(config, messages, systemPrompt, tools, signal)
  let result: SampleResult | undefined
  while (true) {
    const { done, value } = await gen.next()
    if (done) {
      result = value as SampleResult
      break
    }
  }
  return result!
}

/**
 * Convert engine tool definitions to Ollama format.
 */
export function toOllamaToolDefs(
  tools: Array<{ name: string; description: string; input_schema: ToolInputSchema }>,
): OllamaToolDef[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))
}

/**
 * List available models on the Ollama server.
 */
export async function listOllamaModels(
  baseUrl: string,
): Promise<Array<{ name: string; size: number; modifiedAt: string }>> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`)
    if (!response.ok) return []
    const data = await response.json() as { models: Array<{ name: string; size: number; modified_at: string }> }
    return data.models.map(m => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
    }))
  } catch {
    try {
      const health = await invoke<TauriOllamaHealthResponse>('ollama_health_check', {
        config: {
          baseUrl,
          model: '',
          timeoutMs: 15000,
        },
      })
      return (health.models ?? []).map((name) => ({
        name,
        size: 0,
        modifiedAt: '',
      }))
    } catch {
      return []
    }
  }
}

/**
 * Check if Ollama server is reachable.
 */
export async function checkOllamaConnection(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    })
    return response.ok
  } catch {
    try {
      const health = await invoke<TauriOllamaHealthResponse>('ollama_health_check', {
        config: {
          baseUrl,
          model: '',
          timeoutMs: 15000,
        },
      })
      return health.ok
    } catch {
      return false
    }
  }
}

/**
 * Get model info from Ollama.
 */
export async function getOllamaModelInfo(
  baseUrl: string,
  model: string,
): Promise<{ contextLength: number; parameterSize: string } | null> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    })
    if (!response.ok) return null
    const data = await response.json() as Record<string, unknown>
    const params = data.model_info as Record<string, unknown> ?? {}
    return {
      contextLength: (params['context_length'] as number) ?? 0,
      parameterSize: String(data.parameters ?? ''),
    }
  } catch {
    return null
  }
}
