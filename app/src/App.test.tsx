import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the vertical slice headline', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Lokale Ollama-Anbindung mit Tauri Core'
    )
  })

  it('shows default ollama endpoint', () => {
    render(<App />)

    expect(screen.getByDisplayValue('http://192.168.178.82:11434')).toBeInTheDocument()
  })
})
