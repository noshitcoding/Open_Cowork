import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the welcome headline', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Was sollen wir heute erledigen?' })).toBeInTheDocument()
  })

  it('shows top navigation links', async () => {
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Cowork' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})
