import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

export async function showDesktopNotification(title: string, body: string): Promise<boolean> {
  let permissionGranted = await isPermissionGranted()

  if (!permissionGranted) {
    const permission = await requestPermission()
    permissionGranted = permission === 'granted'
  }

  if (!permissionGranted) {
    return false
  }

  sendNotification({ title, body })
  return true
}
