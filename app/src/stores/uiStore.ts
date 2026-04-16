import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppMode = 'work' | 'settings'
export type WorkingPathKind = 'file' | 'folder'
export type ThemeMode = 'light' | 'dark'

type UiState = {
  activeMode: AppMode
  workingFolder: string | null
  workingPathKind: WorkingPathKind | null
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  theme: ThemeMode
  commandPaletteOpen: boolean
  shortcutsOverlayOpen: boolean
  setActiveMode: (mode: AppMode) => void
  setWorkingPath: (path: string | null, kind?: WorkingPathKind | null) => void
  setWorkingFolder: (folder: string | null) => void
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setCommandPaletteOpen: (open: boolean) => void
  setShortcutsOverlayOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeMode: 'work',
      workingFolder: null,
      workingPathKind: null,
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      theme: 'light',
      commandPaletteOpen: false,
      shortcutsOverlayOpen: false,
      setActiveMode: (mode) => set({ activeMode: mode }),
      setWorkingPath: (path, kind = null) =>
        set({ workingFolder: path, workingPathKind: path ? kind : null }),
      setWorkingFolder: (folder) =>
        set({ workingFolder: folder, workingPathKind: folder ? 'folder' : null }),
      toggleLeftSidebar: () =>
        set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
      toggleRightSidebar: () =>
        set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setShortcutsOverlayOpen: (open) => set({ shortcutsOverlayOpen: open }),
    }),
    {
      name: 'open-cowork-ui',
      partialize: (state) => ({
        activeMode: state.activeMode,
        leftSidebarOpen: state.leftSidebarOpen,
        theme: state.theme,
      }),
    }
  )
)
