import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, getActiveThread } from './chatStore'

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      threads: [],
      activeThreadId: null,
      pendingApproval: [],
      busy: false,
      error: null,
    })
  })

  it('creates a thread with system message', () => {
    const id = useChatStore.getState().addThread('Test')
    const state = useChatStore.getState()
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0].id).toBe(id)
    expect(state.threads[0].title).toBe('Test')
    expect(state.threads[0].messages).toHaveLength(1)
    expect(state.threads[0].messages[0].role).toBe('system')
    expect(state.activeThreadId).toBe(id)
  })

  it('adds messages to a thread', () => {
    const id = useChatStore.getState().addThread('Test')
    useChatStore.getState().addMessage(id, {
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    })
    const thread = useChatStore.getState().threads[0]
    expect(thread.messages).toHaveLength(2)
    expect(thread.messages[1].role).toBe('user')
    expect(thread.messages[1].content).toBe('Hello')
    expect(thread.messages[1].id).toBeDefined()
  })

  it('deletes a thread and clears active', () => {
    const id = useChatStore.getState().addThread('Test')
    expect(useChatStore.getState().activeThreadId).toBe(id)
    useChatStore.getState().deleteThread(id)
    expect(useChatStore.getState().threads).toHaveLength(0)
    expect(useChatStore.getState().activeThreadId).toBeNull()
  })

  it('getActiveThread returns the active thread', () => {
    useChatStore.getState().addThread('First')
    const id2 = useChatStore.getState().addThread('Second')
    const active = getActiveThread(useChatStore.getState())
    expect(active?.id).toBe(id2)
  })

  it('manages pending approval state', () => {
    useChatStore.getState().setPendingApproval(['step1', 'step2'])
    expect(useChatStore.getState().pendingApproval).toEqual(['step1', 'step2'])
    useChatStore.getState().clearApproval()
    expect(useChatStore.getState().pendingApproval).toEqual([])
  })

  it('manages busy and error state', () => {
    useChatStore.getState().setBusy(true)
    expect(useChatStore.getState().busy).toBe(true)
    useChatStore.getState().setError('Test error')
    expect(useChatStore.getState().error).toBe('Test error')
  })
})
