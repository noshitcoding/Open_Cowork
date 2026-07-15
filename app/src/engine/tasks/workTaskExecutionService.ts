import type { WorkTask, WorkTaskStatus } from '../../stores/workTasksStore'
import { tr } from '../../i18n'
import type { CrewExecutionResponse } from '../crew/workTaskCrewRuntime'

export function buildCrewRunOutput(response: CrewExecutionResponse, fallbackTaskId: string): string {
  const directResult = response.taskResults.find((result) => result.taskId === fallbackTaskId)
  if (directResult?.output?.trim()) {
    return directResult.output
  }

  const renderedResults = response.taskResults
    .filter((result) => result.output?.trim())
    .map((result) => [
      `Task: ${result.taskId}`,
      `Agent: ${result.agentId}`,
      result.output?.trim() ?? '',
    ].filter(Boolean).join('\n'))

  if (renderedResults.length > 0) {
    return renderedResults.join('\n\n---\n\n')
  }

  return response.error ?? 'Crew run completed without text output.'
}

export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '-'
  try {
    return new Date(ts).toLocaleString('de-DE')
  } catch {
    return String(ts)
  }
}

export function formatWorkTaskStatus(status: WorkTaskStatus): string {
  switch (status) {
    case 'idle':
      return tr('Idle')
    case 'waiting_approval':
      return tr('Waiting for approval')
    case 'running':
      return tr('Running')
    case 'completed':
      return tr('Completed')
    case 'failed':
      return tr('Failed')
    case 'canceled':
      return tr('Canceled')
  }
}

export function deriveTaskName(task: WorkTask): string {
  const title = task.title.trim()
  if (title) return title
  const prompt = task.prompt.trim()
  if (!prompt) return task.id
  const singleLine = prompt.replace(/\s+/g, ' ').trim()
  return singleLine.length > 48 ? `${singleLine.slice(0, 48)}...` : singleLine
}

export function isAbsolutePath(path: string): boolean {
  const trimmed = path.trim()
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(trimmed)
}

export function createCrewStreamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `crew-${crypto.randomUUID()}`
  }

  return `crew-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildTaskThreadSummary(task: WorkTask): string {
  const lines = [
    `${tr('Task created')}: ${deriveTaskName(task)}`,
    `${tr('Runner')}: ${task.runner === 'crew' ? tr('Crew') : tr('Model')}`,
    task.expectedOutput.trim() ? `${tr('Expected output')}: ${task.expectedOutput.trim()}` : '',
    task.workDir.trim() ? `${tr('Working folder')}: ${task.workDir.trim()}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

export function buildTaskPromptMessage(task: WorkTask): string {
  const parts = [task.prompt.trim()]

  if (task.expectedOutput.trim()) {
    parts.push(`${tr('Expected output')}:\n${task.expectedOutput.trim()}`)
  }

  if (task.workDir.trim()) {
    parts.push(`${tr('Working folder')}:\n${task.workDir.trim()}`)
  }

  return parts.filter(Boolean).join('\n\n')
}
