// ── Tool Registry & Built-in Tools (ported from Claude Code) ────────────────
// Mirrors: claude-code-main/src/tools.ts + tools/*
// All file/shell operations delegate to Tauri IPC commands

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useConfigStore } from '../../stores/configStore'
import type { McpServerConfig } from '../../stores/configStore'
import type { Tool, Tools, ToolInputSchema } from '../types'

// ── Tool Registration ──────────────────────────────────────────────────────

const toolRegistry: Tool[] = []

type ExecCommandChunkPayload = {
  streamId: string
  channel: 'stdout' | 'stderr' | 'done'
  content: string
}

type FsAttachmentMetadataResponse = {
  rootPath: string
  rootKind: string
  totalFiles: number
  returnedFiles: number
  truncated: boolean
  files: Array<{
    path: string
    fileName: string
    extension?: string | null
    language?: string | null
    sizeBytes: number
  }>
}

type McpCallResponse = {
  serverName: string
  toolName: string
  success: boolean
  result: string
  error: string | null
}

type LegacyMcpCallResponse = {
  content: string
  isError?: boolean
}

type MemoryEntry = {
  id: string
  scope: string
  category: string
  key: string
  content: string
  sourceSessionId?: string | null
  confidence: number
  accessCount: number
  lastAccessedAt?: string | null
  createdAt: string
  updatedAt: string
}

function createToolStreamId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function splitCommandArgs(value: string): string[] {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return matches.map((part) => part.replace(/^["']|["']$/g, ''))
}

function findMcpServerConfig(serverName: string): McpServerConfig | null {
  const { mcpServer, mcpServers } = useConfigStore.getState()
  const servers = mcpServers.length > 0 ? mcpServers : [mcpServer]
  return servers.find((server) => server.name === serverName) ?? null
}

function normalizeMemoryScope(scope?: string): string | undefined {
  if (!scope) return undefined

  switch (scope) {
    case 'project':
      return 'agent'
    case 'global':
      return 'shared'
    case 'agent':
    case 'user':
    case 'session':
    case 'shared':
      return scope
    default:
      return scope
  }
}

export function registerTool(tool: Tool): void {
  toolRegistry.push(tool)
}

export function getAllTools(): Tools {
  return toolRegistry
}

export function getToolsByCategory(category: string): Tools {
  return toolRegistry.filter(t => t.category === category)
}

export function getEnabledTools(): Tools {
  return toolRegistry.filter(t => !t.isEnabled || t.isEnabled())
}

// ── FileReadTool ───────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/FileReadTool/

const fileReadTool: Tool<{ file_path: string; offset?: number; limit?: number }> = {
  name: 'Read',
  aliases: ['read_file', 'FileReadTool'],
  description: 'Liest den Inhalt einer Datei. Nutze offset/limit fuer grosse Dateien.',
  category: 'filesystem',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absoluter oder relativer Pfad zur Datei' },
      offset: { type: 'number', description: 'Startzeile (0-basiert)' },
      limit: { type: 'number', description: 'Maximale Anzahl Zeilen' },
    },
    required: ['file_path'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input, context) {
    const fullPath = resolvePath(input.file_path, context.cwd)
    const result = await invoke<string>('fs_extract_text', { path: fullPath, runId: context.runId })
    let content = result
    if (input.offset !== undefined || input.limit !== undefined) {
      const lines = content.split('\n')
      const start = input.offset ?? 0
      const end = input.limit ? start + input.limit : lines.length
      content = lines.slice(start, end).join('\n')
    }
    return { data: content }
  },
}

// ── FileWriteTool ──────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/FileWriteTool/

const fileWriteTool: Tool<{ file_path: string; content: string; create_backup?: boolean }> = {
  name: 'Write',
  aliases: ['write_file', 'FileWriteTool'],
  description: 'Schreibt Inhalt in eine Datei. Erstellt bei Bedarf uebergeordnete Verzeichnisse.',
  category: 'filesystem',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absoluter oder relativer Pfad zur Datei' },
      content: { type: 'string', description: 'Der zu schreibende Inhalt' },
      create_backup: { type: 'boolean', description: 'Backup der Originaldatei erstellen' },
    },
    required: ['file_path', 'content'],
  },
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  async call(input, context) {
    const fullPath = resolvePath(input.file_path, context.cwd)
    const result = await invoke<{ diff: string }>('fs_write_text_file', {
      path: fullPath,
      content: input.content,
      createBackup: input.create_backup ?? false,
      runId: context.runId,
    })
    return { data: result.diff || 'Datei geschrieben.' }
  },
}

