import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

describe('sampleOllamaMessage', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: vi.fn() },
      configurable: true,
      writable: true,
    })
  })

  it('falls back to tauri chat when the stream ends without usable content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '{"model":"qwen3.6:35b","message":{"role":"assistant"},"done":true}\n',
        {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    invokeMock.mockResolvedValue({
      endpoint: 'http://localhost:11434',
      model: 'qwen3.6:35b',
      assistantMessage: 'Fallback aus chat_turn',
      requiresApproval: false,
      proposedPlan: [],
    })

    const { sampleOllamaMessage } = await import('./ollamaClient')
    const result = await sampleOllamaMessage(
      {
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.6:35b',
        timeoutMs: 200000,
        temperature: 0.1,
      },
      [{ role: 'user', content: 'Teste den Stream' }],
      'Systemprompt',
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('chat_turn', expect.objectContaining({
      request: expect.objectContaining({
        prompt: expect.stringContaining('Teste den Stream'),
      }),
    }))
    expect(result.content).toEqual([
      { type: 'text', text: 'Fallback aus chat_turn' },
    ])
  })
})
