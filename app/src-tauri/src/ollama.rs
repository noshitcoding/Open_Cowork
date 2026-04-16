use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use thiserror::Error;
use url::Url;

const DEFAULT_OLLAMA_BASE_URL: &str = "http://192.168.178.82:11434";
const DEFAULT_MODEL: &str = "llama3.1:8b";
const DEFAULT_TIMEOUT_MS: u64 = 200_000;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnResponse {
    pub endpoint: String,
    pub model: String,
    pub assistant_message: String,
    pub requires_approval: bool,
    pub proposed_plan: Vec<String>,
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

fn request_error(context: &str, config: &OllamaConfig, error: reqwest::Error) -> OllamaError {
    let kind = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_decode() {
        "decode"
    } else if error.is_request() {
        "request"
    } else {
        "network"
    };
    OllamaError::RequestFailed(format!(
        "{context} failed ({kind}) for endpoint={} model={} timeoutMs={}: {}",
        config.base_url, config.model, config.timeout_ms, error
    ))
}

fn empty_response_error(context: &str, config: &OllamaConfig) -> OllamaError {
    OllamaError::RequestFailed(format!(
        "{context} returned an empty response for endpoint={} model={}. Try another model tag or increase the timeout.",
        config.base_url, config.model
    ))
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
        .map_err(|error| request_error("/api/tags", &config, error))?;

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

    let started = Instant::now();
    log::info!(
        "ollama generate_plan start endpoint={} model={} timeoutMs={}",
        config.base_url,
        config.model,
        config.timeout_ms
    );

    let response = client
        .post(&generate_url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| request_error("/api/generate", &config, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(OllamaError::RequestFailed(format!(
            "Ollama returned status {} for /api/generate{}",
            status,
            if body.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", body.trim())
            }
        )));
    }

    let generate_payload: GenerateResponse = response
        .json()
        .await
        .map_err(|error| OllamaError::ParseFailed(error.to_string()))?;

    if generate_payload.response.trim().is_empty() {
        log::warn!(
            "ollama generate_plan empty endpoint={} model={} elapsedMs={}",
            config.base_url,
            config.model,
            started.elapsed().as_millis()
        );
        return Err(empty_response_error("/api/generate", &config));
    }

    log::info!(
        "ollama generate_plan success endpoint={} model={} elapsedMs={} chars={}",
        config.base_url,
        config.model,
        started.elapsed().as_millis(),
        generate_payload.response.len()
    );

    let steps = parse_steps(&generate_payload.response);

    Ok(PlanResponse {
        endpoint: config.base_url,
        model: config.model,
        raw_response: generate_payload.response,
        steps,
    })
}

pub async fn chat_turn(
    config: Option<OllamaConfig>,
    prompt: String,
    history: Vec<ChatMessage>,
) -> Result<ChatTurnResponse, OllamaError> {
    let config = normalize_config(config)?;
    let client = build_http_client(config.timeout_ms)?;

    let generate_url = format!("{}/api/generate", config.base_url);

    let mut history_text = String::new();
    for msg in history.iter().rev().take(8).rev() {
        history_text.push_str(&format!("{}: {}\n", msg.role, msg.content));
    }

    let chat_prompt = format!(
        "Du bist Open_Cowork, ein lokaler Assistenz-Agent. Antworte knapp, klar und auf Deutsch.\n\
    Wenn die Aufgabe riskante oder destruktive Aktionen enthalten koennte, schlage einen Plan vor und kennzeichne das als approval-beduerftig.\n\
    WICHTIGE REGELN:\n\
    - Gib niemals Platzhalter- oder Warte-Antworten wie 'ich analysiere', 'bitte warten', 'kommt gleich' oder aehnliches aus.\n\
    - Gib immer direkt eine finale, inhaltliche Antwort in genau dieser Nachricht.\n\
    - Erfinde niemals Dokumentinhalte.\n\
    - Wenn nur ein Dateipfad vorhanden ist, aber kein extrahierter Dokumenttext im Prompt steht, sage klar, dass der Inhalt nicht vorliegt und bitte um dokumentierten Textauszug oder aktivierte Dateianalyse.\n\n\
    Kontextverlauf:\n{}\nNutzer: {}\n\nAntwort:",
        history_text,
        prompt
    );

    let payload = serde_json::json!({
        "model": config.model,
        "prompt": chat_prompt,
        "stream": false,
        "options": {
            "temperature": 0.25
        }
    });

    let started = Instant::now();
    log::info!(
        "ollama chat_turn start endpoint={} model={} timeoutMs={} historyItems={} promptChars={}",
        config.base_url,
        config.model,
        config.timeout_ms,
        history.len(),
        prompt.len()
    );

    let response = client
        .post(&generate_url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| request_error("/api/generate", &config, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(OllamaError::RequestFailed(format!(
            "Ollama returned status {} for /api/generate{}",
            status,
            if body.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", body.trim())
            }
        )));
    }

    let generate_payload: GenerateResponse = response
        .json()
        .await
        .map_err(|error| OllamaError::ParseFailed(error.to_string()))?;

    if generate_payload.response.trim().is_empty() {
        log::warn!(
            "ollama chat_turn empty endpoint={} model={} elapsedMs={}",
            config.base_url,
            config.model,
            started.elapsed().as_millis()
        );
        return Err(empty_response_error("/api/generate", &config));
    }

    log::info!(
        "ollama chat_turn success endpoint={} model={} elapsedMs={} chars={}",
        config.base_url,
        config.model,
        started.elapsed().as_millis(),
        generate_payload.response.len()
    );

    let risk_terms = [
        "delete",
        "remove",
        "drop",
        "format",
        "shutdown",
        "kill",
        "rm -rf",
        "powershell",
        "registry",
        "firewall",
    ];

    let normalized_prompt = prompt.to_lowercase();
    let requires_approval = risk_terms.iter().any(|term| normalized_prompt.contains(term));

    let proposed_plan = if requires_approval {
        vec![
            "Risikoanalyse fuer die angefragte Aktion erstellen".to_string(),
            "Explizite Nutzerfreigabe vor Ausfuehrung einholen".to_string(),
            "Aktion in begrenztem Scope ausfuehren und Ergebnis pruefen".to_string(),
        ]
    } else {
        parse_steps(&generate_payload.response)
            .into_iter()
            .take(6)
            .collect::<Vec<String>>()
    };

    Ok(ChatTurnResponse {
        endpoint: config.base_url,
        model: config.model,
        assistant_message: generate_payload.response,
        requires_approval,
        proposed_plan,
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
