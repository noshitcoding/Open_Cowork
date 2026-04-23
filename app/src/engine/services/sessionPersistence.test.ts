import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSessionTitle, listSessions, loadSession } from './sessionPersistence'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

describe('sessionPersistence', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('generates a readable session title from the first user message', () => {
    const title = generateSessionTitle([
      {
        type: 'user',
        content: [{ type: 'text', text: 'Analysiere bitte die letzten Build-Fehler und priorisiere die Fixes fuer mich.' }],
      } as never,
    ])

    expect(title).toContain('Analysiere bitte die letzten Build-Fehler')
    expect(title.endsWith('...')).toBe(true)
  })

  it('maps db thread summaries into session summaries', async () => {
    invokeMock.mockResolvedValue([
      {
        id: 'thread-1',
        title: 'Build Review',
        cwd: 'C:/workspace',
        message_count: 7,
        created_at: 1000,
        updated_at: 2000,
      },
    ])

    await expect(listSessions()).resolves.toEqual([
      {
        id: 'thread-1',
        title: 'Build Review',
        cwd: 'C:/workspace',
        messageCount: 7,
        createdAt: 1000,
        updatedAt: 2000,
      },
    ])
  })

  it('loads legacy role/content rows as valid session messages', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'db_list_threads') {
        return Promise.resolve([
          {
            id: 'legacy-1',
            title: 'Alte Session',
            created_at: 1000,
            updated_at: 2000,
          },
        ])
      }

      if (command === 'db_list_messages') {
        return Promise.resolve([
          {
            id: 'm-1',
            role: 'user',
            content: '{"role":"user","content":"Hallo aus alt","timestamp":1001}',
            timestamp: 1001,
          },
          {
            id: 'm-2',
            role: 'assistant',
            content: '{"role":"assistant","content":"Antwort alt","timestamp":1002}',
            timestamp: 1002,
          },
        ])
      }

      return Promise.resolve([])
    })

    await expect(loadSession('legacy-1')).resolves.toMatchObject({
      id: 'legacy-1',
      title: 'Alte Session',
      messages: [
        {
          type: 'user',
          content: [{ type: 'text', text: 'Hallo aus alt' }],
        },
        {
          type: 'assistant',
          content: [{ type: 'text', text: 'Antwort alt' }],
        },
      ],
    })
  })
})
