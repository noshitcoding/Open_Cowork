import type { CSSProperties } from 'react'
import { useCoworkStore } from '../stores/coworkStore'
import { tr } from '../i18n'

export default function ConnectorPanel() {
  const connectors = useCoworkStore((s) => s.connectors)
  const toggleConnector = useCoworkStore((s) => s.toggleConnector)
  const setConnectorNote = useCoworkStore((s) => s.setConnectorNote)
  const updateConnectorConfig = useCoworkStore((s) => s.updateConnectorConfig)
  const testConnector = useCoworkStore((s) => s.testConnector)

  const inputStyle: CSSProperties = {
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    fontSize: 13,
    width: '100%',
  }

  return (
    <div className="panel">
      <h2>{tr("Connectors")}</h2>
      <p className="hint-text">{tr("Webhook URL and API key are saved locally. The connection test runs through the Rust backend to avoid WebView CORS issues.")}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {connectors.map((connector) => {
          const statusColor = connector.lastTestStatus === 'success'
            ? 'var(--success)'
            : connector.lastTestStatus === 'error'
              ? 'var(--danger)'
              : 'var(--text-muted)'

          return (
            <div key={connector.key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <strong>{connector.label}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{tr("Key:")}{connector.key}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => toggleConnector(connector.key, !connector.enabled)}
                >
                  {connector.enabled ? tr('Disable') : tr('Enable')}
                </button>
              </div>

              <label>{tr("Webhook / API URL")}<input
                  value={connector.webhookUrl ?? ''}
                  onChange={(event) => updateConnectorConfig(connector.key, { webhookUrl: event.target.value })}
                  placeholder={tr("https://example.com/webhook")}
                  style={inputStyle}
                />
              </label>

              <label>{tr("API Key")}<input
                  value={connector.apiKey ?? ''}
                  onChange={(event) => updateConnectorConfig(connector.key, { apiKey: event.target.value })}
                  placeholder={tr("Optional bearer token")}
                  style={inputStyle}
                />
              </label>

              <label>{tr("Note")}<textarea
                  rows={2}
                  value={connector.note}
                  onChange={(event) => setConnectorNote(connector.key, event.target.value)}
                  placeholder={tr("Internal notes or setup comments")}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: statusColor }}>
                  {connector.lastTestMessage ?? tr('No connection test has run yet.')}
                  {connector.lastTestAt ? ` (${new Date(connector.lastTestAt).toLocaleString('en-US')})` : ''}
                </div>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => void testConnector(connector.key)}
                  disabled={connector.lastTestStatus === 'testing'}
                >
                  {connector.lastTestStatus === 'testing' ? tr('Testing...') : tr('Test connection')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
