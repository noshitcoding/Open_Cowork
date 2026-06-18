import { Suspense, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Command, Menu, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  clampLeftSidebarWidth,
  useUiStore,
} from '../stores/uiStore'
import { useConfigStore } from '../stores/configStore'
import LeftSidebar from './LeftSidebar'
import CommandPalette from './CommandPalette'
import LanguageSwitcher from './LanguageSwitcher'
import { tr } from '../i18n'

function ViewLoadingState() {
  const { t } = useTranslation()

  return (
    <div className="view-loading-state" aria-busy="true" aria-live="polite">
      <div className="view-loading-bar" aria-hidden="true">
        <span />
      </div>
      <span>{t('common.preparingView')}</span>
    </div>
  )
}

export default function Layout() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  
  const {
    leftSidebarOpen,
    leftSidebarWidth,
    theme,
    toggleLeftSidebar,
    setLeftSidebarWidth,
    toggleTheme,
    setCommandPaletteOpen,
    commandPaletteOpen,
    shortcutsOverlayOpen,
    setShortcutsOverlayOpen,
  } = useUiStore()
  
  const focusMode = useConfigStore((s) => s.preferences.focusMode)
  const shortcutOverlayEnabled = useConfigStore((s) => s.preferences.shortcutOverlayEnabled)
  const leftSidebarFrameRef = useRef<HTMLDivElement | null>(null)
  const leftSidebarResizeRef = useRef<{ pointerId: number; left: number } | null>(null)
  const [leftSidebarResizing, setLeftSidebarResizing] = useState(false)
  const resolvedLeftSidebarWidth = clampLeftSidebarWidth(leftSidebarWidth)
  const leftSidebarFrameStyle = {
    '--left-sidebar-width': `${resolvedLeftSidebarWidth}px`,
  } as CSSProperties

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = event.ctrlKey || event.metaKey
      if (!modifierPressed) {
        if (event.key === 'Escape' && commandPaletteOpen) {
          setCommandPaletteOpen(false)
        }
        return
      }

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
      }

      if (event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggleLeftSidebar()
      }

      if (event.key === '1') {
        event.preventDefault()
        navigate('/')
      }

      if (event.key === '2') {
        event.preventDefault()
        navigate('/settings')
      }

      if (event.key === '3') {
        event.preventDefault()
        navigate('/crew')
      }

      if (event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        toggleTheme()
      }

      if (event.shiftKey && event.key === '?') {
        event.preventDefault()
        if (shortcutOverlayEnabled) {
          setShortcutsOverlayOpen(true)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandPaletteOpen, navigate, setCommandPaletteOpen, setShortcutsOverlayOpen, shortcutOverlayEnabled, toggleLeftSidebar, toggleTheme])

  useEffect(() => {
    if (!leftSidebarResizing) return undefined

    const handlePointerMove = (event: PointerEvent) => {
      const resize = leftSidebarResizeRef.current
      if (!resize || event.pointerId !== resize.pointerId) return

      event.preventDefault()
      setLeftSidebarWidth(event.clientX - resize.left)
    }

    const finishResize = (event: PointerEvent) => {
      const resize = leftSidebarResizeRef.current
      if (resize && event.pointerId !== resize.pointerId) return

      leftSidebarResizeRef.current = null
      setLeftSidebarResizing(false)
    }

    document.body.classList.add('sidebar-resize-active')
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    return () => {
      document.body.classList.remove('sidebar-resize-active')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }
  }, [leftSidebarResizing, setLeftSidebarWidth])

  const handleLeftSidebarResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const rect = leftSidebarFrameRef.current?.getBoundingClientRect()
    if (!rect) return

    event.preventDefault()
    event.stopPropagation()
    leftSidebarResizeRef.current = { pointerId: event.pointerId, left: rect.left }
    setLeftSidebarResizing(true)
    setLeftSidebarWidth(event.clientX - rect.left)
  }

  const handleLeftSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16
    let nextWidth: number | null = null

    if (event.key === 'ArrowLeft') nextWidth = resolvedLeftSidebarWidth - step
    if (event.key === 'ArrowRight') nextWidth = resolvedLeftSidebarWidth + step
    if (event.key === 'Home') nextWidth = LEFT_SIDEBAR_MIN_WIDTH
    if (event.key === 'End') nextWidth = LEFT_SIDEBAR_MAX_WIDTH

    if (nextWidth === null) return
    event.preventDefault()
    setLeftSidebarWidth(nextWidth)
  }

  const shortcuts = [
    { label: t('shortcuts.commandPalette'), keys: 'Ctrl+K' },
    { label: t('shortcuts.workspace'), keys: 'Ctrl+1' },
    { label: t('shortcuts.settings'), keys: 'Ctrl+2' },
    { label: t('shortcuts.crew'), keys: 'Ctrl+3' },
    { label: t('shortcuts.sidebar'), keys: 'Ctrl+Shift+B' },
    { label: t('shortcuts.theme'), keys: 'Ctrl+Shift+L' },
    { label: t('shortcuts.show'), keys: 'Ctrl+Shift+?' },
  ]

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div className="top-bar-brand">
          <button type="button" className="top-icon-button" onClick={toggleLeftSidebar} title={t('layout.sidebarShortcut')} aria-label={t('layout.toggleSidebar')}>
            <Menu size={17} strokeWidth={2} />
          </button>
          <span className="brand-name">{t('app.name')}</span>
        </div>

        <nav className="top-tabs" aria-label={t('layout.mainNavigation')}>
          <NavLink to="/" end className={({isActive}) => 'top-tab' + (isActive ? ' active' : '')}>
            {t('nav.cowork')}
          </NavLink>
          <NavLink to="/tasks" className={({isActive}) => 'top-tab' + (isActive ? ' active' : '')}>
            {t('nav.tasks')}
          </NavLink>
          <NavLink to="/crew" className={({isActive}) => 'top-tab' + (isActive ? ' active' : '')}>
            {t('nav.crew')}
          </NavLink>
          <NavLink to="/projects" className={({isActive}) => 'top-tab' + (isActive ? ' active' : '')}>
            {t('nav.projects')}
          </NavLink>
          <NavLink to="/features" className={({isActive}) => 'top-tab' + (isActive ? ' active' : '')}>
            {t('nav.features')}
          </NavLink>
          <NavLink to="/settings" className={({isActive}) => 'top-tab' + (isActive ? ' active' : '')}>
            {t('nav.settings')}
          </NavLink>
        </nav>

        <div className="top-bar-actions">
          <LanguageSwitcher />
          <button type="button" className="top-icon-button" onClick={toggleTheme} title={t('layout.themeShortcut')} aria-label={t('layout.toggleTheme')}>
            {theme === 'light' ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
          </button>
          <button type="button" className="top-command-button" onClick={() => setCommandPaletteOpen(true)} title={t('layout.commandPaletteShortcut')} aria-label={t('layout.openCommandPalette')}>
            <Command size={15} strokeWidth={2} />
            <kbd>{tr("Ctrl K")}</kbd>
          </button>
        </div>
      </div>

      <div className="app-body">
        {leftSidebarOpen && !focusMode && (
          <div
            ref={leftSidebarFrameRef}
            className={`left-sidebar-frame${leftSidebarResizing ? ' is-resizing' : ''}`}
            style={leftSidebarFrameStyle}
          >
            <LeftSidebar />
            <div
              className="left-sidebar-resize-handle"
              role="separator"
              aria-label={t('layout.resizeSidebar')}
              aria-orientation="vertical"
              aria-valuemin={LEFT_SIDEBAR_MIN_WIDTH}
              aria-valuemax={LEFT_SIDEBAR_MAX_WIDTH}
              aria-valuenow={resolvedLeftSidebarWidth}
              tabIndex={0}
              onPointerDown={handleLeftSidebarResizePointerDown}
              onKeyDown={handleLeftSidebarResizeKeyDown}
            />
          </div>
        )}

        <div className="main-content" key={i18n.resolvedLanguage ?? i18n.language}>
          <Suspense fallback={<ViewLoadingState />}>
            <Outlet />
          </Suspense>
        </div>
      </div>

      <CommandPalette />

      {shortcutsOverlayOpen && (
        <div className="command-palette-overlay">
          <button
            type="button"
            className="command-palette-backdrop"
            aria-label={tr("Close shortcuts")}
            onClick={() => setShortcutsOverlayOpen(false)}
          />
          <div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={t('shortcuts.title')}
          >
            <div className="command-palette-header">
              <strong className="shortcut-overlay-title">{t('shortcuts.title')}</strong>
              <button type="button" onClick={() => setShortcutsOverlayOpen(false)}>{tr("Esc")}</button>
            </div>
            <ul className="command-palette-list">
              {shortcuts.map((s, i) => (
                <li key={i}>
                  <button type="button" onClick={() => setShortcutsOverlayOpen(false)}>
                    <span>{s.label}</span>
                    <kbd>{s.keys}</kbd>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
