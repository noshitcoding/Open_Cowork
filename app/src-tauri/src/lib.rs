mod artifact_pipeline;
mod audit;
mod claude_code_bridge;
mod cowork_features;
mod db;
mod file_safety;
mod file_watch;
mod insights;
mod mcp;
mod memory_engine;
mod ollama;
mod process_manager;
mod scheduler;
mod skill_engine;
mod terminal_backends;
mod worker_sandbox;

use claude_code_bridge::ClaudeCodeBridge;
use db::Database;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use mcp::{call_tool, probe_server, McpCallRequest, McpError, McpServerRequest};
use reqwest::StatusCode;
use ollama::{
  chat_turn as chat_turn_internal,
  chat_turn_stream as chat_turn_stream_internal,
  check_health,
  generate_plan as generate_plan_internal,
  ChatMessage,
  ChatStreamChunkPayload,
  OllamaConfig,
  OllamaError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use std::time::Duration;
use tauri::{Emitter, Manager};

const LOCAL_DOCS_MCP_COMMAND: &str = "open-cowork-docs-mcp";
const LOCAL_SCREENSHOT_MCP_COMMAND: &str = "open-cowork-screenshot-mcp";
const POLICY_FLAG_STRICT: &str = "strictPolicyEnforcement";
const POLICY_FLAG_TOOL_DISPATCHER: &str = "allowToolDispatcher";
const POLICY_FLAG_MCP: &str = "allowMcpToolCalls";
const POLICY_FLAG_WEB_FETCH: &str = "allowWebFetch";
const POLICY_FLAG_FILE_READ: &str = "allowFileReadExtraction";
const POLICY_FLAG_AUTO_COMPACT: &str = "autoCompactLongContext";
const POLICY_FLAG_SHELL_EXECUTION: &str = "allowShellExecution";
const POLICY_FLAG_WEB_SEARCH: &str = "allowWebSearch";

#[derive(Default)]
struct WatchRegistry {
  watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

// -- Request/Response types -------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanRequest {
  prompt: String,
  config: Option<OllamaConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatTurnRequest {
  prompt: String,
  history: Vec<ChatMessage>,
  config: Option<OllamaConfig>,
  stream_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebFetchRequest {
  url: String,
  max_chars: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchRequest {
  query: String,
  max_results: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchResultItem {
  title: String,
  url: String,
  snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchResponse {
  query: String,
  results: Vec<WebSearchResultItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecCommandRequest {
  command: String,
  cwd: Option<String>,
  timeout_ms: Option<u64>,
  stream_id: Option<String>,
  retry_count: Option<u32>,
  retry_backoff_ms: Option<u64>,
  run_id: Option<String>,
  backend_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecCommandResponse {
  stdout: String,
  stderr: String,
  exit_code: Option<i32>,
  timed_out: bool,
  duration_ms: u64,
  attempts: u32,
  normalized_status: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PolicyFlagsPayload {
  #[serde(default = "default_true")]
  strict_policy_enforcement: bool,
  #[serde(default = "default_true")]
  allow_tool_dispatcher: bool,
  #[serde(default = "default_true")]
  allow_mcp_tool_calls: bool,
  #[serde(default = "default_true")]
  allow_web_fetch: bool,
  #[serde(default = "default_true")]
  allow_file_read_extraction: bool,
  #[serde(default = "default_true")]
  auto_compact_long_context: bool,
  #[serde(default = "default_true")]
  allow_shell_execution: bool,
  #[serde(default = "default_true")]
  allow_web_search: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicySetRequest {
  flags: PolicyFlagsPayload,
  deny_rules: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyStatePayload {
  flags: PolicyFlagsPayload,
  deny_rules: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineRunCreateRequest {
  id: String,
  parent_run_id: Option<String>,
  thread_id: Option<String>,
  session_id: Option<String>,
  title: String,
  input_summary: Option<String>,
  status: Option<String>,
  phase: Option<String>,
  cwd: Option<String>,
  model: Option<String>,
  provider: Option<String>,
  retry_count: Option<i32>,
  resumed_from_run_id: Option<String>,
  checkpoint_json: Option<String>,
  metadata_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineRunUpdateRequest {
  id: String,
  status: Option<String>,
  phase: Option<String>,
  checkpoint_json: Option<String>,
  result_summary: Option<String>,
  error: Option<String>,
  metadata_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineRunCheckpointRequest {
  run_id: String,
  label: String,
  snapshot_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInstructionUpsertRequest {
  id: String,
  scope_type: String,
  scope_ref: Option<String>,
  title: String,
  content: String,
  enabled: Option<bool>,
  priority: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerSandboxCreateRequest {
  id: String,
  run_id: String,
  parent_run_id: Option<String>,
  backend_id: Option<String>,
  source_cwd: String,
  mode: Option<String>,
  allow_file_read: Option<bool>,
  allow_file_write: Option<bool>,
  allow_shell_execution: Option<bool>,
  allow_web_fetch: Option<bool>,
  allow_web_search: Option<bool>,
  allow_mcp: Option<bool>,
  env_json: Option<String>,
  metadata_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerSandboxUpdateRequest {
  id: String,
  status: Option<String>,
  metadata_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyEvaluateRequest {
  tool: String,
  target: String,
  requested_flag: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyEvaluateResponse {
  allowed: bool,
  reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadRow {
  id: String,
  title: String,
  created_at: String,
  updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageRow {
  id: String,
  role: String,
  content: String,
  timestamp: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskRow {
  id: String,
  title: String,
  prompt: String,
  status: String,
  thread_id: Option<String>,
  created_at: String,
  updated_at: String,
  error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepRow {
  id: String,
  idx: i32,
  title: String,
  state: String,
  requires_approval: bool,
  risk_level: String,
  output: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactVersionRow {
  id: String,
  run_id: Option<String>,
  label: Option<String>,
  source_path: String,
  format: String,
  size_bytes: i64,
  summary: String,
  preview: String,
  metadata: Value,
  created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactExportRow {
  id: String,
  artifact_version_id: String,
  export_format: String,
  target_path: String,
  size_bytes: i64,
  created_at: String,
  source_path: String,
  run_id: Option<String>,
  label: Option<String>,
  source_format: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedAttachmentRow {
  original_path: String,
  imported_path: String,
  file_name: String,
  size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractTextLimitedResponse {
  text: String,
  chars: usize,
  truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsAttachmentMetadataEntry {
  path: String,
  file_name: String,
  extension: Option<String>,
  language: Option<String>,
  size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsAttachmentMetadataResponse {
  root_path: String,
  root_kind: String,
  total_files: usize,
  returned_files: usize,
  truncated: bool,
  files: Vec<FsAttachmentMetadataEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebFetchResponse {
  url: String,
  status: u16,
  ok: bool,
  title: Option<String>,
  content: String,
  truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledTaskUpsertRequest {
  id: String,
  name: String,
  prompt: String,
  schedule_expr: String,
  active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledTaskToggleRequest {
  id: String,
  active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledTaskRow {
  id: String,
  name: String,
  prompt: String,
  schedule_expr: String,
  active: bool,
  last_run_at: Option<String>,
  next_run_at: Option<String>,
  created_at: String,
  updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledRunRow {
  id: String,
  task_id: String,
  status: String,
  started_at: String,
  finished_at: Option<String>,
  result: Option<String>,
  error: Option<String>,
}

// -- Ollama commands --------------------------------------------------------

#[tauri::command]
async fn ollama_health_check(config: Option<OllamaConfig>) -> Result<ollama::OllamaHealthResponse, String> {
  check_health(config).await.map_err(map_ollama_error)
}

#[tauri::command]
async fn generate_plan(request: PlanRequest) -> Result<ollama::PlanResponse, String> {
  generate_plan_internal(request.config, request.prompt)
    .await
    .map_err(map_ollama_error)
}

#[tauri::command]
async fn chat_turn(request: ChatTurnRequest) -> Result<ollama::ChatTurnResponse, String> {
  chat_turn_internal(request.config, request.prompt, request.history)
    .await
    .map_err(map_ollama_error)
}

#[tauri::command]
async fn chat_turn_stream(app: tauri::AppHandle, request: ChatTurnRequest) -> Result<ollama::ChatTurnResponse, String> {
  let stream_id = request
    .stream_id
    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
  let app_for_emit = app.clone();

  chat_turn_stream_internal(
    stream_id,
    request.config,
    request.prompt,
    request.history,
    move |payload: ChatStreamChunkPayload| {
      app_for_emit
        .emit("ollama-chat-chunk", payload)
        .map_err(|error| OllamaError::RequestFailed(error.to_string()))
    },
  )
    .await
    .map_err(map_ollama_error)
}

// -- Claude Code Bridge commands --------------------------------------------

#[tauri::command]
fn claude_code_start(
  bridge: tauri::State<'_, ClaudeCodeBridge>,
  config: claude_code_bridge::ClaudeCodeConfig,
) -> Result<claude_code_bridge::ClaudeCodeStatus, String> {
  bridge.start(&config)
}

#[tauri::command]
fn claude_code_stop(bridge: tauri::State<'_, ClaudeCodeBridge>) -> Result<(), String> {
  bridge.stop()
}

#[tauri::command]
fn claude_code_status(bridge: tauri::State<'_, ClaudeCodeBridge>) -> claude_code_bridge::ClaudeCodeStatus {
  bridge.status()
}

#[tauri::command]
async fn claude_code_send(
  config: claude_code_bridge::ClaudeCodeConfig,
  prompt: String,
) -> Result<claude_code_bridge::ClaudeCodeResponse, String> {
  tauri::async_runtime::spawn_blocking(move || {
    ClaudeCodeBridge::send_prompt(&config, &prompt, "json")
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn claude_code_send_stream(
  app: tauri::AppHandle,
  config: claude_code_bridge::ClaudeCodeConfig,
  prompt: String,
  session_id: String,
) -> Result<claude_code_bridge::ClaudeCodeResponse, String> {
  let app_for_emit = app.clone();
  let sid = session_id.clone();

  tauri::async_runtime::spawn_blocking(move || {
    ClaudeCodeBridge::send_prompt_streaming(
      &config,
      &prompt,
      &sid,
      move |chunk| {
        let _ = app_for_emit.emit("claude-code-chunk", &chunk);
      },
    )
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
fn claude_code_list_commands() -> Vec<claude_code_bridge::ClaudeCodeCommandInfo> {
  claude_code_bridge::get_claude_code_commands()
}

#[tauri::command]
fn claude_code_list_tools() -> Vec<claude_code_bridge::ClaudeCodeToolInfo> {
  claude_code_bridge::get_claude_code_tools()
}

// -- MCP commands -----------------------------------------------------------

fn local_docs_mcp_probe(name: String) -> mcp::McpProbeResponse {
  mcp::McpProbeResponse {
    server_name: name,
    protocol_version: Some("2024-11-05".to_string()),
    server_info: Some("Open_Cowork Local Docs MCP 0.1.0".to_string()),
    tools: vec![
      mcp::McpTool {
        name: "extract_full_text".to_string(),
        description: "Extract full text from one file inside allowed folders".to_string(),
      },
      mcp::McpTool {
        name: "get_chunk".to_string(),
        description: "Read a text chunk by character offset and length".to_string(),
      },
      mcp::McpTool {
        name: "search_in_document".to_string(),
        description: "Search case-insensitive matches in extracted text".to_string(),
      },
      mcp::McpTool {
        name: "list_allowed_folders".to_string(),
        description: "List currently allowed root folders".to_string(),
      },
    ],
  }
}

fn local_screenshot_mcp_probe(name: String) -> mcp::McpProbeResponse {
  mcp::McpProbeResponse {
    server_name: name,
    protocol_version: Some("2024-11-05".to_string()),
    server_info: Some("Open_Cowork Screenshot MCP 0.1.0".to_string()),
    tools: vec![
      mcp::McpTool {
        name: "list_screens".to_string(),
        description: "List connected screens/monitors with bounds and primary flag".to_string(),
      },
      mcp::McpTool {
        name: "capture_screenshot".to_string(),
        description: "Capture screenshots for all connected screens (always all screens). Optional arg: outputDir".to_string(),
      },
    ],
  }
}

fn escape_powershell_single_quoted(value: &str) -> String {
  value.replace('\'', "''")
}

fn run_powershell_script(script: &str) -> Result<String, String> {
  let allow_bypass = std::env::var("OPEN_COWORK_ALLOW_POWERSHELL_BYPASS")
    .map(|value| value == "1")
    .unwrap_or(false);
  let policies: Vec<&str> = if allow_bypass {
    vec!["RemoteSigned", "Bypass"]
  } else {
    vec!["RemoteSigned"]
  };

  let mut last_error = String::new();
  for policy in policies {
    let output = Command::new("powershell")
      .args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        policy,
        "-Command",
        script,
      ])
      .output()
      .map_err(|err| format!("failed to launch powershell: {}", err))?;

    if output.status.success() {
      return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if stderr.is_empty() { stdout } else { stderr };
    last_error = format!("policy={} details={}", policy, details);
  }

  Err(format!("powershell screenshot command failed: {}", last_error))
}

fn local_screenshot_mcp_call(
  request: McpCallRequest,
  app: &tauri::AppHandle,
) -> Result<mcp::McpCallResponse, String> {
  if !cfg!(target_os = "windows") {
    return Err("screenshot MCP is currently supported only on Windows".to_string());
  }

  let tool_name = request.tool_name.clone();
  let output = match tool_name.as_str() {
    "list_screens" => {
      let script = r#"
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [PSCustomObject]@{
    index = [array]::IndexOf([System.Windows.Forms.Screen]::AllScreens, $_)
    primary = $_.Primary
    x = $_.Bounds.X
    y = $_.Bounds.Y
    width = $_.Bounds.Width
    height = $_.Bounds.Height
    deviceName = $_.DeviceName
  }
} | ConvertTo-Json -Compress
"#;

      run_powershell_script(script)?
    }
    "capture_screenshot" => {
      let output_dir = if let Some(dir) = request.tool_args.get("outputDir").and_then(|value| value.as_str()) {
        PathBuf::from(dir)
      } else {
        let mut path = app.path().app_data_dir().map_err(|err| err.to_string())?;
        path.push("screenshots");
        path
      };

      fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;
      let escaped_dir = escape_powershell_single_quoted(&output_dir.display().to_string());
      let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
      let escaped_timestamp = escape_powershell_single_quoted(&timestamp);

      let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$dir = '{escaped_dir}'
$ts = '{escaped_timestamp}'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$result = @()
$screens = [System.Windows.Forms.Screen]::AllScreens
for ($i = 0; $i -lt $screens.Length; $i++) {{
  $screen = $screens[$i]
  $bounds = $screen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
  $path = Join-Path $dir ('screenshot-' + $ts + '-' + $i + '.png')
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bmp.Dispose()
  $result += [PSCustomObject]@{{
    index = $i
    path = $path
    primary = $screen.Primary
    x = $bounds.X
    y = $bounds.Y
    width = $bounds.Width
    height = $bounds.Height
  }}
}}
[PSCustomObject]@{{ allScreens = $true; forcedAllScreens = $true; outputDir = $dir; screenshots = $result }} | ConvertTo-Json -Compress
"#
      );

      run_powershell_script(&script)?
    }
    _ => {
      return Err(format!("unsupported screenshot MCP tool: {}", tool_name));
    }
  };

  let pretty_result = serde_json::from_str::<Value>(&output)
    .ok()
    .and_then(|value| serde_json::to_string_pretty(&value).ok())
    .unwrap_or(output);

  Ok(mcp::McpCallResponse {
    server_name: request.name,
    tool_name,
    success: true,
    result: pretty_result,
    error: None,
  })
}

fn local_docs_mcp_call(
  request: McpCallRequest,
  state: tauri::State<'_, Arc<Database>>,
) -> Result<mcp::McpCallResponse, String> {
  let tool_name = request.tool_name.clone();

  if tool_name == "list_allowed_folders" {
    let folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
    return Ok(mcp::McpCallResponse {
      server_name: request.name,
      tool_name,
      success: true,
      result: serde_json::to_string_pretty(&folders).unwrap_or_else(|_| "[]".to_string()),
      error: None,
    });
  }

  let path = request
    .tool_args
    .get("path")
    .and_then(|value| value.as_str())
    .ok_or_else(|| "missing required argument: path".to_string())?;

  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(path).as_path(), &allowed_folders)?;
  let text = artifact_pipeline::extract_text_for_llm(canonical_target.as_path())?;

  let result = match tool_name.as_str() {
    "extract_full_text" => text,
    "get_chunk" => {
      let start = request
        .tool_args
        .get("start")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as usize;
      let length = request
        .tool_args
        .get("length")
        .and_then(|value| value.as_u64())
        .unwrap_or(8_000) as usize;

      text.chars().skip(start).take(length).collect::<String>()
    }
    "search_in_document" => {
      let query = request
        .tool_args
        .get("query")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "missing required argument: query".to_string())?
        .to_lowercase();
      let limit = request
        .tool_args
        .get("limit")
        .and_then(|value| value.as_u64())
        .unwrap_or(12) as usize;

      let mut matches: Vec<String> = Vec::new();
      for line in text.lines() {
        if line.to_lowercase().contains(&query) {
          matches.push(line.to_string());
          if matches.len() >= limit {
            break;
          }
        }
      }

      serde_json::to_string_pretty(&matches).unwrap_or_else(|_| "[]".to_string())
    }
    _ => {
      return Err(format!("unsupported local docs MCP tool: {}", tool_name));
    }
  };

  Ok(mcp::McpCallResponse {
    server_name: request.name,
    tool_name,
    success: true,
    result,
    error: None,
  })
}

#[tauri::command]
async fn mcp_probe(request: McpServerRequest) -> Result<mcp::McpProbeResponse, String> {
  if request.command.trim() == LOCAL_DOCS_MCP_COMMAND {
    return Ok(local_docs_mcp_probe(request.name));
  }

  if request.command.trim() == LOCAL_SCREENSHOT_MCP_COMMAND {
    return Ok(local_screenshot_mcp_probe(request.name));
  }

  probe_server(request).map_err(map_mcp_error)
}

#[tauri::command]
async fn mcp_call_tool(
  app: tauri::AppHandle,
  request: McpCallRequest,
  state: tauri::State<'_, Arc<Database>>,
  run_id: Option<String>,
) -> Result<mcp::McpCallResponse, String> {
  let policy = load_policy_state(&state)?;
  enforce_tool_policy(
    &policy,
    "mcp",
    &format!("{}::{}", request.name, request.tool_name),
    policy.flags.allow_mcp_tool_calls,
  )?;
  if let Some(sandbox) = load_run_sandbox(&state, run_id.as_deref())? {
    enforce_worker_sandbox_flag(&sandbox, sandbox.allow_mcp, "mcp-aufrufe")?;
  }

  if request.command.trim() == LOCAL_DOCS_MCP_COMMAND {
    return local_docs_mcp_call(request, state);
  }

  if request.command.trim() == LOCAL_SCREENSHOT_MCP_COMMAND {
    return local_screenshot_mcp_call(request, &app);
  }

  call_tool(request).map_err(map_mcp_error)
}

#[tauri::command]
async fn web_fetch_url(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  request: WebFetchRequest,
  run_id: Option<String>,
) -> Result<WebFetchResponse, String> {
  let requested_url = request.url.trim();
  if requested_url.is_empty() {
    return Err("url darf nicht leer sein".to_string());
  }

  let policy = load_policy_state(&state)?;
  enforce_tool_policy(&policy, "web_fetch", requested_url, policy.flags.allow_web_fetch)?;
  if let Some(sandbox) = load_run_sandbox(&state, run_id.as_deref())? {
    enforce_worker_sandbox_flag(&sandbox, sandbox.allow_web_fetch, "web-fetch")?;
  }

  let max_chars = request.max_chars.unwrap_or(4_000).clamp(500, 30_000);
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(|err| err.to_string())?;
  let response = client
    .get(requested_url)
    .send()
    .await
    .map_err(|err| err.to_string())?;
  let status = response.status();
  let body = response.text().await.map_err(|err| err.to_string())?;

  let title = extract_html_title(&body);
  let text = strip_html_like_content(&body);
  let trimmed = text.trim().to_string();
  let content: String = trimmed.chars().take(max_chars).collect();
  let truncated = trimmed.chars().count() > max_chars;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "url": requested_url,
    "status": status.as_u16(),
    "maxChars": max_chars,
    "truncated": truncated,
    "contentChars": content.chars().count(),
  });
  let _ = audit::append_audit_event(app_data_dir, "web", "fetch_url", Some(details));

  Ok(WebFetchResponse {
    url: requested_url.to_string(),
    status: status.as_u16(),
    ok: status == StatusCode::OK,
    title,
    content,
    truncated,
  })
}

#[tauri::command]
async fn web_search(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  request: WebSearchRequest,
  run_id: Option<String>,
) -> Result<WebSearchResponse, String> {
  let query = request.query.trim();
  if query.is_empty() {
    return Err("query darf nicht leer sein".to_string());
  }

  let policy = load_policy_state(&state)?;
  enforce_tool_policy(&policy, "web_search", query, policy.flags.allow_web_search)?;
  if let Some(sandbox) = load_run_sandbox(&state, run_id.as_deref())? {
    enforce_worker_sandbox_flag(&sandbox, sandbox.allow_web_search, "web-search")?;
  }

  let max_results = request.max_results.unwrap_or(5).clamp(1, 10);
  let encoded_query = url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
  let search_url = format!("https://html.duckduckgo.com/html/?q={}", encoded_query);
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(|err| err.to_string())?;
  let body = client
    .get(&search_url)
    .send()
    .await
    .map_err(|err| err.to_string())?
    .text()
    .await
    .map_err(|err| err.to_string())?;

  let results = parse_duckduckgo_results(&body, max_results);

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "query": query,
    "resultCount": results.len(),
  });
  let _ = audit::append_audit_event(app_data_dir, "web", "search", Some(details));

  Ok(WebSearchResponse {
    query: query.to_string(),
    results,
  })
}

#[tauri::command]
fn exec_command(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  command: String,
  cwd: Option<String>,
  timeout_ms: Option<u64>,
  stream_id: Option<String>,
  retry_count: Option<u32>,
  retry_backoff_ms: Option<u64>,
  run_id: Option<String>,
  backend_id: Option<String>,
) -> Result<ExecCommandResponse, String> {
  let request = ExecCommandRequest {
    command,
    cwd,
    timeout_ms,
    stream_id,
    retry_count,
    retry_backoff_ms,
    run_id,
    backend_id,
  };

  let command_text = request.command.trim();
  if command_text.is_empty() {
    return Err("command darf nicht leer sein".to_string());
  }

  let policy = load_policy_state(&state)?;
  enforce_tool_policy(
    &policy,
    "shell",
    command_text,
    policy.flags.allow_shell_execution,
  )?;

  if let Some(sandbox) = load_run_sandbox(&state, request.run_id.as_deref())? {
    enforce_worker_sandbox_flag(&sandbox, sandbox.allow_shell_execution, "shell-ausfuehrung")?;
    if process_manager::detect_admin_requirement(command_text) {
      return Err("sandbox blockiert shell-kommandos mit admin/elevation-anforderung".to_string());
    }
  }

  let timeout_ms = request.timeout_ms.unwrap_or(30_000).clamp(1_000, 600_000);
  let retry_count = request.retry_count.unwrap_or(0).min(3);
  let retry_backoff_ms = request.retry_backoff_ms.unwrap_or(1_000).clamp(100, 30_000);
  let start = Instant::now();
  let effective_cwd = ensure_run_cwd(&state, request.run_id.as_deref(), request.cwd.as_deref())?;
  let (shell_override, env_vars) = resolve_exec_runtime(
    &state,
    request.backend_id.as_deref(),
    request.run_id.as_deref(),
  )?;

  let mut last_response = ExecCommandResponse {
    stdout: String::new(),
    stderr: String::new(),
    exit_code: None,
    timed_out: false,
    duration_ms: 0,
    attempts: 0,
    normalized_status: "error".to_string(),
  };
  let mut last_error: Option<String> = None;

  for attempt in 0..=retry_count {
    last_response.attempts = attempt + 1;
    match run_command_once(
      &app,
      request.stream_id.as_deref(),
      command_text,
      effective_cwd.as_deref(),
      timeout_ms,
      shell_override.as_deref(),
      &env_vars,
    ) {
      Ok(response) => {
        last_response = ExecCommandResponse {
          attempts: attempt + 1,
          duration_ms: start.elapsed().as_millis() as u64,
          ..response
        };

        if last_response.normalized_status == "success" || attempt == retry_count {
          break;
        }

        thread::sleep(Duration::from_millis(retry_backoff_ms * (attempt as u64 + 1)));
      }
      Err(err) => {
        last_error = Some(err.clone());
        last_response.stderr = err;
        last_response.duration_ms = start.elapsed().as_millis() as u64;
        last_response.normalized_status = "spawn_error".to_string();

        if attempt == retry_count {
          break;
        }

        thread::sleep(Duration::from_millis(retry_backoff_ms * (attempt as u64 + 1)));
      }
    }
  }

  if let Some(run_id) = request.run_id.as_deref() {
    let payload = serde_json::json!({
      "command": command_text,
      "cwd": request.cwd,
      "backendId": request.backend_id,
      "stdout": truncate_chars(&last_response.stdout, 4000),
      "stderr": truncate_chars(&last_response.stderr, 4000),
      "exitCode": last_response.exit_code,
      "timedOut": last_response.timed_out,
      "status": last_response.normalized_status,
      "attempts": last_response.attempts,
      "error": last_error,
    });
    let payload_text = payload.to_string();
    let _ = state.insert_engine_run_event(
      &uuid::Uuid::new_v4().to_string(),
      run_id,
      "exec_command",
      Some(&payload_text),
    );
  }

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "command": command_text,
    "cwd": effective_cwd,
    "backendId": request.backend_id,
    "exitCode": last_response.exit_code,
    "timedOut": last_response.timed_out,
    "status": last_response.normalized_status,
    "attempts": last_response.attempts,
    "durationMs": last_response.duration_ms,
  });
  let _ = audit::append_audit_event(app_data_dir, "shell", "exec_command", Some(details));

  Ok(last_response)
}

// -- Persistence commands ---------------------------------------------------

#[tauri::command]
fn db_save_thread(state: tauri::State<'_, Arc<Database>>, id: String, title: String, created_at: String) -> Result<(), String> {
  state.insert_thread(&id, &title, &created_at).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_threads(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<ThreadRow>, String> {
  state.list_threads().map_err(|e| e.to_string()).map(|rows| {
    rows.into_iter().map(|(id, title, ca, ua)| ThreadRow { id, title, created_at: ca, updated_at: ua }).collect()
  })
}

#[tauri::command]
fn db_delete_thread(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_thread(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_message(state: tauri::State<'_, Arc<Database>>, id: String, thread_id: String, role: String, content: String, timestamp: i64) -> Result<(), String> {
  state.insert_message(&id, &thread_id, &role, &content, timestamp).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_message_content(state: tauri::State<'_, Arc<Database>>, id: String, content: String) -> Result<(), String> {
  state.update_message_content(&id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_messages(state: tauri::State<'_, Arc<Database>>, thread_id: String) -> Result<Vec<MessageRow>, String> {
  state.list_messages(&thread_id).map_err(|e| e.to_string()).map(|rows| {
    rows.into_iter().map(|(id, role, content, ts)| MessageRow { id, role, content, timestamp: ts }).collect()
  })
}

#[tauri::command]
fn db_save_task(
  state: tauri::State<'_, Arc<Database>>,
  id: String, title: String, prompt: String, status: String,
  thread_id: Option<String>, created_at: String,
) -> Result<(), String> {
  state.insert_task(&id, &title, &prompt, &status, thread_id.as_deref(), &created_at).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_task_status(state: tauri::State<'_, Arc<Database>>, id: String, status: String) -> Result<(), String> {
  state.update_task_status(&id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_tasks(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<TaskRow>, String> {
  state.list_tasks().map_err(|e| e.to_string()).map(|rows| {
    rows.into_iter().map(|(id, title, prompt, status, thread_id, ca, ua, error)| {
      TaskRow { id, title, prompt, status, thread_id, created_at: ca, updated_at: ua, error }
    }).collect()
  })
}

#[tauri::command]
fn db_save_step(
  state: tauri::State<'_, Arc<Database>>,
  id: String, task_id: String, idx: i32, title: String, state_val: String,
  requires_approval: bool, risk_level: String,
) -> Result<(), String> {
  state.insert_step(&id, &task_id, idx, &title, &state_val, requires_approval, &risk_level).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_step(state: tauri::State<'_, Arc<Database>>, id: String, state_val: String, output: Option<String>) -> Result<(), String> {
  state.update_step_state(&id, &state_val, output.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_steps(state: tauri::State<'_, Arc<Database>>, task_id: String) -> Result<Vec<StepRow>, String> {
  state.list_steps(&task_id).map_err(|e| e.to_string()).map(|rows| {
    rows.into_iter().map(|(id, idx, title, st, ra, rl, output)| {
      StepRow { id, idx, title, state: st, requires_approval: ra, risk_level: rl, output }
    }).collect()
  })
}

#[tauri::command]
fn execute_task(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  task_id: String,
) -> Result<(), String> {
  let task_exists = state
    .list_tasks()
    .map_err(|e| e.to_string())?
    .into_iter()
    .any(|(id, _, _, _, _, _, _, _)| id == task_id);
  if !task_exists {
    return Err("task not found".to_string());
  }

  let steps = state.list_steps(&task_id).map_err(|e| e.to_string())?;
  if steps.is_empty() {
    state.set_task_error(&task_id, "task has no steps").map_err(|e| e.to_string())?;
    return Err("task has no steps".to_string());
  }

  state
    .update_task_status(&task_id, "running")
    .map_err(|e| e.to_string())?;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let _ = audit::append_audit_event(
    app_data_dir.clone(),
    "task_engine",
    "execute_task_started",
    Some(serde_json::json!({ "taskId": task_id, "stepCount": steps.len() })),
  );

  let task_id_for_audit = task_id.clone();
  let execution = (|| -> Result<(), String> {
    for (step_id, _, title, _, _, _, _) in steps {
      let current_status = state
        .list_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|(id, _, _, _, _, _, _, _)| id == &task_id)
        .map(|(_, _, _, status, _, _, _, _)| status)
        .unwrap_or_else(|| "failed".to_string());

      if current_status == "cancelled" {
        state
          .update_step_state(&step_id, "skipped", Some("Task wurde abgebrochen"))
          .map_err(|e| e.to_string())?;
        return Ok(());
      }

      state
        .update_step_state(&step_id, "running", None)
        .map_err(|e| e.to_string())?;
      thread::sleep(Duration::from_millis(50));

      let output = format!("Automatisch ausgefuehrt: {}", title);
      state
        .update_step_state(&step_id, "completed", Some(&output))
        .map_err(|e| e.to_string())?;
    }

    state
      .update_task_status(&task_id, "completed")
      .map_err(|e| e.to_string())?;
    Ok(())
  })();

  match execution {
    Ok(()) => {
      let _ = audit::append_audit_event(
        app_data_dir,
        "task_engine",
        "execute_task_completed",
        Some(serde_json::json!({ "taskId": task_id_for_audit })),
      );
      Ok(())
    }
    Err(err) => {
      let _ = state.set_task_error(&task_id, &err);
      let _ = audit::append_audit_event(
        app_data_dir,
        "task_engine",
        "execute_task_failed",
        Some(serde_json::json!({ "taskId": task_id_for_audit, "error": err })),
      );
      Err("task execution failed".to_string())
    }
  }
}

#[tauri::command]
fn audit_event(
  app: tauri::AppHandle,
  area: String,
  action: String,
  details: Option<Value>,
) -> Result<(), String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|err| err.to_string())?;

  audit::append_audit_event(app_data_dir, &area, &action, details)
}

#[tauri::command]
fn fs_list_allowed_folders(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<String>, String> {
  state.list_allowed_folders().map_err(|err| err.to_string())
}

#[tauri::command]
fn fs_add_allowed_folder(state: tauri::State<'_, Arc<Database>>, path: String) -> Result<(), String> {
  let canonical = PathBuf::from(path)
    .canonicalize()
    .map_err(|err| err.to_string())?;
  state
    .add_allowed_folder(&canonical.display().to_string())
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn fs_remove_allowed_folder(state: tauri::State<'_, Arc<Database>>, path: String) -> Result<(), String> {
  state.remove_allowed_folder(&path).map_err(|err| err.to_string())
}

fn sanitize_attachment_file_name(value: &str) -> String {
  let sanitized: String = value
    .chars()
    .map(|ch| match ch {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
      ch if ch.is_control() => '_',
      ch => ch,
    })
    .collect();

  let trimmed = sanitized.trim().trim_matches('.').to_string();
  if trimmed.is_empty() {
    "attachment".to_string()
  } else {
    trimmed
  }
}

#[tauri::command]
fn fs_import_attachment(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
) -> Result<ImportedAttachmentRow, String> {
  let source = PathBuf::from(&path)
    .canonicalize()
    .map_err(|err| err.to_string())?;
  let metadata = fs::metadata(&source).map_err(|err| err.to_string())?;
  if !metadata.is_file() {
    return Err("attachment source is not a file".to_string());
  }

  let mut attachment_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  attachment_dir.push("attachments");
  fs::create_dir_all(&attachment_dir).map_err(|err| err.to_string())?;

  let original_name = source
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("attachment");
  let safe_name = sanitize_attachment_file_name(original_name);
  let target_name = format!("{}_{}", uuid::Uuid::new_v4(), safe_name);
  let target_path = attachment_dir.join(target_name);
  fs::copy(&source, &target_path).map_err(|err| err.to_string())?;

  let canonical_attachment_dir = attachment_dir
    .canonicalize()
    .map_err(|err| err.to_string())?;
  state
    .add_allowed_folder(&canonical_attachment_dir.display().to_string())
    .map_err(|err| err.to_string())?;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "originalPath": source.display().to_string(),
    "importedPath": target_path.display().to_string(),
    "sizeBytes": metadata.len(),
  });
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "import_attachment", Some(details));

  Ok(ImportedAttachmentRow {
    original_path: source.display().to_string(),
    imported_path: target_path.display().to_string(),
    file_name: original_name.to_string(),
    size_bytes: metadata.len(),
  })
}

fn infer_language_from_extension(path: &Path) -> Option<String> {
  let ext = path
    .extension()
    .and_then(|value| value.to_str())?
    .to_lowercase();

  let language = match ext.as_str() {
    "rs" => "Rust",
    "ts" | "tsx" => "TypeScript",
    "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
    "py" => "Python",
    "java" => "Java",
    "kt" | "kts" => "Kotlin",
    "cs" => "C#",
    "cpp" | "cc" | "cxx" | "hpp" | "h" => "C/C++",
    "go" => "Go",
    "php" => "PHP",
    "rb" => "Ruby",
    "swift" => "Swift",
    "scala" => "Scala",
    "sh" | "bash" | "zsh" | "ps1" => "Shell",
    "sql" => "SQL",
    "html" | "htm" => "HTML",
    "css" | "scss" | "sass" | "less" => "CSS",
    "json" => "JSON",
    "yaml" | "yml" => "YAML",
    "toml" => "TOML",
    "xml" => "XML",
    "md" => "Markdown",
    _ => return None,
  };

  Some(language.to_string())
}

fn push_metadata_entry(path: &Path, metadata: &fs::Metadata, files: &mut Vec<FsAttachmentMetadataEntry>) {
  let file_name = path
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();
  let extension = path
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.to_lowercase());

  files.push(FsAttachmentMetadataEntry {
    path: path.display().to_string(),
    file_name,
    extension,
    language: infer_language_from_extension(path),
    size_bytes: metadata.len(),
  });
}

#[tauri::command]
fn fs_collect_attachment_metadata(
  state: tauri::State<'_, Arc<Database>>,
  path: String,
  max_entries: Option<usize>,
  run_id: Option<String>,
) -> Result<FsAttachmentMetadataResponse, String> {
  let policy = load_policy_state(&state)?;
  enforce_tool_policy(
    &policy,
    "read_file",
    path.as_str(),
    policy.flags.allow_file_read_extraction,
  )?;

  let allowed_folders = resolve_allowed_folders_for_run(&state, run_id.as_deref())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&path).as_path(), &allowed_folders)?;
  let bounded_max_entries = max_entries.unwrap_or(120).clamp(1, 2_000);

  let mut files: Vec<FsAttachmentMetadataEntry> = Vec::new();
  let mut total_files: usize = 0;

  if canonical_target.is_file() {
    let metadata = fs::metadata(&canonical_target).map_err(|err| err.to_string())?;
    total_files = 1;
    push_metadata_entry(&canonical_target, &metadata, &mut files);

    return Ok(FsAttachmentMetadataResponse {
      root_path: canonical_target.display().to_string(),
      root_kind: "file".to_string(),
      total_files,
      returned_files: files.len(),
      truncated: false,
      files,
    });
  }

  let mut stack = vec![canonical_target.clone()];
  while let Some(current_dir) = stack.pop() {
    let entries = fs::read_dir(&current_dir).map_err(|err| err.to_string())?;
    for entry in entries {
      let entry = entry.map_err(|err| err.to_string())?;
      let candidate_path = entry.path();
      let file_type = entry.file_type().map_err(|err| err.to_string())?;

      if file_type.is_symlink() {
        continue;
      }

      if file_type.is_dir() {
        stack.push(candidate_path);
        continue;
      }

      if file_type.is_file() {
        total_files += 1;
        if files.len() < bounded_max_entries {
          let metadata = entry.metadata().map_err(|err| err.to_string())?;
          push_metadata_entry(&candidate_path, &metadata, &mut files);
        }
      }
    }
  }

  Ok(FsAttachmentMetadataResponse {
    root_path: canonical_target.display().to_string(),
    root_kind: "folder".to_string(),
    total_files,
    returned_files: files.len(),
    truncated: total_files > files.len(),
    files,
  })
}

#[tauri::command]
fn fs_write_text_file(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
  content: String,
  create_backup: bool,
  run_id: Option<String>,
) -> Result<file_safety::FileWriteResponse, String> {
  let canonical_target = ensure_run_file_access(&state, run_id.as_deref(), &path, true)?;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let response = file_safety::write_text_file(&app_data_dir, &canonical_target, &content, create_backup)?;

  let details = file_safety::write_file_audit_details(
    &response.path,
    response.backup_path.as_deref(),
    response.bytes_written,
  );
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "write_text_file", Some(details));

  Ok(response)
}

#[tauri::command]
fn fs_delete_file(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
  confirm_token: String,
) -> Result<(), String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&path).as_path(), &allowed_folders)?;

  file_safety::delete_file(&canonical_target, &confirm_token)?;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = file_safety::delete_file_audit_details(&canonical_target.display().to_string());
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "delete_file", Some(details));

  Ok(())
}

#[tauri::command]
fn fs_list_backups(app: tauri::AppHandle) -> Result<Vec<file_safety::BackupEntry>, String> {
  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  file_safety::list_backups(&app_data_dir)
}

#[tauri::command]
fn fs_restore_backup(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  backup_file_name: String,
  target_path: String,
  create_backup: bool,
) -> Result<file_safety::FileWriteResponse, String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&target_path).as_path(), &allowed_folders)?;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let response = file_safety::restore_backup(
    &app_data_dir,
    &backup_file_name,
    &canonical_target,
    create_backup,
  )?;

  let details = file_safety::restore_file_audit_details(&response.path, &backup_file_name);
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "restore_backup", Some(details));

  Ok(response)
}

#[tauri::command]
fn fs_watch_list(watch_registry: tauri::State<'_, WatchRegistry>) -> Result<Vec<String>, String> {
  let watchers = watch_registry.watchers.lock().map_err(|_| "watch registry is poisoned")?;
  Ok(watchers.keys().cloned().collect())
}

#[tauri::command]
fn fs_watch_start(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  watch_registry: tauri::State<'_, WatchRegistry>,
  path: String,
) -> Result<(), String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&path).as_path(), &allowed_folders)?;
  let watched_path = canonical_target.display().to_string();

  {
    let watchers = watch_registry.watchers.lock().map_err(|_| "watch registry is poisoned")?;
    if watchers.contains_key(&watched_path) {
      return Ok(());
    }
  }

  let app_handle = app.clone();
  let watched_path_for_callback = watched_path.clone();

  let mut watcher = notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
    if let Ok(event) = result {
      let payload = file_watch::to_payload(&watched_path_for_callback, &event);
      let _ = app_handle.emit("file_safety://watch_event", payload.clone());

      if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let details = serde_json::to_value(payload).ok();
        let _ = audit::append_audit_event(app_data_dir, "file_safety", "watch_event", details);
      }
    }
  })
  .map_err(|err| err.to_string())?;

  watcher
    .watch(canonical_target.as_path(), RecursiveMode::Recursive)
    .map_err(|err| err.to_string())?;

  let mut watchers = watch_registry.watchers.lock().map_err(|_| "watch registry is poisoned")?;
  watchers.insert(watched_path, watcher);

  Ok(())
}

#[tauri::command]
fn fs_watch_stop(
  watch_registry: tauri::State<'_, WatchRegistry>,
  path: String,
) -> Result<(), String> {
  let canonical = PathBuf::from(&path)
    .canonicalize()
    .map_err(|err| err.to_string())?;
  let watched_path = canonical.display().to_string();

  let mut watchers = watch_registry.watchers.lock().map_err(|_| "watch registry is poisoned")?;
  if let Some(mut watcher) = watchers.remove(&watched_path) {
    let _ = watcher.unwatch(canonical.as_path());
  }

  Ok(())
}

#[tauri::command]
fn fs_parse_artifact(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
) -> Result<artifact_pipeline::ArtifactParseResponse, String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&path).as_path(), &allowed_folders)?;

  let response = artifact_pipeline::parse_artifact(canonical_target.as_path())?;
  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "path": response.path,
    "format": response.format,
    "sizeBytes": response.size_bytes,
  });
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "parse_artifact", Some(details));

  Ok(response)
}

#[tauri::command]
fn fs_extract_text(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
  run_id: Option<String>,
) -> Result<String, String> {
  let policy = load_policy_state(&state)?;
  enforce_tool_policy(
    &policy,
    "read_file",
    path.as_str(),
    policy.flags.allow_file_read_extraction,
  )?;

  let canonical_target = ensure_run_file_access(&state, run_id.as_deref(), &path, false)?;

  let text = artifact_pipeline::extract_text_for_llm(canonical_target.as_path())?;
  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "path": canonical_target.display().to_string(),
    "chars": text.chars().count(),
  });
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "extract_text", Some(details));

  Ok(text)
}

#[tauri::command]
fn fs_extract_text_limited(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
  max_chars: usize,
  run_id: Option<String>,
) -> Result<ExtractTextLimitedResponse, String> {
  let bounded_max_chars = max_chars.clamp(1_000, 120_000);
  let policy = load_policy_state(&state)?;
  enforce_tool_policy(
    &policy,
    "read_file",
    path.as_str(),
    policy.flags.allow_file_read_extraction,
  )?;

  let canonical_target = ensure_run_file_access(&state, run_id.as_deref(), &path, false)?;

  let (text, truncated) = artifact_pipeline::extract_text_for_llm_limited(
    canonical_target.as_path(),
    bounded_max_chars,
  )?;
  let chars = text.chars().count();
  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "path": canonical_target.display().to_string(),
    "chars": chars,
    "maxChars": bounded_max_chars,
    "truncated": truncated,
  });
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "extract_text_limited", Some(details));

  Ok(ExtractTextLimitedResponse {
    text,
    chars,
    truncated,
  })
}

#[tauri::command]
fn fs_save_artifact_version(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
  run_id: Option<String>,
  label: Option<String>,
) -> Result<ArtifactVersionRow, String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&path).as_path(), &allowed_folders)?;
  let parsed = artifact_pipeline::parse_artifact(canonical_target.as_path())?;

  let id = uuid::Uuid::new_v4().to_string();
  let created_at = chrono::Utc::now().to_rfc3339();
  let metadata_json = serde_json::to_string(&parsed.metadata).map_err(|err| err.to_string())?;

  state
    .insert_artifact_version(
      &id,
      run_id.as_deref(),
      label.as_deref(),
      &parsed.path,
      &parsed.format,
      parsed.size_bytes as i64,
      &parsed.summary,
      &parsed.preview,
      &metadata_json,
      &created_at,
    )
    .map_err(|err| err.to_string())?;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "artifactVersionId": id,
    "runId": run_id,
    "label": label,
    "sourcePath": parsed.path,
    "format": parsed.format,
    "sizeBytes": parsed.size_bytes,
  });
  let _ = audit::append_audit_event(app_data_dir, "file_safety", "save_artifact_version", Some(details));

  Ok(ArtifactVersionRow {
    id,
    run_id,
    label,
    source_path: parsed.path,
    format: parsed.format,
    size_bytes: parsed.size_bytes as i64,
    summary: parsed.summary,
    preview: parsed.preview,
    metadata: parsed.metadata,
    created_at,
  })
}

#[tauri::command]
fn fs_list_artifact_versions(
  state: tauri::State<'_, Arc<Database>>,
  limit: Option<u32>,
) -> Result<Vec<ArtifactVersionRow>, String> {
  let bounded_limit = limit.unwrap_or(30).clamp(1, 200) as i64;

  state
    .list_artifact_versions(bounded_limit)
    .map_err(|err| err.to_string())
    .map(|rows| {
      rows
        .into_iter()
        .map(
          |(id, run_id, label, source_path, format, size_bytes, summary, preview, metadata_json, created_at)| {
            let metadata: Value = serde_json::from_str(&metadata_json).unwrap_or_else(|_| serde_json::json!({}));
            ArtifactVersionRow {
              id,
              run_id,
              label,
              source_path,
              format,
              size_bytes,
              summary,
              preview,
              metadata,
              created_at,
            }
          },
        )
        .collect()
    })
}

#[tauri::command]
fn fs_export_artifact_version(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  artifact_version_id: String,
  target_dir: String,
  export_format: String,
) -> Result<ArtifactExportRow, String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_dir = file_safety::ensure_path_allowed(PathBuf::from(&target_dir).as_path(), &allowed_folders)?;
  fs::create_dir_all(&canonical_dir).map_err(|err| err.to_string())?;

  let version = state
    .get_artifact_version_by_id(&artifact_version_id)
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "artifact version not found".to_string())?;

  let (
    version_id,
    run_id,
    label,
    source_path,
    source_format,
    size_bytes,
    summary,
    preview,
    metadata_json,
    _created_at,
  ) = version;

  let format = export_format.trim().to_lowercase();
  let extension = match format.as_str() {
    "json" => "json",
    "md" | "markdown" => "md",
    "txt" | "text" => "txt",
    "pdf" => "pdf",
    "docx" => "docx",
    "xlsx" => "xlsx",
    "pptx" => "pptx",
    _ => return Err("unsupported export format (allowed: json, md, txt, pdf, docx, xlsx, pptx)".to_string()),
  };

  let source_stem = PathBuf::from(&source_path)
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("artifact")
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' })
    .collect::<String>();

  let short_id: String = version_id.chars().take(8).collect();
  let file_name = format!("{}_{}_export.{}", source_stem, short_id, extension);
  let target_path = canonical_dir.join(file_name);

  let metadata = serde_json::from_str::<Value>(&metadata_json).unwrap_or_else(|_| serde_json::json!({}));

  let written_size = if matches!(format.as_str(), "json" | "md" | "markdown" | "txt" | "text") {
    let content = match format.as_str() {
      "json" => serde_json::to_string_pretty(&serde_json::json!({
        "artifactVersionId": version_id,
        "runId": run_id,
        "label": label,
        "sourcePath": source_path,
        "sourceFormat": source_format,
        "sourceSizeBytes": size_bytes,
        "summary": summary,
        "preview": preview,
        "metadata": metadata,
      }))
      .map_err(|err| err.to_string())?,
      "md" | "markdown" => format!(
        "# Artefakt-Export\n\n- Artefakt-Version: {}\n- Run-ID: {}\n- Label: {}\n- Quelle: {}\n- Format: {}\n- Groesse: {} Bytes\n\n## Summary\n\n{}\n\n## Preview\n\n```\n{}\n```\n",
        version_id,
        run_id.clone().unwrap_or_else(|| "-".to_string()),
        label.clone().unwrap_or_else(|| "-".to_string()),
        source_path,
        source_format,
        size_bytes,
        summary,
        preview,
      ),
      _ => format!(
        "Artefakt-Version: {}\nRun-ID: {}\nLabel: {}\nQuelle: {}\nFormat: {}\nGroesse: {} Bytes\n\nSummary:\n{}\n\nPreview:\n{}\n",
        version_id,
        run_id.clone().unwrap_or_else(|| "-".to_string()),
        label.clone().unwrap_or_else(|| "-".to_string()),
        source_path,
        source_format,
        size_bytes,
        summary,
        preview,
      ),
    };

    fs::write(&target_path, &content).map_err(|err| err.to_string())?;
    content.len() as i64
  } else {
    let native_input = cowork_features::ArtifactVersionExportInput {
      artifact_version_id: version_id.clone(),
      run_id: run_id.clone(),
      label: label.clone(),
      source_path: source_path.clone(),
      source_format: source_format.clone(),
      source_size_bytes: size_bytes,
      summary: summary.clone(),
      preview: preview.clone(),
      metadata,
    };
    cowork_features::export_artifact_version_native(target_path.as_path(), &format, &native_input)?;
    fs::metadata(&target_path).map_err(|err| err.to_string())?.len() as i64
  };
  let created_at = chrono::Utc::now().to_rfc3339();
  let export_id = uuid::Uuid::new_v4().to_string();

  state
    .insert_artifact_export(
      &export_id,
      &version_id,
      &format,
      &target_path.display().to_string(),
      written_size,
      &created_at,
    )
    .map_err(|err| err.to_string())?;

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "exportId": export_id,
    "artifactVersionId": version_id,
    "format": format,
    "targetPath": target_path.display().to_string(),
    "sizeBytes": written_size,
  });
  let _ = audit::append_audit_event(app_data_dir, "artifact_pipeline", "export_artifact_version", Some(details));

  Ok(ArtifactExportRow {
    id: export_id,
    artifact_version_id: version_id,
    export_format: format,
    target_path: target_path.display().to_string(),
    size_bytes: written_size,
    created_at,
    source_path,
    run_id,
    label,
    source_format,
  })
}