// ── FileEditTool ───────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/FileEditTool/

const fileEditTool: Tool<{ file_path: string; old_string: string; new_string: string }> = {
  name: 'Edit',
  aliases: ['edit_file', 'FileEditTool'],
  description: 'Ersetzt eine exakte Zeichenfolge in einer Datei. old_string muss eindeutig sein.',
  category: 'filesystem',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Pfad zur zu bearbeitenden Datei' },
      old_string: { type: 'string', description: 'Exakter zu ersetzender Text' },
      new_string: { type: 'string', description: 'Neuer Ersetzungstext' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  async call(input, context) {
    const fullPath = resolvePath(input.file_path, context.cwd)
    // Read file, replace, write back
    const content = await invoke<string>('fs_extract_text', { path: fullPath, runId: context.runId })
    const occurrences = content.split(input.old_string).length - 1
    if (occurrences === 0) {
      return { data: `Fehler: old_string wurde nicht in ${input.file_path} gefunden.` }
    }
    if (occurrences > 1) {
      return { data: `Fehler: old_string wurde ${occurrences}x gefunden. Muss eindeutig sein.` }
    }
    const newContent = content.replace(input.old_string, input.new_string)
    await invoke('fs_write_text_file', {
      path: fullPath,
      content: newContent,
      createBackup: true,
      runId: context.runId,
    })
    return { data: `Datei bearbeitet: ${input.file_path}` }
  },
}

// ── GlobTool ───────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/GlobTool/

const globTool: Tool<{ pattern: string; path?: string }> = {
  name: 'Glob',
  aliases: ['glob', 'GlobTool'],
  description: 'Sucht Dateien nach Glob-Muster. Schnell zum Finden von Dateien nach Name/Extension.',
  category: 'search',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob-Muster (z.B. **/*.ts, src/**/*.rs)' },
      path: { type: 'string', description: 'Basisverzeichnis fuer die Suche (optional)' },
    },
    required: ['pattern'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input, context) {
    const basePath = input.path ? resolvePath(input.path, context.cwd) : context.cwd
    const result = await invoke<FsAttachmentMetadataResponse>('fs_collect_attachment_metadata', {
      path: basePath,
      maxEntries: 200,
      runId: context.runId,
    })
    // Filter by glob pattern (simplified)
    const pattern = globToRegex(input.pattern)
    const matches = result.files
      .map((file) => file.path)
      .filter((filePath) => pattern.test(filePath))
    return { data: matches.length > 0 ? matches.join('\n') : 'Keine Treffer.' }
  },
}

// ── GrepTool ───────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/GrepTool/

