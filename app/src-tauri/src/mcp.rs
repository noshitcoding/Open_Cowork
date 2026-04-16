use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRequest {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResponse {
    pub server_name: String,
    pub protocol_version: Option<String>,
    pub server_info: Option<String>,
    pub tools: Vec<McpTool>,
}

#[derive(Debug, Error)]
pub enum McpError {
    #[error("invalid command")] 
    InvalidCommand,
    #[error("failed to spawn process: {0}")]
    SpawnFailed(String),
    #[error("failed to communicate with process: {0}")]
    IoFailed(String),
    #[error("timed out waiting for MCP response")]
    Timeout,
}

pub fn probe_server(req: McpServerRequest) -> Result<McpProbeResponse, McpError> {
    if req.command.trim().is_empty() {
        return Err(McpError::InvalidCommand);
    }

    let mut child = Command::new(req.command.trim())
        .args(req.args.iter().map(String::as_str))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| McpError::SpawnFailed(e.to_string()))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| McpError::IoFailed("missing stdin pipe".to_string()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| McpError::IoFailed("missing stdout pipe".to_string()))?;

    let init = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "clientInfo": {
                "name": "Open_Cowork",
                "version": "0.1.0"
            },
            "capabilities": {}
        }
    });

    let list_tools = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });

    writeln!(stdin, "{}", init).map_err(|e| McpError::IoFailed(e.to_string()))?;
    writeln!(stdin, "{}", list_tools).map_err(|e| McpError::IoFailed(e.to_string()))?;
    stdin.flush().map_err(|e| McpError::IoFailed(e.to_string()))?;

    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let start = Instant::now();
    let timeout = Duration::from_secs(8);

    let mut protocol_version: Option<String> = None;
    let mut server_info: Option<String> = None;
    let mut tools: Vec<McpTool> = vec![];
    let mut have_init = false;
    let mut have_tools = false;

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let wait_for = remaining.min(Duration::from_millis(400));

        match rx.recv_timeout(wait_for) {
            Ok(line) => {
                let value: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if value.get("id").and_then(|id| id.as_i64()) == Some(1) {
                    have_init = true;
                    protocol_version = value
                        .get("result")
                        .and_then(|r| r.get("protocolVersion"))
                        .and_then(|s| s.as_str())
                        .map(ToString::to_string);

                    server_info = value
                        .get("result")
                        .and_then(|r| r.get("serverInfo"))
                        .map(|info| {
                            let name = info.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
                            let version = info
                                .get("version")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            format!("{} {}", name, version)
                        });
                }

                if value.get("id").and_then(|id| id.as_i64()) == Some(2) {
                    have_tools = true;
                    if let Some(array) = value
                        .get("result")
                        .and_then(|r| r.get("tools"))
                        .and_then(|t| t.as_array())
                    {
                        for tool in array {
                            let name = tool
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let description = tool
                                .get("description")
                                .and_then(|d| d.as_str())
                                .unwrap_or("")
                                .to_string();
                            tools.push(McpTool { name, description });
                        }
                    }
                }

                if have_init && have_tools {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        }
    }

    let _ = child.kill();
    let _ = child.wait();

    if !have_init {
        return Err(McpError::Timeout);
    }

    Ok(McpProbeResponse {
        server_name: req.name,
        protocol_version,
        server_info,
        tools,
    })
}
