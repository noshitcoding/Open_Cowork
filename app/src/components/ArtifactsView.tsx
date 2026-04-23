import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'

type ArtifactVersionRow = {
  id: string
  runId: string | null
  label: string | null
  sourcePath: string
  format: string
  sizeBytes: number
  summary: string
  preview: string
  metadata: unknown
  createdAt: string
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return path
  const dir = normalized.slice(0, index)
  return path.includes('\\') ? dir.replace(/\//g, '\\') : dir
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

export default function ArtifactsView() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ArtifactVersionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const loadRows = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await invoke<ArtifactVersionRow[]>('fs_list_artifact_versions', { limit: 200 })
      setRows(Array.isArray(result) ? result : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadRows()
  }, [])

  const importArtifact = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [
        { name: 'Dokumente und Code', extensions: ['txt', 'md', 'pdf', 'docx', 'xlsx', 'pptx', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'py', 'rs'] },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    })
    if (typeof selected !== 'string') return

    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await invoke('fs_add_allowed_folder', { path: parentDir(selected) })
      await invoke('fs_save_artifact_version', {
        path: selected,
        runId: null,
        label: `manuell:${fileName(selected)}`,
      })
      setInfo('Artefakt wurde dauerhaft in der App-Datenbank gespeichert.')
      await loadRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h2>{t('Artifacts')}</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn-sm" onClick={() => void importArtifact()} disabled={busy}>
          + Datei importieren
        </button>
        <button type="button" className="btn-sm" onClick={() => void loadRows()} disabled={busy}>
          Aktualisieren
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
      {info && <p style={{ color: 'var(--success)', fontSize: 12 }}>{info}</p>}

      {busy && rows.length === 0 ? (
        <p className="panel-empty">Laden...</p>
      ) : rows.length === 0 ? (
        <p className="panel-empty">Noch keine gespeicherten Artefakte vorhanden.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => (
            <div key={row.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{fileName(row.sourcePath)}</strong>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(row.createdAt).toLocaleString('de-DE')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {row.format} · {formatBytes(row.sizeBytes)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {row.sourcePath}
              </div>
              <div style={{ fontSize: 12 }}>{row.summary}</div>
              <pre className="tool-result" style={{ margin: 0, maxHeight: 180, overflow: 'auto' }}>
                {row.preview}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}