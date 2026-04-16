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
