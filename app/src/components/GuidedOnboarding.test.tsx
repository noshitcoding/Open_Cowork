import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GuidedOnboarding, { GUIDED_ONBOARDING_STORAGE_KEY, STARTER_PROMPT } from './GuidedOnboarding'

const baseProps = {
  providerLabel: 'Ollama',
  model: 'llama3.1:8b',
  workingFolder: 'C:\\workspace',
  permissionLabel: 'Standard',
  onChooseFolder: vi.fn(),
  onOpenSettings: vi.fn(),
  onUseStarterTask: vi.fn(),
}

describe('GuidedOnboarding', () => {
  beforeEach(() => {
    window.localStorage.removeItem(GUIDED_ONBOARDING_STORAGE_KEY)
    Object.values(baseProps).forEach((value) => {
      if (typeof value === 'function') value.mockClear()
    })
  })

  it('guides the user to a real starter task and persists completion', () => {
    render(<GuidedOnboarding {...baseProps} />)

    expect(screen.getByRole('heading', { name: 'Set up Open_Cowork' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Choose how the work is powered')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use starter task' }))

    expect(baseProps.onUseStarterTask).toHaveBeenCalledWith(STARTER_PROMPT)
    expect(window.localStorage.getItem(GUIDED_ONBOARDING_STORAGE_KEY)).toBe('completed')
    expect(screen.getByRole('button', { name: 'Open getting started' })).toBeInTheDocument()
  })

  it('can be dismissed and reopened without losing discoverability', () => {
    render(<GuidedOnboarding {...baseProps} model="" workingFolder={null} />)

    expect(screen.getAllByText('Needs setup').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss onboarding' }))
    expect(window.localStorage.getItem(GUIDED_ONBOARDING_STORAGE_KEY)).toBe('dismissed')

    fireEvent.click(screen.getByRole('button', { name: 'Open getting started' }))
    expect(screen.getByRole('heading', { name: 'Set up Open_Cowork' })).toBeInTheDocument()
  })

  it('links model and folder steps to the existing application actions', () => {
    render(<GuidedOnboarding {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open model settings' }))
    expect(baseProps.onOpenSettings).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose another folder' }))
    expect(baseProps.onChooseFolder).toHaveBeenCalledTimes(1)
  })
})
