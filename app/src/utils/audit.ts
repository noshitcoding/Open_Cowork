import { invoke } from '@tauri-apps/api/core'

export async function writeAuditEvent(
  area: string,
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await invoke('audit_event', {
      area,
      action,
      details: details ?? null,
    })
  } catch {
    // Audit logging must never break product flows.
  }
}
