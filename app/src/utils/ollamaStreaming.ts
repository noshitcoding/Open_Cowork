import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type ChatTurnResponse = {
  endpoint: string
  model: string
  assistantMessage: string
  requiresApproval: boolean
  proposedPlan: string[]
}

export type ChatTurnRequest = {
  prompt: string
  history: Array<{ role: string; content: string }>
  config: unknown
}

type OllamaChatChunk = {
  streamId: string
  chunk: string
}

function createStreamId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function invokeChatTurnFallback(request: ChatTurnRequest): Promise<ChatTurnResponse> {
  return await invoke<ChatTurnResponse>('chat_turn', {
    request,
  })
}

export async function streamChatTurn(
  request: ChatTurnRequest,
  onChunk: (chunk: string) => void,
): Promise<ChatTurnResponse> {
  const streamId = createStreamId()
  let unlisten: (() => void) | null = null

  try {
    unlisten = await listen<OllamaChatChunk>('ollama-chat-chunk', (event) => {
      if (event.payload.streamId === streamId) {
        onChunk(event.payload.chunk)
      }
    })
  } catch {
    // Fallback for environments where window event subscriptions are unavailable.
    return await invokeChatTurnFallback(request)
  }

  try {
    return await invoke<ChatTurnResponse>('chat_turn_stream', {
      request: {
        ...request,
        streamId,
      },
    })
  } catch (streamError) {
    try {
      return await invokeChatTurnFallback(request)
    } catch (fallbackError) {
      const streamMessage = streamError instanceof Error ? streamError.message : String(streamError)
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      throw new Error(`${streamMessage}\nFallback fehlgeschlagen: ${fallbackMessage}`)
    }
  } finally {
    if (unlisten) {
      unlisten()
    }
  }
}
