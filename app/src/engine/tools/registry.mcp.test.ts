import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfigStore } from '../../stores/configStore'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

describe('MCPTool compatibility', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useConfigStore.setState({
      mcpServer: {
        name: 'test-mcp',
        command: 'node',
        args: 'server.js',
        env: {},
      },
      mcpServers: [
        {
          name: 'test-mcp',
          command: 'node',
          args: 'server.js',
          env: {},
        },
      ],
      activeMcpServerName: 'test-mcp',
    })
  })

  it('handles current backend MCP response contract', async () => {
    const { registerAllBuiltinTools, getAllTools } = await import('./registry')
    registerAllBuiltinTools()

    invokeMock.mockResolvedValue({
      serverName: 'test-mcp',
      toolName: 'search_docs',
      success: true,
      result: 'ok-current',
      error: null,
    })

    const tool = getAllTools().find((entry) => entry.name === 'MCPTool')
    expect(tool).toBeTruthy()

    const result = await tool!.call(
      {
        server_name: 'test-mcp',
        tool_name: 'search_docs',
        arguments: { query: 'hello' },
      },
      { runId: 'run-1' } as never,
    )

    expect(result.data).toBe('ok-current')
    expect(invokeMock).toHaveBeenCalledWith(
      'mcp_call_tool',
      expect.objectContaining({
        request: expect.objectContaining({
          name: 'test-mcp',
          command: 'node',
          toolName: 'search_docs',
          toolArgs: { query: 'hello' },
        }),
      }),
    )
  })

  it('falls back to legacy MCP envelope and response shape', async () => {
    const { registerAllBuiltinTools, getAllTools } = await import('./registry')
    registerAllBuiltinTools()

    invokeMock.mockImplementation((_cmd: string, payload: Record<string, unknown>) => {
      if (payload.request) {
        throw new Error('primary contract failed')
      }
      return Promise.resolve({
        content: 'ok-legacy',
        isError: false,
      })
    })

    const tool = getAllTools().find((entry) => entry.name === 'MCPTool')
    expect(tool).toBeTruthy()

    const result = await tool!.call(
      {
        server_name: 'test-mcp',
        tool_name: 'search_docs',
        arguments: { query: 'legacy' },
      },
      { runId: 'run-2' } as never,
    )

    expect(result.data).toBe('ok-legacy')
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenLastCalledWith(
      'mcp_call_tool',
      expect.objectContaining({
        mcpCallRequest: expect.objectContaining({
          name: 'test-mcp',
          toolName: 'search_docs',
          toolArgs: { query: 'legacy' },
        }),
        server_name: 'test-mcp',
        tool_name: 'search_docs',
      }),
    )
  })
})
