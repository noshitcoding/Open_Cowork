import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach } from 'vitest'
import App from './App'
import { useChatStore } from './stores/chatStore'
import { useUiStore } from './stores/uiStore'

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')

    useChatStore.setState({
      threads: [],
      activeThreadId: null,
      pendingApproval: [],
      busy: false,
      error: null,
    })

    useUiStore.setState({
      leftSidebarOpen: true,
      leftSidebarWidth: 320,
      commandPaletteOpen: false,
      shortcutsOverlayOpen: false,
    })
  })

  it('starts directly in an empty chat', async () => {
    render(<App />)
    expect(await screen.findByPlaceholderText('Next instruction...', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New chat' })).toBeInTheDocument()
  })

  it('shows top navigation links', async () => {
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Cowork' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Tasks' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Features' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('loads direct feature URLs', async () => {
    window.history.pushState({}, '', '/features')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Features' })).toBeInTheDocument()
  })

  it('loads the tasks page without crashing', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Tasks' }))
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'New task' })).toBeInTheDocument()
  })

  it('resizes the left sidebar from the separator', async () => {
    render(<App />)

    const separator = await screen.findByRole('separator', { name: 'Resize sidebar' })
    fireEvent.pointerDown(separator, { pointerId: 7, button: 0, clientX: 320 })

    await waitFor(() => expect(document.body).toHaveClass('sidebar-resize-active'))

    fireEvent.pointerMove(window, { pointerId: 7, clientX: 430 })
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 430 })

    expect(useUiStore.getState().leftSidebarWidth).toBe(430)
  })
})
