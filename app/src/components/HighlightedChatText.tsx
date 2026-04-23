import type { ReactNode } from 'react'

type HighlightedChatTextProps = {
  content: string
}

const COMMAND_TOKEN_PATTERN = /(^|[\s([{])\/[A-Za-z][A-Za-z0-9_-]*/g

export function HighlightedChatText({ content }: HighlightedChatTextProps) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  COMMAND_TOKEN_PATTERN.lastIndex = 0

  while ((match = COMMAND_TOKEN_PATTERN.exec(content)) !== null) {
    const prefix = match[1] ?? ''
    const commandStart = match.index + prefix.length
    const commandEnd = match.index + match[0].length

    if (lastIndex < commandStart) {
      parts.push(content.slice(lastIndex, commandStart))
    }

    parts.push(
      <span className="chat-command-highlight" key={`${commandStart}-${commandEnd}`}>
        {content.slice(commandStart, commandEnd)}
      </span>,
    )

    lastIndex = commandEnd
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return <>{parts.length > 0 ? parts : content}</>
}