#[tauri::command]
fn fs_list_artifact_exports(
  state: tauri::State<'_, Arc<Database>>,
  limit: Option<u32>,
) -> Result<Vec<ArtifactExportRow>, String> {
  let bounded_limit = limit.unwrap_or(30).clamp(1, 200) as i64;
  state
    .list_artifact_exports(bounded_limit)
    .map_err(|err| err.to_string())
    .map(|rows| {
      rows
        .into_iter()
        .map(
          |(id, artifact_version_id, export_format, target_path, size_bytes, created_at, source_path, run_id, label, source_format)| {
            ArtifactExportRow {
              id,
              artifact_version_id,
              export_format,
              target_path,
              size_bytes,
              created_at,
              source_path,
              run_id,
              label,
              source_format,
            }
          },
        )
        .collect()
    })
}

#[tauri::command]
async fn task_run_sub_agents(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  request: cowork_features::SubAgentRequest,
) -> Result<cowork_features::SubAgentRunResponse, String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let mut canonical_paths = Vec::new();

  for path in &request.paths {
    let canonical = file_safety::ensure_path_allowed(PathBuf::from(path).as_path(), &allowed_folders)?;
    canonical_paths.push(canonical);
  }

  let response = cowork_features::run_sub_agents(request, canonical_paths).await;
  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "totalItems": response.total_items,
    "successfulItems": response.successful_items,
    "failedItems": response.failed_items,
    "parallelism": response.parallelism,
    "durationMs": response.duration_ms,
  });
  let _ = audit::append_audit_event(app_data_dir, "task_engine", "run_sub_agents", Some(details));

  Ok(response)
}

