import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    warmup: {
      clientFiles: [
        './src/App.tsx',
        './src/components/Layout.tsx',
        './src/components/CoworkView.tsx',
        './src/components/LeftSidebar.tsx',
      ],
    },
  },
  optimizeDeps: {
    include: [
      '@tanstack/react-query',
      '@tauri-apps/api',
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/window',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-notification',
      '@tauri-apps/plugin-opener',
      'class-variance-authority',
      'clsx',
      'i18next',
      'lucide-react',
      'react',
      'react-dom',
      'react-dom/client',
      'react-i18next',
      'react-router-dom',
      'tailwind-merge',
      'zod',
      'zustand',
      'zustand/middleware',
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      checks: {
        pluginTimings: false,
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            if (id.includes('/src/components/CoworkView')) return 'cowork-view'
            if (id.includes('/src/components/SettingsView')) return 'settings-view'
            if (id.includes('/src/components/FeaturesView')) return 'features-view'
            if (id.includes('/src/engine/')) return 'engine-core'
            if (id.includes('/src/stores/commandRegistryStore') || id.includes('/src/stores/coworkStore')) {
              return 'cowork-support'
            }
            return undefined
          }

          if (id.includes('react-router-dom')) return 'router'
          if (id.includes('@tanstack/react-query')) return 'query'
          if (id.includes('@tauri-apps')) return 'tauri'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
})
