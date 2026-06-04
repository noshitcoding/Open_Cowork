import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach } from 'vitest'
import App from './App'
import { useChatStore } from './stores/chatStore'

describe('App', () => {
  beforeEach(() => {
    useChatStore.setState({
      threads: [],
      activeThreadId: null,
      pendingApproval: [],
      busy: false,
      error: null,
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
    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('loads the tasks page without crashing', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Tasks' }))
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '➕ New Task' })).toBeInTheDocument()
  })
})
