# Windows Desktop App Anforderungs- und Implementierungsdokument (Open_Cowork)

## 1. Zielbild

Diese Anwendung ist eine native Windows-Desktop-App fuer agentisches Arbeiten nach dem Vorbild von Claude Cowork:

- Aufgaben in natuerlicher Sprache annehmen
- mehrstufig planen und kontrolliert ausfuehren
- lokale Dateien, Browser und Connectoren sicher nutzen
- Ergebnisse nachvollziehbar, exportierbar und auditierbar bereitstellen

Der Fokus liegt auf:

- Sicherheit (Permission-Gating, Least Privilege, Audit)
- Nachvollziehbarkeit (Plan, Schrittstatus, Diffs, Logs)
- Produktivitaet (Sub-Agents, Automatisierung, Vorlagen)
- Enterprise-Einsatz (Policies, Monitoring, Rollen, Verteilung)

## 2. Produkt-Scope

### 2.1 In Scope (MVP -> 1.5)

- Native Windows-App mit Installer, Auto-Update, Crash-Recovery
- Task-Workflow: Prompt -> Plan -> Freigabe -> Ausfuehrung -> Abschlussbericht
- Dateisystem-Zugriff auf explizit freigegebene Ordner
- Tool-Runner fuer PowerShell/Python in sicherem Ausfuehrungskontext
- Browser-Recherche und kontrollierte Browser-Automation
- Connector-/Plugin-/Skill-System
- Scheduled Tasks und (spaeter) Mobile Dispatch
- Enterprise-Funktionen (RBAC, Policies, OTel, SIEM, MDM/GPO)

### 2.2 Out of Scope (erste Version)

- Linux/macOS als Pflichtziel
- vollautomatische Steuerung sensibler Anwendungen ohne explizite Freigabe
- irreversible Massenloeschungen ohne Rueckfallebene

## 3. Referenzquellen

- https://claude.com/product/cowork
- https://claude.com/docs/cowork/overview
- https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
- https://support.claude.com/en/articles/13364135-use-claude-cowork-safely
- https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork
- https://support.claude.com/en/articles/13837440-use-plugins-in-claude-cowork
- https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- https://support.claude.com/en/articles/13947068-assign-tasks-to-claude-from-anywhere-in-cowork
- https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork
- https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans
- https://claude.com/docs/cowork/monitoring
- https://code.claude.com/docs/en/desktop

## 4. Technische Leitentscheidungen

### 4.1 Plattform

Empfehlung:

- UI/Client: Tauri 2 + React + TypeScript
- Backend-Core (lokal): Rust Services (stabil, performant, sicher)

Warum:

- deutlich geringerer RAM/CPU-Footprint als Electron
- native Windows-Integration (Tray, Notifications, Autostart, Signierung)
- saubere Trennung von UI und privilegierten Aktionen

Alternative (falls Team stark .NET-lastig):

- .NET 8 + WPF/WinUI 3

## 5. Zielarchitektur

```text
[Desktop UI (React/TS)]
        |
        v
[App Shell (Tauri)]
        |
        +--> [Task Orchestrator]
        +--> [Policy & Permission Engine]
        +--> [Tool Runner Sandbox]
        +--> [File Service + Diff + Backup]
        +--> [Connector/Plugin Runtime]
        +--> [Scheduler]
        +--> [Audit + Telemetry]
        |
        v
[Local Data Layer: SQLite + encrypted secrets]
        |
        v
[External APIs / MCP / Browser / Local CLI]
```

## 6. Verbindlicher Tool- und Bibliotheksstack

## 6.1 App, UI, Packaging

- Tauri 2 (Desktop Runtime)
- React 18
- TypeScript 5
- Vite 5
- Zustand (State Management)
- TanStack Query (Server/Async State)
- React Router
- Tailwind CSS + shadcn/ui (UI-Komponenten)
- i18next + react-i18next (DE/EN Lokalisierung)
- Zod (Input-Validierung)
- Sentry (Crash/Fehlertelemetrie)
- tauri-plugin-updater (Auto-Updates)
- tauri-plugin-notification (Windows Notifications)
- tauri-plugin-store (lokale Einstellungen)
- tauri-plugin-single-instance

