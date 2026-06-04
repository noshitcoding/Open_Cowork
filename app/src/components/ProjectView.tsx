import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import {
  FilePlus,
  FolderOpen,
  FolderPlus,
  Link2,
  MessageSquarePlus,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import {
  getProjectForThread,
  useProjectStore,
  type Project,
} from '../stores/projectStore'
import {
  extractFileAttachmentsFromFileList,
  extractFileAttachmentsFromUriList,
  getPathName,
  normalizeDialogSelection,
} from '../utils/chatAttachments'
import { createChatProviderSelection, getChatProviderState } from '../utils/chatProvider'
import { useConfigStore } from '../stores/configStore'
import { useEngineStore } from '../stores/engineStore'
import { useUiStore } from '../stores/uiStore'
import { tr } from '../i18n'

const THREAD_DND_MIME = 'application/open-cowork-thread-id'

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function readDraggedThreadId(event: DragEvent): string {
  const typed = event.dataTransfer.getData(THREAD_DND_MIME).trim()
  if (typed) return typed

  const plain = event.dataTransfer.getData('text/plain').trim()
  return plain.startsWith('thread:') ? plain.slice('thread:'.length).trim() : plain
}

function getProjectTitleForThread(projects: Project[], threadId: string, currentProjectId: string): string | null {
  const project = getProjectForThread(projects, threadId)
  if (!project || project.id === currentProjectId) return null
  return project.title
}

export default function ProjectView() {
  const navigate = useNavigate()
  const threads = useChatStore((s) => s.threads)
  const setActiveThread = useChatStore((s) => s.setActiveThread)
  const addThread = useChatStore((s) => s.addThread)
  const deleteThread = useChatStore((s) => s.deleteThread)
  const setActiveMode = useUiStore((s) => s.setActiveMode)
  const ollama = useConfigStore((s) => s.ollama)
  const availableModels = useConfigStore((s) => s.availableModels)
  const llmProfiles = useConfigStore((s) => s.llmProfiles)
  const defaultLlmProfileIds = useConfigStore((s) => s.defaultLlmProfileIds)
  const llmProfileModels = useConfigStore((s) => s.llmProfileModels)
  const activeProvider = useEngineStore((s) => s.activeProvider)
  const {
    projects,
    activeProjectId,
    addProject,
    renameProject,
    updateProjectInstructions,
    deleteProject,
    setActiveProject,
    addResources,
    removeResource,
    setResourceEnabled,
    attachThread,
    detachThread,
  } = useProjectStore()
  const [titleDraft, setTitleDraft] = useState('')
  const [instructionsDraft, setInstructionsDraft] = useState('')
  const [linkDraft, setLinkDraft] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const [deletePromptOpen, setDeletePromptOpen] = useState(false)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null,
    [activeProjectId, projects],
  )
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  )
  const projectThreads = useMemo(() => {
    if (!activeProject) return []
    return activeProject.threadIds
      .map((threadId) => threadById.get(threadId))
      .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
  }, [activeProject, threadById])
  const outsideThreads = useMemo(() => {
    if (!activeProject) return threads
    const currentProjectThreadIds = new Set(activeProject.threadIds)
    return threads.filter((thread) => !currentProjectThreadIds.has(thread.id))
  }, [activeProject, threads])
  const providerState = useMemo(
    () => getChatProviderState({
      ollama,
      availableModels,
      llmProfiles,
      defaultLlmProfileIds,
      llmProfileModels,
    }, activeProvider),
    [activeProvider, availableModels, defaultLlmProfileIds, llmProfileModels, llmProfiles, ollama],
  )

  useEffect(() => {
    if (!activeProject && projects[0]) {
      setActiveProject(projects[0].id)
    }
  }, [activeProject, projects, setActiveProject])

  useEffect(() => {
    setTitleDraft(activeProject?.title ?? '')
    setInstructionsDraft(activeProject?.instructions ?? '')
    setLinkDraft('')
    setDeletePromptOpen(false)
  }, [activeProject?.id, activeProject?.instructions, activeProject?.title])

  const handleCreateProject = () => {
    const id = addProject(`Project ${projects.length + 1}`)
    setActiveProject(id)
  }

  const commitTitle = () => {
    if (!activeProject) return
    renameProject(activeProject.id, titleDraft)
  }

  const commitInstructions = () => {
    if (!activeProject || instructionsDraft === activeProject.instructions) return
    updateProjectInstructions(activeProject.id, instructionsDraft)
  }

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  const handleAddFiles = async () => {
    if (!activeProject) return
    const selected = await open({
      directory: false,
      multiple: true,
      filters: [
        { name: 'Project files', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'md', 'rtf', 'csv', 'json', 'yaml', 'yml'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    const paths = normalizeDialogSelection(selected)
    addResources(activeProject.id, paths.map((path) => ({ path, kind: 'file' })))
  }

  const handleAddFolders = async () => {
    if (!activeProject) return
    const selected = await open({
      directory: true,
      multiple: true,
    })
    const paths = normalizeDialogSelection(selected)
    addResources(activeProject.id, paths.map((path) => ({ path, kind: 'folder' })))
  }

  const handleAddLink = () => {
    if (!activeProject) return
    const url = linkDraft.trim()
    if (!/^https?:\/\/\S+$/i.test(url)) return
    addResources(activeProject.id, [{ path: url, kind: 'link', label: url }])
    setLinkDraft('')
  }

  const handleOpenThread = (threadId: string) => {
    setActiveMode('work')
    setActiveThread(threadId)
    navigate('/')
  }

  const handleNewProjectChat = () => {
    if (!activeProject) return
    const threadId = addThread(`Chat: ${activeProject.title}`, createChatProviderSelection(providerState))
    attachThread(activeProject.id, threadId)
    handleOpenThread(threadId)
  }

  const handleDeleteProject = (deleteThreads: boolean) => {
    if (!activeProject) return
    const deletedThreadIds = deleteProject(activeProject.id, { deleteThreads })
    if (deleteThreads) {
      deletedThreadIds.forEach((threadId) => deleteThread(threadId))
    }
    setDeletePromptOpen(false)
  }

  const handleThreadDragStart = (event: DragEvent, threadId: string) => {
    event.stopPropagation()
    event.dataTransfer.setData(THREAD_DND_MIME, threadId)
    event.dataTransfer.setData('text/plain', `thread:${threadId}`)
    event.dataTransfer.effectAllowed = 'move'
  }

  const attachDroppedThread = (event: DragEvent, targetProjectId: string): boolean => {
    const threadId = readDraggedThreadId(event)
    if (!threadId || !threadById.has(threadId)) return false
    attachThread(targetProjectId, threadId)
    setActiveProject(targetProjectId)
    return true
  }

  const handleProjectDrop = (event: DragEvent, targetProjectId: string) => {
    event.preventDefault()
    setDropActive(false)

    if (attachDroppedThread(event, targetProjectId)) {
      return
    }

    const fromFiles = extractFileAttachmentsFromFileList(event.dataTransfer.files)
    const rawUriList = event.dataTransfer.getData('text/uri-list') || ''
    const fromUriList = extractFileAttachmentsFromUriList(rawUriList)
    const droppedLinks = [
      ...rawUriList.split(/\r?\n/),
      event.dataTransfer.getData('text/plain') || '',
    ]
      .map((value) => value.trim())
      .filter((value) => /^https?:\/\/\S+$/i.test(value))
      .map((path) => ({ path, kind: 'link' as const, label: path }))
    const resources = [...fromFiles, ...fromUriList, ...droppedLinks]
    if (resources.length > 0) {
      addResources(targetProjectId, resources.map((resource) => ({
        path: resource.path,
        kind: resource.kind,
        label: resource.label,
      })))
    }
  }

  return (
    <div className="project-view">
      <aside className="project-list-panel">
        <div className="project-list-header">
          <h1>{tr("Projects")}</h1>
          <button type="button" className="btn-sm project-icon-button" onClick={handleCreateProject}>
            <Plus size={14} aria-hidden="true" />{tr("New")}</button>
        </div>

        <div className="project-list">
          {projects.map((project) => {
            const existingThreadCount = project.threadIds.filter((threadId) => threadById.has(threadId)).length
            const active = activeProject?.id === project.id
            return (
              <button
                key={project.id}
                type="button"
                className={`project-list-item${active ? ' active' : ''}`}
                onClick={() => setActiveProject(project.id)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => handleProjectDrop(event, project.id)}
              >
                <span className="project-list-item-title">{project.title}</span>
                <span className="project-list-item-meta">
                  {existingThreadCount}{tr("Chats /")}{project.resources.length}{tr("sources")}</span>
              </button>
            )
          })}
          {projects.length === 0 && (
            <p className="hint-text">{tr("No projects yet.")}</p>
          )}
        </div>
      </aside>

      <main className="project-detail">
        {!activeProject ? (
          <div className="project-empty-state">
            <FolderOpen size={38} aria-hidden="true" />
            <h2>{tr("No project selected")}</h2>
            <button type="button" className="btn-send" onClick={handleCreateProject}>{tr("Create project")}</button>
          </div>
        ) : (
          <>
            <header className="project-detail-header">
              <div className="project-title-editor">
                <label htmlFor="project-title">{tr("Project name")}</label>
                <input
                  id="project-title"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.currentTarget.value)}
                  onBlur={commitTitle}
                  onKeyDown={handleTitleKeyDown}
                />
              </div>
              <div className="project-instructions-editor">
                <label htmlFor="project-instructions">{tr("Project instructions")}</label>
                <textarea
                  id="project-instructions"
                  value={instructionsDraft}
                  rows={3}
                  onChange={(event) => setInstructionsDraft(event.currentTarget.value)}
                  onBlur={commitInstructions}
                  placeholder={tr("Additional instructions for chats in this project...")}
                />
              </div>
              <div className="project-detail-actions">
                <button type="button" className="btn-sm project-icon-button" onClick={handleNewProjectChat}>
                  <MessageSquarePlus size={14} aria-hidden="true" />{tr("Chat")}</button>
                <button type="button" className="btn-sm project-icon-button" onClick={handleAddFiles}>
                  <FilePlus size={14} aria-hidden="true" />{tr("Files")}</button>
                <button type="button" className="btn-sm project-icon-button" onClick={handleAddFolders}>
                  <FolderPlus size={14} aria-hidden="true" />{tr("Folder")}</button>
                <button
                  type="button"
                  className="btn-sm project-icon-button danger"
                  onClick={() => setDeletePromptOpen(true)}
                  title={tr("Delete project")}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </header>

            {deletePromptOpen && (
              <div className="project-delete-panel" role="dialog" aria-label={tr("Delete project")}>
                <div>
                  <strong>{tr("Delete project")}</strong>
                  <p>{tr("Choose whether assigned chats should be kept or deleted as well.")}</p>
                </div>
                <div className="project-delete-actions">
                  <button type="button" className="btn-sm" onClick={() => handleDeleteProject(false)}>{tr("Detach project only")}</button>
                  <button type="button" className="btn-sm project-icon-button danger" onClick={() => handleDeleteProject(true)}>{tr("Delete project and chats")}</button>
                  <button type="button" className="btn-sm" onClick={() => setDeletePromptOpen(false)}>{tr("Cancel")}</button>
                </div>
              </div>
            )}

            <section
              className={`project-drop-zone${dropActive ? ' active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDropActive(true)
                event.dataTransfer.dropEffect = 'move'
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(event) => handleProjectDrop(event, activeProject.id)}
            >
              <span>{tr("Drop chats or files here")}</span>
            </section>

            <div className="project-detail-grid">
              <section className="project-panel">
                <div className="project-panel-header">
                  <h2>{tr("Project sources")}</h2>
                  <span>{activeProject.resources.filter((resource) => resource.enabled).length}{tr("active")}</span>
                </div>
                <div className="project-link-add">
                  <Link2 size={15} aria-hidden="true" />
                  <input
                    value={linkDraft}
                    onChange={(event) => setLinkDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleAddLink()
                      }
                    }}
                    placeholder={tr("https://...")}
                  />
                  <button type="button" className="btn-sm" onClick={handleAddLink} disabled={!/^https?:\/\/\S+$/i.test(linkDraft.trim())}>{tr("Link")}</button>
                </div>
                <div className="project-resource-list">
                  {activeProject.resources.map((resource) => (
                    <div key={resource.id} className={`project-resource-item${resource.enabled ? '' : ' disabled'}`}>
                      <label className="project-resource-toggle">
                        <input
                          type="checkbox"
                          checked={resource.enabled}
                          onChange={(event) => setResourceEnabled(activeProject.id, resource.id, event.currentTarget.checked)}
                        />
                        <span className="project-resource-kind">
                          {resource.kind === 'folder' ? 'Folder' : resource.kind === 'link' ? 'Link' : 'File'}
                        </span>
                        <span className="project-resource-name" title={resource.path}>
                          {resource.label ?? getPathName(resource.path)}
                        </span>
                      </label>
                      <span className="project-resource-path" title={resource.path}>{resource.path}</span>
                      <button
                        type="button"
                        className="project-row-action"
                        onClick={() => removeResource(activeProject.id, resource.id)}
                        title={tr("Source entfernen")}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {activeProject.resources.length === 0 && (
                    <p className="hint-text">{tr("No sources linked.")}</p>
                  )}
                </div>
              </section>

              <section className="project-panel">
                <div className="project-panel-header">
                  <h2>{tr("Project chats")}</h2>
                  <span>{projectThreads.length}</span>
                </div>
                <div className="project-thread-list">
                  {projectThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className="project-thread-item"
                      draggable
                      onDragStart={(event) => handleThreadDragStart(event, thread.id)}
                    >
                      <button
                        type="button"
                        className="project-thread-main"
                        draggable
                        onDragStart={(event) => handleThreadDragStart(event, thread.id)}
                        onClick={() => handleOpenThread(thread.id)}
                      >
                        <span>{thread.title}</span>
                        <small>{thread.messages.filter((message) => message.role !== 'system').length}{tr("Messages /")}{formatDate(thread.updatedAt)}</small>
                      </button>
                      <button
                        type="button"
                        className="project-row-action"
                        onClick={() => detachThread(activeProject.id, thread.id)}
                        title={tr("Remove from project")}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {projectThreads.length === 0 && (
                    <p className="hint-text">{tr("No chats in the project yet.")}</p>
                  )}
                </div>
              </section>

              <section className="project-panel project-panel-wide">
                <div className="project-panel-header">
                  <h2>{tr("Chats outside this project")}</h2>
                  <span>{outsideThreads.length}</span>
                </div>
                <div className="project-thread-list compact">
                  {outsideThreads.map((thread) => {
                    const sourceProjectTitle = getProjectTitleForThread(projects, thread.id, activeProject.id)
                    return (
                      <div
                        key={thread.id}
                        className="project-thread-item"
                        draggable
                        onDragStart={(event) => handleThreadDragStart(event, thread.id)}
                      >
                        <button
                          type="button"
                          className="project-thread-main"
                          draggable
                          onDragStart={(event) => handleThreadDragStart(event, thread.id)}
                          onClick={() => handleOpenThread(thread.id)}
                        >
                          <span>{thread.title}</span>
                          <small>
                            {sourceProjectTitle ? `Aus ${sourceProjectTitle}` : tr('Not in this project')} / {formatDate(thread.updatedAt)}
                          </small>
                        </button>
                        <button
                          type="button"
                          className="btn-sm project-icon-button"
                          onClick={() => attachThread(activeProject.id, thread.id)}
                        >{tr("Add")}</button>
                      </div>
                    )
                  })}
                  {outsideThreads.length === 0 && (
                    <p className="hint-text">{tr("No more chats available.")}</p>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
