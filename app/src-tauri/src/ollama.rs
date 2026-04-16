use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use thiserror::Error;
use url::Url;

const DEFAULT_OLLAMA_BASE_URL: &str = "http://192.168.178.82:11434";
const DEFAULT_MODEL: &str = "llama3.1:8b";
const DEFAULT_TIMEOUT_MS: u64 = 20_000;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConfig {
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u64,
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            base_url: std::env::var("OLLAMA_BASE_URL")
                .unwrap_or_else(|_| DEFAULT_OLLAMA_BASE_URL.to_string()),
            model: std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string()),
            timeout_ms: std::env::var("OLLAMA_TIMEOUT_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(DEFAULT_TIMEOUT_MS),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagResponse {
    models: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelEntry {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionResponse {
    version: String,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealthResponse {
    pub ok: bool,
    pub endpoint: String,
    pub model: String,
    pub latency_ms: u128,
    pub version: Option<String>,
    pub models: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResponse {
    pub endpoint: String,
    pub model: String,
    pub raw_response: String,
    pub steps: Vec<String>,
}

#[derive(Debug, Error)]
pub enum OllamaError {
    #[error("invalid endpoint: {0}")]
    InvalidEndpoint(String),
    #[error("request failed: {0}")]
    RequestFailed(String),
    #[error("response parsing failed: {0}")]
    ParseFailed(String),
}

fn normalize_config(config: Option<OllamaConfig>) -> Result<OllamaConfig, OllamaError> {
    let merged = config.unwrap_or_default();

    let endpoint = if merged.base_url.trim().is_empty() {
        DEFAULT_OLLAMA_BASE_URL.to_string()
    } else {
        merged.base_url.trim().to_string()
    };

    let parsed = Url::parse(&endpoint).map_err(|error| {
        OllamaError::InvalidEndpoint(format!("{endpoint} ({error})"))
    })?;

    let model = if merged.model.trim().is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        merged.model.trim().to_string()
    };

    Ok(OllamaConfig {
        base_url: parsed.to_string().trim_end_matches('/').to_string(),
        model,
        timeout_ms: merged.timeout_ms.max(1_000),
    })
}

fn build_http_client(timeout_ms: u64) -> Result<Client, OllamaError> {
    Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| OllamaError::RequestFailed(error.to_string()))
}

pub async fn check_health(config: Option<OllamaConfig>) -> Result<OllamaHealthResponse, OllamaError> {
    let config = normalize_config(config)?;
    let client = build_http_client(config.timeout_ms)?;

    let tags_url = format!("{}/api/tags", config.base_url);
    let version_url = format!("{}/api/version", config.base_url);

    let started = Instant::now();

    let tags_response = client
        .get(&tags_url)
        .send()
        .await
        .map_err(|error| OllamaError::RequestFailed(error.to_string()))?;

    if !tags_response.status().is_success() {
        return Ok(OllamaHealthResponse {
            ok: false,
            endpoint: config.base_url,
            model: config.model,
            latency_ms: started.elapsed().as_millis(),
            version: None,
            models: vec![],
            error: Some(format!("Ollama returned status {} for /api/tags", tags_response.status())),
        });
    }

    let tag_payload: TagResponse = tags_response
        .json()
        .await
        .map_err(|error| OllamaError::ParseFailed(error.to_string()))?;

    let version_payload = match client.get(&version_url).send().await {
        Ok(response) if response.status().is_success() => response
            .json::<VersionResponse>()
            .await
            .ok()
            .map(|value| value.version),
        _ => None,
    };

    Ok(OllamaHealthResponse {
        ok: true,
        endpoint: config.base_url,
        model: config.model,
        latency_ms: started.elapsed().as_millis(),
        version: version_payload,
        models: tag_payload.models.into_iter().map(|item| item.name).collect(),
        error: None,
    })
}

pub async fn generate_plan(config: Option<OllamaConfig>, prompt: String) -> Result<PlanResponse, OllamaError> {
    let config = normalize_config(config)?;
    let client = build_http_client(config.timeout_ms)?;

    let generate_url = format!("{}/api/generate", config.base_url);

    let payload = serde_json::json!({
        "model": config.model,
        "prompt": format!(
            "Erzeuge eine kurze, umsetzbare Schrittfolge auf Deutsch. Gib nur nummerierte Schritte aus.\n\nAufgabe:\n{}",
            prompt
        ),
        "stream": false,
        "options": {
            "temperature": 0.2
        }
    });

    let response = client
        .post(&generate_url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| OllamaError::RequestFailed(error.to_string()))?;

    if !response.status().is_success() {
        return Err(OllamaError::RequestFailed(format!(
            "Ollama returned status {} for /api/generate",
            response.status()
        )));
    }

    let generate_payload: GenerateResponse = response
        .json()
        .await
        .map_err(|error| OllamaError::ParseFailed(error.to_string()))?;

    let steps = parse_steps(&generate_payload.response);

    Ok(PlanResponse {
        endpoint: config.base_url,
        model: config.model,
        raw_response: generate_payload.response,
        steps,
    })
}

fn parse_steps(raw: &str) -> Vec<String> {
    let mut parsed = vec![];

    for line in raw.lines() {
        let cleaned = line
            .trim()
            .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch == '-' || ch == ')')
            .trim()
            .to_string();

        if !cleaned.is_empty() {
            parsed.push(cleaned);
        }
    }

    if parsed.is_empty() {
        vec![raw.trim().to_string()]
    } else {
        parsed
    }
}

#[cfg(test)]
mod tests {
    use super::parse_steps;

    #[test]
    fn parse_steps_extracts_numbered_lines() {
        let raw = "1. Projekt initialisieren\n2) Ollama konfigurieren\n- Tests ausfuehren";
        let parsed = parse_steps(raw);

        assert_eq!(
            parsed,
            vec![
                "Projekt initialisieren".to_string(),
                "Ollama konfigurieren".to_string(),
                "Tests ausfuehren".to_string()
            ]
        );
    }

    #[test]
    fn parse_steps_falls_back_to_raw_text() {
        let raw = "Freitext ohne Zeilenumbrueche";
        let parsed = parse_steps(raw);

        assert_eq!(parsed, vec!["Freitext ohne Zeilenumbrueche".to_string()]);
    }
}