## 6.2 Lokale Daten, Security, Logging

- SQLite (rusqlite/sqlx)
- SQLCipher oder OS-geschuetzte Verschluesselung fuer sensible Felder
- Windows Credential Manager (Token-/Secret-Speicher)
- tracing + tracing-subscriber (strukturierte Logs)
- OpenTelemetry SDK + OTLP Exporter
- serde/serde_json/serde_yaml/toml
- chrono/time (Zeit und Schedules)

## 6.3 Dateiverarbeitung

- PDF: lopdf + pdf-extract (oder poppler-utils als optionale Fallback-CLI)
- DOCX/XLSX/PPTX: umya-spreadsheet, docx-rs, pptx libs (oder Python-Fallback)
- CSV: csv crate
- Markdown: pulldown-cmark
- HTML/XML: scraper + quick-xml
- Bildanalyse: image + optional OCR via tesseract (separat konfigurierbar)
- Notebook: serde_json Parsing von .ipynb
- Diff: similar / difflib-entsprechung in Rust
- Dateiwatching: notify

Hinweis: Falls Office-Formate in Rust nicht stabil genug sind, wird ein isolierter Python Worker verwendet:

- python-docx
- openpyxl
- python-pptx
- pandas

## 6.4 Automation und Sandbox

- PowerShell 5.1/7 Runner (expliziter Modus)
- Python Runner (venv-basiert)
- Job Objects (Windows Ressourcenlimits)
- timeout + retry/backoff via tokio + backoff crate
- Prozesskontrolle via tokio::process

## 6.5 Browser und Web

- Playwright (Chromium/Edge Automation)
- Optional: bestehendes Browser-Profil nur mit expliziter Nutzerfreigabe
- Web Fetch: reqwest
- URL-Extraktion und Parsing: url crate

## 6.6 Connectoren, Plugins, Skills

- MCP-Client-Protokoll (JSON-RPC ueber stdio/http)
- Plugin Runtime:
  - Option A: Wasmtime (WASM Sandbox fuer Plugins)
  - Option B: isolierte Child-Processes mit Capability Manifest
- Skill-Format: Markdown + YAML Frontmatter
- Signaturpruefung: minisign/sigstore (Release-Pakete)

## 6.7 Scheduler und Mobile Dispatch

- Scheduler: tokio-cron-scheduler
- Persistenz: SQLite (Jobs, Runs, Retry-State)
- Push/Mobile Bruecke (1.5): Firebase Cloud Messaging oder Pusher Channels

## 6.8 Tests und QA

- Rust: cargo test, insta snapshots
- Frontend: Vitest + React Testing Library
- E2E: Playwright Test
- Security: semgrep + trivy (fuer Abhaengigkeiten/Artefakte)
- Accessibility: axe-core (UI checks)
- Performance: criterion (Rust) + custom startup benchmarks

## 7. Funktionale Anforderungen mit Umsetzungsdetails

Jede Kategorie enthaelt Muss-Anforderungen (M) und Soll-Anforderungen (S).

### 7.1 Plattform und Windows-Basis

M:

- Native Auslieferung als signierter Installer (.msi oder .exe)
- Auto-Update mit Ringsteuerung (Pilot -> Broad)
- Tray, Notification Center, Taskleistenstatus
- DPI 100-200%, Light/Dark, Keyboard-first, Screenreader-Basics
- Crash-Recovery und Session-Wiederherstellung

Implementierung:

- Tauri Updater + Signierungspipeline
- Persistente Window-State-Store (Position/Size/Layout)
- UI Accessibility Checks via axe-core in CI

Akzeptanzkriterien:

- Startzeit <= 3s auf Referenzhardware
- 100% der Kernflows ohne Adminrechte nutzbar

### 7.2 Konto, Auth, Organisation

M:

- Login/Logout/Session-Refresh
- sichere Token-Speicherung im Windows Credential Manager
- Rollenmodell (Admin, Member, Viewer)
- Policy Enforcement (org-weite Sperren)

S:

- SSO (OIDC/SAML) fuer Enterprise

Implementierung:

