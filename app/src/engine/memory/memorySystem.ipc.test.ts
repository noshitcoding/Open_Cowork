import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

describe('memorySystem IPC contracts', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('stores memory entries via memory_upsert with mapped scope', async () => {
    const { storeMemoryEntry } = await import('./memorySystem')

    invokeMock.mockResolvedValue(undefined)

    await storeMemoryEntry({
      scope: 'project',
      category: 'notes',
      key: 'k1',
      content: 'value',
      confidence: 0.8,
    })

    expect(invokeMock).toHaveBeenCalledWith(
      'memory_upsert',
      expect.objectContaining({
        scope: 'agent',
        category: 'notes',
        key: 'k1',
        content: 'value',
        confidence: 0.8,
      }),
    )
  })

  it('reads memory entries via memory_search and maps backend shape', async () => {
    const { getMemoryEntries } = await import('./memorySystem')

    invokeMock.mockResolvedValue([
      {
        id: 'm1',
        scope: 'shared',
        category: 'prefs',
        key: 'lang',
        content: 'de',
        confidence: 1,
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T11:00:00.000Z',
      },
    ])

    const result = await getMemoryEntries('global', 'prefs')

    expect(invokeMock).toHaveBeenCalledWith(
      'memory_search',
      expect.objectContaining({
        scope: 'shared',
        category: 'prefs',
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].scope).toBe('global')
    expect(Number.isFinite(result[0].createdAt)).toBe(true)
    expect(Number.isFinite(result[0].updatedAt)).toBe(true)
  })
})
