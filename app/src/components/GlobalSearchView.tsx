import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { SessionSummary } from '../engine'
import { useChatStore } from '../stores/chatStore'
import { useEngineStore } from '../stores/engineStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { useWorkTasksStore } from '../stores/workTasksStore'
import { buildSearchIndex, filterSearchIndex, type SearchIndexEntry, type SearchIndexEntryType } from '../utils/globalSearch'
import { tr } from '../i18n'

const TYPE_LABELS: Record<SearchIndexEntryType, string> = {
  thread: 'chat',
  message: 'Message',
  task: 'Task',
  project: 'Project',
  'project-resource': 'Resource',
  session: 'Session',
  setting: 'Setting',
  feature: 'Feature',
}

function highlightSnippet(entry: SearchIndexEntry): string {
  const text = entry.body.trim() || entry.subtitle.trim() || ''
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ')
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized
}

export default function GlobalSearchView() {
  const navigate = useNavigate()
  const threads = useChatStore((s) => s.threads)
  const setActiveThread = useChatStore((s) => s.setActiveThread)
  const tasks = useWorkTasksStore((s) => s.tasks)
  const projects = useProjectStore((s) => s.projects)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setActiveMode = useUiStore((s) => s.setActiveMode)
  const getSessions = useEngineStore((s) => s.getSessions)
  const loadSessionById = useEngineStore((s) => s.loadSessionById)
  const [query, setQuery] = useState('')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  useEffect(() => {
    let Cancelled = false
    void (async () => {
      try {
        const loadedSessions = await getSessions()
        if (!Cancelled) setSessions(loadedSessions)
        if (!Cancelled) setSessionsError(null)
      } catch {
        if (!Cancelled) {
          setSessions([])
          setSessionsError(tr('Sessions could not be loaded.'))
        }
      } finally {
        if (!Cancelled) setSessionsLoading(false)
      }
    })()
    return () => {
      Cancelled = true
    }
  }, [getSessions])

  const searchIndex = useMemo(
    () => buildSearchIndex({ threads, tasks, projects, sessions }),
    [projects, sessions, tasks, threads],
  )

  const results = useMemo(
    () => filterSearchIndex(searchIndex, query, 60),
    [query, searchIndex],
  )

  const groupedResults = useMemo(() => {
    const groups = new Map<SearchIndexEntryType, SearchIndexEntry[]>()
    for (const result of results) {
      if (!groups.has(result.type)) groups.set(result.type, [])
      groups.get(result.type)!.push(result)
    }
    return Array.from(groups.entries())
  }, [results])

  const openResult = async (result: SearchIndexEntry) => {
    switch (result.action) {
      case 'open-thread':
        if (result.targetId) {
          setActiveThread(result.targetId)
        }
        setActiveMode('work')
        navigate('/')
        break
      case 'open-project':
        if (result.targetId) {
          setActiveProject(result.targetId)
        }
        navigate('/projects')
        break
      case 'open-task': {
        const task = tasks.find((item) => item.id === result.targetId)
        if (!task) {
          navigate('/tasks')
          break
        }
        if (task.threadId) {
          setActiveThread(task.threadId)
          setActiveMode('work')
          navigate('/')
        } else {
          navigate('/tasks')
        }
        break
      }
      case 'open-session':
        if (result.targetId) {
          const session = await loadSessionById(result.targetId)
          if (session?.threadId) {
            setActiveThread(session.threadId)
          }
        }
        setActiveMode('work')
        navigate('/')
        break
      case 'open-settings':
        setActiveMode('settings')
        navigate('/settings')
        break
      case 'open-features':
        navigate('/features')
        break
      default:
        if (result.href) navigate(result.href)
    }
  }

  const hasQuery = query.trim().length > 0

  return (
    <section className="global-search-view" aria-label={tr("Global Search")}>
      <div className="global-search-header">
        <div>
          <p className="section-eyebrow">{tr("Workspace")}</p>
          <h1>{tr("Global Search")}</h1>
        </div>
        <span className="global-search-count">{results.length}{tr("Treffer")}</span>
      </div>

      <label className="global-search-input">
        <Search size={18} strokeWidth={2} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr("Search threads, messages, tasks, projects, sessions, or settings...")}
        />
      </label>

      {sessionsError && <p className="global-search-error">{sessionsError}</p>}
      {sessionsLoading && <p className="hint-text">{tr("Sessions will be loaded...")}</p>}

      {!hasQuery && (
        <div className="global-search-empty">
          <h2>{tr("Find everything in one place")}</h2>
          <p>{tr("Search across chats, messages, tasks, project resources, sessions, settings, and features.")}</p>
        </div>
      )}

      {hasQuery && results.length === 0 && (
        <div className="global-search-empty">
          <h2>{tr("No results")}</h2>
          <p>{tr("Try another search term or check the spelling.")}</p>
        </div>
      )}

      {hasQuery && groupedResults.length > 0 && (
        <div className="global-search-results">
          {groupedResults.map(([type, entries]) => (
            <section key={type} className="global-search-group" aria-label={TYPE_LABELS[type]}>
              <div className="global-search-group-title">
                <span>{TYPE_LABELS[type]}</span>
                <span>{entries.length}</span>
              </div>
              <div className="global-search-list">
                {entries.map((entry) => (
                  <button key={entry.id} type="button" className="global-search-result" onClick={() => { void openResult(entry) }}>
                    <span className="global-search-result-main">
                      <span className="global-search-result-title">{entry.title}</span>
                      {entry.subtitle && <span className="global-search-result-subtitle">{entry.subtitle}</span>}
                      {highlightSnippet(entry) && <span className="global-search-result-snippet">{highlightSnippet(entry)}</span>}
                    </span>
                    <span className="global-search-result-type">{TYPE_LABELS[entry.type]}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}




