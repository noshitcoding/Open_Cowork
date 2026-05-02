use crate::db::{Database, TerminalBackendRow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn suppress_command_window(command: &mut std::process::Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn suppress_command_window(_command: &mut std::process::Command) {}

// ── Backend config types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBackendConfig {
    pub shell: Option<String>,
    pub working_dir: Option<String>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerBackendConfig {
    pub image: String,
    pub container_name: Option<String>,
    pub mounts: Option<Vec<String>>,
    pub ports: Option<Vec<String>>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshBackendConfig {
    pub host: String,
    pub port: Option<u16>,
    pub user: String,
    pub key_path: Option<String>,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HpcBackendConfig {
    pub runtime: String, // singularity | apptainer
    pub image_path: String,
    pub bind_mounts: Option<Vec<String>>,
    pub gpu_flag: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerlessBackendConfig {
    pub provider: String, // modal | lambda | cloud-run
    pub function_name: String,
    pub region: Option<String>,
    pub env_vars: Option<HashMap<String, String>>,
}

// ── Request / Response types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct BackendUpsertRequest {
    pub id: String,
    pub name: String,
    pub backend_type: String,
    pub config_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct BackendExecRequest {
    pub backend_id: String,
    pub command: String,
    pub working_dir: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendExecResponse {
    pub backend_id: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

// ── Backend validation ──────────────────────────────────────────────────────

pub fn validate_backend_type(backend_type: &str) -> Result<(), String> {
    match backend_type {
        "local" | "container" | "ssh" | "hpc" | "serverless" => Ok(()),
        other => Err(format!(
            "Unbekannter Backend-Typ '{}'. Erlaubt: local, container, ssh, hpc, serverless",
            other
        )),
    }
}

pub fn validate_backend_config(backend_type: &str, config_json: &str) -> Result<(), String> {
    match backend_type {
        "local" => {
            serde_json::from_str::<LocalBackendConfig>(config_json)
                .map_err(|e| format!("Ungültige Local-Konfiguration: {}", e))?;
        }
        "container" => {
            let cfg: ContainerBackendConfig = serde_json::from_str(config_json)
                .map_err(|e| format!("Ungültige Container-Konfiguration: {}", e))?;
            if cfg.image.is_empty() {
                return Err("Container-Image darf nicht leer sein".to_string());
            }
        }
        "ssh" => {
            let cfg: SshBackendConfig = serde_json::from_str(config_json)
                .map_err(|e| format!("Ungültige SSH-Konfiguration: {}", e))?;
            if cfg.host.is_empty() || cfg.user.is_empty() {
                return Err("SSH host und user sind erforderlich".to_string());
            }
        }
        "hpc" => {
            let cfg: HpcBackendConfig = serde_json::from_str(config_json)
                .map_err(|e| format!("Ungültige HPC-Konfiguration: {}", e))?;
            if cfg.image_path.is_empty() {
                return Err("HPC image_path darf nicht leer sein".to_string());
            }
        }
        "serverless" => {
            let cfg: ServerlessBackendConfig = serde_json::from_str(config_json)
                .map_err(|e| format!("Ungültige Serverless-Konfiguration: {}", e))?;
            if cfg.function_name.is_empty() {
                return Err("Serverless function_name darf nicht leer sein".to_string());
            }
        }
        _ => return Err(format!("Unbekannter Backend-Typ: {}", backend_type)),
    }
    Ok(())
}

/// Execute a command on the local backend
pub fn execute_local(
    config_json: &str,
    command: &str,
    working_dir_override: Option<&str>,
    timeout_ms: Option<u64>,
) -> BackendExecResponse {
    let config: LocalBackendConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => {
            return BackendExecResponse {
                backend_id: String::new(),
                stdout: String::new(),
                stderr: format!("Config-Fehler: {}", e),
                exit_code: None,
                timed_out: false,
            };
        }
    };

    let shell = config.shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "powershell".to_string()
        } else {
            "sh".to_string()
        }
    });

    let cwd = working_dir_override
        .map(|s| s.to_string())
        .or(config.working_dir);

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new(&shell);
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        c
    } else {
        let mut c = std::process::Command::new(&shell);
        c.args(["-c", command]);
        c
    };

    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    }
    suppress_command_window(&mut cmd);

    if let Some(ref env_vars) = config.env_vars {
        for (k, v) in env_vars {
            cmd.env(k, v);
        }
    }

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000));

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            // Basic timeout check: if process took too long we'd need a child + wait_timeout
            // For now, std::process::Command blocks
            let _ = timeout; // reserved for future child-process timeout
            BackendExecResponse {
                backend_id: String::new(),
                stdout,
                stderr,
                exit_code: output.status.code(),
                timed_out: false,
            }
        }
        Err(e) => BackendExecResponse {
            backend_id: String::new(),
            stdout: String::new(),
            stderr: format!("Ausführungsfehler: {}", e),
            exit_code: None,
            timed_out: false,
        },
    }
}

