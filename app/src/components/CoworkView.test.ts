import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProjectInstructionsPromptContext,
  buildProjectLinkPromptContext,
} from './CoworkView'
import type { ProjectResource } from '../stores/projectStore'

const safeInvokeMock = vi.hoisted(() => vi.fn())

vi.mock('../utils/safeInvoke', () => ({
  hasTauriRuntime: vi.fn(() => false),
  safeInvoke: safeInvokeMock,
  safeInvokeVoid: vi.fn(),
}))

describe('CoworkView project context helpers', () => {
  beforeEach(() => {
    safeInvokeMock.mockReset()
  })

  it('builds supplemental project instructions without global override text', () => {
    expect(buildProjectInstructionsPromptContext({
      title: 'Alpha',
      instructions: 'Nutze die Projektquellen zuerst.  ',
    })).toBe('Projektanweisungen fuer "Alpha":\nNutze die Projektquellen zuerst.')

    expect(buildProjectInstructionsPromptContext({
      title: 'Alpha',
      instructions: '   ',
    })).toBe('')
  })

  it('fetches project links manually and reports non-blocking failures', async () => {
    safeInvokeMock.mockImplementation(async (_cmd: string, args: { request: { url: string } }) => {
      if (args.request.url.includes('broken')) {
        throw new Error('Netzwerkfehler')
      }
      return {
        url: args.request.url,
        status: 200,
        ok: true,
        title: 'Spezifikation',
        content: 'Linkinhalt',
        truncated: false,
      }
    })

    const links: ProjectResource[] = [
      {
        id: 'link-1',
        kind: 'link',
        path: 'https://example.com/spec',
        label: 'Spec',
        enabled: true,
        addedAt: 100,
      },
      {
        id: 'link-2',
        kind: 'link',
        path: 'https://example.com/broken',
        label: 'Broken',
        enabled: true,
        addedAt: 100,
      },
    ]

    const result = await buildProjectLinkPromptContext(links)

    expect(result.context).toContain('Manuell abgerufene Projektlinks:')
    expect(result.context).toContain('Quelle: Spec')
    expect(result.context).toContain('Linkinhalt')
    expect(result.notice).toContain('Nicht alle Projektlinks konnten abgerufen werden')
    expect(result.notice).toContain('Broken: Netzwerkfehler')
  })
})
