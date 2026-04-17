import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the welcome headline', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Was sollen wir heute erledigen?' })).toBeInTheDocument()
  })

  it('shows top navigation links', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: 'Cowork' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})
