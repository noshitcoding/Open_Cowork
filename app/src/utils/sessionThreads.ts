import { extractTextContent, loadSession, type Message, type SessionRecord } from '../engine'
import type { ChatMessage, ChatThread } from '../stores/chatStore'
import { extractAttachmentsFromContent } from './chatAttachments'

export function toChatMessages(messages: Message[]): ChatMessage[] {
  return messages.map((message, index) => {
    const role = message.type === 'user'
      ? 'user'
      : message.type === 'assistant' || message.type === 'tool_use_summary'
        ? 'assistant'
        : 'system'
    const timestamp = 'timestamp' in message && typeof message.timestamp === 'number'
      ? message.timestamp
      : Date.now() + index

    const rawContent = extractTextContent(message) || `[${message.type}]`
    const extracted = role === 'user'
      ? extractAttachmentsFromContent(rawContent)
      : { content: rawContent, attachments: [] }

    return {
      id: 'uuid' in message && typeof message.uuid === 'string'
        ? message.uuid
        : `${timestamp}-${index}`,
      role,
      content: extracted.content,
      timestamp,
      attachments: extracted.attachments.length > 0 ? extracted.attachments : undefined,
      debugContent: extracted.attachments.length > 0 ? rawContent : undefined,
    }
  })
}

export function toChatThread(session: SessionRecord): ChatThread {
  return {
    id: session.id,
    title: session.title,
    messages: toChatMessages(session.messages),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export async function resolveSessionRecord(
  sessionId: string,
  loadSessionById: (sessionId: string) => Promise<SessionRecord | null>,
): Promise<SessionRecord | null> {
  return await loadSessionById(sessionId) ?? await loadSession(sessionId)
}