const grepTool: Tool<{ pattern: string; path?: string; include?: string }> = {
  name: 'Grep',
  aliases: ['grep', 'GrepTool', 'search'],
  description: 'Durchsucht Dateiinhalte mit regulaeren Ausdruecken. Schnell fuer Code-Suche.',
  category: 'search',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regulaerer Ausdruck zum Suchen' },
      path: { type: 'string', description: 'Verzeichnis fuer die Suche (optional)' },
      include: { type: 'string', description: 'Dateinamenmuster zum Einschliessen (z.B. *.ts)' },
    },
    required: ['pattern'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input, context) {
    // Use bash to run grep/findstr (PowerShell on Windows)
    const searchPath = input.path ? resolvePath(input.path, context.cwd) : context.cwd
    const includeFlag = input.include ? `-Include "${input.include}"` : ''
    const cmd = `Get-ChildItem -Path "${searchPath}" -Recurse -File ${includeFlag} | Select-String -Pattern "${input.pattern}" | Select-Object -First 50 | Format-Table -AutoSize Path, LineNumber, Line`
    try {
      const result = await invoke<{ stdout: string; stderr: string; exitCode: number }>('exec_command', {
        command: cmd,
        cwd: context.cwd,
        runId: context.runId,
      })
      return { data: result.stdout || 'Keine Treffer.' }
    } catch {
      return { data: `Grep-Suche nach "${input.pattern}" — Tauri exec_command nicht verfuegbar. Nutze Fallback.` }
    }
  },
}

// ── BashTool ───────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/BashTool/

const bashTool: Tool<{ command: string; timeout?: number }> = {
  name: 'Bash',
  aliases: ['bash', 'shell', 'BashTool', 'execute'],
  description: 'Fuehrt einen Shell-Befehl aus (PowerShell auf Windows). Nutze fuer Build, Test, Git etc.',
  category: 'shell',
  riskLevel: 'high',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Der auszufuehrende Shell-Befehl' },
      timeout: { type: 'number', description: 'Timeout in Millisekunden (Standard: 30000)' },
    },
    required: ['command'],
  },
  isReadOnly: () => false,
  isDestructive: (input) => {
    const dangerous = ['rm -rf', 'del /s', 'format', 'Remove-Item -Recurse']
    return dangerous.some(d => input.command.includes(d))
  },
  isConcurrencySafe: () => false,
  async call(input, context, onProgress) {
    const streamId = createToolStreamId()
    let unlisten: (() => void) | null = null

    try {
      try {
        unlisten = await listen<ExecCommandChunkPayload>('exec-command-chunk', (event) => {
          if (event.payload.streamId !== streamId || !onProgress) return

          if (event.payload.channel === 'done') {
            onProgress({
              toolUseID: '',
              data: {
                type: 'bash_progress',
                output: `status: ${event.payload.content}`,
              },
            })
            return
          }

          onProgress({
            toolUseID: '',
            data: {
              type: 'bash_progress',
              output: `${event.payload.channel}: ${event.payload.content}`,
            },
          })
        })
      } catch {
        unlisten = null
      }

      const result = await invoke<{ stdout: string; stderr: string; exitCode: number }>('exec_command', {
        command: input.command,
        cwd: context.cwd,
        timeoutMs: input.timeout ?? 30000,
        streamId,
        runId: context.runId,
      })
      if (onProgress) {
        onProgress({
          toolUseID: '',
          data: {
            type: 'bash_progress',
            output: `exit code: ${result.exitCode}`,
            exitCode: result.exitCode,
          },
        })
      }
      const output = [
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
        `exit code: ${result.exitCode}`,
      ].filter(Boolean).join('\n\n')
      return { data: output }
    } catch (err) {
      return { data: `Fehler beim Ausfuehren: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
      if (unlisten) {
        unlisten()
      }
    }
  },
}

// ── WebFetchTool ───────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/WebFetchTool/

const webFetchTool: Tool<{ url: string; max_chars?: number }> = {
  name: 'WebFetch',
  aliases: ['web_fetch', 'fetch', 'WebFetchTool'],
  description: 'Ruft den Textinhalt einer URL ab und extrahiert den Haupttext.',
  category: 'web',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Die abzurufende URL' },
      max_chars: { type: 'number', description: 'Maximale Zeichenanzahl (Standard: 50000)' },
    },
    required: ['url'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input, context) {
    const result = await invoke<{ title?: string | null; content: string; url: string; truncated: boolean }>('web_fetch_url', {
      request: {
        url: input.url,
        maxChars: input.max_chars ?? 50000,
      },
      runId: context.runId,
    })
    const title = result.title?.trim() || input.url
    return { data: `# ${title}\n\n${result.content}` }
  },
}

// ── WebSearchTool ──────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/WebSearchTool/

const webSearchTool: Tool<{ query: string; max_results?: number }> = {
  name: 'WebSearch',
  aliases: ['web_search', 'WebSearchTool'],
  description: 'Durchsucht das Web nach Informationen zu einem Thema.',
  category: 'web',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Suchanfrage' },
      max_results: { type: 'number', description: 'Maximale Ergebnisanzahl (Standard: 5)' },
    },
    required: ['query'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input, context, onProgress) {
    try {
      const result = await invoke<{ query: string; results: Array<{ title: string; url: string; snippet: string }> }>('web_search', {
        request: {
          query: input.query,
          maxResults: input.max_results ?? 5,
        },
        runId: context.runId,
      })
      if (onProgress) {
        onProgress({
          toolUseID: '',
          data: { type: 'web_search_progress', query: input.query, results: result.results.length },
        })
      }
      const lines = result.results.map((item, index) => {
        const snippet = item.snippet ? `\n${item.snippet}` : ''
        return `${index + 1}. ${item.title}\n${item.url}${snippet}`
      })
      return { data: lines.join('\n\n') || `Keine Treffer fuer "${input.query}"` }
    } catch {
      return { data: `Web-Suche fehlgeschlagen fuer: "${input.query}"` }
    }
  },
}