- OAuth2/OIDC PKCE Flow
- Policy Engine mit priorisierten Regelquellen (System > Admin > Nutzer > Projekt)

Akzeptanzkriterien:

- Token nie im Klartext in DB/Logs
- Rollenwechsel wirkt ohne App-Neustart

### 7.3 Task-Orchestrierung und Agentenmodus

M:

- natuerliche Spracheingabe
- Plan vor Ausfuehrung mit Nutzerfreigabe
- Pause/Resume/Cancel
- sichtbarer Schrittstatus inkl. Zwischenartefakte
- Sub-Agents mit konfigurierbarer Parallelitaet

Implementierung:

- Orchestrator als State Machine
- Schrittmodell: Planned, Running, WaitingApproval, Failed, Completed
- Plan-Only Modus als Policy-Flag

Akzeptanzkriterien:

- Jede Aktion ist einem Plan-Step zugeordnet
- Abbruch beendet Child-Prozesse sauber

### 7.4 Dateisystem und Formate

M:

- Zugriff nur auf explizit freigegebene Ordner
- lesen/schreiben/bearbeiten mit Diff und Audit
- Delete nur mit separater Bestaetigung
- Backups bei Batch-Operationen
- PDF, Office, Markdown, Text, JSON, YAML, TOML, XML, HTML, Bilder, ipynb

Implementierung:

- Capability-Model pro Workspace-Pfad
- Write-Operationen ueber Transaction Layer (prepare -> diff -> confirm -> commit)

Akzeptanzkriterien:

- jede Dateiaenderung ist rueckverfolgbar (vorher/nachher)
- Konflikte werden erkannt, kein blindes Ueberschreiben

### 7.5 Tool-Ausfuehrung und Sandbox

M:

- kontrollierte Ausfuehrung von PowerShell/Python
- Risikoerkennung fuer destructive Befehle
- Timeouts, Ressourcenlimits, Retry mit Backoff

Implementierung:

- Command Policy Evaluator (deny/warn/allow)
- Windows Job Objects fuer CPU/RAM/Child-Kontrolle

Akzeptanzkriterien:

- riskante Kommandos brauchen explizite Freigabe
- hängende Prozesse werden beendet und sauber geloggt

### 7.6 Browser, Web und Computer Use

M:

- Websuche und strukturierte Extraktion mit Quellenzitaten
- Browser-Automation (Edge/Chrome) mit Freigabemodell
- Captcha-Erkennung, keine Umgehung

S:

- Computer Use (Maus/Tastatur) als optionales, klar markiertes Risiko-Feature

Implementierung:

- Playwright-Kontexte pro Task isoliert
- High-risk Ziele (Banking/Password Manager) per Blocklist

Akzeptanzkriterien:

- jede Browseraktion in Audit nachvollziehbar
- sofortiger Not-Aus fuer Steuerung vorhanden

### 7.7 Connectoren, Plugins, Skills

M:

- MCP-kompatible Connectoren registrieren/nutzen
- Plugin-Manager (install/update/remove)
- Skill-Aktivierung pro Projekt/Task
- connector- und plugin-spezifische Berechtigungen

Implementierung:

- Manifest Schema: name, version, permissions, endpoints, signature
- Plugin Isolation ueber WASM oder separaten Prozess

Akzeptanzkriterien:

- fehlerhafte Plugins beeintraechtigen Kern-App nicht
- alle Connector-Aktionen sind auditierbar

### 7.8 Scheduled Tasks und Dispatch

M:

- taeglich/woechentlich/monatlich planbare Tasks
- pausieren/fortsetzen/manuell starten
- Run-Historie mit Erfolgs-/Fehlerstatus

S:

- Mobile Dispatch inkl. Freigabe-Workflow

Implementierung:

- persistenter Scheduler + Recovery nach Neustart
- missed-run Handling (skip, catch-up, manual)

Akzeptanzkriterien:

- geplanter Task startet zuverlaessig bei aktiver App + wachendem Rechner

### 7.9 Ergebnisse und Exporte

M:

- Berichte, Tabellen, Praesentationen, strukturierte Daten
- Export in PDF, DOCX, PPTX, XLSX, CSV, JSON, Markdown
- Abschlussbericht mit Quellen, geaenderten Dateien, offenen Punkten