#[tauri::command]
fn fs_generate_pro_outputs(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  request: cowork_features::ProOutputRequest,
) -> Result<cowork_features::ProOutputResponse, String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let csv_path = file_safety::ensure_path_allowed(PathBuf::from(&request.csv_path).as_path(), &allowed_folders)?;
  let output_dir = file_safety::ensure_path_allowed(PathBuf::from(&request.output_dir).as_path(), &allowed_folders)?;

  let response = cowork_features::generate_pro_outputs(request, csv_path.as_path(), output_dir.as_path())?;
  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let details = serde_json::json!({
    "csvPath": response.csv_path,
    "outputDir": response.output_dir,
    "generatedFiles": response.generated_files,
    "rows": response.rows,
    "columns": response.columns,
    "numericColumns": response.numeric_columns,
  });
  let _ = audit::append_audit_event(app_data_dir, "artifact_pipeline", "generate_pro_outputs", Some(details));

  Ok(response)
}

fn map_scheduled_task_row(
  row: (String, String, String, String, bool, Option<String>, Option<String>, String, String),
) -> ScheduledTaskRow {
  let (id, name, prompt, schedule_expr, active, last_run_at, next_run_at, created_at, updated_at) = row;
  ScheduledTaskRow {
    id,
    name,
    prompt,
    schedule_expr,
    active,
    last_run_at,
    next_run_at,
    created_at,
    updated_at,
  }
}