/// Dispatch command execution to the correct backend
pub fn dispatch_exec(
    db: &Arc<Database>,
    backend_id: &str,
    command: &str,
    working_dir: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<BackendExecResponse, String> {
    let backends = db.list_terminal_backends().map_err(|e| e.to_string())?;
    let backend = backends
        .into_iter()
        .find(|b| b.id == backend_id)
        .ok_or_else(|| format!("Backend '{}' nicht gefunden", backend_id))?;

    if backend.status != "active" && backend.status != "connected" {
        return Err(format!(
            "Backend '{}' ist nicht aktiv (Status: {})",
            backend.name, backend.status
        ));
    }

    let mut result = match backend.backend_type.as_str() {
        "local" => execute_local(&backend.config_json, command, working_dir, timeout_ms),
        "container" => {
            // Placeholder: would spawn docker exec or docker run
            BackendExecResponse {
                backend_id: backend_id.to_string(),
                stdout: String::new(),
                stderr: "Container-Backend noch nicht implementiert".to_string(),
                exit_code: None,
                timed_out: false,
            }
        }
        "ssh" => BackendExecResponse {
            backend_id: backend_id.to_string(),
            stdout: String::new(),
            stderr: "SSH-Backend noch nicht implementiert".to_string(),
            exit_code: None,
            timed_out: false,
        },
        "hpc" => BackendExecResponse {
            backend_id: backend_id.to_string(),
            stdout: String::new(),
            stderr: "HPC-Backend noch nicht implementiert".to_string(),
            exit_code: None,
            timed_out: false,
        },
        "serverless" => BackendExecResponse {
            backend_id: backend_id.to_string(),
            stdout: String::new(),
            stderr: "Serverless-Backend noch nicht implementiert".to_string(),
            exit_code: None,
            timed_out: false,
        },
        _ => return Err(format!("Unbekannter Backend-Typ: {}", backend.backend_type)),
    };

    result.backend_id = backend_id.to_string();

    // Touch last_connected
    let _ = db.update_terminal_backend_status(&backend.id, "active");

    Ok(result)
}

/// Get the default local backend, creating it if needed
pub fn ensure_default_local_backend(db: &Arc<Database>) -> Result<TerminalBackendRow, String> {
    let backends = db.list_terminal_backends().map_err(|e| e.to_string())?;
    if let Some(local) = backends.into_iter().find(|b| b.backend_type == "local") {
        return Ok(local);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let config = serde_json::to_string(&LocalBackendConfig {
        shell: None,
        working_dir: None,
        env_vars: None,
    })
    .unwrap_or_else(|_| "{}".to_string());

    db.upsert_terminal_backend(&id, "Lokal", "local", &config)
        .map_err(|e| e.to_string())?;
    db.update_terminal_backend_status(&id, "active")
        .map_err(|e| e.to_string())?;

    db.list_terminal_backends()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| "Default-Backend konnte nicht erstellt werden".to_string())
}
