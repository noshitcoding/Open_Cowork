import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatAttachment, ChatAttachmentKind } from '../utils/chatAttachments'

export type ProjectResource = {
  id: string
  path: string
  kind: ChatAttachmentKind
  label?: string
  enabled: boolean
  addedAt: number
}

export type Project = {
  id: string
  title: string
  resources: ProjectResource[]
  threadIds: string[]
  createdAt: number
  updatedAt: number
}

type AddProjectResourceInput = {
  path: string
  kind: ChatAttachmentKind
  label?: string
  enabled?: boolean
}

type ProjectState = {
  projects: Project[]
  activeProjectId: string | null
  addProject: (title?: string) => string
  renameProject: (projectId: string, title: string) => void
  deleteProject: (projectId: string) => void
  setActiveProject: (projectId: string | null) => void
  addResources: (projectId: string, resources: AddProjectResourceInput[]) => void
  removeResource: (projectId: string, resourceId: string) => void
  setResourceEnabled: (projectId: string, resourceId: string, enabled: boolean) => void
  attachThread: (projectId: string, threadId: string) => void
  detachThread: (projectId: string, threadId: string) => void
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeTitle(title: string | undefined, fallback: string): string {
  const trimmed = title?.trim()
  return trimmed || fallback
}

function resourceKey(resource: Pick<ProjectResource, 'kind' | 'path'>): string {
  return `${resource.kind}::${resource.path.trim().toLowerCase()}`
}

function normalizeResource(raw: Partial<ProjectResource>): ProjectResource | null {
  if (typeof raw.path !== 'string' || !raw.path.trim()) return null
  const kind = raw.kind === 'folder' ? 'folder' : 'file'
  const addedAt = typeof raw.addedAt === 'number' ? raw.addedAt : Date.now()
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateId('resource'),
    path: raw.path.trim(),
    kind,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined,
    enabled: raw.enabled !== false,
    addedAt,
  }
}

function normalizeProject(raw: Partial<Project> & { id?: unknown }): Project | null {
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  const resources = Array.isArray(raw.resources)
    ? raw.resources
        .map((resource) => normalizeResource(resource))
        .filter((resource): resource is ProjectResource => Boolean(resource))
    : []
  const threadIds = Array.isArray(raw.threadIds)
    ? Array.from(new Set(raw.threadIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
    : []

  return {
    id: raw.id,
    title: normalizeTitle(raw.title, 'Unbenanntes Projekt'),
    resources,
    threadIds,
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
  }
}

function addUniqueResources(existing: ProjectResource[], incoming: AddProjectResourceInput[]): ProjectResource[] {
  const seen = new Set(existing.map(resourceKey))
  const now = Date.now()
  const additions = incoming
    .map((item): ProjectResource | null => {
      const normalized = normalizeResource({
        id: generateId('resource'),
        path: item.path,
        kind: item.kind,
        label: item.label,
        enabled: item.enabled,
        addedAt: now,
      })
      if (!normalized) return null
      const key = resourceKey(normalized)
      if (seen.has(key)) return null
      seen.add(key)
      return normalized
    })
    .filter((item): item is ProjectResource => Boolean(item))

  return additions.length > 0 ? [...existing, ...additions] : existing
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,

      addProject: (title) => {
        const now = Date.now()
        const id = generateId('project')
        const project: Project = {
          id,
          title: normalizeTitle(title, 'Neues Projekt'),
          resources: [],
          threadIds: [],
          createdAt: now,
          updatedAt: now,
        }

        set((state) => ({
          projects: [project, ...state.projects],
          activeProjectId: id,
        }))

        return id
      },

      renameProject: (projectId, title) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId
              ? { ...project, title: normalizeTitle(title, project.title), updatedAt: Date.now() }
              : project,
          ),
        })),

      deleteProject: (projectId) =>
        set((state) => {
          const projects = state.projects.filter((project) => project.id !== projectId)
          return {
            projects,
            activeProjectId: state.activeProjectId === projectId ? projects[0]?.id ?? null : state.activeProjectId,
          }
        }),

      setActiveProject: (projectId) =>
        set((state) => ({
          activeProjectId: projectId && state.projects.some((project) => project.id === projectId)
            ? projectId
            : null,
        })),

      addResources: (projectId, resources) =>
        set((state) => ({
          projects: state.projects.map((project) => {
            if (project.id !== projectId) return project
            const nextResources = addUniqueResources(project.resources, resources)
            if (nextResources === project.resources) return project
            return {
              ...project,
              resources: nextResources,
              updatedAt: Date.now(),
            }
          }),
        })),

      removeResource: (projectId, resourceId) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  resources: project.resources.filter((resource) => resource.id !== resourceId),
                  updatedAt: Date.now(),
                }
              : project,
          ),
        })),

      setResourceEnabled: (projectId, resourceId, enabled) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  resources: project.resources.map((resource) =>
                    resource.id === resourceId ? { ...resource, enabled } : resource,
                  ),
                  updatedAt: Date.now(),
                }
              : project,
          ),
        })),

      attachThread: (projectId, threadId) => {
        const normalizedThreadId = threadId.trim()
        if (!normalizedThreadId) return

        set((state) => ({
          projects: state.projects.map((project) => {
            const threadIds = project.threadIds.filter((id) => id !== normalizedThreadId)
            if (project.id !== projectId) {
              return threadIds.length === project.threadIds.length
                ? project
                : { ...project, threadIds, updatedAt: Date.now() }
            }

            return {
              ...project,
              threadIds: [normalizedThreadId, ...threadIds],
              updatedAt: Date.now(),
            }
          }),
          activeProjectId: projectId,
        }))
      },

      detachThread: (projectId, threadId) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  threadIds: project.threadIds.filter((id) => id !== threadId),
                  updatedAt: Date.now(),
                }
              : project,
          ),
        })),
    }),
    {
      name: 'open-cowork-projects',
      merge: (persistedState, currentState) => {
        const typedState = persistedState as Partial<ProjectState>
        const projects = Array.isArray((typedState as { projects?: unknown }).projects)
          ? (typedState as { projects: unknown[] }).projects
              .map((project) => normalizeProject(project as Partial<Project>))
              .filter((project): project is Project => Boolean(project))
          : currentState.projects
        const activeProjectId = typeof typedState.activeProjectId === 'string'
          && projects.some((project) => project.id === typedState.activeProjectId)
          ? typedState.activeProjectId
          : projects[0]?.id ?? null

        return {
          ...currentState,
          projects,
          activeProjectId,
        }
      },
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      }),
    },
  ),
)

export function getProjectForThread(projects: Project[], threadId: string | null | undefined): Project | null {
  if (!threadId) return null
  return projects.find((project) => project.threadIds.includes(threadId)) ?? null
}

export function projectResourceToAttachment(resource: ProjectResource): ChatAttachment {
  return {
    path: resource.path,
    kind: resource.kind,
    label: resource.label,
  }
}

export function getEnabledProjectAttachments(project: Project | null | undefined): ChatAttachment[] {
  if (!project) return []
  return project.resources
    .filter((resource) => resource.enabled)
    .map(projectResourceToAttachment)
}