Implementierung:

- Unified Artifact Pipeline mit Templates und Validierungsregeln

Akzeptanzkriterien:

- Exporte oeffnen fehlerfrei in Zielanwendungen

### 7.10 Sicherheit, Datenschutz, Compliance

M:

- Permission Modes: Ask, Auto (eingeschraenkt), Plan-Only
- Prompt-Injection Mitigation
- Secret Redaction in Logs
- Datenminimierung und Retention-Regeln
- tamper-resistentere Audit-Logs

Implementierung:

- Trust Boundary fuer externe Inhalte (untrusted context)
- Sicherheitsfilter fuer Tool-Inputs/Outputs

Akzeptanzkriterien:

- keine Secret-Leaks in Standard-Logs
- externe Dokumentanweisungen koennen Policies nicht ueberschreiben

### 7.11 Enterprise, Monitoring, Betrieb

M:

- GPO/MDM-kompatible Konfiguration
- OTel Export (Prompt, Tool Decisions, Tool Results, Errors)
- SIEM Forwarding
- Feature Flags und Rollout-Ringe

Akzeptanzkriterien:

- zentrale Deaktivierung kritischer Features ohne Redeploy

## 8. Priorisierung und Release-Plan

### 8.1 MVP (Release 0.1)

Enthaelt:

- Plattformkern (Installer, Updates, Crash Recovery)
- Task-Orchestrierung (Plan, Freigabe, Ausfuehrung)
- Dateizugriff inkl. Diff/Backup
- Tool Runner PowerShell/Python
- Basis-Reporting und Exporte
- Sicherheitsgrundlagen (Permission Modes, Audit, Secret Redaction)

### 8.2 Release 1.0

Zusaetzlich:

- Browser-Automation
- Connector-/Plugin-/Skill-Manager
- Scheduled Tasks
- Team-/Rollenmodell erweitert

### 8.3 Release 1.5

Zusaetzlich:

- Mobile Dispatch
- Computer Use erweitert
- Enterprise Monitoring/SIEM/Policy-Feinsteuerung
- erweiterte Sub-Agent-Optimierung

## 9. Konkreter Implementierungsplan (Phasen)

## Phase 0: Setup und Architektur (1-2 Wochen)

Deliverables:

- Monorepo-Struktur (app-ui, app-core, plugins-sdk)
- CI/CD Grundpipeline
- Signierungskonzept und Secrets-Handling

Tools:

- GitHub Actions
- cargo, pnpm
- changesets (Versionierung)

## Phase 1: Desktop Shell und Kern-UX (2-3 Wochen)

Deliverables:

- Tauri App Shell
- Navigation: Chat/Tasks/Files/Settings
- Tray, Notifications, Window-State

Libraries:

- tauri plugins, React Router, Zustand

## Phase 2: Orchestrator und Policies (3-4 Wochen)

Deliverables:

- Plan-Engine
- Step-State-Machine
- Permission-Gating

Libraries:

- tokio, serde, zod, tracing

## Phase 3: Files + Tool Runner (3-4 Wochen)

Deliverables:

- File Service mit Freigabeordnern
- Diff + Backup + Restore
- PowerShell/Python Runner mit Limits

Libraries:

- notify, similar, tokio::process, backoff

## Phase 4: Browser + Connectoren + Plugins (4-5 Wochen)

Deliverables:

- Playwright Integration
- MCP Connector Runtime
- Plugin Manager + Signaturpruefung

Libraries:

- Playwright, JSON-RPC libs, wasmtime

## Phase 5: Scheduler + Exportpipeline + Hardening (3-4 Wochen)

Deliverables:

- Scheduled Tasks
- Artefakt-Exports
- Security Hardening + Injection Tests

Libraries:

- tokio-cron-scheduler, semgrep, trivy

## Phase 6: Enterprise + Observability (2-3 Wochen)

Deliverables:

- OTel Export
- SIEM Bridge
- GPO/MDM Konfigurationsprofile

Libraries:

- OpenTelemetry OTLP

## 10. Qualitaetssicherung und Definition of Done

