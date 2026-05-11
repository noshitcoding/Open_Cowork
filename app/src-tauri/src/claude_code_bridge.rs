use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn suppress_command_window(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn suppress_command_window(_command: &mut Command) {}

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeConfig {
    pub claude_code_path: String,
    pub bun_path: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub working_dir: Option<String>,
    pub max_turns: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub session_id: Option<String>,
    pub working_dir: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeResponse {
    pub session_id: String,
    pub content: String,
    pub cost_usd: Option<f64>,
    pub duration_ms: u64,
    pub is_error: bool,
    pub tools_used: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeStreamChunk {
    pub session_id: String,
    pub chunk_type: String, // "text", "tool_use", "tool_result", "thinking", "done", "error"
    pub content: String,
    pub tool_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeCommandInfo {
    pub name: String,
    pub description: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeToolInfo {
    pub name: String,
    pub description: String,
    pub category: String,
}

// ── Constants ───────────────────────────────────────────────────────────────

/// All known Claude Code slash commands by category
pub fn get_claude_code_commands() -> Vec<ClaudeCodeCommandInfo> {
    let commands = vec![
        // Session Management
        (
            "clear",
            "Kontext loeschen und neue Session starten",
            "session",
        ),
        (
            "compact",
            "Konversation komprimieren (Token sparen)",
            "session",
        ),
        ("resume", "Vorherige Session fortsetzen", "session"),
        ("recap", "Zusammenfassung der aktuellen Session", "session"),
        ("exit", "Session beenden", "session"),
        (
            "cost",
            "Aktuelle Kosten und Token-Verbrauch anzeigen",
            "session",
        ),
        ("stats", "Session-Statistiken anzeigen", "session"),
        ("status", "Status der aktuellen Session", "session"),
        ("export", "Session exportieren", "session"),
        // Configuration
        ("config", "Konfiguration anzeigen und aendern", "config"),
        ("model", "Modell wechseln (z.B. opus, sonnet)", "config"),
        (
            "memory",
            "Projektgedaechtnis (CLAUDE.md) bearbeiten",
            "config",
        ),
        ("permissions", "Berechtigungen verwalten", "config"),
        ("init", "Projekt initialisieren (.claude/ Ordner)", "config"),
        ("login", "API-Authentifizierung", "config"),
        ("logout", "API-Session beenden", "config"),
        ("theme", "Farbschema aendern", "config"),
        ("color", "Farbeinstellungen", "config"),
        ("keybindings", "Tastenkuerzel anzeigen", "config"),
        // Code & Files
        ("diff", "Aenderungen als Diff anzeigen", "code"),
        ("review", "Code-Review durchfuehren", "code"),
        ("security-review", "Sicherheits-Review durchfuehren", "code"),
        ("autofix-pr", "PR automatisch reparieren", "code"),
        ("branch", "Git Branch erstellen/wechseln", "code"),
        ("commit", "Aenderungen committen", "code"),
        // Planning & Execution
        (
            "plan",
            "Detaillierten Plan erstellen (ultraplan)",
            "planning",
        ),
        (
            "ultraplan",
            "Umfassenden Plan mit Analyse erstellen",
            "planning",
        ),
        (
            "ultrareview",
            "Tiefgehenden Review durchfuehren",
            "planning",
        ),
        ("simplify", "Code vereinfachen", "planning"),
        // Agent & Tasks
        ("agents", "Sub-Agenten verwalten", "agents"),
        ("tasks", "Aktive Tasks anzeigen und verwalten", "agents"),
        ("batch", "Batch-Operationen ausfuehren", "agents"),
        ("loop", "Schleife fuer wiederkehrende Aufgaben", "agents"),
        ("schedule", "Aufgabe zeitgesteuert ausfuehren", "agents"),
        // Tools & Extensions
        ("mcp", "MCP-Server verwalten", "tools"),
        ("skills", "Skills durchsuchen und ausfuehren", "tools"),
        ("plugin", "Plugins verwalten", "tools"),
        ("web-setup", "Web-Integration einrichten", "tools"),
        ("chrome", "Chrome-Integration", "tools"),
        ("desktop", "Desktop-Interaktion", "tools"),
        ("voice", "Spracheingabe", "tools"),
        // IDE & Bridge
        ("ide", "IDE-Integration verwalten", "bridge"),
        ("bridge", "Bridge-Verbindung verwalten", "bridge"),
        ("remote-env", "Remote-Umgebung konfigurieren", "bridge"),
        ("remote-control", "Fernsteuerung", "bridge"),
        // Debugging
        ("debug", "Debug-Modus aktivieren", "debug"),
        ("doctor", "System-Diagnose ausfuehren", "debug"),
        ("feedback", "Feedback senden", "debug"),
        // Advanced
        ("context", "Kontext anzeigen und bearbeiten", "advanced"),
        ("focus", "Fokus auf bestimmte Dateien/Ordner", "advanced"),
        ("add-dir", "Verzeichnis zum Kontext hinzufuegen", "advanced"),
        ("sandbox", "Sandbox-Umgebung nutzen", "advanced"),
        (
            "effort",
            "Aufwand-Level einstellen (low/medium/high)",
            "advanced",
        ),
        ("fast", "Schnellmodus (weniger Denkzeit)", "advanced"),
        (
            "rewind",
            "Zu einem frueheren Zustand zurueckspringen",
            "advanced",
        ),
        ("insights", "Erkenntnisse und Muster anzeigen", "advanced"),
        ("release-notes", "Release Notes generieren", "advanced"),
    ];

    commands
        .into_iter()
        .map(|(name, desc, cat)| ClaudeCodeCommandInfo {
            name: format!("/{}", name),
            description: desc.to_string(),
            category: cat.to_string(),
        })
        .collect()
}

/// All known Claude Code tools
pub fn get_claude_code_tools() -> Vec<ClaudeCodeToolInfo> {
    vec![
        ClaudeCodeToolInfo {
            name: "bash".into(),
            description: "Shell-Befehle ausfuehren".into(),
            category: "execution".into(),
        },
        ClaudeCodeToolInfo {
            name: "read".into(),
            description: "Dateien lesen".into(),
            category: "file".into(),
        },
        ClaudeCodeToolInfo {
            name: "write".into(),
            description: "Dateien schreiben".into(),
            category: "file".into(),
        },
        ClaudeCodeToolInfo {
            name: "edit".into(),
            description: "Dateien editieren (Diff-basiert)".into(),
            category: "file".into(),
        },
        ClaudeCodeToolInfo {
            name: "glob".into(),
            description: "Dateien per Muster suchen".into(),
            category: "file".into(),
        },
        ClaudeCodeToolInfo {
            name: "grep".into(),
            description: "Textsuche in Dateien".into(),
            category: "file".into(),
        },
        ClaudeCodeToolInfo {
            name: "ls".into(),
            description: "Verzeichnis auflisten".into(),
            category: "file".into(),
        },
        ClaudeCodeToolInfo {
            name: "agent".into(),
            description: "Sub-Agent starten".into(),
            category: "agents".into(),
        },
        ClaudeCodeToolInfo {
            name: "skill".into(),
            description: "Skill ausfuehren".into(),
            category: "agents".into(),
        },
        ClaudeCodeToolInfo {
            name: "task_create".into(),
            description: "Aufgabe erstellen".into(),
            category: "agents".into(),
        },
        ClaudeCodeToolInfo {
            name: "task_stop".into(),
            description: "Aufgabe stoppen".into(),
            category: "agents".into(),
        },
        ClaudeCodeToolInfo {
            name: "web_search".into(),
            description: "Web-Suche durchfuehren".into(),
            category: "web".into(),
        },
        ClaudeCodeToolInfo {
            name: "web_fetch".into(),
            description: "URL abrufen".into(),
            category: "web".into(),
        },
        ClaudeCodeToolInfo {
            name: "mcp_tool".into(),
            description: "MCP-Tool aufrufen".into(),
            category: "mcp".into(),
        },
        ClaudeCodeToolInfo {
            name: "mcp_resource".into(),
            description: "MCP-Ressource lesen".into(),
            category: "mcp".into(),
        },
        ClaudeCodeToolInfo {
            name: "lsp".into(),
            description: "Language Server Anfrage".into(),
            category: "code".into(),
        },
        ClaudeCodeToolInfo {
            name: "notebook_edit".into(),
            description: "Jupyter Notebook bearbeiten".into(),
            category: "code".into(),
        },
        ClaudeCodeToolInfo {
            name: "config_tool".into(),
            description: "Konfiguration aendern".into(),
            category: "config".into(),
        },
        ClaudeCodeToolInfo {
            name: "plan_mode".into(),
            description: "Plan-Modus umschalten".into(),
            category: "planning".into(),
        },
    ]
}

// ── Process Manager ─────────────────────────────────────────────────────────

pub struct ClaudeCodeProcess {
    child: Child,
    session_id: String,
    working_dir: String,
    model: Option<String>,
}

pub struct ClaudeCodeBridge {
    process: Mutex<Option<ClaudeCodeProcess>>,
}

impl ClaudeCodeBridge {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    /// Start Claude Code as subprocess in print mode
    pub fn start(&self, config: &ClaudeCodeConfig) -> Result<ClaudeCodeStatus, String> {
        let mut guard = self.process.lock().map_err(|e| e.to_string())?;

        if guard.is_some() {
            return Err("Claude Code laeuft bereits. Stoppe zuerst die aktuelle Session.".into());
        }

        let bun_path = resolve_bun_path(&config.bun_path)?;
        let cc_path = resolve_claude_code_path(&config.claude_code_path)?;
        let work_dir = config.working_dir.clone().unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

        let session_id = uuid::Uuid::new_v4().to_string();

        let mut cmd = Command::new(&bun_path);
        cmd.arg("run")
            .arg(cc_path.join("src").join("dev-entry.ts"))
            .current_dir(&work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Pass API key via environment
        if let Some(ref key) = config.api_key {
            cmd.env("ANTHROPIC_API_KEY", key);
        }
        suppress_command_window(&mut cmd);

        let child = cmd.spawn().map_err(|e| {
            format!(
                "Claude Code konnte nicht gestartet werden: {}. Stelle sicher dass Bun installiert ist ({}).",
                e, bun_path
            )
        })?;

        let pid = child.id();

        *guard = Some(ClaudeCodeProcess {
            child,
            session_id: session_id.clone(),
            working_dir: work_dir.clone(),
            model: config.model.clone(),
        });

        Ok(ClaudeCodeStatus {
            running: true,
            pid: Some(pid),
            session_id: Some(session_id),
            working_dir: Some(work_dir),
            model: config.model.clone(),
        })
    }

    /// Stop the Claude Code process
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.process.lock().map_err(|e| e.to_string())?;
        if let Some(mut proc) = guard.take() {
            let _ = proc.child.kill();
            let _ = proc.child.wait();
        }
        Ok(())
    }

    /// Get current status
    pub fn status(&self) -> ClaudeCodeStatus {
        let guard = self.process.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(proc) => ClaudeCodeStatus {
                running: true,
                pid: Some(proc.child.id()),
                session_id: Some(proc.session_id.clone()),
                working_dir: Some(proc.working_dir.clone()),
                model: proc.model.clone(),
            },
            None => ClaudeCodeStatus {
                running: false,
                pid: None,
                session_id: None,
                working_dir: None,
                model: None,
            },
        }
    }

    /// Send a prompt to Claude Code via --print mode (one-shot)
    pub fn send_prompt(
        config: &ClaudeCodeConfig,
        prompt: &str,
        output_format: &str,
    ) -> Result<ClaudeCodeResponse, String> {
        let bun_path = resolve_bun_path(&config.bun_path)?;
        let cc_path = resolve_claude_code_path(&config.claude_code_path)?;
        let work_dir = config.working_dir.clone().unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

        let session_id = uuid::Uuid::new_v4().to_string();
        let start = std::time::Instant::now();

        let mut cmd = Command::new(&bun_path);
        cmd.arg("run")
            .arg(cc_path.join("src").join("dev-entry.ts"))
            .arg("--print")
            .arg(prompt)
            .arg("--output-format")
            .arg(output_format)
            .current_dir(&work_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref key) = config.api_key {
            cmd.env("ANTHROPIC_API_KEY", key);
        }
        if let Some(ref model) = config.model {
            cmd.arg("--model");
            cmd.arg(model);
        }
        if let Some(max_turns) = config.max_turns {
            cmd.arg("--max-turns");
            cmd.arg(max_turns.to_string());
        }
        suppress_command_window(&mut cmd);

        let output = cmd
            .output()
            .map_err(|e| format!("Claude Code Aufruf fehlgeschlagen: {}", e))?;

        let duration_ms = start.elapsed().as_millis() as u64;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Ok(ClaudeCodeResponse {
                session_id,
                content: if stderr.is_empty() { stdout } else { stderr },
                cost_usd: None,
                duration_ms,
                is_error: true,
                tools_used: vec![],
            });
        }

        // Try to parse JSON output
        let (content, cost, tools) = if output_format == "json" {
            parse_json_response(&stdout)
        } else {
            (stdout.clone(), None, vec![])
        };

        Ok(ClaudeCodeResponse {
            session_id,
            content,
            cost_usd: cost,
            duration_ms,
            is_error: false,
            tools_used: tools,
        })
    }

    /// Send a prompt and stream output line-by-line via callback
    pub fn send_prompt_streaming<F>(
        config: &ClaudeCodeConfig,
        prompt: &str,
        session_id: &str,
        on_chunk: F,
    ) -> Result<ClaudeCodeResponse, String>
    where
        F: Fn(ClaudeCodeStreamChunk) + Send + 'static,
    {
        let bun_path = resolve_bun_path(&config.bun_path)?;
        let cc_path = resolve_claude_code_path(&config.claude_code_path)?;
        let work_dir = config.working_dir.clone().unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

        let start = std::time::Instant::now();
        let sid = session_id.to_string();

        let mut cmd = Command::new(&bun_path);
        cmd.arg("run")
            .arg(cc_path.join("src").join("dev-entry.ts"))
            .arg("--print")
            .arg(prompt)
            .arg("--output-format")
            .arg("stream-json")
            .current_dir(&work_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref key) = config.api_key {
            cmd.env("ANTHROPIC_API_KEY", key);
        }
        if let Some(ref model) = config.model {
            cmd.arg("--model");
            cmd.arg(model);
        }
        if let Some(max_turns) = config.max_turns {
            cmd.arg("--max-turns");
            cmd.arg(max_turns.to_string());
        }
        suppress_command_window(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Claude Code Aufruf fehlgeschlagen: {}", e))?;

        let stdout = child.stdout.take().ok_or("Kein stdout verfuegbar")?;
        let reader = BufReader::new(stdout);
        let mut full_content = String::new();
        let mut tools_used: Vec<String> = vec![];

        for line in reader.lines() {
            let line = line.map_err(|e| e.to_string())?;
            if line.trim().is_empty() {
                continue;
            }

            // Try to parse as JSON event
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                let chunk_type = event
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("text")
                    .to_string();
                let text = event
                    .get("content")
                    .or_else(|| event.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&line)
                    .to_string();
                let tool = event
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if let Some(ref t) = tool {
                    if !tools_used.contains(t) {
                        tools_used.push(t.clone());
                    }
                }

                if chunk_type == "text" || chunk_type == "assistant" {
                    full_content.push_str(&text);
                }

                on_chunk(ClaudeCodeStreamChunk {
                    session_id: sid.clone(),
                    chunk_type,
                    content: text,
                    tool_name: tool,
                });
            } else {
                // Raw text line
                full_content.push_str(&line);
                full_content.push('\n');

                on_chunk(ClaudeCodeStreamChunk {
                    session_id: sid.clone(),
                    chunk_type: "text".into(),
                    content: line,
                    tool_name: None,
                });
            }
        }

        let status = child.wait().map_err(|e| e.to_string())?;
        let duration_ms = start.elapsed().as_millis() as u64;

        on_chunk(ClaudeCodeStreamChunk {
            session_id: sid.clone(),
            chunk_type: "done".into(),
            content: String::new(),
            tool_name: None,
        });

        Ok(ClaudeCodeResponse {
            session_id: sid,
            content: full_content,
            cost_usd: None,
            duration_ms,
            is_error: !status.success(),
            tools_used,
        })
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn resolve_bun_path(configured: &str) -> Result<String, String> {
    let path = if configured.is_empty() {
        "bun"
    } else {
        configured
    };
    Ok(path.to_string())
}

fn resolve_claude_code_path(configured: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(configured);
    if !path.exists() {
        return Err(format!(
            "Claude Code Pfad nicht gefunden: {}. Bitte den korrekten Pfad in den Einstellungen angeben.",
            configured
        ));
    }
    Ok(path)
}

fn parse_json_response(raw: &str) -> (String, Option<f64>, Vec<String>) {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) {
        let content = json
            .get("result")
            .or_else(|| json.get("content"))
            .or_else(|| json.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or(raw)
            .to_string();

        let cost = json
            .get("cost_usd")
            .or_else(|| json.get("total_cost"))
            .and_then(|v| v.as_f64());

        let tools = json
            .get("tools_used")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        (content, cost, tools)
    } else {
        (raw.to_string(), None, vec![])
    }
}