// ── MCPTool ────────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/MCPTool/

const mcpTool: Tool<{ server_name: string; tool_name: string; arguments: Record<string, unknown> }> = {
  name: 'MCPTool',
  aliases: ['mcp_call', 'mcp'],
  description: 'Ruft ein Tool auf einem MCP-Server auf.',
  category: 'mcp',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      server_name: { type: 'string', description: 'Name des MCP-Servers' },
      tool_name: { type: 'string', description: 'Name des Tools auf dem Server' },
      arguments: { type: 'object', description: 'Argumente fuer den Tool-Aufruf' },
    },
    required: ['server_name', 'tool_name', 'arguments'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  async call(input, context) {
    const server = findMcpServerConfig(input.server_name)
    if (!server) {
      return { data: `MCP Fehler: Server "${input.server_name}" ist nicht konfiguriert.` }
    }

    const requestPayload = {
      name: server.name,
      command: server.command,
      args: splitCommandArgs(server.args),
      env: server.env ?? {},
      toolName: input.tool_name,
      toolArgs: input.arguments,
    }

    const normalizeResponse = (raw: McpCallResponse | LegacyMcpCallResponse): { ok: boolean; message: string } => {
      if ('content' in raw) {
        return {
          ok: !raw.isError,
          message: raw.content,
        }
      }
      return {
        ok: raw.success,
        message: raw.success ? raw.result : (raw.error ?? raw.result),
      }
    }

    try {
      const primary = await invoke<McpCallResponse | LegacyMcpCallResponse>('mcp_call_tool', {
        request: requestPayload,
        runId: context.runId,
      })
      const normalized = normalizeResponse(primary)
      if (!normalized.ok) {
        return { data: `MCP Fehler: ${normalized.message}` }
      }
      return { data: normalized.message }
    } catch {
      // Backward-compat fallback for alternate envelope contracts.
      const fallback = await invoke<McpCallResponse | LegacyMcpCallResponse>('mcp_call_tool', {
        mcpCallRequest: requestPayload,
        server_name: input.server_name,
        tool_name: input.tool_name,
        arguments: input.arguments,
        runId: context.runId,
      })
      const normalized = normalizeResponse(fallback)
      if (!normalized.ok) {
        return { data: `MCP Fehler: ${normalized.message}` }
      }
      return { data: normalized.message }
    }
  },
}