Ein Feature gilt als fertig, wenn:

- funktionale Akzeptanzkriterien erfuellt sind
- Unit- und Integrationstests vorhanden sind
- Security Checks (SAST + Dependency Scan) gruen sind
- Telemetrie und Auditereignisse vorhanden sind
- UX/Accessibility Mindestanforderungen erfuellt sind

Mindest-Qualitaetsmetriken:

- Unit-Test-Coverage Core >= 75%
- kritische End-to-End-Flows vollautomatisiert
- Crash-Free Sessions >= 99.5% (rolling 30 Tage)

## 11. Risiken und Gegenmassnahmen

Risiko: Zu breite Feature-Menge im MVP.
Gegenmassnahme: strikte Scope-Gates, Feature Flags, vertikale Inkremente.

Risiko: Unsichere Plugin-/Connector-Ausfuehrung.
Gegenmassnahme: Sandbox, signed manifests, least privilege, kill switch.

Risiko: Formatvielfalt bei Office-Dateien.
Gegenmassnahme: Rust-first, Python-Worker als klar isolierter Fallback.

Risiko: Intransparente Agentenentscheidungen.
Gegenmassnahme: Step-basierter Plan, explainability panel, vollstaendige Audits.

## 12. Appendix: Abbildung der Ursprungsliste

Die urspruenglichen Punkte 1-331 sind in diesem Dokument in konsolidierter Form abgedeckt, insbesondere in:

- Kapitel 7.1 bis 7.11 (funktionale Vollabdeckung)
- Kapitel 8 (Priorisierung)
- Kapitel 9 (exakter Implementierungsplan)
- Kapitel 10-11 (QA, Betrieb, Sicherheit)

Falls gewuenscht, kann als naechster Schritt eine 1:1 Traceability-Matrix erzeugt werden:

- Spalte A: Ursprungs-ID (1-331)
- Spalte B: neue Kapitelreferenz
- Spalte C: konkreter Testfall
- Spalte D: Implementierungsstatus

## 13. Detaillierter Systemkontext und Haupt-Use-Cases

### 13.1 Primare Actor

- Endnutzer: erstellt und steuert Aufgaben, gibt Freigaben, exportiert Ergebnisse.
- Team Admin: verwaltet Rollen, Policies, Connectoren, Plugin-Freigaben.
- Security Admin: ueberwacht Audit, SIEM, OTel, Retention und Sperrlisten.
- Scheduler Service: fuehrt geplante Aufgaben in konfigurierten Zeitfenstern aus.
- Connector Runtime: bindet externe Quellen und APIs kontrolliert an.

### 13.2 Kern-Use-Cases (UC)

- UC-01: Ad-hoc-Aufgabe planen und ausfuehren.
- UC-02: Dateibasierte Analyse mit kontrollierten Schreiboperationen.
- UC-03: Browser-Recherche mit Quellenbelegen.
- UC-04: Wiederkehrende Aufgabe mit Fehler- und Skip-Handling.
- UC-05: Teamweite Policy-Aenderung mit sofortiger Wirkung.
- UC-06: Incident-Nachvollzug ueber Audit und Telemetrie.

### 13.3 Beispielablauf UC-01

1. Nutzer gibt Prompt ein.
2. Orchestrator erstellt Schrittplan mit Risiken und benoetigten Tools.
3. UI zeigt Plan zur Freigabe.
4. Nach Freigabe startet Ausfuehrung Schritt fuer Schritt.
5. Bei riskanten Aktionen fordert App explizite Freigabe.
6. Abschlussbericht wird erstellt und exportiert.

## 14. Modulvertraege (Implementation Contracts)

### 14.1 Task Orchestrator

Verantwortung:

- Plan erstellen, ausfuehren, pausieren, fortsetzen, abbrechen.
- Schrittstatus fuehren und persistieren.
- Rueckfragen bei Unsicherheit/Risiko erzeugen.

Schnittstellen (intern):

- create_task(input_prompt, context_refs) -> task_id
- generate_plan(task_id) -> plan
- approve_plan(task_id, approved_steps) -> ok
- run_task(task_id) -> run_id
- pause_task(task_id) -> ok
- resume_task(task_id) -> ok
- cancel_task(task_id) -> ok