fn run_scheduled_task_once(
  app: &tauri::AppHandle,
  database: &Arc<Database>,
  task_id: &str,
  task_name: &str,
  task_prompt: &str,
  schedule_expr: &str,
) {
  let started_at = chrono::Utc::now().to_rfc3339();
  let run_id = uuid::Uuid::new_v4().to_string();
  let plan_result = tauri::async_runtime::block_on(generate_plan_internal(None, task_prompt.to_string()));
  let finished_at = chrono::Utc::now().to_rfc3339();

  let next_run_at = scheduler::next_run_from_expression(schedule_expr, chrono::Utc::now())
    .ok()
    .map(|next| next.to_rfc3339());

  match plan_result {
    Ok(plan) => {
      let result_json = serde_json::to_string(&plan).unwrap_or_else(|_| String::new());
      let _ = database.insert_scheduled_run(
        &run_id,
        task_id,
        "succeeded",
        &started_at,
        Some(&finished_at),
        Some(&result_json),
        None,
      );
      let _ = database.update_scheduled_task_runtime(task_id, Some(&finished_at), next_run_at.as_deref());

      if let Ok(app_data_dir) = app.path().app_data_dir() {
        let details = serde_json::json!({
          "taskId": task_id,
          "taskName": task_name,
          "runId": run_id,
          "status": "succeeded",
        });
        let _ = audit::append_audit_event(app_data_dir, "scheduler", "task_run_completed", Some(details));
      }
    }
    Err(err) => {
      let error_text = err.to_string();
      let _ = database.insert_scheduled_run(
        &run_id,
        task_id,
        "failed",
        &started_at,
        Some(&finished_at),
        None,
        Some(&error_text),
      );
      let _ = database.update_scheduled_task_runtime(task_id, Some(&finished_at), next_run_at.as_deref());

      if let Ok(app_data_dir) = app.path().app_data_dir() {
        let details = serde_json::json!({
          "taskId": task_id,
          "taskName": task_name,
          "runId": run_id,
          "status": "failed",
          "error": error_text,
        });
        let _ = audit::append_audit_event(app_data_dir, "scheduler", "task_run_completed", Some(details));
      }
    }
  }
}

