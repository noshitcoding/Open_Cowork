// ── Command Registry (ported from Claude Code) ─────────────────────────────
// Mirrors: claude-code-main/src/commands.ts
// Slash commands that users type in the chat: /help, /clear, /model, etc.

import type { Command, CommandCategory, ToolUseContext } from '../types'

// ── Command Registry ───────────────────────────────────────────────────────

const commandRegistry: Command[] = []

export function registerCommand(command: Command): void {
  commandRegistry.push(command)
}

export function getAllCommands(): Command[] {
  return commandRegistry
}

export function getCommandsByCategory(category: CommandCategory): Command[] {
  return commandRegistry.filter(c => c.category === category)
}

export function findCommand(name: string): Command | undefined {
  return commandRegistry.find(c =>
    c.name === name || c.name === `/${name}`,
  )
}

export function parseCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    return { command: trimmed.slice(1), args: '' }
  }
  return {
    command: trimmed.slice(1, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  }
}

export async function executeCommand(input: string, context: ToolUseContext): Promise<string | null> {
  const parsed = parseCommand(input)
  if (!parsed) return null

  const cmd = findCommand(parsed.command)
  if (!cmd) return `Unbekannter Befehl: /${parsed.command}. Tippe /help fuer alle Befehle.`

  if (cmd.isAvailable && !cmd.isAvailable()) {
    return `Befehl /${parsed.command} ist momentan nicht verfuegbar.`
  }

  const result = await cmd.call(parsed.args, context)
  return result ?? null
}

// ── Built-in Commands ──────────────────────────────────────────────────────

