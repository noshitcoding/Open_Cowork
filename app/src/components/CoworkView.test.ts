import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProjectInstructionsPromptContext,
  buildProjectLinkPromptContext,
  formatAssistantFailureContent,
  getAssistantFailureSettingsPath,
  isAssistantFailureContent,
} from './CoworkView'
import type { ProjectResource } from '../stores/projectStore'
import i18n from '../i18n'

const safeInvokeMock = vi.hoisted(() => vi.fn())

vi.mock('../utils/safeInvoke', () => ({
  hasTauriRuntime: vi.fn(() => false),
  safeInvoke: safeInvokeMock,
  safeInvokeVoid: vi.fn(),
}))

describe('CoworkView project context helpers', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    safeInvokeMock.mockReset()
  })

  it('builds supplemental project instructions without global override text', () => {
    expect(buildProjectInstructionsPromptContext({
      title: 'Alpha',
      instructions: 'Use the project sources first.  ',
    })).toBe('Project instructions for "Alpha":\nUse the project sources first.')

    expect(buildProjectInstructionsPromptContext({
      title: 'Alpha',
      instructions: '   ',
    })).toBe('')
  })

  it('recognizes actionable assistant failures without flagging ordinary answers', () => {
    expect(isAssistantFailureContent('LLM request failed: timeout')).toBe(true)
    expect(isAssistantFailureContent('ConnectionError: provider unreachable')).toBe(true)
    expect(isAssistantFailureContent('Here is the completed launch checklist.')).toBe(false)
  })

  it('presents provider failures as localized, actionable chat copy', async () => {
    await i18n.changeLanguage('de')

    expect(formatAssistantFailureContent(
      'LLM request failed: OpenRouter API-Key fehlt.\n\nCheck the OpenRouter profile, endpoint, API key, and model in Settings.',
    )).toBe(
      'Anfrage fehlgeschlagen: Für OpenRouter fehlt der API-Schlüssel.\n\nÜberprüfe in den Einstellungen das OpenRouter-Profil, den Endpunkt, den API-Schlüssel und das Modell.',
    )
  })

  it('links provider failures to the matching settings profile', () => {
    expect(getAssistantFailureSettingsPath('LLM request failed: OpenRouter API-Key fehlt.')).toBe('/settings?provider=openrouter')
    expect(getAssistantFailureSettingsPath('Ollama request failed: timeout')).toBe('/settings?provider=ollama')
    expect(getAssistantFailureSettingsPath('Unknown provider failure')).toBe('/settings')
  })

  it('fetches project links manually and reports non-blocking failures', async () => {
    safeInvokeMock.mockImplementation(async (_cmd: string, args: { request: { url: string } }) => {
      if (args.request.url.includes('broken')) {
        throw new Error('Network error')
      }
      return {
        url: args.request.url,
        status: 200,
        ok: true,
        title: 'Specification',
        content: 'Link content',
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

    expect(result.context).toContain('Manually fetched project links:')
    expect(result.context).toContain('Source: Spec')
    expect(result.context).toContain('Link content')
    expect(result.notice).toContain('Not all project links could be fetched')
    expect(result.notice).toContain('Broken: Network error')
  })
})
