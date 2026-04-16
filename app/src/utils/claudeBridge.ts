import type { ClaudePermissionMode } from '../stores/coworkStore'

export type ParsedSlashCommand = {
  command: string
  args: string
} | null

export function parseSlashCommand(input: string): ParsedSlashCommand {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const firstSpace = trimmed.indexOf(' ')
  if (firstSpace < 0) {
    return {
      command: trimmed.slice(1).toLowerCase(),
      args: '',
    }
  }

  return {
    command: trimmed.slice(1, firstSpace).toLowerCase(),
    args: trimmed.slice(firstSpace + 1).trim(),
  }
}

export function buildClaudeSystemAddendum(input: {
  globalInstruction: string
  planMode: boolean
  permissionMode: ClaudePermissionMode
  enabledTools: string[]
}): string {
  const sections: string[] = []

  if (input.globalInstruction.trim()) {
    sections.push(`Projekt-Instruktion: ${input.globalInstruction.trim()}`)
  }

  sections.push(`Permission-Modus: ${input.permissionMode}`)

  if (input.planMode) {
    sections.push('Plan-Mode ist aktiv: gib nur Plan/Analyse aus, keine Ausfuehrungsanweisungen mit destruktiven Schritten.')
  }

  if (input.enabledTools.length > 0) {
    sections.push(`Aktive Tool-Familien: ${input.enabledTools.join(', ')}`)
  }

  if (sections.length === 0) return ''

  return `[SYSTEM-KONTEXT]\n${sections.join('\n')}\n[/SYSTEM-KONTEXT]`
}

export function buildSlashHelpText(pluginSkillLines: string[] = []): string {
  const baseLines = [
    'Verfuegbare Slash-Commands:',
    '/help - Diese Hilfe anzeigen',
    '/tools - Aktive Tool-Konfiguration anzeigen',
    '/mode plan|execute - Plan-Mode ein/aus',
    '/permissions <mode> - default | acceptEdits | bypassPermissions | dontAsk | plan',
    '/plan <prompt> - Prompt als Plan-Anfrage ausfuehren',
    '/fetch <url> - URL laden und Textauszug anzeigen',
    '/tool <name> <args> - Tool Dispatcher nutzen (z. B. /tool read_file C:\\tmp\\a.txt)',
    '/todo add <titel> | /todo list - einfache Todo-Steuerung',
  ]

  if (pluginSkillLines.length > 0) {
    baseLines.push('', 'Aktive Plugin-Skills:')
    pluginSkillLines.forEach((line) => baseLines.push(line))
  }

  return baseLines.join('\n')
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

export function isToolDeniedByRules(toolId: string, target: string | null, rules: string[]): boolean {
  const normalizedTarget = (target ?? '').trim()

  return rules.some((rule) => {
    const trimmed = rule.trim()
    if (!trimmed) return false

    if (trimmed.includes(':')) {
      const [ruleTool, rulePattern] = trimmed.split(':', 2)
      if (ruleTool.trim().toLowerCase() !== toolId.toLowerCase()) return false
      if (!normalizedTarget) return true
      return wildcardToRegex(rulePattern.trim()).test(normalizedTarget)
    }

    return trimmed.toLowerCase() === toolId.toLowerCase()
  })
}

export function compactHistoryForPrompt(
  messages: Array<{ role: string; content: string }>,
  maxItems: number,
): { compacted: Array<{ role: string; content: string }>; droppedCount: number } {
  if (messages.length <= maxItems) {
    return {
      compacted: messages,
      droppedCount: 0,
    }
  }

  const keepTail = Math.max(2, maxItems - 1)
  const dropped = messages.slice(0, messages.length - keepTail)
  const tail = messages.slice(messages.length - keepTail)

  const summary = dropped
    .slice(-6)
    .map((entry, idx) => {
      const snippet = entry.content.replace(/\s+/g, ' ').slice(0, 140)
      return `${idx + 1}. ${entry.role}: ${snippet}`
    })
    .join('\n')

  const synthetic = {
    role: 'system',
    content: `[HISTORY_COMPACTED]\nReduzierte Nachrichten: ${dropped.length}\nLetzte Kernaussagen:\n${summary}\n[/HISTORY_COMPACTED]`,
  }

  return {
    compacted: [synthetic, ...tail],
    droppedCount: dropped.length,
  }
}
