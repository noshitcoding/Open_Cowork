import { beforeEach, describe, expect, it } from 'vitest'
import {
  getEnabledProjectAttachments,
  getProjectForThread,
  useProjectStore,
} from './projectStore'

describe('projectStore', () => {
  beforeEach(() => {
    window.localStorage.removeItem('open-cowork-projects')
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
    })
  })

  it('creates named projects and renames them', () => {
    const id = useProjectStore.getState().addProject('Kundenanalyse')
    useProjectStore.getState().renameProject(id, 'Kundenanalyse Q2')

    const project = useProjectStore.getState().projects[0]
    expect(project.id).toBe(id)
    expect(project.title).toBe('Kundenanalyse Q2')
    expect(useProjectStore.getState().activeProjectId).toBe(id)
  })

  it('deduplicates resources and exposes only enabled attachments', () => {
    const id = useProjectStore.getState().addProject('Daten')
    useProjectStore.getState().addResources(id, [
      { path: 'C:/docs/spec.md', kind: 'file' },
      { path: 'C:/docs/spec.md', kind: 'file' },
      { path: 'C:/repo', kind: 'folder', enabled: false },
    ])

    const project = useProjectStore.getState().projects[0]
    expect(project.resources).toHaveLength(2)
    expect(getEnabledProjectAttachments(project)).toEqual([
      { path: 'C:/docs/spec.md', kind: 'file', label: undefined },
    ])
  })

  it('moves chats between projects exclusively', () => {
    const firstId = useProjectStore.getState().addProject('Alpha')
    const secondId = useProjectStore.getState().addProject('Beta')

    useProjectStore.getState().attachThread(firstId, 'thread-1')
    useProjectStore.getState().attachThread(secondId, 'thread-1')

    const state = useProjectStore.getState()
    const first = state.projects.find((project) => project.id === firstId)
    const second = state.projects.find((project) => project.id === secondId)

    expect(first?.threadIds).toEqual([])
    expect(second?.threadIds).toEqual(['thread-1'])
    expect(getProjectForThread(state.projects, 'thread-1')?.id).toBe(secondId)
  })
})
