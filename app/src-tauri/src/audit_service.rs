#![allow(dead_code)]

use crate::audit_sink::{AuditEvent, AuditRiskClass, AuditSink, AuditTarget};
use crate::context::RequestContext;
use crate::service_error::ServiceResult;
use chrono::Utc;
use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

pub struct AuditService<S>
where
    S: AuditSink,
{
    sink: S,
}

impl<S> AuditService<S>
where
    S: AuditSink,
{
    pub fn new(sink: S) -> Self {
        Self { sink }
    }

    pub fn record(&self, event: AuditEvent) -> ServiceResult<AuditEvent> {
        self.sink.emit(event.clone())?;
        Ok(event)
    }

    pub fn record_success(
        &self,
        context: &RequestContext,
        action: impl Into<String>,
        target: AuditTarget,
        risk_class: AuditRiskClass,
    ) -> ServiceResult<AuditEvent> {
        self.record(AuditEvent::success(context, action, target, risk_class))
    }

    pub fn record_denial(
        &self,
        context: &RequestContext,
        action: impl Into<String>,
        target: AuditTarget,
        risk_class: AuditRiskClass,
    ) -> ServiceResult<AuditEvent> {
        self.record(AuditEvent::denied(context, action, target, risk_class))
    }
}

#[derive(Debug, Clone)]
pub struct LegacyAuditJsonlService {
    app_data_dir: PathBuf,
}

impl LegacyAuditJsonlService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self { app_data_dir }
    }

    pub fn append_legacy_event(
        &self,
        area: &str,
        action: &str,
        details: Option<Value>,
    ) -> Result<(), String> {
        let mut audit_dir = self.app_data_dir.clone();
        audit_dir.push("audit");
        create_dir_all(&audit_dir).map_err(|err| err.to_string())?;

        let mut file_path = audit_dir;
        file_path.push("events.jsonl");

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .map_err(|err| err.to_string())?;

        let event = json!({
          "timestamp": Utc::now().to_rfc3339(),
          "area": area,
          "action": action,
          "details": details,
        });

        writeln!(file, "{}", event).map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit_sink::AuditSink;
    use crate::context::{ActorRole, RequestContext};
    use std::fs;
    use std::sync::Mutex;
    use uuid::Uuid;

    #[derive(Default)]
    struct RecordingAuditSink {
        events: Mutex<Vec<AuditEvent>>,
    }

    impl RecordingAuditSink {
        fn events(&self) -> Vec<AuditEvent> {
            self.events.lock().expect("events lock").clone()
        }
    }

    impl AuditSink for RecordingAuditSink {
        fn emit(&self, event: AuditEvent) -> ServiceResult<()> {
            self.events.lock().expect("events lock").push(event);
            Ok(())
        }
    }

    #[test]
    fn audit_service_records_success_event_without_tauri_runtime() {
        let sink = RecordingAuditSink::default();
        let service = AuditService::new(sink);
        let context = RequestContext::test_with_role(ActorRole::Admin);

        let event = service
            .record_success(
                &context,
                "workspace.update",
                AuditTarget::workspace(&context.workspace_id),
                AuditRiskClass::Medium,
            )
            .expect("success audit records");

        assert_eq!(event.action, "workspace.update");
        assert_eq!(event.tenant_id.as_str(), "test-tenant");
        assert_eq!(service.sink.events().len(), 1);
    }

    #[test]
    fn audit_service_records_denial_event_without_tauri_runtime() {
        let sink = RecordingAuditSink::default();
        let service = AuditService::new(sink);
        let context = RequestContext::test_with_role(ActorRole::Viewer);

        let event = service
            .record_denial(
                &context,
                "desktop.input.request",
                AuditTarget::new("desktop_agent", Some("agent_1".to_string())),
                AuditRiskClass::Critical,
            )
            .expect("denial audit records");

        assert_eq!(event.action, "desktop.input.request");
        assert_eq!(event.risk_class, AuditRiskClass::Critical);
        assert_eq!(service.sink.events()[0].outcome, event.outcome);
    }

    #[test]
    fn legacy_jsonl_service_preserves_existing_event_shape() {
        let root = std::env::temp_dir().join(format!("open_cowork_audit_{}", Uuid::new_v4()));
        let service = LegacyAuditJsonlService::new(root.clone());

        service
            .append_legacy_event(
                "test_area",
                "test_action",
                Some(serde_json::json!({ "key": "value" })),
            )
            .expect("legacy event writes");

        let contents =
            fs::read_to_string(root.join("audit").join("events.jsonl")).expect("audit file reads");
        let value: Value = serde_json::from_str(contents.trim()).expect("audit json parses");

        assert!(value["timestamp"].as_str().is_some());
        assert_eq!(value["area"], "test_area");
        assert_eq!(value["action"], "test_action");
        assert_eq!(value["details"]["key"], "value");

        let _ = fs::remove_dir_all(root);
    }
}