const helpCommand: Command = {
  name: '/help',
  description: 'Zeigt alle verfuegbaren Befehle an.',
  shortDescription: 'Hilfe',
  category: 'session',
  examples: ['/help', '/help config'],
  async call(args) {
    const commands = args
      ? getCommandsByCategory(args as CommandCategory)
      : getAllCommands()

    if (commands.length === 0) {
      return `Keine Befehle in Kategorie "${args}" gefunden.`
    }

    const grouped = new Map<string, Command[]>()
    for (const cmd of commands) {
      const cat = cmd.category
      if (!grouped.has(cat)) grouped.set(cat, [])
      grouped.get(cat)!.push(cmd)
    }

    const lines: string[] = ['### Verfuegbare Befehle\n']
    for (const [category, cmds] of grouped) {
      lines.push(`**${category}**`)
      for (const cmd of cmds) {
        lines.push(`  ${cmd.name} — ${cmd.shortDescription ?? cmd.description}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  },
}

const clearCommand: Command = {
  name: '/clear',
  description: 'Loescht den Chatverlauf der aktuellen Sitzung.',
  shortDescription: 'Chat leeren',
  category: 'session',
  async call(_args, context) {
    // The UI layer handles the actual clearing
    context.setAppState(prev => ({
      ...prev,
      turnCount: 0,
    }))
    return 'Chat geleert.'
  },
}

const modelCommand: Command = {
  name: '/model',
  description: 'Zeigt oder wechselt das aktuelle Modell.',
  shortDescription: 'Modell anzeigen/wechseln',
  category: 'config',
  examples: ['/model', '/model claude-sonnet-4-20250514'],
  async call(args, context) {
    if (!args) {
      return `Aktuelles Modell: ${context.model}`
    }
    // Model switch is handled by the engine config
    return `Modell gewechselt zu: ${args}`
  },
}

const statusCommand: Command = {
  name: '/status',
  description: 'Zeigt den aktuellen Status der Sitzung.',
  shortDescription: 'Session-Status',
  category: 'session',
  async call(_args, context) {
    const state = context.getAppState()
    return [
      '### Sitzungsstatus',
      `- **Modell:** ${context.model}`,
      `- **CWD:** ${state.cwd}`,
      `- **Turns:** ${state.turnCount}`,
      `- **Tokens:** ${state.totalTokens.input} input / ${state.totalTokens.output} output`,
      `- **Kosten:** $${state.totalCostUsd.toFixed(4)}`,
      `- **Plan-Modus:** ${state.planMode ? 'Aktiv' : 'Inaktiv'}`,
      `- **Aktive Tasks:** ${state.activeTasks.length}`,
    ].join('\n')
  },
}

const planCommand: Command = {
  name: '/plan',
  description: 'Wechselt in den Plan-Modus (nur Vorschlaege, keine Ausfuehrung).',
  shortDescription: 'Plan-Modus',
  category: 'planning',
  async call(_args, context) {
    const state = context.getAppState()
    const newPlanMode = !state.planMode
    context.setAppState(prev => ({ ...prev, planMode: newPlanMode }))
    return newPlanMode
      ? '📋 Plan-Modus aktiviert. Aenderungen werden nur vorgeschlagen.'
      : '🔧 Plan-Modus deaktiviert. Aenderungen werden ausgefuehrt.'
  },
}

const compactCommand: Command = {
  name: '/compact',
  description: 'Komprimiert den Chatverlauf um Token zu sparen.',
  shortDescription: 'Chat komprimieren',
  category: 'session',
  async call(_args) {
    // Compaction is handled by the memory system
    return 'Chat-Verlauf wird komprimiert...'
  },
}

const costCommand: Command = {
  name: '/cost',
  description: 'Zeigt die bisherigen API-Kosten dieser Sitzung.',
  shortDescription: 'Kosten anzeigen',
  category: 'session',
  async call(_args, context) {
    const state = context.getAppState()
    return [
      '### API-Kosten',
      `- **Gesamt:** $${state.totalCostUsd.toFixed(4)}`,
      `- **Input-Tokens:** ${state.totalTokens.input.toLocaleString()}`,
      `- **Output-Tokens:** ${state.totalTokens.output.toLocaleString()}`,
    ].join('\n')
  },
}

const debugCommand: Command = {
  name: '/debug',
  description: 'Aktiviert/deaktiviert den Debug-Modus.',
  shortDescription: 'Debug-Modus',
  category: 'debug',
  async call(_args, context) {
    const newDebug = !context.debug
    return `Debug-Modus: ${newDebug ? 'Aktiviert' : 'Deaktiviert'}`
  },
}

const cwdCommand: Command = {
  name: '/cwd',
  description: 'Zeigt oder wechselt das Arbeitsverzeichnis.',
  shortDescription: 'Arbeitsverzeichnis',
  category: 'navigation',
  examples: ['/cwd', '/cwd /home/user/project'],
  async call(args, context) {
    if (!args) {
      return `Arbeitsverzeichnis: ${context.cwd}`
    }
    context.setAppState(prev => ({ ...prev, cwd: args }))
    return `Arbeitsverzeichnis gewechselt zu: ${args}`
  },
}

const agentsCommand: Command = {
  name: '/agents',
  description: 'Listet verfuegbare Agenten auf.',
  shortDescription: 'Agenten anzeigen',
  category: 'agents',
  async call(_args, context) {
    if (context.agentDefinitions.length === 0) {
      return 'Keine Agenten konfiguriert.'
    }
    const lines = context.agentDefinitions.map(a =>
      `- **${a.name}** (${a.type}): ${a.description}`,
    )
    return `### Verfuegbare Agenten\n${lines.join('\n')}`
  },
}

const toolsCommand: Command = {
  name: '/tools',
  description: 'Listet verfuegbare Tools auf.',
  shortDescription: 'Tools anzeigen',
  category: 'tools',
  async call(_args, context) {
    const lines = context.tools.map(t =>
      `- **${t.name}** [${t.category}] (${t.riskLevel ?? 'low'}): ${t.description}`,
    )
    return `### Verfuegbare Tools (${context.tools.length})\n${lines.join('\n')}`
  },
}

const mcpCommand: Command = {
  name: '/mcp',
  description: 'Zeigt MCP-Server-Verbindungen und Tools.',
  shortDescription: 'MCP-Server',
  category: 'mcp',
  async call(_args, context) {
    if (context.mcpConnections.length === 0) {
      return 'Keine MCP-Server verbunden.'
    }
    const lines: string[] = ['### MCP-Server']
    for (const conn of context.mcpConnections) {
      lines.push(`\n**${conn.name}** (${conn.serverType}) — ${conn.connected ? '✅ Verbunden' : '❌ Getrennt'}`)
      if (conn.tools.length > 0) {
        lines.push('  Tools: ' + conn.tools.map(t => t.name).join(', '))
      }
    }
    return lines.join('\n')
  },
}

const memoryCommand: Command = {
  name: '/memory',
  description: 'Zeigt oder bearbeitet den Gedaechtnisspeicher.',
  shortDescription: 'Gedaechtnis',
  category: 'memory',
  examples: ['/memory', '/memory add key=value'],
  async call(args, context) {
    if (!args) {
      return context.memoryContent
        ? `### Gedaechtnis-Inhalt\n${context.memoryContent}`
        : 'Kein Gedaechtnisinhalt geladen.'
    }
    return `Gedaechtnis-Befehl: ${args}`
  },
}

const permissionsCommand: Command = {
  name: '/permissions',
  description: 'Zeigt aktuelle Berechtigungsregeln.',
  shortDescription: 'Berechtigungen',
  category: 'security',
  async call(_args, context) {
    const p = context.permissionContext
    const lines = [
      `### Berechtigungen (Modus: ${p.mode})`,
      `\n**Erlaubte Verzeichnisse:** ${p.allowedDirectories.length > 0 ? p.allowedDirectories.join(', ') : 'Keine'}`,
    ]
    if (p.allowRules.length > 0) {
      lines.push(`\n**Allow-Regeln:** ${p.allowRules.map(r => `${r.pattern} (${r.source})`).join(', ')}`)
    }
    if (p.denyRules.length > 0) {
      lines.push(`\n**Deny-Regeln:** ${p.denyRules.map(r => `${r.pattern} (${r.source})`).join(', ')}`)
    }
    return lines.join('\n')
  },
}

const exportCommand: Command = {
  name: '/export',
  description: 'Exportiert den aktuellen Chat als Markdown.',
  shortDescription: 'Chat exportieren',
  category: 'export',
  async call(_args, context) {
    const lines: string[] = ['# Chat-Export\n']
    for (const msg of context.messages) {
      if (msg.type === 'user') {
        const text = msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n')
        lines.push(`## User\n${text}\n`)
      } else if (msg.type === 'assistant') {
        const text = msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n')
        lines.push(`## Assistant (${msg.model})\n${text}\n`)
      }
    }
    return lines.join('\n')
  },
}

// ── Register All Built-in Commands ─────────────────────────────────────────

export function registerBuiltinCommands(): void {
  const commands = [
    helpCommand,
    clearCommand,
    modelCommand,
    statusCommand,
    planCommand,
    compactCommand,
    costCommand,
    debugCommand,
    cwdCommand,
    agentsCommand,
    toolsCommand,
    mcpCommand,
    memoryCommand,
    permissionsCommand,
    exportCommand,
  ]
  for (const cmd of commands) {
    registerCommand(cmd)
  }
}
