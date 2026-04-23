export const MAX_CHAT_ATTACHMENTS = 25

export type ChatAttachmentKind = 'file' | 'folder'

export type ChatAttachment = {
  path: string
  kind: ChatAttachmentKind
}

type FileWithPath = File & { path?: string }

export function normalizeDialogSelection(selection: string | string[] | null): string[] {
  if (!selection) return []
  return Array.isArray(selection) ? selection : [selection]
}

export function mergeAttachments(
  existing: ChatAttachment[],
  additions: ChatAttachment[],
): { next: ChatAttachment[]; rejectedCount: number } {
  const seen = new Set(existing.map((item) => `${item.kind}::${item.path.toLowerCase()}`))
  const uniqueAdditions = additions.filter((item) => {
    const key = `${item.kind}::${item.path.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const room = Math.max(0, MAX_CHAT_ATTACHMENTS - existing.length)
  const accepted = uniqueAdditions.slice(0, room)
  return {
    next: [...existing, ...accepted],
    rejectedCount: uniqueAdditions.length - accepted.length,
  }
}

export function getPathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function formatAttachmentContext(attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return ''

  const lines = attachments.map((item, index) => {
    const label = item.kind === 'folder' ? 'Ordner' : 'Datei'
    return `${index + 1}. ${label}: ${item.path}`
  })

  return [`Verbundene Pfade (${attachments.length}):`, ...lines].join('\n')
}

const ATTACHMENT_CONTEXT_BLOCK_REGEX = /(?:^|\n)Verbundene Pfade \(\d+\):\n((?:\d+\.\s+(?:Datei|Ordner):[^\n]*(?:\n|$))+)/i

export function extractAttachmentsFromContent(content: string): {
  content: string
  attachments: ChatAttachment[]
} {
  if (!content.trim()) {
    return { content: '', attachments: [] }
  }

  const match = ATTACHMENT_CONTEXT_BLOCK_REGEX.exec(content)
  if (!match) {
    return { content: content.trim(), attachments: [] }
  }

  const attachments = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const entry = line.match(/^\d+\.\s+(Datei|Ordner):\s*(.+)$/i)
      if (!entry) return null
      return {
        kind: entry[1].toLowerCase() === 'ordner' ? 'folder' : 'file',
        path: entry[2].trim(),
      } satisfies ChatAttachment
    })
    .filter((item): item is ChatAttachment => item !== null && item.path.length > 0)

  const cleanedContent = content
    .replace(match[0], '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    content: cleanedContent,
    attachments,
  }
}

function fileUriToWindowsPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith('file://')) return ''

  let decoded = trimmed.replace(/^file:\/\//i, '')
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // Malformed URI segments (e.g. lone %) must not crash drop handling.
    return ''
  }

  if (/^[a-zA-Z]:/.test(decoded)) {
    return decoded.replace(/\//g, '\\')
  }

  if (decoded.startsWith('/')) {
    const maybeDrive = decoded.slice(1)
    if (/^[a-zA-Z]:/.test(maybeDrive)) {
      return maybeDrive.replace(/\//g, '\\')
    }
  }

  return decoded.replace(/\//g, '\\')
}

export function extractFileAttachmentsFromFileList(fileList: FileList | null): ChatAttachment[] {
  if (!fileList || fileList.length === 0) return []

  const paths: ChatAttachment[] = []
  for (const file of Array.from(fileList)) {
    const filePath = (file as FileWithPath).path
    if (typeof filePath === 'string' && filePath.trim().length > 0) {
      paths.push({ path: filePath, kind: 'file' })
    }
  }

  return paths
}

export function extractFileAttachmentsFromUriList(uriList: string): ChatAttachment[] {
  return uriList
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .map((line) => fileUriToWindowsPath(line))
    .filter((path) => path.length > 0)
    .map((path) => ({ path, kind: 'file' as const }))
}
