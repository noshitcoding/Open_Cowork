import { describe, expect, it } from 'vitest'
import { resolveAssistantPresentation } from './messageDisplay'

describe('resolveAssistantPresentation', () => {
  it('falls back to provided thinking content when visible text is empty', () => {
    const result = resolveAssistantPresentation('', {
      verboseMode: false,
      thinkingContent: 'Zwischenschritt der Analyse',
    })

    expect(result.content).toBe('Zwischenschritt der Analyse')
    expect(result.thinkingContent).toBe('Zwischenschritt der Analyse')
  })

  it('falls back to explicit fallback text when there is no content', () => {
    const result = resolveAssistantPresentation('', {
      verboseMode: false,
      fallbackText: 'Keine sichtbare Antwort geliefert.',
    })

    expect(result.content).toBe('Keine sichtbare Antwort geliefert.')
  })

  it('prefers visible assistant text over fallback content', () => {
    const result = resolveAssistantPresentation('Fertige Antwort', {
      verboseMode: false,
      fallbackText: 'Fallback',
      thinkingContent: 'Thinking',
    })

    expect(result.content).toBe('Fertige Antwort')
  })
})