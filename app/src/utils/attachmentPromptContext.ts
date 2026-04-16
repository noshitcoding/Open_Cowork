import { invoke } from '@tauri-apps/api/core'
import {
  formatAttachmentContext,
  getPathName,
  type ChatAttachment,
} from './chatAttachments'

const LOCAL_DOCS_MCP_SERVER = {
  name: 'local-docs',
  command: 'open-cowork-docs-mcp',
  args: [] as string[],
  env: {} as Record<string, string>,
}

type ArtifactParseResponse = {
  path: string
  format: string
  sizeBytes: number
  summary: string
  preview: string
  metadata: Record<string, unknown>
}

type McpCallResponse = {
  success: boolean
  result: string
  error: string | null
}

const MCP_CHUNK_SIZE = 16_000
const MCP_MAX_CHUNKS_PER_FILE = 256

export type AttachmentPromptBuildResult = {
  context: string
  parsedFiles: number
  failedFiles: Array<{ path: string; error: string }>
}

export async function buildAttachmentPromptContext(
  attachments: ChatAttachment[],
): Promise<AttachmentPromptBuildResult> {
  const baseContext = formatAttachmentContext(attachments)
  const fileAttachments = attachments.filter((item) => item.kind === 'file').slice(0, 6)

  if (fileAttachments.length === 0) {
    return {
      context: baseContext,
      parsedFiles: 0,
      failedFiles: [],
    }
  }

  const analyses: string[] = []
  const failedFiles: Array<{ path: string; error: string }> = []
  let parsedFiles = 0

  const callLocalDocsTool = async (
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<string> => {
    const mcpResponse = await invoke<McpCallResponse>('mcp_call_tool', {
      request: {
        ...LOCAL_DOCS_MCP_SERVER,
        toolName,
        toolArgs,
      },
    })

    if (!mcpResponse.success) {
      throw new Error(mcpResponse.error ?? `MCP tool call failed: ${toolName}`)
    }

    return mcpResponse.result
  }

  const readFullTextInChunks = async (path: string): Promise<string> => {
    const chunks: string[] = []
    let start = 0

    for (let chunkIndex = 0; chunkIndex < MCP_MAX_CHUNKS_PER_FILE; chunkIndex += 1) {
      const chunk = await callLocalDocsTool('get_chunk', {
        path,
        start,
        length: MCP_CHUNK_SIZE,
      })

      if (!chunk) {
        break
      }

      chunks.push(chunk)
      const chunkLength = Array.from(chunk).length

      if (chunkLength < MCP_CHUNK_SIZE) {
        break
      }

      start += chunkLength
    }

    if (chunks.length === MCP_MAX_CHUNKS_PER_FILE) {
      throw new Error('MCP chunk limit erreicht, Dokument ist zu gross fuer den aktuellen Kontextlauf.')
    }

    return chunks.join('')
  }

  for (const item of fileAttachments) {
    try {
      const parsed = await invoke<ArtifactParseResponse>('fs_parse_artifact', {
        path: item.path,
      })
      const fullText = await readFullTextInChunks(item.path)
      parsedFiles += 1

      analyses.push(
        [
          `Dateianalyse: ${getPathName(parsed.path)}`,
          `Pfad: ${parsed.path}`,
          `Format: ${parsed.format}`,
          `Zusammenfassung: ${parsed.summary}`,
          `Volltext (fuer LLM-Kontext):`,
          fullText || '(kein extrahierbarer Text)',
        ].join('\n'),
      )
    } catch (error) {
      failedFiles.push({
        path: item.path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const failedBlock =
    failedFiles.length > 0
      ? [
          'Nicht analysierbare Anhaenge:',
          ...failedFiles.map((entry) => `- ${entry.path}: ${entry.error}`),
        ].join('\n')
      : ''

  const analysisBlock = analyses.length > 0 ? ['Dateiinhalt-Kontext:', ...analyses].join('\n\n') : ''

  const context = [baseContext, analysisBlock, failedBlock].filter((part) => part.trim().length > 0).join('\n\n')

  return {
    context,
    parsedFiles,
    failedFiles,
  }
}