### 14.2 Policy and Permission Engine

Verantwortung:

- Entscheidung deny, ask, allow je Aktion.
- Prioritaetslogik fuer Regeln.
- Nachvollziehbare Entscheidungsbegruendung.

Schnittstellen:

- evaluate(action, resource, context) -> decision, reason, policy_id
- list_effective_policies(user_id, project_id) -> policies

### 14.3 Tool Runner

Verantwortung:

- Ausfuehrung von PowerShell/Python in begrenztem Kontext.
- Timeout, Ressourcenlimit, Exit-Code-Auswertung.

Schnittstellen:

- run_command(spec) -> execution_id
- stream_output(execution_id) -> stdout, stderr events
- terminate(execution_id) -> ok

### 14.4 File Service

Verantwortung:

- Lesen, Schreiben, Diff, Backup, Restore.
- Pfadfreigaben und Konflikterkennung.

Schnittstellen:

- list_allowed_roots(user_id, project_id) -> paths
- read_file(path) -> content, metadata
- write_file(path, content, mode) -> diff, backup_ref
- delete_file(path, confirmed) -> recycle_ref

## 15. Datenmodell (SQLite) - Vorschlag

### 15.1 Haupttabellen

- users
- organizations
- projects
- tasks
- task_steps
- runs
- artifacts
- permissions
- policy_rules
- connectors
- plugins
- scheduled_jobs
- scheduled_runs
- audit_events
- telemetry_queue

### 15.2 Beispiel-DDL (kompakt)

```sql
CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL
);

CREATE TABLE task_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        title TEXT NOT NULL,
        state TEXT NOT NULL,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        risk_level TEXT NOT NULL DEFAULT 'low',
        output_ref TEXT,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        actor_id TEXT,
        org_id TEXT,
        project_id TEXT,
        event_type TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        decision TEXT,
        details_json TEXT
);
```

### 15.3 Indizes

- idx_tasks_project_status(project_id, status)
- idx_task_steps_task_idx(task_id, idx)
- idx_audit_ts_event(ts, event_type)
- idx_scheduled_next_run(next_run_at)

## 16. Permission- und Risiko-Matrix

| Aktion | Low | Medium | High | Standard-Entscheidung |
|---|---|---|---|---|
| Datei lesen in freigegebenem Ordner | x |  |  | allow |
| Datei schreiben in freigegebenem Ordner |  | x |  | ask |
| Datei loeschen |  |  | x | ask |
| Rekursives Umbenennen |  |  | x | ask |
| PowerShell read-only Kommando | x |  |  | allow |
| PowerShell mit Remove/Set-Acl |  |  | x | deny oder ask (Admin-Policy) |
| Browser lesen/scrapen | x |  |  | allow |
| Browser Formular submit |  | x |  | ask |
| Computer Use (Maus/Tastatur) |  |  | x | ask |
| Plugin-Installation unsigniert |  |  | x | deny |

## 17. Policy-Regelwerk (Prioritaet und Aufloesung)

Prioritaetsreihenfolge:

1. System Safety Rules (nicht ueberschreibbar)
2. Organization Admin Policies
3. Projektregeln
4. Nutzerpraeferenzen
5. Laufzeitheuristik (risikobasiert)

Konfliktregel:

- deny gewinnt immer gegen ask/allow.
- ask gewinnt gegen allow.

Beispielregel:

```yaml
id: ORG-SEC-014
scope: organization
match:
        action: command.execute
        command_regex: "(?i)\\b(remove-item|del|rmdir|format)\\b"
decision: ask
conditions:
        - user_role in [admin, member]
        - target_path not_in critical_paths
```

## 18. IPC/API-Vertrag zwischen UI und Core

### 18.1 Standard Request Envelope

```json
{
        "requestId": "uuid",
        "command": "task.generatePlan",
        "payload": {},
        "meta": {
                "projectId": "...",
                "userId": "..."
        }
}
```

### 18.2 Standard Response Envelope

```json
{
        "requestId": "uuid",
        "ok": true,
        "result": {},
        "error": null
}
```