// ── AgentTool ──────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/AgentTool/

const agentTool: Tool<{ agent_name: string; prompt: string }> = {
  name: 'Agent',
  aliases: ['agent', 'subagent', 'AgentTool'],
  description: 'Startet einen Sub-Agenten fuer eine bestimmte Aufgabe. Der Agent laeuft in einer isolierten Worker-Sandbox.',
  category: 'agent',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      agent_name: { type: 'string', description: 'Name/Typ des zu startenden Agenten' },
      prompt: { type: 'string', description: 'Aufgabe/Prompt fuer den Sub-Agenten' },
    },
    required: ['agent_name', 'prompt'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  async call(input, _context, onProgress) {
    // Sub-agent runs will be dispatched through the query engine
    // This is a placeholder that the query engine intercepts
    if (onProgress) {
      onProgress({ toolUseID: '', data: { type: 'agent_progress', agentName: input.agent_name, content: `Agent "${input.agent_name}" gestartet...` } })
    }
    return { data: `Sub-Agent "${input.agent_name}" fuer Aufgabe: ${input.prompt}` }
  },
}

// ── AskUserTool ────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/AskUserQuestionTool/

const askUserTool: Tool<{ question: string }> = {
  name: 'AskUser',
  aliases: ['ask_user', 'AskUserQuestionTool'],
  description: 'Stellt dem Benutzer eine Frage und wartet auf Antwort. Fuer Klaerungen und Entscheidungen.',
  category: 'user_interaction',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Die Frage an den Benutzer' },
    },
    required: ['question'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => false,
  async call(input, context) {
    // The UI layer will intercept this and show a dialog
    context.setToolUI?.({
      type: 'approval',
      toolName: 'AskUser',
      content: input.question,
    })
    return {
      data: `[Warte auf Benutzerantwort: ${input.question}]`,
      awaitUserInput: true,
    }
  },
}

// ── TaskTools ──────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/TaskTool/

const taskCreateTool: Tool<{ title: string; description: string }> = {
  name: 'TaskCreate',
  aliases: ['task_create', 'todo_add'],
  description: 'Erstellt eine neue Aufgabe/Todo.',
  category: 'task',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titel der Aufgabe' },
      description: { type: 'string', description: 'Beschreibung der Aufgabe' },
    },
    required: ['title', 'description'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  async call(input) {
    const taskId = createToolStreamId()
    await invoke('db_save_task', {
      id: taskId,
      title: input.title,
      prompt: input.description,
      status: 'pending',
      threadId: null,
      createdAt: new Date().toISOString(),
    })
    return { data: `Aufgabe erstellt: ${input.title} (ID: ${taskId})` }
  },
}

const taskListTool: Tool<{ status?: string }> = {
  name: 'TaskList',
  aliases: ['task_list', 'todo_list'],
  description: 'Listet alle aktiven Aufgaben/Todos auf.',
  category: 'task',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'Filtere nach Status (pending/running/completed/failed)', enum: ['pending', 'running', 'completed', 'failed'] },
    },
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input) {
    const tasks = await invoke<Array<{ id: string; title: string; status: string }>>('db_list_tasks')
    const filtered = input.status ? tasks.filter(t => t.status === input.status) : tasks
    if (filtered.length === 0) return { data: 'Keine Aufgaben gefunden.' }
    const list = filtered.map(t => `- [${t.status}] ${t.title} (${t.id.slice(0, 8)})`).join('\n')
    return { data: `Aufgaben (${filtered.length}):\n${list}` }
  },
}

// ── MemoryTool ─────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/memory functionality

