import { beforeEach, describe, expect, it, vi } from 'vitest'

const readToolDef = {
  name: 'Read',
  description: 'Liest eine Datei.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', description: 'Pfad zur Datei' },
    },
    required: ['file_path'] as string[],
  },
}

describe('streamOpenAiCompatibleMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('serializes tool results and image inputs for chat completions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp-1',
          model: 'gpt-4.1-mini',
          usage: { prompt_tokens: 10, completion_tokens: 4 },
          choices: [{ finish_reason: 'stop', message: { content: 'Analyse abgeschlossen.' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { streamOpenAiCompatibleMessages } = await import('./openaiCompatibleClient')
    const stream = streamOpenAiCompatibleMessages(
      {
        provider: 'openai-compatible',
        apiKey: 'sk-test',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://api.openai.com/v1',
      },
      [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'Screenshot aufgenommen.' },
          { type: 'text', text: 'Bitte analysiere den aktuellen Bildschirm.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
        ],
      }],
      'Systemprompt',
      [readToolDef],
    )

    while (!(await stream.next()).done) {
      // consume stream
    }

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(requestInit.body))
    expect(body.messages).toEqual([
      { role: 'system', content: 'Systemprompt' },
      { role: 'tool', content: 'Screenshot aufgenommen.', tool_call_id: 'tool-1' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Bitte analysiere den aktuellen Bildschirm.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ])
    expect(body.tools).toMatchObject([
      {
        type: 'function',
        function: { name: 'Read' },
      },
    ])
  })

  it('maps tool calls into tool_use blocks for the engine loop', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp-2',
          model: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 21, completion_tokens: 9 },
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              tool_calls: [{
                id: 'call-1',
                function: {
                  name: 'Read',
                  arguments: '{"file_path":"README.md"}',
                },
              }],
            },
          }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { streamOpenAiCompatibleMessages } = await import('./openaiCompatibleClient')
    const stream = streamOpenAiCompatibleMessages(
      {
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        model: 'openai/gpt-4o-mini',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      [{ role: 'user', content: 'Lies die README.' }],
      'Systemprompt',
      [readToolDef],
    )

    const events = [] as Array<{ type: string; [key: string]: unknown }>
    let result: Awaited<ReturnType<typeof stream.next>>['value'] | null = null

    while (true) {
      const next = await stream.next()
      if (next.done) {
        result = next.value
        break
      }
      events.push(next.value as { type: string; [key: string]: unknown })
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'content_block_start',
          content_block: expect.objectContaining({
            type: 'tool_use',
            id: 'call-1',
            name: 'Read',
            input: { file_path: 'README.md' },
          }),
        }),
      ]),
    )
    expect(result).toMatchObject({
      model: 'openai/gpt-4o-mini',
      stopReason: 'tool_use',
      usage: { input_tokens: 21, output_tokens: 9 },
    })
  })

  it('requests OpenRouter reasoning and maps it into thinking deltas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp-reasoning',
          model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          usage: { prompt_tokens: 12, completion_tokens: 8 },
          choices: [{
            finish_reason: 'stop',
            message: {
              reasoning: 'Ich pruefe zuerst die Bedingung.',
              content: 'Die Antwort ist 4.',
            },
          }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { streamOpenAiCompatibleMessages } = await import('./openaiCompatibleClient')
    const stream = streamOpenAiCompatibleMessages(
      {
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      [{ role: 'user', content: 'Was ist 2+2?' }],
      'Systemprompt',
    )

    const events = [] as Array<{ type: string; [key: string]: unknown }>
    let result: Awaited<ReturnType<typeof stream.next>>['value'] | null = null

    while (true) {
      const next = await stream.next()
      if (next.done) {
        result = next.value
        break
      }
      events.push(next.value as { type: string; [key: string]: unknown })
    }

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(requestInit.body))
    expect(body.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')
    expect(body.reasoning).toEqual({ enabled: true, exclude: false })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'content_block_delta',
          delta: {
            type: 'thinking_delta',
            thinking: 'Ich pruefe zuerst die Bedingung.',
          },
        }),
        expect.objectContaining({
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: 'Die Antwort ist 4.',
          },
        }),
      ]),
    )
    expect(result).toMatchObject({
      content: [
        { type: 'thinking', thinking: 'Ich pruefe zuerst die Bedingung.' },
        { type: 'text', text: 'Die Antwort ist 4.' },
      ],
    })
  })
})
