import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type OllamaConfig = {
  baseUrl: string
  model: string
  timeoutMs: number
}

export type McpServerConfig = {
  name: string
  command: string
  args: string
}

type ConfigState = {
  ollama: OllamaConfig
  mcpServer: McpServerConfig
  setOllama: (patch: Partial<OllamaConfig>) => void
  setMcpServer: (patch: Partial<McpServerConfig>) => void
}

const DEFAULT_OLLAMA: OllamaConfig = {
  baseUrl: 'http://192.168.178.82:11434',
  model: 'llama3.1:8b',
  timeoutMs: 20000,
}

const DEFAULT_MCP: McpServerConfig = {
  name: 'filesystem',
  command: 'npx',
  args: '-y @modelcontextprotocol/server-filesystem .',
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      ollama: DEFAULT_OLLAMA,
      mcpServer: DEFAULT_MCP,
      setOllama: (patch) =>
        set((state) => ({ ollama: { ...state.ollama, ...patch } })),
      setMcpServer: (patch) =>
        set((state) => ({ mcpServer: { ...state.mcpServer, ...patch } })),
    }),
    { name: 'open-cowork-config' }
  )
)
