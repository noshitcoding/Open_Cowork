/**
 * Scheduled Tasks Worker
 * Periodically checks for due tasks and executes them via Ollama.
 */

import { useCoworkStore } from '../stores/coworkStore'

let intervalId: ReturnType<typeof setInterval> | null = null
let running = false

/** Parse simple cron-like pattern. Returns interval in milliseconds. */
function parseCronLike(pattern: string): number {
  const p = pattern.trim().toLowerCase()
  if (p === 'every 1m' || p === 'every minute') return 60_000
  if (p === 'every 5m' || p === 'every 5 minutes') return 5 * 60_000
  if (p === 'every 10m' || p === 'every 10 minutes') return 10 * 60_000
  if (p === 'every 15m' || p === 'every 15 minutes') return 15 * 60_000
  if (p === 'every 30m' || p === 'every 30 minutes') return 30 * 60_000
  if (p === 'every 1h' || p === 'hourly') return 60 * 60_000
  if (p === 'every 2h') return 2 * 60 * 60_000
  if (p === 'every 4h') return 4 * 60 * 60_000
  if (p === 'every 6h') return 6 * 60 * 60_000
  if (p === 'every 12h') return 12 * 60 * 60_000
  if (p === 'every 24h' || p === 'daily') return 24 * 60 * 60_000

  // Try to parse "every Nm" or "every Nh"
  const match = p.match(/^every\s+(\d+)\s*(m|min|h|hr|hours?|minutes?)$/)
  if (match) {
    const num = parseInt(match[1], 10)
    const unit = match[2].startsWith('h') ? 60 : 1
    return num * unit * 60_000
  }

  // Default: every hour
  return 60 * 60_000
}

function isDue(task: { cronLike: string; lastRunAt: number | null }): boolean {
  const intervalMs = parseCronLike(task.cronLike)
  const now = Date.now()
  if (!task.lastRunAt) return true
  return (now - task.lastRunAt) >= intervalMs
}

async function executeScheduledTask(taskPrompt: string, ollamaUrl: string, model: string): Promise<string> {
  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `[Geplante Aufgabe] ${taskPrompt}`,
        stream: false,
      }),
    })

    if (!response.ok) return `Fehler: HTTP ${response.status}`

    const data = await response.json() as { response?: string }
    return data.response ?? '(keine Antwort)'
  } catch (e) {
    return `Fehler: ${e}`
  }
}

async function tick(): Promise<void> {
  if (running) return
  running = true

  try {
    const store = useCoworkStore.getState()
    const activeTasks = store.scheduledTasks.filter(t => t.active)

    if (activeTasks.length === 0) {
      running = false
      return
    }

    // Get Ollama config dynamically
    let ollamaUrl = 'http://192.168.178.82:11434'
    let ollamaModel = 'gpt-oss:20b'
    try {
      const { useConfigStore } = await import('../stores/configStore')
      const config = useConfigStore.getState()
      ollamaUrl = config.ollama.baseUrl
      ollamaModel = config.ollama.model
    } catch { /* use defaults */ }

    for (const task of activeTasks) {
      if (!isDue(task)) continue

      console.log(`[ScheduledWorker] Executing task: ${task.name}`)
      const result = await executeScheduledTask(task.prompt, ollamaUrl, ollamaModel)
      store.markScheduledTaskRun(task.id, Date.now())

      // Log to insights if available
      try {
        const { useInsightsStore } = await import('../stores/insightsStore')
        await useInsightsStore.getState().recordEvent({
          eventType: 'scheduled_task',
          category: 'automation',
          valueText: `${task.name}: ${result.slice(0, 200)}`,
        })
      } catch { /* insights not available */ }

      console.log(`[ScheduledWorker] Task "${task.name}" completed:`, result.slice(0, 100))
    }
  } catch (e) {
    console.error('[ScheduledWorker] Error:', e)
  } finally {
    running = false
  }
}

/** Start the scheduled task worker. Checks every 60 seconds. */
export function startScheduledWorker(): void {
  if (intervalId !== null) return
  console.log('[ScheduledWorker] Started')
  intervalId = setInterval(tick, 60_000)
  // Run immediately on start
  void tick()
}

/** Stop the scheduled task worker. */
export function stopScheduledWorker(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
    console.log('[ScheduledWorker] Stopped')
  }
}

/** Check if the worker is running. */
export function isScheduledWorkerRunning(): boolean {
  return intervalId !== null
}