fn start_scheduler_worker(app: tauri::AppHandle, database: Arc<Database>) {
  std::thread::spawn(move || loop {
    let now = chrono::Utc::now().to_rfc3339();
    if let Ok(due_tasks) = database.list_due_scheduled_tasks(&now) {
      for (task_id, task_name, task_prompt, schedule_expr, _) in due_tasks {
        run_scheduled_task_once(&app, &database, &task_id, &task_name, &task_prompt, &schedule_expr);
      }
    }

    std::thread::sleep(Duration::from_secs(30));
  });
}

#[tauri::command]
fn scheduler_upsert_task(
  state: tauri::State<'_, Arc<Database>>,
  request: ScheduledTaskUpsertRequest,
) -> Result<ScheduledTaskRow, String> {
  let now = chrono::Utc::now();
  let now_text = now.to_rfc3339();
  let existing_task = state
    .list_scheduled_tasks()
    .map_err(|err| err.to_string())?
    .into_iter()
    .find(|row| row.0 == request.id);

  let next_run_at = if request.active {
    Some(
      scheduler::next_run_from_expression(&request.schedule_expr, now)
        .map_err(|err| err.to_string())?
        .to_rfc3339(),
    )
  } else {
    None
  };

  let last_run_at = existing_task.and_then(|row| row.5);

  state
    .upsert_scheduled_task(
      &request.id,
      &request.name,
      &request.prompt,
      &request.schedule_expr,
      request.active,
      last_run_at.as_deref(),
      next_run_at.as_deref(),
      &now_text,
    )
    .map_err(|err| err.to_string())?;

  state
    .list_scheduled_tasks()
    .map_err(|err| err.to_string())?
    .into_iter()
    .find(|row| row.0 == request.id)
    .map(map_scheduled_task_row)
    .ok_or_else(|| "scheduled task not found after upsert".to_string())
}

