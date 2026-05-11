use crate::db::{Database, MemoryEntryRow, UserProfileRow};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ── Request / Response types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MemoryUpsertRequest {
    pub scope: String,
    pub category: String,
    pub key: String,
    pub content: String,
    pub source_session_id: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MemorySearchRequest {
    pub query: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MemoryCompactRequest {
    pub scope: String,
    pub min_confidence: Option<f64>,
    pub max_age_days: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCompactResponse {
    pub scope: String,
    pub deleted_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct UserProfileUpsertRequest {
    pub key: String,
    pub value: String,
    pub source: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MemoryProviderUpsertRequest {
    pub name: String,
    pub provider_type: String,
    pub config_json: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenMemorySnapshot {
    pub session_id: String,
    pub agent_entries: Vec<MemoryEntryRow>,
    pub user_profile: Vec<UserProfileRow>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHint {
    pub hint_type: String,
    pub message: String,
    pub suggested_key: Option<String>,
    pub suggested_category: Option<String>,
}

// ── Core engine logic ───────────────────────────────────────────────────────

/// Check for duplicates before upsert - returns true if content is a duplicate
pub fn is_duplicate_memory(
    db: &Arc<Database>,
    scope: &str,
    category: &str,
    key: &str,
    _content: &str,
) -> bool {
    db.get_memory_entry(scope, category, key)
        .ok()
        .flatten()
        .is_some()
}

/// Create a frozen snapshot of memory for a session
pub fn create_memory_snapshot(db: &Arc<Database>) -> Result<FrozenMemorySnapshot, String> {
    let agent_entries = db
        .list_memory_entries("agent", None, 500)
        .map_err(|e| e.to_string())?;
    let user_profile = db.list_user_profile().map_err(|e| e.to_string())?;

    Ok(FrozenMemorySnapshot {
        session_id: uuid::Uuid::new_v4().to_string(),
        agent_entries,
        user_profile,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Generate memory hints based on current state
pub fn generate_memory_hints(db: &Arc<Database>) -> Vec<MemoryHint> {
    let mut hints = Vec::new();

    // Hint: if memory is getting old, suggest compaction
    if let Ok(entries) = db.list_memory_entries("agent", None, 200) {
        let low_confidence_count = entries.iter().filter(|e| e.confidence < 0.3).count();
        if low_confidence_count > 20 {
            hints.push(MemoryHint {
                hint_type: "compaction_suggested".to_string(),
                message: format!(
                    "{} Memory-Einträge mit niedriger Konfidenz – Memory bereinigen?",
                    low_confidence_count
                ),
                suggested_key: None,
                suggested_category: None,
            });
        }

        let total = entries.len();
        if total > 100 {
            hints.push(MemoryHint {
                hint_type: "memory_large".to_string(),
                message: format!("{} Memory-Einträge gespeichert. Kategorien prüfen?", total),
                suggested_key: None,
                suggested_category: None,
            });
        }
    }

    hints
}

/// Remove low-confidence entries for a given scope
pub fn compact_low_confidence(
    db: &Arc<Database>,
    scope: &str,
    min_confidence: f64,
) -> Result<MemoryCompactResponse, String> {
    let entries = db
        .list_memory_entries(scope, None, 10000)
        .map_err(|e| e.to_string())?;

    let mut deleted_count = 0usize;
    for entry in &entries {
        if entry.confidence < min_confidence {
            db.delete_memory_entry(&entry.id)
                .map_err(|e| e.to_string())?;
            deleted_count += 1;
        }
    }

    Ok(MemoryCompactResponse {
        scope: scope.to_string(),
        deleted_count,
    })
}

/// Validate and normalize memory scope
pub fn validate_scope(scope: &str) -> Result<&str, String> {
    match scope {
        "agent" | "user" | "session" | "shared" => Ok(scope),
        _ => Err(format!(
            "Ungültiger Memory-Scope: {}. Erlaubt: agent, user, session, shared",
            scope
        )),
    }
}

/// Merge external provider entries into local memory (with dedup)
#[allow(dead_code)]
pub fn merge_external_entries(
    db: &Arc<Database>,
    entries: Vec<MemoryUpsertRequest>,
    provider_name: &str,
) -> Result<(usize, usize), String> {
    let mut inserted = 0usize;
    let mut skipped = 0usize;

    for entry in entries {
        if is_duplicate_memory(
            db,
            &entry.scope,
            &entry.category,
            &entry.key,
            &entry.content,
        ) {
            skipped += 1;
            continue;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let content = format!("[{}] {}", provider_name, entry.content);
        db.upsert_memory_entry(
            &id,
            &entry.scope,
            &entry.category,
            &entry.key,
            &content,
            entry.source_session_id.as_deref(),
            entry.confidence.unwrap_or(0.6),
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }

    Ok((inserted, skipped))
}
