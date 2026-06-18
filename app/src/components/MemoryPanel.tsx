import { useEffect, useState } from 'react'
import { Camera, Plus, Trash2 } from 'lucide-react'
import { useMemoryStore, type MemoryEntry } from '../stores/memoryStore'
import i18n, { tr } from '../i18n'

type MemoryTab = 'entries' | 'profile' | 'providers' | 'hints'

function randomId() {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getTabLabel(tab: MemoryTab): string {
  switch (tab) {
    case 'entries': return tr('Entries')
    case 'profile': return tr('Profile')
    case 'providers': return tr('Provider')
    case 'hints': return tr('Hints')
  }
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(i18n.resolvedLanguage ?? i18n.language ?? 'en')
}

export default function MemoryPanel() {
  const {
    entries, searchResults, profileEntries, providers, hints, lastSnapshot,
    loading, error,
    loadEntries, searchEntries, upsertEntry, deleteEntry,
    compactEntries, createSnapshot, loadHints,
    loadProfile, upsertProfile, deleteProfile,
    loadProviders, upsertProvider, deleteProvider,
  } = useMemoryStore()

  const [tab, setTab] = useState<MemoryTab>('entries')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterScope, setFilterScope] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newEntry, setNewEntry] = useState({ scope: 'agent', category: 'general', key: '', content: '' })
  const [compactScope, setCompactScope] = useState('agent')
  const [compactMinConf, setCompactMinConf] = useState(0.3)
  const [compactResult, setCompactResult] = useState<string | null>(null)
  const [profileKey, setProfileKey] = useState('')
  const [profileValue, setProfileValue] = useState('')
  const [providerForm, setProviderForm] = useState({ name: '', type: 'mem0', config: '{}' })

  useEffect(() => {
    void loadEntries(filterScope || undefined, undefined, 200)
  }, [filterScope, loadEntries])

  useEffect(() => {
    if (tab === 'profile') void loadProfile()
    if (tab === 'providers') void loadProviders()
    if (tab === 'hints') void loadHints()
  }, [tab, loadProfile, loadProviders, loadHints])

  const handleSearch = () => {
    if (searchQuery.trim()) void searchEntries(searchQuery.trim())
  }

  const handleAdd = async () => {
    if (!newEntry.key.trim() || !newEntry.content.trim()) return
    await upsertEntry({ id: randomId(), ...newEntry })
    setShowAdd(false)
    setNewEntry({ scope: 'agent', category: 'general', key: '', content: '' })
    void loadEntries(filterScope || undefined)
  }

  const handleCompact = async () => {
    const result = await compactEntries(compactScope, compactMinConf)
    setCompactResult(`${result.removed} ${tr('removed')}, ${result.remaining} ${tr('remaining')}`)
    void loadEntries(filterScope || undefined)
  }

  const handleSnapshot = async () => {
    await createSnapshot()
  }

  const handleAddProfile = async () => {
    if (!profileKey.trim() || !profileValue.trim()) return
    await upsertProfile(profileKey.trim(), profileValue.trim())
    setProfileKey('')
    setProfileValue('')
    void loadProfile()
  }

  const handleAddProvider = async () => {
    if (!providerForm.name.trim()) return
    const id = `prov-${Date.now()}`
    await upsertProvider({ id, name: providerForm.name, provider_type: providerForm.type, config_json: providerForm.config })
    setProviderForm({ name: '', type: 'mem0', config: '{}' })
    void loadProviders()
  }

  const handleDeleteProfile = async (key: string) => {
    await deleteProfile(key)
    void loadProfile()
  }

  const handleDeleteProvider = async (id: string) => {
    await deleteProvider(id)
    void loadProviders()
  }

  const displayEntries = searchQuery.trim() ? searchResults : entries

  return (
    <div className="panel memory-panel">
      <h2>{tr("Agent memory")}</h2>

      <div className="memory-tab-row" role="tablist" aria-label={tr("Agent memory")}>
        {(['entries', 'profile', 'providers', 'hints'] as const).map((entry) => (
          <button
            type="button"
            key={entry}
            role="tab"
            aria-selected={tab === entry}
            className={`btn-sm${tab === entry ? ' active' : ''}`}
            onClick={() => setTab(entry)}
          >
            {getTabLabel(entry)}
          </button>
        ))}
      </div>

      {error && <p className="memory-error">{error}</p>}

      {tab === 'entries' && (
        <>
          <div className="memory-toolbar">
            <input
              type="text"
              className="memory-input memory-search-input"
              aria-label={tr("Search memory...")}
              placeholder={tr("Search memory...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            />
            <select className="memory-select" value={filterScope} onChange={(e) => setFilterScope(e.target.value)} aria-label={tr("Scope")}>
              <option value="">{tr("All Scopes")}</option>
              <option value="agent">{tr("Agent")}</option>
              <option value="user">{tr("User")}</option>
              <option value="session">{tr("Session")}</option>
              <option value="shared">{tr("Shared")}</option>
            </select>
            <button type="button" className="btn-sm" onClick={() => setShowAdd(!showAdd)}>{tr("New")}</button>
          </div>

          {showAdd && (
            <div className="card memory-form-card">
              <div className="grid memory-form-grid">
                <label>{tr("Scope")}<select value={newEntry.scope} onChange={(e) => setNewEntry({ ...newEntry, scope: e.target.value })}>
                  <option value="agent">{tr("Agent")}</option>
                  <option value="user">{tr("User")}</option>
                  <option value="session">{tr("Session")}</option>
                  <option value="shared">{tr("Shared")}</option>
                </select>
                </label>
                <label>{tr("Category")}<input type="text" value={newEntry.category} onChange={(e) => setNewEntry({ ...newEntry, category: e.target.value })} />
                </label>
              </div>
              <label className="memory-label">{tr("Key")}<input type="text" value={newEntry.key} onChange={(e) => setNewEntry({ ...newEntry, key: e.target.value })} />
              </label>
              <label className="memory-label">{tr("Content")}<textarea value={newEntry.content} onChange={(e) => setNewEntry({ ...newEntry, content: e.target.value })} rows={3} />
              </label>
              <button type="button" className="btn-sm" onClick={handleAdd}>{tr("Save")}</button>
            </div>
          )}

          <div className="memory-compact-row">
            <select className="memory-select memory-compact-select" value={compactScope} onChange={(e) => setCompactScope(e.target.value)} aria-label={tr("Scope")}>
              <option value="agent">{tr("Agent")}</option>
              <option value="user">{tr("User")}</option>
              <option value="session">{tr("Session")}</option>
            </select>
            <input
              type="number"
              className="memory-confidence-input"
              aria-label={tr("Confidence")}
              value={compactMinConf}
              onChange={(e) => setCompactMinConf(Number(e.target.value))}
              min={0}
              max={1}
              step={0.1}
            />
            <button type="button" className="btn-sm" onClick={handleCompact}>{tr("Compact")}</button>
            <button type="button" className="btn-sm" onClick={handleSnapshot}>
              <Camera size={14} aria-hidden="true" /> {tr("Snapshot")}
            </button>
            {compactResult && <span className="memory-success">{compactResult}</span>}
          </div>

          {loading ? (
            <p className="panel-empty">{tr("Loading...")}</p>
          ) : displayEntries.length === 0 ? (
            <p className="panel-empty">{tr("No entries found")}</p>
          ) : (
            <div className="memory-list">
              {displayEntries.map((entry: MemoryEntry) => (
                <div key={entry.id} className="card memory-entry-card">
                  <div className="memory-entry-main">
                    <div className="memory-entry-meta">
                      {entry.scope} / {entry.category} / {tr("Confidence")}: {entry.confidence.toFixed(2)} / {tr("Accesses")}: {entry.access_count}
                    </div>
                    <div className="memory-entry-key">{entry.key}</div>
                    <div className="memory-entry-content">
                      {truncateText(entry.content, 200)}
                    </div>
                  </div>
                  <button type="button" className="memory-danger-button" onClick={() => void deleteEntry(entry.id)} title={tr("Delete memory entry")} aria-label={tr("Delete memory entry")}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {lastSnapshot && (
            <div className="card memory-snapshot-card">
              <div><strong>{tr("Last snapshot:")}</strong> {lastSnapshot.total_entries}{tr("entries,")}{lastSnapshot.total_profile_keys}{tr("profile keys")}</div>
              <span className="memory-muted">{tr("Created:")}{formatDateTime(lastSnapshot.timestamp)}</span>
            </div>
          )}
        </>
      )}

      {tab === 'profile' && (
        <>
          <div className="memory-inline-form">
            <input className="memory-input" type="text" placeholder={tr("Key")} aria-label={tr("Key")} value={profileKey} onChange={(e) => setProfileKey(e.target.value)} />
            <input className="memory-input memory-grow-input" type="text" placeholder={tr("Wert")} aria-label={tr("Wert")} value={profileValue} onChange={(e) => setProfileValue(e.target.value)} />
            <button type="button" className="btn-sm" onClick={handleAddProfile} aria-label={tr("Add")}>
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
          {profileEntries.length === 0 ? (
            <p className="panel-empty">{tr("No profile created")}</p>
          ) : (
            <div className="memory-list">
              {profileEntries.map((profile) => (
                <div key={profile.id} className="card memory-profile-card">
                  <div className="memory-profile-main">
                    <strong className="memory-profile-key">{profile.key}:</strong>
                    <span className="memory-profile-value">{profile.value}</span>
                    <span className="memory-muted">({profile.source}, {profile.confidence.toFixed(1)})</span>
                  </div>
                  <button type="button" className="memory-danger-button" onClick={() => void handleDeleteProfile(profile.key)} title={tr("Delete profile entry")} aria-label={tr("Delete profile entry")}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'providers' && (
        <>
          <div className="card memory-form-card">
            <div className="grid memory-provider-grid">
              <label>{tr("Name")}<input type="text" value={providerForm.name} onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })} />
              </label>
              <label>{tr("Type")}<select value={providerForm.type} onChange={(e) => setProviderForm({ ...providerForm, type: e.target.value })}>
                <option value="mem0">{tr("Mem0")}</option>
                <option value="honcho">{tr("Honcho")}</option>
                <option value="supermemory">{tr("Supermemory")}</option>
                <option value="custom">{tr("Custom")}</option>
              </select>
              </label>
              <label>{tr("Config (JSON)")}<input type="text" value={providerForm.config} onChange={(e) => setProviderForm({ ...providerForm, config: e.target.value })} />
              </label>
            </div>
            <button type="button" className="btn-sm memory-spaced-button" onClick={handleAddProvider}>{tr("Provider add")}</button>
          </div>
          {providers.length === 0 ? (
            <p className="panel-empty">{tr("No Provider configured")}</p>
          ) : (
            <div className="memory-list">
              {providers.map((provider) => (
                <div key={provider.id} className="card memory-provider-card">
                  <div className="memory-provider-main">
                    <strong>{provider.name}</strong>
                    <span className="memory-muted">({provider.provider_type})</span>
                    {!provider.enabled && <span className="memory-provider-disabled">{tr("disabled")}</span>}
                  </div>
                  <button type="button" className="memory-danger-button" onClick={() => void handleDeleteProvider(provider.id)} title={tr("Delete provider")} aria-label={tr("Delete provider")}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'hints' && (
        <>
          {hints.length === 0 ? (
            <p className="panel-empty">{tr("No notes available")}</p>
          ) : (
            <div className="memory-list">
              {hints.map((hint, index) => (
                <div key={`${hint.scope}-${hint.key}-${index}`} className="card memory-hint-card">
                  <div className="memory-entry-meta">
                    {hint.scope} / {tr("Relevance")}: {hint.relevance}
                  </div>
                  <div className="memory-entry-key">{hint.key}</div>
                  <div className="memory-entry-content">{hint.content}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
