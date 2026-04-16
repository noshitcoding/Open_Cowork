import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the cowork chat headline', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Lokaler Chat mit Plan-Freigabe und MCP-Server-Anbindung'
    )
  })

  it('shows default ollama endpoint', () => {
    render(<App />)

    expect(screen.getByDisplayValue('http://192.168.178.82:11434')).toBeInTheDocument()
  })
})
