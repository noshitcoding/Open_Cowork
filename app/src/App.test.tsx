import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the sidebar brand', () => {
    render(<App />)
    expect(screen.getByText('Open_Cowork')).toBeInTheDocument()
  })

  it('shows navigation links', () => {
    render(<App />)
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('MCP')).toBeInTheDocument()
    expect(screen.getByText('Einstellungen')).toBeInTheDocument()
  })
})
