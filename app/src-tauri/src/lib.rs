mod ollama;
mod mcp;

use mcp::{probe_server, McpError, McpServerRequest};
use ollama::{
  chat_turn as chat_turn_internal,
  check_health,
  generate_plan as generate_plan_internal,
  ChatMessage,
  OllamaConfig,
  OllamaError,
};
use serde::Deserialize;

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
async fn mcp_probe(request: McpServerRequest) -> Result<mcp::McpProbeResponse, String> {
  probe_server(request).map_err(map_mcp_error)
}

fn map_ollama_error(err: OllamaError) -> String {
  err.to_string()
}

fn map_mcp_error(err: McpError) -> String {
  err.to_string()
}

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
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      ollama_health_check,
      generate_plan,
      chat_turn,
      mcp_probe
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
