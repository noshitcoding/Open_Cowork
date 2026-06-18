use crate::audit_service::LegacyAuditJsonlService;
use serde_json::Value;
use std::path::PathBuf;

pub fn append_audit_event(
    app_data_dir: PathBuf,
    area: &str,
    action: &str,
    details: Option<Value>,
) -> Result<(), String> {
    LegacyAuditJsonlService::new(app_data_dir).append_legacy_event(area, action, details)
}
