import { limitRollingLines } from '../utils/messageDisplay'

const WAITING_LINES = [
  'Kontext wird sortiert',
  'Gedanken werden gebündelt',
  'Antwort wird aufgebaut',
  'Nächster sinnvoller Schritt wird gesucht',
]

type MessageThinkingProps = {
  content?: string
  limitToRollingWindow: boolean
}

type MessageStreamPanelProps = MessageThinkingProps & {
  title: string
  className?: string
}

function MessageStreamPanel({ content, limitToRollingWindow, title, className }: MessageStreamPanelProps) {
  if (!content?.trim()) return null

  const visibleContent = limitToRollingWindow ? limitRollingLines(content, 50) : content

  return (
    <div className={`thinking-panel ${className ?? ''}`.trim()}>
      <div className="thinking-header">
        <span>{title}</span>
        {limitToRollingWindow && <span className="thinking-limit">letzte 50 Zeilen</span>}
      </div>
      <pre>{visibleContent}</pre>
    </div>
  )
}

export function MessageThinking({ content, limitToRollingWindow }: MessageThinkingProps) {
  return (
    <MessageStreamPanel
      content={content}
      limitToRollingWindow={limitToRollingWindow}
      title="Thinking"
    />
  )
}

export function MessageVerbose({ content, limitToRollingWindow }: MessageThinkingProps) {
  return (
    <MessageStreamPanel
      content={content}
      limitToRollingWindow={limitToRollingWindow}
      title="Verbose Live"
      className="verbose-panel"
    />
  )
}

export function StreamingPlaceholder() {
  return (
    <span className="stream-placeholder" aria-live="polite">
      {WAITING_LINES.map((line) => (
        <span key={line} className="stream-placeholder-line">
          {line}<span className="stream-placeholder-dots" />
        </span>
      ))}
    </span>
  )
}
