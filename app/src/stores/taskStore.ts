import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type TaskStatus =
  | 'created'
  | 'planned'
  | 'waiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TaskStep = {
  id: string
  index: number
  title: string
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  requiresApproval: boolean
  riskLevel: 'low' | 'medium' | 'high'
  output: string | null
}

export type Task = {
  id: string
  title: string
  prompt: string
  status: TaskStatus
  steps: TaskStep[]
  threadId: string | null
  createdAt: number
  updatedAt: number
  error: string | null
}

type TaskState = {
  tasks: Task[]
  activeTaskId: string | null
  loadFromDb: () => Promise<void>
  createTask: (prompt: string, title: string, threadId: string | null) => string
  updateTaskStatus: (taskId: string, status: TaskStatus) => void
  setTaskSteps: (taskId: string, steps: TaskStep[]) => void
  updateStep: (taskId: string, stepId: string, patch: Partial<TaskStep>) => void
  setActiveTask: (id: string | null) => void
  setTaskError: (taskId: string, error: string) => void
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useTaskStore = create<TaskState>()((set) => ({
  tasks: [],
  activeTaskId: null,

  loadFromDb: async () => {
    try {
      type DbTask = { id: string; title: string; prompt: string; status: string; thread_id: string | null; created_at: string; updated_at: string; error: string | null }
      type DbStep = { id: string; idx: number; title: string; state: string; requires_approval: boolean; risk_level: string; output: string | null }
      const dbTasks = await invoke<DbTask[]>('db_list_tasks')
      const tasks: Task[] = []
      for (const dt of dbTasks) {
        const dbSteps = await invoke<DbStep[]>('db_list_steps', { taskId: dt.id })
        tasks.push({
          id: dt.id,
          title: dt.title,
          prompt: dt.prompt,
          status: dt.status as TaskStatus,
          threadId: dt.thread_id,
          createdAt: new Date(dt.created_at).getTime(),
          updatedAt: new Date(dt.updated_at).getTime(),
          error: dt.error,
          steps: dbSteps.map((s) => ({
            id: s.id,
            index: s.idx,
            title: s.title,
            state: s.state as TaskStep['state'],
            requiresApproval: s.requires_approval,
            riskLevel: s.risk_level as TaskStep['riskLevel'],
            output: s.output,
          })),
        })
      }
      set({ tasks })
    } catch {
      // DB not available - keep in-memory state
    }
  },

  createTask: (prompt, title, threadId) => {
    const id = generateId()
    const now = Date.now()
    const task: Task = {
      id,
      title,
      prompt,
      status: 'created',
      steps: [],
      threadId,
      createdAt: now,
      updatedAt: now,
      error: null,
    }
    set((state) => ({
      tasks: [task, ...state.tasks],
      activeTaskId: id,
    }))
    const isoNow = new Date(now).toISOString()
    invoke('db_save_task', {
      id, title, prompt, status: 'created', threadId, createdAt: isoNow,
    }).catch(() => {})
    return id
  },

  updateTaskStatus: (taskId, status) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status, updatedAt: Date.now() } : t
      ),
    }))
    invoke('db_update_task_status', { id: taskId, status }).catch(() => {})
  },

  setTaskSteps: (taskId, steps) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, steps, updatedAt: Date.now() } : t
      ),
    }))
    for (const step of steps) {
      invoke('db_save_step', {
        id: step.id, taskId, idx: step.index, title: step.title,
        stateVal: step.state, requiresApproval: step.requiresApproval, riskLevel: step.riskLevel,
      }).catch(() => {})
    }
  },

  updateStep: (taskId, stepId, patch) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId ? { ...s, ...patch } : s
              ),
              updatedAt: Date.now(),
            }
          : t
      ),
    }))
    if (patch.state !== undefined) {
      invoke('db_update_step', { id: stepId, stateVal: patch.state, output: patch.output ?? null }).catch(() => {})
    }
  },

  setActiveTask: (id) => set({ activeTaskId: id }),

  setTaskError: (taskId, error) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, error, status: 'failed' as TaskStatus, updatedAt: Date.now() }
          : t
      ),
    }))
    invoke('db_update_task_status', { id: taskId, status: 'failed' }).catch(() => {})
  },
}))
