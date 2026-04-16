import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setupWindowStatePersistence } from './utils/windowState'
import { registerGlobalCrashLogging } from './utils/crashLogging'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './i18n'

const queryClient = new QueryClient()

registerGlobalCrashLogging()
void setupWindowStatePersistence()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
