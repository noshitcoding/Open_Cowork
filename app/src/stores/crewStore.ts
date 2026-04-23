import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AgentRole = 'researcher' | 'writer' | 'reviewer' | 'planner' | 'executor' | 'analyst' | 'custom'

export type CrewAgent = {
  id: string
  name: string
  role: AgentRole
  goal: string
  backstory: string
  personalityId: string | null
  modelOverride: string | null
  tools: string[]
  allowDelegation: boolean
  verbose: boolean
  maxIterations: number
}

export type CrewTask = {
  id: string
  description: string
  expectedOutput: string
  agentId: string
  context: string[]
  dependencies: string[]
  asyncExecution: boolean
  status: 'pending' | 'running' | 'completed' | 'failed'
  output: string | null
}

export type Crew = {
  id: string
  name: string
  description: string
  agents: CrewAgent[]
  tasks: CrewTask[]
  process: 'sequential' | 'hierarchical'
  managerAgentId: string | null
  verbose: boolean
  maxRpm: number
  status: 'idle' | 'running' | 'completed' | 'failed'
  createdAt: number
  updatedAt: number
}

export type CrewExecutionLog = {
  id: string
  crewId: string
  agentId: string
  taskId: string
  action: string
  result: string
  timestamp: number
}

type CrewState = {
  crews: Crew[]
  agents: CrewAgent[]
  executionLogs: CrewExecutionLog[]
  activeCrewId: string | null
  loading: boolean

  createCrew: (id: string, name: string, agentIds: string[]) => void
  updateCrew: (id: string, patch: Partial<Crew>) => void
  deleteCrew: (id: string) => void
  setActiveCrew: (id: string | null) => void

  addAgent: (agent: CrewAgent) => void
  updateAgent: (id: string, patch: Partial<CrewAgent>) => void
  removeAgent: (id: string) => void
  loadAgents: () => void

  addTask: (crewId: string, task: CrewTask) => void
  updateTask: (crewId: string, taskId: string, patch: Partial<CrewTask>) => void
  removeTask: (crewId: string, taskId: string) => void

  runCrew: (crewId: string) => void
  stopCrew: (crewId: string) => void

  addLog: (log: CrewExecutionLog) => void
  installDefaultAgents: () => void
}

const DEFAULT_AGENTS: CrewAgent[] = [
  {
    id: 'agent-researcher',
    name: 'Forscher',
    role: 'researcher',
    goal: 'Gruendliche Recherche und Informationsbeschaffung zu jedem Thema',
    backstory: 'Ein erfahrener Forscher mit Zugang zu vielfaeltigen Quellen. Analysiert Informationen kritisch und liefert fundierte Ergebnisse.',
    personalityId: null,
    modelOverride: null,
    tools: ['web_fetch', 'grep', 'glob', 'read_file'],
    allowDelegation: true,
    verbose: true,
    maxIterations: 10,
  },
  {
    id: 'agent-writer',
    name: 'Autor',
    role: 'writer',
    goal: 'Hochwertige Texte, Dokumentation und Content erstellen',
    backstory: 'Ein versierter Autor der klare, praegnante und gut strukturierte Texte verfasst. Beherrscht verschiedene Schreibstile.',
    personalityId: null,
    modelOverride: null,
    tools: ['edit_file', 'read_file', 'glob'],
    allowDelegation: false,
    verbose: true,
    maxIterations: 5,
  },
  {
    id: 'agent-reviewer',
    name: 'Reviewer',
    role: 'reviewer',
    goal: 'Code und Texte qualitativ pruefen und verbessern',
    backstory: 'Ein erfahrener Code-Reviewer mit Blick fuer Details, Best Practices und potenzielle Probleme.',
    personalityId: null,
    modelOverride: null,
    tools: ['read_file', 'grep', 'glob'],
    allowDelegation: true,
    verbose: true,
    maxIterations: 8,
  },
  {
    id: 'agent-planner',
    name: 'Planer',
    role: 'planner',
    goal: 'Komplexe Aufgaben in ausfuehrbare Schritte zerlegen',
    backstory: 'Ein strategischer Denker der komplexe Probleme analysiert und in klare, priorisierte Aktionsplaene uebersetzen kann.',
    personalityId: null,
    modelOverride: null,
    tools: ['todo', 'read_file', 'glob', 'grep'],
    allowDelegation: true,
    verbose: true,
    maxIterations: 5,
  },
  {
    id: 'agent-executor',
    name: 'Ausfuehrer',
    role: 'executor',
    goal: 'Aufgaben zuverlaessig und effizient ausfuehren',
    backstory: 'Ein zuverlaessiger Ausfuehrer der Plaene praezise umsetzt, Fehler erkennt und selbststaendig loest.',
    personalityId: null,
    modelOverride: null,
    tools: ['bash', 'edit_file', 'read_file', 'glob', 'grep'],
    allowDelegation: false,
    verbose: true,
    maxIterations: 15,
  },
  {
    id: 'agent-analyst',
    name: 'Analyst',
    role: 'analyst',
    goal: 'Daten analysieren, Muster erkennen und Empfehlungen ableiten',
    backstory: 'Ein Datenanalyst der Zusammenhaenge erkennt, Metriken auswertet und datengetriebene Empfehlungen ausspricht.',
    personalityId: null,
    modelOverride: null,
    tools: ['read_file', 'grep', 'glob', 'web_fetch'],
    allowDelegation: true,
    verbose: true,
    maxIterations: 8,
  },
]

