import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const listenMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

describe('streamChatTurn', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    listenMock.mockReset()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: vi.fn() },
      configurable: true,
      writable: true,
    })
  })

  it('falls back to chat_turn when the stream command fails', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValue(unlisten)
    invokeMock.mockImplementation((command: string) => {
      if (command === 'chat_turn_stream') {
        return Promise.reject(new Error('stream decode failed'))
      }
      if (command === 'chat_turn') {
        return Promise.resolve({
          endpoint: 'http://localhost:11434',
          model: 'qwen3.6:35b',
          assistantMessage: 'Fallback-Antwort',
          requiresApproval: false,
          proposedPlan: [],
        })
      }
      return Promise.reject(new Error(`unexpected command ${command}`))
    })

    const { streamChatTurn } = await import('./ollamaStreaming')
    const result = await streamChatTurn(
      {
        prompt: 'Teste den Fallback',
        history: [],
        config: {
          baseUrl: 'http://localhost:11434',
          model: 'qwen3.6:35b',
          timeoutMs: 200000,
        },
      },
      vi.fn(),
    )

    expect(result.assistantMessage).toBe('Fallback-Antwort')
    expect(invokeMock).toHaveBeenCalledWith('chat_turn', expect.objectContaining({
      request: expect.objectContaining({
        prompt: 'Teste den Fallback',
      }),
    }))
    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})