### 18.3 Fehlerobjekt

```json
{
        "code": "POLICY_DENIED",
        "message": "Action requires approval",
        "details": {
                "policyId": "ORG-SEC-014",
                "action": "command.execute"
        }
}
```

## 19. Fehlerkatalog (auszugsweise)

- AUTH-001: Session abgelaufen. Aktion: re-login flow starten.
- FILE-004: Zielpfad nicht freigegeben. Aktion: Pfadfreigabe anbieten.
- FILE-011: Schreibkonflikt erkannt. Aktion: Merge/Overwrite/Abort anbieten.
- TOOL-006: Timeout. Aktion: Retry mit erhoehtem Timeout anbieten.
- TOOL-009: Abhaengigkeit fehlt. Aktion: Installationshinweis anzeigen.
- BROWSE-003: Captcha erkannt. Aktion: manuelle Uebernahme anfordern.
- POL-002: Aktion durch Policy gesperrt. Aktion: Admin-Hinweis mit policy_id.
- PLUGIN-005: Signatur ungueltig. Aktion: Installation blockieren.

## 20. Observability und Audit (OTel + SIEM)

### 20.1 Eventtypen

- prompt_received
- plan_generated
- plan_approved
- step_started
- step_completed
- step_failed
- tool_call_started
- tool_call_finished
- policy_decision
- artifact_exported
- scheduled_run_started
- scheduled_run_finished

### 20.2 Pflichtfelder je Event

- timestamp
- event_name
- prompt_id
- task_id
- step_id (optional)
- user_id (pseudonymisiert falls noetig)
- org_id
- decision (falls policy)
- duration_ms
- status

### 20.3 Datenschutz-Defaults

- Prompt-Inhalte standardmaessig redacted, falls Enterprise-Policy aktiv.
- Secrets immer maskiert.
- personenbezogene IDs optional gehasht.

## 21. CI/CD, Build und Release-Blueprint

### 21.1 Pipeline-Stages

1. Lint und Format (Rust, TS)
2. Unit Tests
3. Integration Tests
4. Security Scan (SAST + Dependencies)
5. Build (Debug/Release)
6. Signing
7. E2E Smoke Tests auf Windows Runner
8. Rollout in Ring 0 (Pilot)
9. Progressive Rollout in Ring 1/2

### 21.2 Release-Artefakte

- .msi Installer
- optional .exe bootstrapper
- checksums
- signaturdateien
- release notes

### 21.3 Rollback

- Sofortiger Stopp des Rollouts via Feature Flag.
- Vorversion bleibt fuer Auto-rollback verfuegbar.

## 22. Ausfuehrliche Testmatrix

### 22.1 Funktionale Tests

- FT-001: Prompt -> Plan -> Freigabe -> Run -> Report.
- FT-002: Plan-Only verhindert Tool-Ausfuehrung.
- FT-003: Pause/Resume behaelt Kontext und Step-State.
- FT-004: Cancel beendet Child-Prozesse.

### 22.2 Dateitests

- DF-001: Write erzeugt Diff und Audit-Event.
- DF-002: Delete verlangt Double Confirmation.
- DF-003: Konflikt bei geaenderter Datei wird erkannt.
- DF-004: Backup + Restore erfolgreich.

### 22.3 Security Tests

- SEC-001: Prompt Injection kann Policies nicht ueberschreiben.
- SEC-002: Secret wird in Logs maskiert.
- SEC-003: Unsigniertes Plugin wird blockiert.
- SEC-004: Verbotener Pfadzugriff wird verweigert.

### 22.4 Browser/Automation Tests

- BW-001: Quellenangabe fuer extrahierte Daten vorhanden.
- BW-002: Captcha fuehrt zu manueller Uebernahme.
- BW-003: Formular-Submit fragt Freigabe an.

### 22.5 Scheduler Tests

- SC-001: taeglicher Job startet zum Zeitfenster.
- SC-002: Offline-Zeit fuehrt zu definierter Skip/Catch-up Logik.
- SC-003: Historie zeigt alle Runs inkl. Fehlergrund.

### 22.6 Nicht-funktionale Tests

