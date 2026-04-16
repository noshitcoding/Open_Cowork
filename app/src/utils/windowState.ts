import {
  LogicalPosition,
  LogicalSize,
  getCurrentWindow,
} from '@tauri-apps/api/window'

type StoredWindowState = {
  width: number
  height: number
  x: number
  y: number
  maximized: boolean
}

const STORAGE_KEY = 'open-cowork-window-state-v1'

function canUseDesktopApis(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function saveToStorage(state: StoredWindowState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function loadFromStorage(): StoredWindowState | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as StoredWindowState
    if (
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number' ||
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.maximized !== 'boolean'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function captureAndStoreWindowState(): Promise<void> {
  const currentWindow = getCurrentWindow()
  const size = await currentWindow.outerSize()
  const position = await currentWindow.outerPosition()
  const maximized = await currentWindow.isMaximized()

  saveToStorage({
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    maximized,
  })
}

export async function setupWindowStatePersistence(): Promise<void> {
  if (!canUseDesktopApis()) return

  const currentWindow = getCurrentWindow()
  const storedState = loadFromStorage()

  if (storedState) {
    await currentWindow.setSize(
      new LogicalSize(storedState.width, storedState.height)
    )
    await currentWindow.setPosition(
      new LogicalPosition(storedState.x, storedState.y)
    )
    if (storedState.maximized) {
      await currentWindow.maximize()
    }
  }

  await captureAndStoreWindowState()

  await currentWindow.onMoved(async () => {
    await captureAndStoreWindowState()
  })

  await currentWindow.onResized(async () => {
    await captureAndStoreWindowState()
  })
}