#[tauri::command]
fn scheduler_list_tasks(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<ScheduledTaskRow>, String> {
  state
    .list_scheduled_tasks()
    .map_err(|err| err.to_string())
    .map(|rows| rows.into_iter().map(map_scheduled_task_row).collect())
}

#[tauri::command]
fn scheduler_delete_task(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_scheduled_task(&id).map_err(|err| err.to_string())
}

#[tauri::command]
fn scheduler_set_task_active(
  state: tauri::State<'_, Arc<Database>>,
  request: ScheduledTaskToggleRequest,
) -> Result<(), String> {
  let task_row = state
    .list_scheduled_tasks()
    .map_err(|err| err.to_string())?
    .into_iter()
    .find(|row| row.0 == request.id)
    .ok_or_else(|| "scheduled task not found".to_string())?;

  let next_run_at = if request.active {
    Some(
      scheduler::next_run_from_expression(&task_row.3, chrono::Utc::now())
        .map_err(|err| err.to_string())?
        .to_rfc3339(),
    )
  } else {
    None
  };

  state
    .set_scheduled_task_active(&request.id, request.active, next_run_at.as_deref())
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn scheduler_run_task_now(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  id: String,
) -> Result<(), String> {
  let task_row = state
    .list_scheduled_tasks()
    .map_err(|err| err.to_string())?
    .into_iter()
    .find(|row| row.0 == id)
    .ok_or_else(|| "scheduled task not found".to_string())?;

  let database = state.inner().clone();
  run_scheduled_task_once(&app, &database, &task_row.0, &task_row.1, &task_row.2, &task_row.3);
  Ok(())
}

#[tauri::command]
fn scheduler_list_runs(
  state: tauri::State<'_, Arc<Database>>,
  limit: Option<u32>,
) -> Result<Vec<ScheduledRunRow>, String> {
  let bounded_limit = limit.unwrap_or(30).clamp(1, 200) as i64;
  state
    .list_scheduled_runs(bounded_limit)
    .map_err(|err| err.to_string())
    .map(|rows| {
      rows
        .into_iter()
        .map(|(id, task_id, status, started_at, finished_at, result, error)| ScheduledRunRow {
          id,
          task_id,
          status,
          started_at,
          finished_at,
          result,
          error,
        })
        .collect()
    })
}

#[tauri::command]
fn policy_get(state: tauri::State<'_, Arc<Database>>) -> Result<PolicyStatePayload, String> {
  load_policy_state(&state)
}

#[tauri::command]
fn policy_set(
  state: tauri::State<'_, Arc<Database>>,
  request: PolicySetRequest,
) -> Result<PolicyStatePayload, String> {
  state
    .set_policy_flag(POLICY_FLAG_STRICT, request.flags.strict_policy_enforcement)
    .map_err(|err| err.to_string())?;
  state
    .set_policy_flag(POLICY_FLAG_TOOL_DISPATCHER, request.flags.allow_tool_dispatcher)
    .map_err(|err| err.to_string())?;
  state
    .set_policy_flag(POLICY_FLAG_MCP, request.flags.allow_mcp_tool_calls)
    .map_err(|err| err.to_string())?;
  state
    .set_policy_flag(POLICY_FLAG_WEB_FETCH, request.flags.allow_web_fetch)
    .map_err(|err| err.to_string())?;
  state
    .set_policy_flag(POLICY_FLAG_FILE_READ, request.flags.allow_file_read_extraction)
    .map_err(|err| err.to_string())?;
  state
    .set_policy_flag(POLICY_FLAG_AUTO_COMPACT, request.flags.auto_compact_long_context)
    .map_err(|err| err.to_string())?;
  state
    .set_policy_flag(POLICY_FLAG_SHELL_EXECUTION, request.flags.allow_shell_execution)
    .map_err(|err| err.to_string())?;
  state
    .set_policy_flag(POLICY_FLAG_WEB_SEARCH, request.flags.allow_web_search)
    .map_err(|err| err.to_string())?;

  state
    .replace_policy_deny_rules(&request.deny_rules)
    .map_err(|err| err.to_string())?;

  load_policy_state(&state)
}

#[tauri::command]
fn policy_evaluate(
  state: tauri::State<'_, Arc<Database>>,
  request: PolicyEvaluateRequest,
) -> Result<PolicyEvaluateResponse, String> {
  let policy = load_policy_state(&state)?;
  let flag_allowed = match request.requested_flag.as_deref() {
    Some(POLICY_FLAG_TOOL_DISPATCHER) => policy.flags.allow_tool_dispatcher,
    Some(POLICY_FLAG_MCP) => policy.flags.allow_mcp_tool_calls,
    Some(POLICY_FLAG_WEB_FETCH) => policy.flags.allow_web_fetch,
    Some(POLICY_FLAG_FILE_READ) => policy.flags.allow_file_read_extraction,
    Some(POLICY_FLAG_AUTO_COMPACT) => policy.flags.auto_compact_long_context,
    Some(POLICY_FLAG_SHELL_EXECUTION) => policy.flags.allow_shell_execution,
    Some(POLICY_FLAG_WEB_SEARCH) => policy.flags.allow_web_search,
    _ => true,
  };

  match enforce_tool_policy(&policy, &request.tool, &request.target, flag_allowed) {
    Ok(_) => Ok(PolicyEvaluateResponse {
      allowed: true,
      reason: "allowed".to_string(),
    }),
    Err(err) => Ok(PolicyEvaluateResponse {
      allowed: false,
      reason: err,
    }),
  }
}

#[tauri::command]
fn engine_run_create(
  state: tauri::State<'_, Arc<Database>>,
  request: EngineRunCreateRequest,
) -> Result<(), String> {
  state
    .insert_engine_run(
      &request.id,
      request.parent_run_id.as_deref(),
      request.thread_id.as_deref(),
      request.session_id.as_deref(),
      &request.title,
      request.input_summary.as_deref(),
      request.status.as_deref().unwrap_or("pending"),
      request.phase.as_deref().unwrap_or("queued"),
      request.cwd.as_deref(),
      request.model.as_deref(),
      request.provider.as_deref(),
      request.retry_count.unwrap_or(0),
      request.resumed_from_run_id.as_deref(),
      request.checkpoint_json.as_deref(),
      request.metadata_json.as_deref(),
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn engine_run_update(
  state: tauri::State<'_, Arc<Database>>,
  request: EngineRunUpdateRequest,
) -> Result<(), String> {
  state
    .update_engine_run(
      &request.id,
      request.status.as_deref(),
      request.phase.as_deref(),
      request.checkpoint_json.as_deref(),
      request.result_summary.as_deref(),
      request.error.as_deref(),
      request.metadata_json.as_deref(),
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn engine_run_get(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
) -> Result<Option<db::EngineRunRow>, String> {
  state.get_engine_run(&id).map_err(|err| err.to_string())
}

#[tauri::command]
fn engine_run_list(
  state: tauri::State<'_, Arc<Database>>,
  limit: Option<i64>,
  status: Option<String>,
) -> Result<Vec<db::EngineRunRow>, String> {
  state
    .list_engine_runs(limit.unwrap_or(100).clamp(1, 500), status.as_deref())
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn engine_run_cancel(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
) -> Result<(), String> {
  if let Some(sandbox) = state
    .get_worker_sandbox_by_run(&id)
    .map_err(|err| err.to_string())?
  {
    let _ = state.update_worker_sandbox(&sandbox.id, Some("canceled"), None);
  }
  state
    .update_engine_run(&id, Some("canceled"), Some("canceled"), None, None, None, None)
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn engine_run_resume(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
) -> Result<(), String> {
  let existing = state
    .get_engine_run(&id)
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "run not found".to_string())?;

  if existing.checkpoint_json.is_none() {
    return Err("run hat keinen checkpoint".to_string());
  }

  state
    .update_engine_run(
      &id,
      Some("running"),
      Some("resumed"),
      existing.checkpoint_json.as_deref(),
      None,
      None,
      None,
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn engine_run_retry(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
) -> Result<String, String> {
  let existing = state
    .get_engine_run(&id)
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "run not found".to_string())?;
  let new_id = uuid::Uuid::new_v4().to_string();

  state
    .insert_engine_run(
      &new_id,
      existing.parent_run_id.as_deref(),
      existing.thread_id.as_deref(),
      existing.session_id.as_deref(),
      &existing.title,
      existing.input_summary.as_deref(),
      "pending",
      "retry_queued",
      existing.cwd.as_deref(),
      existing.model.as_deref(),
      existing.provider.as_deref(),
      existing.retry_count + 1,
      Some(&id),
      existing.checkpoint_json.as_deref(),
      existing.metadata_json.as_deref(),
    )
    .map_err(|err| err.to_string())?;

  Ok(new_id)
}

#[tauri::command]
fn engine_run_checkpoint_add(
  state: tauri::State<'_, Arc<Database>>,
  request: EngineRunCheckpointRequest,
) -> Result<(), String> {
  state
    .insert_engine_run_checkpoint(
      &uuid::Uuid::new_v4().to_string(),
      &request.run_id,
      &request.label,
      &request.snapshot_json,
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn engine_run_checkpoint_list(
  state: tauri::State<'_, Arc<Database>>,
  run_id: String,
  limit: Option<i64>,
) -> Result<Vec<db::EngineRunCheckpointRow>, String> {
  state
    .list_engine_run_checkpoints(&run_id, limit.unwrap_or(20).clamp(1, 200))
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn runtime_instruction_upsert(
  state: tauri::State<'_, Arc<Database>>,
  request: RuntimeInstructionUpsertRequest,
) -> Result<(), String> {
  state
    .upsert_runtime_instruction(
      &request.id,
      &request.scope_type,
      request.scope_ref.as_deref(),
      &request.title,
      &request.content,
      request.enabled.unwrap_or(true),
      request.priority.unwrap_or(100),
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn runtime_instruction_delete(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
) -> Result<(), String> {
  state.delete_runtime_instruction(&id).map_err(|err| err.to_string())
}

#[tauri::command]
fn runtime_instruction_list(
  state: tauri::State<'_, Arc<Database>>,
  scope_type: Option<String>,
  enabled_only: Option<bool>,
) -> Result<Vec<db::RuntimeInstructionRow>, String> {
  state
    .list_runtime_instructions(scope_type.as_deref(), enabled_only.unwrap_or(true))
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn runtime_instruction_effective(
  state: tauri::State<'_, Arc<Database>>,
  cwd: String,
) -> Result<Vec<db::RuntimeInstructionRow>, String> {
  let rows = state
    .list_runtime_instructions(None, true)
    .map_err(|err| err.to_string())?;
  Ok(filter_runtime_instructions_for_cwd(rows, &cwd))
}

#[tauri::command]
fn worker_sandbox_create(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  request: WorkerSandboxCreateRequest,
) -> Result<db::WorkerSandboxRow, String> {
  let mode = request.mode.unwrap_or_else(|| "workspace_copy".to_string());
  if mode != "workspace_copy" {
    return Err(format!("sandbox mode '{}' wird noch nicht unterstuetzt", mode));
  }

  let source_cwd = PathBuf::from(&request.source_cwd)
    .canonicalize()
    .map_err(|err| err.to_string())?;
  if !source_cwd.is_dir() {
    return Err("source_cwd muss ein verzeichnis sein".to_string());
  }

  let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  let backend = if let Some(backend_id) = request.backend_id.as_deref() {
    state
      .list_terminal_backends()
      .map_err(|err| err.to_string())?
      .into_iter()
      .find(|item| item.id == backend_id)
      .ok_or_else(|| format!("backend '{}' nicht gefunden", backend_id))?
  } else {
    terminal_backends::ensure_default_local_backend(&state)?
  };

  let workspace = worker_sandbox::prepare_workspace_snapshot(&app_data_dir, &request.id, &source_cwd)?;
  let allowed_roots_json = serde_json::to_string(&vec![workspace.workspace_root.clone()])
    .map_err(|err| err.to_string())?;
  let read_only_roots_json = if request.allow_file_write.unwrap_or(true) {
    None
  } else {
    Some(allowed_roots_json.clone())
  };

  let metadata_json = serde_json::json!({
    "copiedFiles": workspace.copied_files,
    "skippedFiles": workspace.skipped_files,
    "skippedDirs": workspace.skipped_dirs,
    "sourceCwd": source_cwd.display().to_string(),
    "sandboxRoot": workspace.sandbox_root,
    "requestedMetadata": request.metadata_json,
  })
  .to_string();

  state
    .insert_worker_sandbox(
      &request.id,
      &request.run_id,
      request.parent_run_id.as_deref(),
      Some(&backend.id),
      "active",
      &mode,
      &source_cwd.display().to_string(),
      &workspace.workspace_root,
      &allowed_roots_json,
      read_only_roots_json.as_deref(),
      request.allow_file_read.unwrap_or(true),
      request.allow_file_write.unwrap_or(true),
      request.allow_shell_execution.unwrap_or(true),
      request.allow_web_fetch.unwrap_or(false),
      request.allow_web_search.unwrap_or(false),
      request.allow_mcp.unwrap_or(false),
      request.env_json.as_deref(),
      Some(&metadata_json),
    )
    .map_err(|err| err.to_string())?;

  let event_payload = serde_json::json!({
    "sandboxId": request.id,
    "workspaceRoot": workspace.workspace_root,
    "backendId": backend.id,
    "copiedFiles": workspace.copied_files,
    "skippedFiles": workspace.skipped_files,
  })
  .to_string();
  let _ = state.insert_engine_run_event(
    &uuid::Uuid::new_v4().to_string(),
    &request.run_id,
    "worker_sandbox_created",
    Some(&event_payload),
  );

  state
    .get_worker_sandbox(&request.id)
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "sandbox konnte nicht geladen werden".to_string())
}

#[tauri::command]
fn worker_sandbox_get(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
) -> Result<Option<db::WorkerSandboxRow>, String> {
  state.get_worker_sandbox(&id).map_err(|err| err.to_string())
}

#[tauri::command]
fn worker_sandbox_get_for_run(
  state: tauri::State<'_, Arc<Database>>,
  run_id: String,
) -> Result<Option<db::WorkerSandboxRow>, String> {
  state.get_worker_sandbox_by_run(&run_id).map_err(|err| err.to_string())
}

#[tauri::command]
fn worker_sandbox_list(
  state: tauri::State<'_, Arc<Database>>,
  limit: Option<i64>,
  status: Option<String>,
) -> Result<Vec<db::WorkerSandboxRow>, String> {
  state
    .list_worker_sandboxes(limit.unwrap_or(100).clamp(1, 500), status.as_deref())
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn worker_sandbox_update(
  state: tauri::State<'_, Arc<Database>>,
  request: WorkerSandboxUpdateRequest,
) -> Result<(), String> {
  state
    .update_worker_sandbox(
      &request.id,
      request.status.as_deref(),
      request.metadata_json.as_deref(),
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn worker_sandbox_destroy(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  remove_files: Option<bool>,
) -> Result<(), String> {
  if remove_files.unwrap_or(true) {
    let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    worker_sandbox::destroy_workspace_snapshot(&app_data_dir, &id)?;
  }
  state
    .update_worker_sandbox(&id, Some("destroyed"), None)
    .map_err(|err| err.to_string())
}

// -- Helpers ----------------------------------------------------------------

fn default_true() -> bool {
  true
}

fn default_policy_flags() -> PolicyFlagsPayload {
  PolicyFlagsPayload {
    strict_policy_enforcement: true,
    allow_tool_dispatcher: true,
    allow_mcp_tool_calls: true,
    allow_web_fetch: true,
    allow_file_read_extraction: true,
    auto_compact_long_context: true,
    allow_shell_execution: true,
    allow_web_search: true,
  }
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
  if pattern == "*" {
    return true;
  }

  if !pattern.contains('*') {
    return pattern.eq_ignore_ascii_case(text);
  }

  let mut remainder = text.to_lowercase();
  let pattern_lower = pattern.to_lowercase();
  let parts: Vec<&str> = pattern_lower.split('*').collect();
  let anchored_start = !pattern_lower.starts_with('*');
  let anchored_end = !pattern_lower.ends_with('*');

  if anchored_start {
    let first = parts.first().copied().unwrap_or("");
    if !remainder.starts_with(first) {
      return false;
    }
    remainder = remainder[first.len()..].to_string();
  }

  let mut idx = if anchored_start { 1 } else { 0 };
  let mut end_guard = parts.len();
  if anchored_end && !parts.is_empty() {
    end_guard -= 1;
  }

  while idx < end_guard {
    let part = parts[idx];
    if part.is_empty() {
      idx += 1;
      continue;
    }
    if let Some(found_at) = remainder.find(part) {
      remainder = remainder[found_at + part.len()..].to_string();
      idx += 1;
      continue;
    }
    return false;
  }

  if anchored_end {
    let last = parts.last().copied().unwrap_or("");
    return remainder.ends_with(last);
  }

  true
}

fn matches_deny_rule(rule: &str, tool: &str, target: &str) -> bool {
  let trimmed = rule.trim();
  if trimmed.is_empty() {
    return false;
  }

  let (rule_tool, rule_target) = if let Some(split_idx) = trimmed.find(':') {
    (&trimmed[..split_idx], &trimmed[split_idx + 1..])
  } else {
    (trimmed, "*")
  };

  wildcard_match(rule_tool, tool) && wildcard_match(rule_target, target)
}

fn enforce_tool_policy(
  policy: &PolicyStatePayload,
  tool: &str,
  target: &str,
  tool_allowed_by_flag: bool,
) -> Result<(), String> {
  if !policy.flags.strict_policy_enforcement {
    return Ok(());
  }

  if !tool_allowed_by_flag {
    return Err(format!("policy blockiert {}", tool));
  }

  if policy
    .deny_rules
    .iter()
    .any(|rule| matches_deny_rule(rule, tool, target))
  {
    return Err(format!("deny rule blockiert {}:{}", tool, target));
  }

  Ok(())
}

fn load_run_sandbox(
  state: &Arc<Database>,
  run_id: Option<&str>,
) -> Result<Option<db::WorkerSandboxRow>, String> {
  let Some(active_run_id) = run_id else {
    return Ok(None);
  };
  state
    .get_worker_sandbox_by_run(active_run_id)
    .map_err(|err| err.to_string())
}

fn parse_json_string_array(input: &str) -> Result<Vec<String>, String> {
  serde_json::from_str::<Vec<String>>(input).map_err(|err| err.to_string())
}

fn enforce_worker_sandbox_flag(
  sandbox: &db::WorkerSandboxRow,
  allowed: bool,
  capability: &str,
) -> Result<(), String> {
  if sandbox.status != "active" {
    return Err(format!("sandbox {} ist nicht aktiv", sandbox.id));
  }
  if !allowed {
    return Err(format!("sandbox {} blockiert {}", sandbox.id, capability));
  }
  Ok(())
}

fn resolve_allowed_folders_for_run(
  state: &Arc<Database>,
  run_id: Option<&str>,
) -> Result<Vec<String>, String> {
  if let Some(sandbox) = load_run_sandbox(state, run_id)? {
    enforce_worker_sandbox_flag(&sandbox, sandbox.allow_file_read, "dateizugriff")?;
    return parse_json_string_array(&sandbox.allowed_roots_json);
  }

  state.list_allowed_folders().map_err(|err| err.to_string())
}

fn ensure_run_file_access(
  state: &Arc<Database>,
  run_id: Option<&str>,
  path: &str,
  write_access: bool,
) -> Result<PathBuf, String> {
  if let Some(sandbox) = load_run_sandbox(state, run_id)? {
    enforce_worker_sandbox_flag(&sandbox, sandbox.allow_file_read, "dateilesen")?;
    if write_access {
      enforce_worker_sandbox_flag(&sandbox, sandbox.allow_file_write, "dateischreiben")?;
    }
    let allowed_roots = parse_json_string_array(&sandbox.allowed_roots_json)?;
    let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(path).as_path(), &allowed_roots)?;
    if write_access {
      if let Some(read_only_roots_json) = sandbox.read_only_roots_json.as_deref() {
        let read_only_roots = parse_json_string_array(read_only_roots_json)?;
        if !read_only_roots.is_empty()
          && file_safety::ensure_path_allowed(canonical_target.as_path(), &read_only_roots).is_ok()
        {
          return Err(format!("sandbox {} erlaubt nur lesen fuer {}", sandbox.id, path));
        }
      }
    }
    return Ok(canonical_target);
  }

  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  file_safety::ensure_path_allowed(PathBuf::from(path).as_path(), &allowed_folders)
}

fn ensure_run_cwd(
  state: &Arc<Database>,
  run_id: Option<&str>,
  requested_cwd: Option<&str>,
) -> Result<Option<String>, String> {
  let Some(sandbox) = load_run_sandbox(state, run_id)? else {
    return Ok(requested_cwd.map(|value| value.to_string()));
  };

  let allowed_roots = parse_json_string_array(&sandbox.allowed_roots_json)?;
  let base = requested_cwd.unwrap_or(sandbox.workspace_root.as_str());
  let canonical = file_safety::ensure_path_allowed(PathBuf::from(base).as_path(), &allowed_roots)?;
  Ok(Some(canonical.display().to_string()))
}

fn parse_env_vars_json(env_json: Option<&str>) -> Result<HashMap<String, String>, String> {
  match env_json {
    Some(text) if !text.trim().is_empty() => {
      serde_json::from_str::<HashMap<String, String>>(text).map_err(|err| err.to_string())
    }
    _ => Ok(HashMap::new()),
  }
}

fn load_policy_state(state: &Arc<Database>) -> Result<PolicyStatePayload, String> {
  let stored_flags = state.list_policy_flags().map_err(|err| err.to_string())?;
  let mut flags = default_policy_flags();

  for (key, value) in stored_flags {
    match key.as_str() {
      POLICY_FLAG_STRICT => flags.strict_policy_enforcement = value,
      POLICY_FLAG_TOOL_DISPATCHER => flags.allow_tool_dispatcher = value,
      POLICY_FLAG_MCP => flags.allow_mcp_tool_calls = value,
      POLICY_FLAG_WEB_FETCH => flags.allow_web_fetch = value,
      POLICY_FLAG_FILE_READ => flags.allow_file_read_extraction = value,
      POLICY_FLAG_AUTO_COMPACT => flags.auto_compact_long_context = value,
      POLICY_FLAG_SHELL_EXECUTION => flags.allow_shell_execution = value,
      POLICY_FLAG_WEB_SEARCH => flags.allow_web_search = value,
      _ => {}
    }
  }

  let deny_rules = state
    .list_policy_deny_rules()
    .map_err(|err| err.to_string())?;

  Ok(PolicyStatePayload { flags, deny_rules })
}

fn map_ollama_error(err: OllamaError) -> String {
  err.to_string()
}

fn map_mcp_error(err: McpError) -> String {
  err.to_string()
}

fn extract_html_title(input: &str) -> Option<String> {
  let lower = input.to_lowercase();
  let start = lower.find("<title>")? + "<title>".len();
  let end = lower[start..].find("</title>")? + start;
  Some(input[start..end].trim().to_string())
}

fn strip_html_like_content(input: &str) -> String {
  let mut output = String::new();
  let mut inside_tag = false;
  let mut previous_was_space = false;

  for ch in input.chars() {
    match ch {
      '<' => {
        inside_tag = true;
      }
      '>' => {
        inside_tag = false;
      }
      _ if !inside_tag => {
        let normalized = if ch.is_whitespace() { ' ' } else { ch };
        if normalized == ' ' {
          if !previous_was_space {
            output.push(' ');
          }
          previous_was_space = true;
        } else {
          output.push(normalized);
          previous_was_space = false;
        }
      }
      _ => {}
    }
  }

  output
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
  input.chars().take(max_chars).collect()
}

fn decode_html_entities(input: &str) -> String {
  input
    .replace("&amp;", "&")
    .replace("&quot;", "\"")
    .replace("&#x27;", "'")
    .replace("&#39;", "'")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
}

fn extract_anchor_href(fragment: &str) -> Option<String> {
  let href_idx = fragment.find("href=\"")? + 6;
  let href_rest = &fragment[href_idx..];
  let href_end = href_rest.find('"')?;
  Some(decode_html_entities(&href_rest[..href_end]))
}

fn extract_anchor_text(fragment: &str) -> Option<String> {
  let start = fragment.find('>')? + 1;
  let end = fragment[start..].find("</a>")? + start;
  Some(decode_html_entities(fragment[start..end].trim()))
}

fn parse_duckduckgo_results(body: &str, max_results: usize) -> Vec<WebSearchResultItem> {
  let mut results = Vec::new();
  let mut remainder = body;

  while results.len() < max_results {
    let Some(anchor_pos) = remainder.find("result__a") else {
      break;
    };
    remainder = &remainder[anchor_pos..];
    let Some(tag_end) = remainder.find("</a>") else {
      break;
    };
    let anchor = &remainder[..tag_end + 4];
    remainder = &remainder[tag_end + 4..];

    let Some(raw_href) = extract_anchor_href(anchor) else {
      continue;
    };
    let url = if let Some(idx) = raw_href.find("uddg=") {
      let encoded = &raw_href[idx + 5..];
      let candidate = format!("https://dummy.invalid/?uddg={}", encoded);
      url::Url::parse(&candidate)
        .ok()
        .and_then(|parsed| {
          parsed
            .query_pairs()
            .find(|(key, _)| key == "uddg")
            .map(|(_, value)| value.to_string())
        })
        .unwrap_or_else(|| raw_href.clone())
    } else {
      raw_href.clone()
    };
    let title = extract_anchor_text(anchor).unwrap_or_else(|| url.clone());

    let snippet = if let Some(snippet_idx) = remainder.find("result__snippet") {
      let snippet_rest = &remainder[snippet_idx..];
      if let Some(snippet_end) = snippet_rest.find("</a>") {
        strip_html_like_content(&snippet_rest[..snippet_end])
      } else if let Some(snippet_end) = snippet_rest.find("</div>") {
        strip_html_like_content(&snippet_rest[..snippet_end])
      } else {
        String::new()
      }
    } else {
      String::new()
    };

    results.push(WebSearchResultItem {
      title,
      url,
      snippet: snippet.trim().to_string(),
    });
  }

  results
}

fn emit_exec_chunk(app: &tauri::AppHandle, stream_id: Option<&str>, channel: &str, content: &str) {
  if let Some(active_stream_id) = stream_id {
    let payload = serde_json::json!({
      "streamId": active_stream_id,
      "channel": channel,
      "content": content,
    });
    let _ = app.emit("exec-command-chunk", payload);
  }
}

fn resolve_exec_runtime(
  state: &Arc<Database>,
  backend_id: Option<&str>,
  run_id: Option<&str>,
) -> Result<(Option<String>, HashMap<String, String>), String> {
  let mut shell_override: Option<String> = None;
  let mut env_vars: HashMap<String, String> = HashMap::new();

  if let Some(active_run_id) = run_id {
    if let Some(sandbox) = load_run_sandbox(state, Some(active_run_id))? {
      enforce_worker_sandbox_flag(&sandbox, sandbox.allow_shell_execution, "shell-ausfuehrung")?;
      env_vars.extend(parse_env_vars_json(sandbox.env_json.as_deref())?);
      env_vars.insert("OPEN_COWORK_SANDBOX_ID".to_string(), sandbox.id.clone());
      env_vars.insert("OPEN_COWORK_RUN_ID".to_string(), sandbox.run_id.clone());
    }
  }

  let selected_backend_id = if let Some(explicit_backend_id) = backend_id {
    Some(explicit_backend_id.to_string())
  } else if let Some(sandbox) = load_run_sandbox(state, run_id)? {
    sandbox.backend_id
  } else {
    None
  };

  if let Some(active_backend_id) = selected_backend_id.as_deref() {
    let backend = state
      .list_terminal_backends()
      .map_err(|err| err.to_string())?
      .into_iter()
      .find(|item| item.id == active_backend_id)
      .ok_or_else(|| format!("backend '{}' nicht gefunden", active_backend_id))?;

    if backend.backend_type != "local" {
      return Err(format!(
        "backend '{}' wird fuer sandboxed exec noch nicht unterstuetzt",
        backend.backend_type
      ));
    }

    let config = serde_json::from_str::<terminal_backends::LocalBackendConfig>(&backend.config_json)
      .map_err(|err| err.to_string())?;
    shell_override = config.shell;
    if let Some(backend_env) = config.env_vars {
      env_vars.extend(backend_env);
    }
  }

  Ok((shell_override, env_vars))
}

fn run_command_once(
  app: &tauri::AppHandle,
  stream_id: Option<&str>,
  command_text: &str,
  cwd: Option<&str>,
  timeout_ms: u64,
  shell_override: Option<&str>,
  env_vars: &HashMap<String, String>,
) -> Result<ExecCommandResponse, String> {
  let shell = shell_override.unwrap_or(if cfg!(target_os = "windows") {
    "powershell"
  } else {
    "sh"
  });

  let mut command = if cfg!(target_os = "windows") {
    let mut cmd = Command::new(shell);
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", command_text]);
    cmd
  } else {
    let mut cmd = Command::new(shell);
    cmd.args(["-c", command_text]);
    cmd
  };

  if let Some(dir) = cwd {
    command.current_dir(dir);
  }

  for (key, value) in env_vars {
    command.env(key, value);
  }

  command.stdout(Stdio::piped());
  command.stderr(Stdio::piped());

  let mut child = command.spawn().map_err(|err| err.to_string())?;
  let stdout = child.stdout.take().ok_or_else(|| "stdout pipe unavailable".to_string())?;
  let stderr = child.stderr.take().ok_or_else(|| "stderr pipe unavailable".to_string())?;

  let stream_for_stdout = stream_id.map(|value| value.to_string());
  let stream_for_stderr = stream_id.map(|value| value.to_string());
  let app_for_stdout = app.clone();
  let app_for_stderr = app.clone();

  let stdout_handle = thread::spawn(move || {
    let mut buffer = String::new();
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
      if let Ok(text) = line {
        buffer.push_str(&text);
        buffer.push('\n');
        emit_exec_chunk(&app_for_stdout, stream_for_stdout.as_deref(), "stdout", &text);
      }
    }
    buffer
  });

  let stderr_handle = thread::spawn(move || {
    let mut buffer = String::new();
    let reader = BufReader::new(stderr);
    for line in reader.lines() {
      if let Ok(text) = line {
        buffer.push_str(&text);
        buffer.push('\n');
        emit_exec_chunk(&app_for_stderr, stream_for_stderr.as_deref(), "stderr", &text);
      }
    }
    buffer
  });

  let wait_started = Instant::now();
  let mut timed_out = false;
  let exit_status = loop {
    match child.try_wait() {
      Ok(Some(status)) => break Some(status),
      Ok(None) => {
        if wait_started.elapsed().as_millis() as u64 >= timeout_ms {
          timed_out = true;
          let _ = child.kill();
          let _ = child.wait();
          break None;
        }
        thread::sleep(Duration::from_millis(50));
      }
      Err(err) => return Err(err.to_string()),
    }
  };

  let stdout_text = stdout_handle.join().unwrap_or_default();
  let stderr_text = stderr_handle.join().unwrap_or_default();
  let exit_code = exit_status.and_then(|status| status.code());
  let normalized_status = if timed_out {
    "timed_out"
  } else if exit_code == Some(0) {
    "success"
  } else if exit_code.is_some() {
    "error"
  } else {
    "terminated"
  };

  emit_exec_chunk(app, stream_id, "done", normalized_status);

  Ok(ExecCommandResponse {
    stdout: stdout_text,
    stderr: stderr_text,
    exit_code,
    timed_out,
    duration_ms: wait_started.elapsed().as_millis() as u64,
    attempts: 1,
    normalized_status: normalized_status.to_string(),
  })
}

fn filter_runtime_instructions_for_cwd(
  rows: Vec<db::RuntimeInstructionRow>,
  cwd: &str,
) -> Vec<db::RuntimeInstructionRow> {
  let normalized_cwd = cwd.replace('\\', "/").to_lowercase();

  rows
    .into_iter()
    .filter(|row| {
      if !row.enabled {
        return false;
      }
      match row.scope_type.as_str() {
        "global" => true,
        "workspace" => row.scope_ref.as_deref().map(|scope| normalized_cwd.starts_with(&scope.replace('\\', "/").to_lowercase())).unwrap_or(false),
        "folder" => row.scope_ref.as_deref().map(|scope| normalized_cwd.starts_with(&scope.replace('\\', "/").to_lowercase())).unwrap_or(false),
        _ => false,
      }
    })
    .collect()
}

fn configure_pdfium_search_paths(app: &tauri::AppHandle) {
  let mut candidates = Vec::new();

  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(
      resource_dir
        .join("resources")
        .join("pdfium")
        .join("bin")
        .join("pdfium.dll"),
    );
    candidates.push(
      resource_dir
        .join("pdfium")
        .join("bin")
        .join("pdfium.dll"),
    );
  }

  if let Ok(current_exe) = std::env::current_exe() {
    if let Some(exe_dir) = current_exe.parent() {
      candidates.push(exe_dir.join("pdfium.dll"));
      candidates.push(
        exe_dir
          .join("resources")
          .join("pdfium")
          .join("bin")
          .join("pdfium.dll"),
      );
    }
  }

  artifact_pipeline::set_pdfium_search_paths(candidates);
}

// -- Memory commands --------------------------------------------------------

#[tauri::command]
fn memory_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  scope: String,
  category: String,
  key: String,
  content: String,
  source_session_id: Option<String>,
  confidence: Option<f64>,
) -> Result<(), String> {
  memory_engine::validate_scope(&scope)?;
  let conf = confidence.unwrap_or(1.0);
  if memory_engine::is_duplicate_memory(&state, &scope, &category, &key, &content) {
    return Ok(());
  }
  state
    .upsert_memory_entry(&id, &scope, &category, &key, &content, source_session_id.as_deref(), conf)
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_delete(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_memory_entry(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_search(
  state: tauri::State<'_, Arc<Database>>,
  scope: Option<String>,
  category: Option<String>,
  keyword: Option<String>,
  limit: Option<i64>,
) -> Result<Vec<db::MemoryEntryRow>, String> {
  let lim = limit.unwrap_or(100);
  if let Some(ref kw) = keyword {
    state
      .search_memory_entries(kw, lim)
      .map_err(|e| e.to_string())
  } else {
    state
      .list_memory_entries(
        &scope.unwrap_or_else(|| "agent".to_string()),
        category.as_deref(),
        lim,
      )
      .map_err(|e| e.to_string())
  }
}

#[tauri::command]
fn memory_compact(
  state: tauri::State<'_, Arc<Database>>,
  scope: String,
  min_confidence: f64,
) -> Result<memory_engine::MemoryCompactResponse, String> {
  let db_arc = state.inner().clone();
  memory_engine::compact_low_confidence(&db_arc, &scope, min_confidence)
}

#[tauri::command]
fn memory_snapshot(
  state: tauri::State<'_, Arc<Database>>,
) -> Result<memory_engine::FrozenMemorySnapshot, String> {
  let db_arc = state.inner().clone();
  memory_engine::create_memory_snapshot(&db_arc)
}

#[tauri::command]
fn memory_hints(
  state: tauri::State<'_, Arc<Database>>,
) -> Result<Vec<memory_engine::MemoryHint>, String> {
  let db_arc = state.inner().clone();
  Ok(memory_engine::generate_memory_hints(&db_arc))
}

// -- User profile commands --------------------------------------------------

#[tauri::command]
fn user_profile_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  key: String,
  value: String,
  source: String,
  confidence: Option<f64>,
) -> Result<(), String> {
  state
    .upsert_user_profile(&id, &key, &value, &source, confidence.unwrap_or(1.0))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn user_profile_list(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<db::UserProfileRow>, String> {
  state.list_user_profile().map_err(|e| e.to_string())
}

#[tauri::command]
fn user_profile_delete(state: tauri::State<'_, Arc<Database>>, key: String) -> Result<(), String> {
  state.delete_user_profile_entry(&key).map_err(|e| e.to_string())
}

// -- Skill commands ---------------------------------------------------------

#[tauri::command]
fn skill_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  name: String,
  description: String,
  prompt_template: String,
  trigger_pattern: Option<String>,
  run_mode: Option<String>,
  auto_generated: Option<bool>,
  parent_skill_id: Option<String>,
  source_task_ids: Option<String>,
) -> Result<(), String> {
  state
    .upsert_skill(
      &id,
      &name,
      &description,
      &prompt_template,
      trigger_pattern.as_deref(),
      &run_mode.unwrap_or_else(|| "execute".to_string()),
      auto_generated.unwrap_or(false),
      parent_skill_id.as_deref(),
      source_task_ids.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn skill_list(state: tauri::State<'_, Arc<Database>>, limit: Option<i64>) -> Result<Vec<db::SkillRow>, String> {
  state.list_skills(limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
fn skill_delete(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_skill(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn skill_record_usage(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  success: bool,
  quality: Option<f64>,
) -> Result<(), String> {
  state
    .record_skill_usage(&id, success, quality.unwrap_or(0.0))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn skill_improve(
  state: tauri::State<'_, Arc<Database>>,
  skill_id: String,
  new_prompt_template: String,
  reason: String,
) -> Result<(), String> {
  state
    .improve_skill(&skill_id, &new_prompt_template, &reason)
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn skill_match(
  state: tauri::State<'_, Arc<Database>>,
  user_input: String,
) -> Result<Option<db::SkillRow>, String> {
  let db_arc = state.inner().clone();
  Ok(skill_engine::match_skill_for_input(&db_arc, &user_input))
}

#[tauri::command]
fn skill_auto_generate(
  state: tauri::State<'_, Arc<Database>>,
  task_title: String,
  task_prompt: String,
  task_steps_summary: String,
  task_outcome: String,
) -> Result<skill_engine::SkillAutoGenResult, String> {
  let db_arc = state.inner().clone();
  Ok(skill_engine::analyze_for_skill_generation(
    &db_arc,
    &task_title,
    &task_prompt,
    &task_steps_summary,
    &task_outcome,
  ))
}

// -- Session commands -------------------------------------------------------

#[tauri::command]
fn session_create(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  thread_id: Option<String>,
  title: String,
  model_used: Option<String>,
  provider: Option<String>,
  personality: Option<String>,
) -> Result<(), String> {
  state
    .insert_session(
      &id,
      thread_id.as_deref(),
      &title,
      None,
      model_used.as_deref(),
      provider.as_deref(),
      personality.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn session_end(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  summary: Option<String>,
  total_messages: Option<i32>,
  total_tokens_est: Option<i64>,
  outcome: Option<String>,
) -> Result<(), String> {
  state
    .end_session(
      &id,
      summary.as_deref(),
      total_messages.unwrap_or(0),
      total_tokens_est.unwrap_or(0),
      outcome.as_deref(),
      None,
      None,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn session_list(state: tauri::State<'_, Arc<Database>>, limit: Option<i64>) -> Result<Vec<db::SessionRow>, String> {
  state.list_sessions(limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_search(state: tauri::State<'_, Arc<Database>>, query: String, limit: Option<i64>) -> Result<Vec<db::SessionSearchResultRow>, String> {
  state
    .fulltext_search_sessions(&query, limit.unwrap_or(50))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn session_freeze_snapshot(
  state: tauri::State<'_, Arc<Database>>,
  session_id: String,
) -> Result<String, String> {
  let db_arc = state.inner().clone();
  let snapshot = memory_engine::create_memory_snapshot(&db_arc)?;
  let snapshot_json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
  state
    .save_session_snapshot(&session_id, &snapshot_json)
    .map_err(|e| e.to_string())?;
  Ok(snapshot_json)
}

// -- Learning outcome commands ----------------------------------------------

#[tauri::command]
fn learning_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  session_id: Option<String>,
  task_id: Option<String>,
  outcome_type: String,
  description: String,
  learned_pattern: Option<String>,
  confidence: Option<f64>,
) -> Result<(), String> {
  state
    .insert_learning_outcome(
      &id,
      session_id.as_deref(),
      task_id.as_deref(),
      &outcome_type,
      &description,
      learned_pattern.as_deref(),
      confidence.unwrap_or(1.0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn learning_list(state: tauri::State<'_, Arc<Database>>, limit: Option<i64>) -> Result<Vec<db::LearningOutcomeRow>, String> {
  state.list_learning_outcomes(limit.unwrap_or(100)).map_err(|e| e.to_string())
}

// -- Terminal backend commands ----------------------------------------------

#[tauri::command]
fn backend_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  name: String,
  backend_type: String,
  config_json: String,
) -> Result<(), String> {
  terminal_backends::validate_backend_type(&backend_type)?;
  terminal_backends::validate_backend_config(&backend_type, &config_json)?;
  state
    .upsert_terminal_backend(&id, &name, &backend_type, &config_json)
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn backend_list(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<db::TerminalBackendRow>, String> {
  state.list_terminal_backends().map_err(|e| e.to_string())
}

#[tauri::command]
fn backend_delete(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_terminal_backend(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn backend_exec(
  state: tauri::State<'_, Arc<Database>>,
  backend_id: String,
  command: String,
  working_dir: Option<String>,
  timeout_ms: Option<u64>,
) -> Result<terminal_backends::BackendExecResponse, String> {
  let db_arc = state.inner().clone();
  terminal_backends::dispatch_exec(&db_arc, &backend_id, &command, working_dir.as_deref(), timeout_ms)
}

#[tauri::command]
fn backend_ensure_local(
  state: tauri::State<'_, Arc<Database>>,
) -> Result<db::TerminalBackendRow, String> {
  let db_arc = state.inner().clone();
  terminal_backends::ensure_default_local_backend(&db_arc)
}

// -- Process manager commands -----------------------------------------------

#[tauri::command]
fn process_start(
  state: tauri::State<'_, Arc<Database>>,
  label: String,
  command: String,
  backend_id: Option<String>,
  requires_admin: Option<bool>,
) -> Result<process_manager::ProcessStartResult, String> {
  let db_arc = state.inner().clone();
  let request = process_manager::ProcessStartRequest {
    label,
    command,
    backend_id,
    requires_admin: requires_admin.unwrap_or(false),
  };
  Ok(process_manager::start_process(&db_arc, &request))
}

#[tauri::command]
fn process_stop(state: tauri::State<'_, Arc<Database>>, process_id: String) -> Result<(), String> {
  let db_arc = state.inner().clone();
  process_manager::stop_process(&db_arc, &process_id)
}

#[tauri::command]
fn process_approve(
  state: tauri::State<'_, Arc<Database>>,
  process_id: String,
  approved: bool,
) -> Result<process_manager::ProcessStartResult, String> {
  let db_arc = state.inner().clone();
  Ok(process_manager::approve_and_start(&db_arc, &process_id, approved))
}

#[tauri::command]
fn process_list(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<process_manager::ProcessStatusResult>, String> {
  let db_arc = state.inner().clone();
  process_manager::list_process_statuses(&db_arc)
}

// -- Personality commands ---------------------------------------------------

#[tauri::command]
fn personality_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  name: String,
  description: String,
  system_prompt: String,
  temperature: Option<f64>,
  model_override: Option<String>,
  icon: Option<String>,
  is_default: Option<bool>,
) -> Result<(), String> {
  state
    .upsert_personality(
      &id,
      &name,
      &description,
      &system_prompt,
      temperature,
      model_override.as_deref(),
      icon.as_deref(),
      is_default.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn personality_list(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<db::PersonalityRow>, String> {
  state.list_personalities().map_err(|e| e.to_string())
}

#[tauri::command]
fn personality_delete(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_personality(&id).map_err(|e| e.to_string())
}

// -- Insights commands ------------------------------------------------------

#[tauri::command]
fn insights_record(
  state: tauri::State<'_, Arc<Database>>,
  event_type: String,
  category: String,
  value_num: Option<f64>,
  value_text: Option<String>,
  session_id: Option<String>,
  metadata_json: Option<String>,
) -> Result<String, String> {
  let db_arc = state.inner().clone();
  let req = insights::InsightsEventRequest {
    event_type,
    category,
    value_num,
    value_text,
    session_id,
    metadata_json,
  };
  insights::record_event(&db_arc, &req)
}

#[tauri::command]
fn insights_list(
  state: tauri::State<'_, Arc<Database>>,
  category: Option<String>,
  limit: Option<i64>,
) -> Result<Vec<db::InsightsEventRow>, String> {
  state
    .query_insights(category.as_deref(), None, limit.unwrap_or(100))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn insights_summary(state: tauri::State<'_, Arc<Database>>) -> Result<insights::InsightsSummary, String> {
  let db_arc = state.inner().clone();
  insights::build_summary(&db_arc)
}

// -- RPC Pipeline commands --------------------------------------------------

#[tauri::command]
fn pipeline_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  name: String,
  description: Option<String>,
  steps_json: String,
  zero_context: Option<bool>,
) -> Result<(), String> {
  // Validate steps_json is valid JSON array
  serde_json::from_str::<Vec<serde_json::Value>>(&steps_json)
    .map_err(|e| format!("steps_json muss ein JSON-Array sein: {}", e))?;
  state
    .upsert_rpc_pipeline(&id, &name, description.as_deref(), &steps_json, zero_context.unwrap_or(false))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn pipeline_list(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<db::RpcPipelineRow>, String> {
  state.list_rpc_pipelines().map_err(|e| e.to_string())
}

#[tauri::command]
fn pipeline_delete(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_rpc_pipeline(&id).map_err(|e| e.to_string())
}

// -- Memory Provider commands -----------------------------------------------

#[tauri::command]
fn memory_provider_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  name: String,
  provider_type: String,
  config_json: String,
  enabled: Option<bool>,
) -> Result<(), String> {
  match provider_type.as_str() {
    "mem0" | "honcho" | "supermemory" | "custom" => {}
    other => return Err(format!("Unbekannter Provider-Typ: {}", other)),
  }
  state
    .upsert_memory_provider(&id, &name, &provider_type, &config_json, enabled.unwrap_or(true))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_provider_list(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<db::MemoryProviderRow>, String> {
  state.list_memory_providers().map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_provider_delete(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_memory_provider(&id).map_err(|e| e.to_string())
}

// -- Tool Gateway commands --------------------------------------------------

#[tauri::command]
fn tool_gateway_upsert(
  state: tauri::State<'_, Arc<Database>>,
  id: String,
  tool_type: String,
  name: String,
  config_json: String,
  enabled: Option<bool>,
) -> Result<(), String> {
  match tool_type.as_str() {
    "web_search" | "image_gen" | "tts" | "browser" | "code_exec" | "custom" => {}
    other => return Err(format!("Unbekannter Tool-Typ: {}", other)),
  }
  state
    .upsert_tool_gateway_entry(&id, &tool_type, &name, &config_json, enabled.unwrap_or(true))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn tool_gateway_list(state: tauri::State<'_, Arc<Database>>) -> Result<Vec<db::ToolGatewayRow>, String> {
  state.list_tool_gateway_entries().map_err(|e| e.to_string())
}

#[tauri::command]
fn tool_gateway_delete(state: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
  state.delete_tool_gateway_entry(&id).map_err(|e| e.to_string())
}

// -- App entry --------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build(),
    )
    .setup(|app| {
      let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
      let panic_log_dir = app_data_dir.clone();
      std::panic::set_hook(Box::new(move |panic_info| {
        let payload = if let Some(message) = panic_info.payload().downcast_ref::<&str>() {
          (*message).to_string()
        } else if let Some(message) = panic_info.payload().downcast_ref::<String>() {
          message.clone()
        } else {
          "unknown panic payload".to_string()
        };

        let location = panic_info
          .location()
          .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()));

        let details = serde_json::json!({
          "payload": payload,
          "location": location,
          "thread": std::thread::current().name().map(|name| name.to_string()),
        });

        let _ = audit::append_audit_event(
          panic_log_dir.clone(),
          "runtime",
          "backend_panic",
          Some(details),
        );
      }));

      let database = Database::open(app_data_dir)
        .expect("failed to open database");
      let shared_database = Arc::new(database);
      start_scheduler_worker(app.handle().clone(), shared_database.clone());
      app.manage(shared_database);
      app.manage(WatchRegistry::default());
      app.manage(ClaudeCodeBridge::new());
      configure_pdfium_search_paths(app.handle());

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      ollama_health_check,
      generate_plan,
      chat_turn,
      chat_turn_stream,
      // Claude Code Bridge
      claude_code_start,
      claude_code_stop,
      claude_code_status,
      claude_code_send,
      claude_code_send_stream,
      claude_code_list_commands,
      claude_code_list_tools,
      mcp_probe,
      mcp_call_tool,
      web_fetch_url,
      web_search,
      exec_command,
      db_save_thread,
      db_list_threads,
      db_delete_thread,
      db_save_message,
      db_update_message_content,
      db_list_messages,
      db_save_task,
      db_update_task_status,
      db_list_tasks,
      db_save_step,
      db_update_step,
      db_list_steps,
      execute_task,
      audit_event,
      fs_list_allowed_folders,
      fs_add_allowed_folder,
      fs_remove_allowed_folder,
      fs_import_attachment,
      fs_collect_attachment_metadata,
      fs_write_text_file,
      fs_delete_file,
      fs_list_backups,
      fs_restore_backup,
      fs_watch_list,
      fs_watch_start,
      fs_watch_stop,
      fs_parse_artifact,
      fs_extract_text,
      fs_extract_text_limited,
      fs_save_artifact_version,
      fs_list_artifact_versions,
      fs_export_artifact_version,
      fs_list_artifact_exports,
      task_run_sub_agents,
      fs_generate_pro_outputs,
      scheduler_upsert_task,
      scheduler_list_tasks,
      scheduler_delete_task,
      scheduler_set_task_active,
      scheduler_run_task_now,
      scheduler_list_runs,
      policy_get,
      policy_set,
      policy_evaluate,
      engine_run_create,
      engine_run_update,
      engine_run_get,
      engine_run_list,
      engine_run_cancel,
      engine_run_resume,
      engine_run_retry,
      engine_run_checkpoint_add,
      engine_run_checkpoint_list,
      runtime_instruction_upsert,
      runtime_instruction_delete,
      runtime_instruction_list,
      runtime_instruction_effective,
      worker_sandbox_create,
      worker_sandbox_get,
      worker_sandbox_get_for_run,
      worker_sandbox_list,
      worker_sandbox_update,
      worker_sandbox_destroy,
      // Memory
      memory_upsert,
      memory_delete,
      memory_search,
      memory_compact,
      memory_snapshot,
      memory_hints,
      // User profile
      user_profile_upsert,
      user_profile_list,
      user_profile_delete,
      // Skills
      skill_upsert,
      skill_list,
      skill_delete,
      skill_record_usage,
      skill_improve,
      skill_match,
      skill_auto_generate,
      // Sessions
      session_create,
      session_end,
      session_list,
      session_search,
      session_freeze_snapshot,
      // Learning
      learning_upsert,
      learning_list,
      // Terminal backends
      backend_upsert,
      backend_list,
      backend_delete,
      backend_exec,
      backend_ensure_local,
      // Process manager
      process_start,
      process_stop,
      process_approve,
      process_list,
      // Personalities
      personality_upsert,
      personality_list,
      personality_delete,
      // Insights
      insights_record,
      insights_list,
      insights_summary,
      // RPC Pipelines
      pipeline_upsert,
      pipeline_list,
      pipeline_delete,
      // Memory providers
      memory_provider_upsert,
      memory_provider_list,
      memory_provider_delete,
      // Tool gateway
      tool_gateway_upsert,
      tool_gateway_list,
      tool_gateway_delete,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
