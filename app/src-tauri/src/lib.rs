mod artifact_pipeline;
mod audit;
mod cowork_features;
mod db;
mod file_safety;
mod file_watch;
mod mcp;
mod ollama;
mod scheduler;

use db::Database;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use mcp::{call_tool, probe_server, McpCallRequest, McpError, McpServerRequest};
use reqwest::StatusCode;
use ollama::{
  chat_turn as chat_turn_internal,
  check_health,
  generate_plan as generate_plan_internal,
  ChatMessage,
  OllamaConfig,
  OllamaError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

const LOCAL_DOCS_MCP_COMMAND: &str = "open-cowork-docs-mcp";
const POLICY_FLAG_STRICT: &str = "strictPolicyEnforcement";
const POLICY_FLAG_TOOL_DISPATCHER: &str = "allowToolDispatcher";
const POLICY_FLAG_MCP: &str = "allowMcpToolCalls";
const POLICY_FLAG_WEB_FETCH: &str = "allowWebFetch";
const POLICY_FLAG_FILE_READ: &str = "allowFileReadExtraction";
const POLICY_FLAG_AUTO_COMPACT: &str = "autoCompactLongContext";

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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebFetchRequest {
  url: String,
  max_chars: Option<usize>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PolicyFlagsPayload {
  strict_policy_enforcement: bool,
  allow_tool_dispatcher: bool,
  allow_mcp_tool_calls: bool,
  allow_web_fetch: bool,
  allow_file_read_extraction: bool,
  auto_compact_long_context: bool,
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

  probe_server(request).map_err(map_mcp_error)
}

#[tauri::command]
async fn mcp_call_tool(
  request: McpCallRequest,
  state: tauri::State<'_, Arc<Database>>,
) -> Result<mcp::McpCallResponse, String> {
  let policy = load_policy_state(&state)?;
  enforce_tool_policy(
    &policy,
    "mcp",
    &format!("{}::{}", request.name, request.tool_name),
    policy.flags.allow_mcp_tool_calls,
  )?;

  if request.command.trim() == LOCAL_DOCS_MCP_COMMAND {
    return local_docs_mcp_call(request, state);
  }

  call_tool(request).map_err(map_mcp_error)
}

#[tauri::command]
async fn web_fetch_url(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  request: WebFetchRequest,
) -> Result<WebFetchResponse, String> {
  let requested_url = request.url.trim();
  if requested_url.is_empty() {
    return Err("url darf nicht leer sein".to_string());
  }

  let policy = load_policy_state(&state)?;
  enforce_tool_policy(&policy, "web_fetch", requested_url, policy.flags.allow_web_fetch)?;

  let max_chars = request.max_chars.unwrap_or(4_000).clamp(500, 30_000);
  let response = reqwest::get(requested_url).await.map_err(|err| err.to_string())?;
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

#[tauri::command]
fn fs_write_text_file(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Database>>,
  path: String,
  content: String,
  create_backup: bool,
) -> Result<file_safety::FileWriteResponse, String> {
  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&path).as_path(), &allowed_folders)?;

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
) -> Result<String, String> {
  let policy = load_policy_state(&state)?;
  enforce_tool_policy(
    &policy,
    "read_file",
    path.as_str(),
    policy.flags.allow_file_read_extraction,
  )?;

  let allowed_folders = state.list_allowed_folders().map_err(|err| err.to_string())?;
  let canonical_target = file_safety::ensure_path_allowed(PathBuf::from(&path).as_path(), &allowed_folders)?;

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
    .replace_policy_deny_rules(&request.deny_rules)
    .map_err(|err| err.to_string())?;

  load_policy_state(&state)
}

// -- Helpers ----------------------------------------------------------------

fn default_policy_flags() -> PolicyFlagsPayload {
  PolicyFlagsPayload {
    strict_policy_enforcement: true,
    allow_tool_dispatcher: true,
    allow_mcp_tool_calls: true,
    allow_web_fetch: true,
    allow_file_read_extraction: true,
    auto_compact_long_context: true,
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

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      ollama_health_check,
      generate_plan,
      chat_turn,
      mcp_probe,
      mcp_call_tool,
      web_fetch_url,
      db_save_thread,
      db_list_threads,
      db_delete_thread,
      db_save_message,
      db_list_messages,
      db_save_task,
      db_update_task_status,
      db_list_tasks,
      db_save_step,
      db_update_step,
      db_list_steps,
      audit_event,
      fs_list_allowed_folders,
      fs_add_allowed_folder,
      fs_remove_allowed_folder,
      fs_write_text_file,
      fs_delete_file,
      fs_list_backups,
      fs_restore_backup,
      fs_watch_list,
      fs_watch_start,
      fs_watch_stop,
      fs_parse_artifact,
      fs_extract_text,
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