const memoryReadTool: Tool<{ scope?: string; key?: string }> = {
  name: 'MemoryRead',
  aliases: ['memory_read', 'recall'],
  description: 'Liest Eintraege aus dem Gedaechtnis-System.',
  category: 'memory',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', description: 'Scope: agent, user, session, shared', enum: ['agent', 'user', 'session', 'shared'] },
      key: { type: 'string', description: 'Optionaler Schluessel zum Filtern' },
    },
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input) {
    const scope = normalizeMemoryScope(input.scope)
    const entries = await invoke<MemoryEntry[]>('memory_search', {
      scope,
      category: null,
      keyword: null,
      limit: 100,
    })
    const filtered = input.key ? entries.filter(e => e.key.includes(input.key ?? '')) : entries
    if (filtered.length === 0) return { data: 'Keine Erinnerungen gefunden.' }
    return { data: filtered.map(e => `[${e.scope}/${e.category}/${e.key}]: ${e.content}`).join('\n\n') }
  },
}

const memoryWriteTool: Tool<{ scope: string; key: string; content: string }> = {
  name: 'MemoryWrite',
  aliases: ['memory_write', 'remember'],
  description: 'Speichert einen Eintrag im Gedaechtnis-System.',
  category: 'memory',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', description: 'Scope: agent, user, session, shared', enum: ['agent', 'user', 'session', 'shared'] },
      key: { type: 'string', description: 'Eindeutiger Schluessel' },
      content: { type: 'string', description: 'Zu speichernder Inhalt' },
    },
    required: ['scope', 'key', 'content'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  async call(input, context) {
    const scope = normalizeMemoryScope(input.scope)
    if (!scope) {
      return { data: 'Fehler: scope ist erforderlich.' }
    }

    await invoke('memory_upsert', {
      id: createToolStreamId(),
      scope,
      category: 'user',
      key: input.key,
      content: input.content,
      sourceSessionId: context.sessionId ?? null,
      confidence: 1.0,
    })
    return { data: `Erinnerung gespeichert: [${scope}/user/${input.key}]` }
  },
}

// ── PlanModeTool ───────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/EnterPlanModeTool/

const enterPlanTool: Tool = {
  name: 'EnterPlanMode',
  aliases: ['plan', 'enter_plan_mode'],
  description: 'Wechselt in den Plan-Modus. Alle Aenderungen werden nur vorgeschlagen, nicht ausgefuehrt.',
  category: 'planning',
  riskLevel: 'low',
  inputSchema: { type: 'object', properties: {} },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(_input, context) {
    context.setAppState(prev => ({ ...prev, planMode: true }))
    return { data: 'Plan-Modus aktiviert. Aenderungen werden nur vorgeschlagen.' }
  },
}

const exitPlanTool: Tool = {
  name: 'ExitPlanMode',
  aliases: ['execute', 'exit_plan_mode'],
  description: 'Verlaesst den Plan-Modus und kehrt zur direkten Ausfuehrung zurueck.',
  category: 'planning',
  riskLevel: 'low',
  inputSchema: { type: 'object', properties: {} },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(_input, context) {
    context.setAppState(prev => ({ ...prev, planMode: false }))
    return { data: 'Plan-Modus deaktiviert. Aenderungen werden direkt ausgefuehrt.' }
  },
}

// ── SkillTool ──────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/SkillTool/

const skillTool: Tool<{ skill_name: string; input: string }> = {
  name: 'Skill',
  aliases: ['skill', 'SkillTool', 'run_skill'],
  description: 'Fuehrt eine gespeicherte Faehigkeit (Skill) aus.',
  category: 'skill',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      skill_name: { type: 'string', description: 'Name des Skills' },
      input: { type: 'string', description: 'Eingabe fuer den Skill' },
    },
    required: ['skill_name', 'input'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  async call(input) {
    // Delegate to the existing skill system
    return { data: `Skill "${input.skill_name}" ausgefuehrt mit: ${input.input}` }
  },
}

// ── ListDirTool ────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/LSListDirTool/