- NFT-001: Startzeit <= 3s (Median) auf Referenzsystem.
- NFT-002: Kein Memory-Leak ueber 8h Langzeitsitzung.
- NFT-003: Crash Recovery stellt offene Tasks wieder her.

## 23. Security Hardening Checklist

- Code Signing fuer alle Binaries aktiviert.
- CSP und strikte IPC Whitelist in Tauri gesetzt.
- Keine Shell-Interpolation ohne Argument-Splitting.
- Default deny fuer nicht freigegebene Pfade.
- Plugin-Sandboxing aktiv.
- Secret Redaction in allen Loggern aktiv.
- Auditlog-Integritaet (hash chain optional) aktiviert.

## 24. Betriebsmodell und Support

### 24.1 Support Bundle Inhalt

- App-Version, Build-Hash, OS-Version
- letzte 500 Audit/Diagnostic Events (redacted)
- aktive Policies und Feature Flags
- installierte Connector-/Plugin-Versionen

### 24.2 SLO-Vorschlag

- App-Start-SLO: 99% <= 5s
- Task-Orchestrierung verfuegbar: 99.9%
- geplante Task-Ausfuehrung erfolgreich: >= 98% (ohne externe API-Fehler)

### 24.3 Incident-Prozess

1. Incident-ID vergeben und Severity setzen.
2. Betroffene Feature Flags deaktivieren.
3. Ursache aus Audit + OTel ermitteln.
4. Hotfix in Pilotring pruefen.
5. Postmortem dokumentieren.

## 25. Detaillierter Backlog-Start (Epics)

- EP-01: Desktop Foundation (Installer, Update, Tray, Recovery)
- EP-02: Task Engine (Plan, Step State, Approvals)
- EP-03: File Safety Layer (Allowlist, Diff, Backup, Restore)
- EP-04: Tool Sandbox (PowerShell, Python, Limits)
- EP-05: Browser Intelligence (Search, Extract, Automation)
- EP-06: Connector and Plugin Platform (MCP, Manifest, Isolation)
- EP-07: Scheduler and Dispatch (timed runs, history, recovery)
- EP-08: Enterprise Controls (RBAC, Policies, OTel, SIEM)
- EP-09: Export and Artifact Pipeline
- EP-10: Security and Compliance Hardening

## 26. Umsetzungsplanung mit Teamrollen

Rollen:

- 1x Tech Lead (Architektur, Risk Governance)
- 2x Rust Engineers (Core, Runner, Security)
- 2x Frontend Engineers (UI, UX, Accessibility)
- 1x QA Automation Engineer (E2E, Regression)
- 1x DevOps Engineer (CI/CD, Signing, Rollout)

Taktung:

- Sprintlaenge: 2 Wochen
- MVP Ziel: 4-5 Sprints
- 1.0 Ziel: +3-4 Sprints
- 1.5 Ziel: +2-3 Sprints

## 27. Konkrete Abnahmekriterien pro Release

### 27.1 MVP Abnahme

- Alle Must-Haves aus Kapitel 7.1 bis 7.5 und 7.9 bis 7.10 produktiv.
- Keine kritischen Security Findings offen.
- 20 definierte E2E Kernfaelle gruen.

### 27.2 Release 1.0 Abnahme

- Browser, Connectoren, Plugins und Scheduler stabil.
- RBAC und Team-Policies funktional.
- mindestens ein Pilotkunde produktiv ohne Blocker.

### 27.3 Release 1.5 Abnahme

- Mobile Dispatch und erweitertes Monitoring aktiv.
- SIEM Integration verifiziert.
- Operations-Handbuch und Support-Runbook abgeschlossen.

## 28. Optionaler naechster Schritt

Fuer direkte Umsetzung sollte als Folgeartefakt erzeugt werden:

- TRACEABILITY_MATRIX.md mit 1:1 Mapping der Ursprungspunkte 1-331.
- TRACEABILITY_MATRIX.md Spalte: Zielmodul.
- TRACEABILITY_MATRIX.md Spalte: Implementierungsaufgabe.
- TRACEABILITY_MATRIX.md Spalte: Testfall-ID.
- TRACEABILITY_MATRIX.md Spalte: Release-Zuordnung.
