import { beforeEach, describe, expect, it } from 'vitest'
import { useCrewStore, type CrewAgent } from './crewStore'

const duplicateAgent: CrewAgent = {
  id: 'agent-researcher',
  name: 'Forscher',
  role: 'researcher',
  goal: 'Recherche',
  backstory: 'Testagent',
  skillsMarkdown: '',
  personalityId: null,
  modelOverride: null,
  providerKind: 'ollama',
  tools: ['read_file'],
  mcpServerNames: [],
  enabled: true,
  allowDelegation: true,
  verbose: true,
  maxIterations: 10,
}

describe('crewStore', () => {
  beforeEach(() => {
    window.localStorage.removeItem('open-cowork-crew')
    useCrewStore.setState({
      crews: [],
      agents: [],
      executionLogs: [],
      activeCrewId: null,
      loading: false,
    })
  })

  it('deduplicates agents when creating a crew', () => {
    useCrewStore.setState({
      agents: [duplicateAgent, { ...duplicateAgent }],
    })

    useCrewStore.getState().createCrew('crew-1', 'Test Crew', [])

    expect(useCrewStore.getState().crews).toHaveLength(1)
    expect(useCrewStore.getState().crews[0].agents).toHaveLength(1)
    expect(useCrewStore.getState().crews[0].agents[0].id).toBe('agent-researcher')
  })
})