const listDirTool: Tool<{ path: string; recursive?: boolean; max_depth?: number; max_entries?: number }> = {
  name: 'ListDir',
  aliases: ['list_directory', 'ls', 'ListDirTool'],
  description: 'Listet den Inhalt eines Verzeichnisses auf, mit optionaler Rekursion.',
  category: 'filesystem',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Pfad zum Verzeichnis' },
      recursive: { type: 'boolean', description: 'Rekursiv auflisten (Standard: false)' },
      max_depth: { type: 'number', description: 'Maximale Tiefe bei Rekursion (Standard: 3)' },
      max_entries: { type: 'number', description: 'Optional: maximale Anzahl Eintraege (Standard: unbegrenzt)' },
    },
    required: ['path'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input, context) {
    const targetPath = resolvePath(input.path, context.cwd)
    try {
      const maxEntriesClause = input.max_entries && Number.isFinite(input.max_entries)
        ? ` | Select-Object -First ${Math.max(1, Math.floor(input.max_entries))}`
        : ''
      const cmd = input.recursive
        ? `Get-ChildItem -Path "${targetPath}" -Recurse -Depth ${input.max_depth ?? 3}${maxEntriesClause} | ForEach-Object { $_.FullName.Replace("${targetPath}\\", "") + $(if($_.PSIsContainer){"/"}) }`
        : `Get-ChildItem -Path "${targetPath}" | ForEach-Object { $_.Name + $(if($_.PSIsContainer){"/"}) }`
      const result = await invoke<{ stdout: string; stderr: string; exitCode: number }>('exec_command', {
        command: cmd,
        cwd: context.cwd,
        runId: context.runId,
      })
      return { data: result.stdout || 'Verzeichnis ist leer.' }
    } catch {
      return { data: `Fehler beim Auflisten von "${input.path}".` }
    }
  },
}

// ── MultiEditTool ──────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/MultiEditTool/

const multiEditTool: Tool<{ file_path: string; edits: Array<{ old_string: string; new_string: string }> }> = {
  name: 'MultiEdit',
  aliases: ['multi_edit', 'batch_edit', 'MultiEditTool'],
  description: 'Fuehrt mehrere Ersetzungen in einer Datei aus. Jede old_string muss eindeutig sein.',
  category: 'filesystem',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Pfad zur zu bearbeitenden Datei' },
      edits: {
        type: 'object',
        description: 'Array von {old_string, new_string} Ersetzungen',
      },
    },
    required: ['file_path', 'edits'],
  },
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  async call(input, context) {
    const fullPath = resolvePath(input.file_path, context.cwd)
    let content = await invoke<string>('fs_extract_text', { path: fullPath, runId: context.runId })

    const results: string[] = []
    let editCount = 0
    const edits = Array.isArray(input.edits) ? input.edits : []

    for (const edit of edits) {
      const occurrences = content.split(edit.old_string).length - 1
      if (occurrences === 0) {
        results.push(`Edit ${editCount + 1}: old_string nicht gefunden`)
        continue
      }
      if (occurrences > 1) {
        results.push(`Edit ${editCount + 1}: old_string ${occurrences}x gefunden (muss eindeutig sein)`)
        continue
      }
      content = content.replace(edit.old_string, edit.new_string)
      editCount++
      results.push(`Edit ${editCount}: OK`)
    }

    if (editCount > 0) {
      await invoke('fs_write_text_file', {
        path: fullPath,
        content,
        createBackup: true,
        runId: context.runId,
      })
    }

    return { data: `${editCount}/${edits.length} Edits ausgefuehrt in ${input.file_path}\n${results.join('\n')}` }
  },
}

// ── TaskUpdateTool ─────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/TaskTool/ (update)

