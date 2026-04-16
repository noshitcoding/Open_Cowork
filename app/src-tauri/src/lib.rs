mod db;
mod mcp;
mod ollama;

use db::Database;
use mcp::{call_tool, probe_server, McpCallRequest, McpError, McpServerRequest};
use ollama::{
  chat_turn as chat_turn_internal,
  check_health,
  generate_plan as generate_plan_internal,
  ChatMessage,
  OllamaConfig,
  OllamaError,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;

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

#[tauri::command]
async fn mcp_probe(request: McpServerRequest) -> Result<mcp::McpProbeResponse, String> {
  probe_server(request).map_err(map_mcp_error)
}

#[tauri::command]
async fn mcp_call_tool(request: McpCallRequest) -> Result<mcp::McpCallResponse, String> {
  call_tool(request).map_err(map_mcp_error)
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

// -- Helpers ----------------------------------------------------------------

fn map_ollama_error(err: OllamaError) -> String {
  err.to_string()
}

fn map_mcp_error(err: McpError) -> String {
  err.to_string()
}

// -- App entry --------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
      let database = Database::open(app_data_dir)
        .expect("failed to open database");
      app.manage(Arc::new(database));

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      ollama_health_check,
      generate_plan,
      chat_turn,
      mcp_probe,
      mcp_call_tool,
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
