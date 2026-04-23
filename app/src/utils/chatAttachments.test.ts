import { describe, expect, it } from 'vitest'
import { extractAttachmentsFromContent } from './chatAttachments'

describe('extractAttachmentsFromContent', () => {
  it('extracts files and folders from prompt content and strips the block', () => {
    const parsed = extractAttachmentsFromContent([
      'Bitte analysiere dieses Projekt.',
      '',
      'Verbundene Pfade (2):',
      '1. Datei: C:\\workspace\\notes.txt',
      '2. Ordner: C:\\workspace\\src',
    ].join('\n'))

    expect(parsed.content).toBe('Bitte analysiere dieses Projekt.')
    expect(parsed.attachments).toEqual([
      { path: 'C:\\workspace\\notes.txt', kind: 'file' },
      { path: 'C:\\workspace\\src', kind: 'folder' },
    ])
  })

  it('leaves normal content untouched when no attachment block exists', () => {
    const parsed = extractAttachmentsFromContent('Nur ein normaler Prompt.')

    expect(parsed.content).toBe('Nur ein normaler Prompt.')
    expect(parsed.attachments).toEqual([])
  })
})