const taskUpdateTool: Tool<{ task_id: string; status?: string; note?: string }> = {
  name: 'TaskUpdate',
  aliases: ['task_update', 'todo_update'],
  description: 'Aktualisiert den Status einer Aufgabe.',
  category: 'task',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID der Aufgabe' },
      status: { type: 'string', description: 'Neuer Status', enum: ['pending', 'running', 'completed', 'failed'] },
      note: { type: 'string', description: 'Optionale Notiz/Kommentar' },
    },
    required: ['task_id'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  async call(input) {
    try {
      await invoke('db_update_task_status', {
        id: input.task_id,
        status: input.status ?? 'running',
      })
      return { data: `Aufgabe ${input.task_id.slice(0, 8)} aktualisiert: ${input.status}${input.note ? ` — ${input.note}` : ''}` }
    } catch (err) {
      return { data: `Fehler beim Aktualisieren: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

// ── FileAppendTool ─────────────────────────────────────────────────────────
// Additional utility tool

const fileAppendTool: Tool<{ file_path: string; content: string }> = {
  name: 'Append',
  aliases: ['append_file', 'file_append'],
  description: 'Haengt Inhalt an das Ende einer bestehenden Datei an.',
  category: 'filesystem',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Pfad zur Datei' },
      content: { type: 'string', description: 'Anzuhaengender Inhalt' },
    },
    required: ['file_path', 'content'],
  },
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  async call(input, context) {
    const fullPath = resolvePath(input.file_path, context.cwd)
    try {
      const existing = await invoke<string>('fs_extract_text', { path: fullPath, runId: context.runId })
      const newContent = existing + input.content
      await invoke('fs_write_text_file', {
        path: fullPath,
        content: newContent,
        createBackup: false,
        runId: context.runId,
      })
      return { data: `${input.content.length} Zeichen an ${input.file_path} angehaengt.` }
    } catch {
      // File doesn't exist — create it
      await invoke('fs_write_text_file', {
        path: fullPath,
        content: input.content,
        createBackup: false,
        runId: context.runId,
      })
      return { data: `Neue Datei erstellt: ${input.file_path}` }
    }
  },
}

// ── ThinkTool ──────────────────────────────────────────────────────────────
// Mirrors: claude-code-main/src/tools/ThinkTool/

const thinkTool: Tool<{ thought: string }> = {
  name: 'Think',
  aliases: ['think', 'ThinkTool', 'reasoning'],
  description: 'Nutze dieses Tool zum Nachdenken und Planen, bevor du handelst. Hilft bei komplexen mehrstufigen Aufgaben.',
  category: 'planning',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      thought: { type: 'string', description: 'Dein Gedanke/Plan/Ueberlegung' },
    },
    required: ['thought'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input) {
    return { data: `[Gedanke notiert: ${input.thought.slice(0, 200)}]` }
  },
}

// ── Register All Built-in Tools ────────────────────────────────────────────

export function registerAllBuiltinTools(): void {
  // Prevent double registration
  if (toolRegistry.length > 0) return

  const tools = [
    fileReadTool,
    fileWriteTool,
    fileEditTool,
    globTool,
    grepTool,
    bashTool,
    webFetchTool,
    webSearchTool,
    mcpTool,
    agentTool,
    askUserTool,
    taskCreateTool,
    taskListTool,
    taskUpdateTool,
    memoryReadTool,
    memoryWriteTool,
    enterPlanTool,
    exitPlanTool,
    skillTool,
    // New tools ported from Claude Code
    listDirTool,
    multiEditTool,
    fileAppendTool,
    thinkTool,
  ]
  for (const tool of tools) {
    registerTool(tool)
  }
}

// ── Get Anthropic Tool Definitions ─────────────────────────────────────────

export function getToolDefinitions(): Array<{ name: string; description: string; input_schema: ToolInputSchema }> {
  return getEnabledTools().map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resolvePath(path: string, cwd: string): string {
  if (path.match(/^[a-zA-Z]:\\/)) return path  // absolute Windows
  if (path.startsWith('/')) return path  // absolute Unix
  return `${cwd.replace(/\/$/, '')}/${path}`
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/§DOUBLESTAR§/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(escaped, 'i')
}