export const useCrewStore = create<CrewState>()(
  persist(
    (set, get) => ({
      crews: [],
      agents: [],
      executionLogs: [],
      activeCrewId: null,
      loading: false,

      createCrew: (id, name, agentIds) => {
        const selectedAgents = get().agents.filter(a => agentIds.includes(a.id))
        const crew: Crew = {
          id,
          name,
          description: '',
          agents: selectedAgents.length > 0 ? selectedAgents : [...get().agents],
          tasks: [],
          process: 'sequential',
          managerAgentId: null,
          verbose: true,
          maxRpm: 10,
          status: 'idle',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set(s => ({ crews: [crew, ...s.crews] }))
      },

      updateCrew: (id, patch) =>
        set(s => ({
          crews: s.crews.map(c => c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c),
        })),

      deleteCrew: (id) =>
        set(s => ({
          crews: s.crews.filter(c => c.id !== id),
          activeCrewId: s.activeCrewId === id ? null : s.activeCrewId,
        })),

      setActiveCrew: (id) => set({ activeCrewId: id }),

      addAgent: (agent) =>
        set(s => ({
          agents: s.agents.some(a => a.id === agent.id)
            ? s.agents.map(a => a.id === agent.id ? agent : a)
            : [agent, ...s.agents],
        })),

      updateAgent: (id, patch) =>
        set(s => ({
          agents: s.agents.map(a => a.id === id ? { ...a, ...patch } : a),
        })),

      removeAgent: (id) =>
        set(s => ({ agents: s.agents.filter(a => a.id !== id) })),

      loadAgents: () => {
        const current = get().agents
        if (current.length === 0) {
          set({ agents: [...DEFAULT_AGENTS] })
        }
      },

      addTask: (crewId, task) =>
        set(s => ({
          crews: s.crews.map(c =>
            c.id === crewId ? { ...c, tasks: [...c.tasks, task], updatedAt: Date.now() } : c
          ),
        })),

      updateTask: (crewId, taskId, patch) =>
        set(s => ({
          crews: s.crews.map(c =>
            c.id === crewId
              ? {
                  ...c,
                  tasks: c.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t),
                  updatedAt: Date.now(),
                }
              : c
          ),
        })),

      removeTask: (crewId, taskId) =>
        set(s => ({
          crews: s.crews.map(c =>
            c.id === crewId
              ? { ...c, tasks: c.tasks.filter(t => t.id !== taskId), updatedAt: Date.now() }
              : c
          ),
        })),

      runCrew: (crewId) => {
        set(s => ({
          crews: s.crews.map(c =>
            c.id === crewId
              ? {
                  ...c,
                  status: 'running' as const,
                  tasks: c.tasks.map((t, i) => ({
                    ...t,
                    status: i === 0 ? 'running' as const : 'pending' as const,
                  })),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },

      stopCrew: (crewId) => {
        set(s => ({
          crews: s.crews.map(c =>
            c.id === crewId
              ? { ...c, status: 'idle' as const, updatedAt: Date.now() }
              : c
          ),
        }))
      },

      addLog: (log) =>
        set(s => ({
          executionLogs: [log, ...s.executionLogs].slice(0, 500),
        })),

      installDefaultAgents: () => {
        set(s => {
          const existing = new Map(s.agents.map(a => [a.id, a]))
          for (const agent of DEFAULT_AGENTS) {
            if (!existing.has(agent.id)) {
              existing.set(agent.id, agent)
            }
          }
          return { agents: Array.from(existing.values()) }
        })
      },
    }),
    {
      name: 'open-cowork-crew',
      partialize: (s) => ({
        crews: s.crews,
        agents: s.agents,
        activeCrewId: s.activeCrewId,
      }),
    }
  )
)
