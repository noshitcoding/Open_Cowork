# Fehlende Features im Code (Gap-Liste)

Stand: 2026-04-16
Basis: WINDOWS_DESKTOP_APP_ANFORDERUNGEN.md, TRACEABILITY_MATRIX.md, aktueller Code in app/src und app/src-tauri/src.

## Update: Produktions-Slice 2026-04-16 (Cowork Core Features)

Die folgenden Cowork-Features sind jetzt umgesetzt:

- Sub-Agent Batch-Lauf mit konfigurierbarer Parallelitaet fuer Dateianalyse (Backend-Command + Task-Integration im UI)
- Pro-Output Pipeline aus CSV mit nativen Exporten nach XLSX, DOCX, PPTX und PDF
- Global Instructions und Folder Instructions als persistente Produktkonfiguration
- Connector-Verwaltung (Slack, Google Drive, Notion, Figma, Gmail, Claude in Chrome)
- Plugin- und Skill-Verwaltung inklusive einfacher Slash-Command-Definitionen
- Geplante Aufgaben mit Aktivierungsstatus und manueller Sofort-Ausfuehrung

Hinweis:

- Die Connector-, Plugin- und Scheduler-Funktionen sind als lokale Produktbasis umgesetzt (persistente Konfiguration + Steuer-UI). Externe Connector-Ausfuehrungen und echter Cron-Worker sind naechster Ausbau.

## Update: Produktions-Slice 2026-04-16 (bereits umgesetzt)

Die folgenden Punkte wurden im Rahmen dieses Umsetzungs-Slices bereits produktionsnah umgesetzt:

- Light/Dark Theme als persistentes Produktfeature (UI-Store + CSS Theme Tokens)
- Keyboard-first Bedienung mit globalen Shortcuts (Ctrl/Cmd+K, Ctrl+1/2, Ctrl+B, Ctrl+Shift+L)
- Command-Palette fuer zentrale App-Aktionen
- Persistente Wiederherstellung zentraler UI-Session-States (Mode/Sidebar/Theme)
- Persistenter Window-State (Position/Size/Maximized) fuer Desktop-Starts
- Windows Desktop Notifications via Tauri Notification Plugin
- Append-only Audit-Event-Logging (JSONL in App-Data) als Compliance-Basis
- Startup-Metrik-Logging (App-Startdauer) als Einstieg in Performance-Monitoring

Hinweis zur Build-Validierung:

- Frontend Build und Tests sind erfolgreich.
- Rust-Compile konnte lokal nicht ausgefuehrt werden, da `cargo` in der aktuellen Umgebung nicht verfuegbar ist.

## Update: Produktions-Slice 2026-04-16 (File-Safety-Fortsetzung)

Die folgenden File-Safety-Funktionen sind nun als produktionsnaher Kern umgesetzt:

- Persistente Allowlist fuer freigegebene Ordner (DB-gestuetzt)
- Harte Backend-Zugriffskontrolle: Dateioperationen nur innerhalb freigegebener Ordner
- Sicheres Schreiben von Textdateien mit Diff-Output als Standard-Ergebnis
- Optionales Backup beim Schreiben (App-Data Backup-Verzeichnis)
- Explizite Delete-Bestaetigung per Confirm-Token auf Backend-Ebene
- Audit-Events fuer Write/Delete im append-only Audit-Log
- Einstellungen-UI zur Verwaltung freigegebener Ordner und Ausfuehrung sicherer Dateioperationen

Hinweis:

- Dateiwatching, breite Format-Pipeline und Restore-Workflow fuer Backups folgen als naechster Ausbau.

## Update: Produktions-Slice 2026-04-16 (Backup-Restore + Dateiwatching)

Die folgenden Erweiterungen sind nun umgesetzt:

- Backup-Verzeichnis-Index mit auflistbaren Backup-Artefakten
- Restore-Workflow: Backup nach Zielpfad wiederherstellen (inkl. Policy-Pruefung und Audit)
- Dateiwatching mit `notify` im Backend auf freigegebenen Pfaden (Start/Stop/List)
- Live-Watch-Events als Frontend-Feed in den Einstellungen
- Audit-Events fuer Restore und Watch-Ereignisse

Hinweis:

- Breite Format-Pipeline (PDF/Office/Bilder/ipynb Parsing) folgt im naechsten Schritt.

## Update: Produktions-Slice 2026-04-16 (Format-Pipeline Grundausbau)

Die folgenden Pipeline-Bausteine sind jetzt umgesetzt:

- Backend-Artefaktparser mit Policy-Gating auf freigegebenen Ordnern
- Parsing fuer Text, CSV, JSON, XML, HTML, ipynb inkl. strukturierter Vorschau
- Parsing fuer Rasterbilder (Dimensionen) und SVG-Vorschau
- Basis-Parsing fuer PDF (Seitenmarker-Metadaten) und Office OpenXML (DOCX/XLSX/PPTX Vorschau)
- Einheitliches Artefakt-Response-Format (Summary, Preview, Metadata)
- Audit-Event fuer Artefakt-Parsing
- Einstellungen-UI fuer Dateiauswahl und Artefaktanalyse

Hinweis:

- Fuer tiefe semantische Extraktion aus PDF/Office (z. B. Layout-treue Inhalte, Tabellenstrukturen, OCR) ist ein weiterer Ausbau vorgesehen.

## Update: Produktions-Slice 2026-04-16 (Versionierte Artefakte je Run)

Die folgenden Artefakt-Versionierungsfunktionen sind nun umgesetzt:

- Persistente `artifact_versions` Tabelle in SQLite (inkl. Migration auf Schema-Version 3)
- Backend-Kommando zum Speichern einer Artefakt-Version mit optionaler `run_id` und optionalem Label
- Speicherung strukturierter Parse-Daten (Format, Summary, Preview, Metadata, Zeitstempel)
- Backend-Kommando zum Auflisten der letzten Artefakt-Versionen (limitierbar)
- Audit-Event `save_artifact_version` fuer Compliance/Nachvollziehbarkeit
- Settings-UI fuer optionale Run-ID/Label und aktives Speichern von Artefakt-Versionen
- Sichtbare Historie der zuletzt gespeicherten Artefakt-Versionen in der Settings-Ansicht

Hinweis:

- Exportfunktionen (PDF/DOCX/XLSX/PPTX) und dedizierte Download-/Ablage-Workflows folgen als naechster Ausbau.

## Update: Produktions-Slice 2026-04-16 (Export- und Ablage-Workflow)

Die folgenden Export-/Ablage-Funktionen sind nun umgesetzt:

- Persistente `artifact_exports` Tabelle in SQLite (Migration auf Schema-Version 4)
- Backend-Exportkommando fuer gespeicherte Artefakt-Versionen in den Formaten `json`, `md`, `txt`, `pdf`, `docx`, `xlsx`, `pptx`
- Policy-Gating auch fuer Export-Zielordner (nur freigegebene Ordner)
- Persistente Export-Historie inkl. Zielpfad, Format, Groesse und Zeitstempel
- Audit-Event `export_artifact_version` fuer Compliance-Nachvollziehbarkeit
- Settings-UI fuer Exportzielwahl, Zielformat-Auswahl und direkte Export-Ausfuehrung
- Sichtbare Export-Historie in der Settings-Ansicht

Hinweis:

- Native Endformat-Exporte (PDF/DOCX/XLSX/PPTX) sind als produktionsnaher Basispfad umgesetzt; Layout-/Template-Fidelity bleibt ein weiterer Ausbau.

## Bereits im Code vorhanden (Kurzabgleich)

Diese Punkte sind erkennbar implementiert und werden daher nicht als fehlend gelistet:

- Chat mit Thread-Verlauf und SQLite-Persistenz
- Ollama Health-Check, Plan-Generierung, Chat-Turn
- Plan/Freigabe-Grundfluss inkl. Schrittstatus
- MCP Probe und MCP Tool-Call via JSON-RPC (stdio)
- Grundlegendes Task- und Step-Modell mit Persistenz
- UI mit Cowork-Ansicht, linker/rechter Sidebar, Tabs

## Fehlende Features nach Anforderungsbereichen

## 1) Plattform und Windows-Basis (Kapitel 7.1, IDs 1-25)

- Signierter Installer- und Release-Flow (.msi/.exe) inkl. Verteilung
- Auto-Update mit Ringsteuerung (Pilot -> Broad)
- System Tray Integration
- Windows Notification Center Integration
- Taskleistenstatus/Badges
- Crash-Recovery und Session-Wiederherstellung nach Absturz
- Persistenter Window-State Store (Position/Size/Layout)
- Explizite Accessibility-Implementierung (A11y Checks, Screenreader-Basics)
- Keyboard-first Bedienkonzept als systematische Feature-Ebene
- Light/Dark Theme Umschaltung als Produktfeature
- Messbare Startup- und Stabilitaetsziele als Runtime-Feature


## 3) Task-Orchestrierung (fortgeschritten) und Personalisierung (Kapitel 7.3, IDs 41-70, 171-185)

- Orchestrator als robuste, persistente Runtime-State-Machine im Backend
- Pause/Resume laufender Tasks auf Engine-Ebene
- Sub-Agent Ausfuehrung mit konfigurierbarer Parallelitaet
- Plan-Only Modus als Policy Flag
- Umfangreiche Kontextkompression/Summarization fuer lange Sessions
- Prompt-Profile und Personalisierungsprofile
- Projektbezogene dauerhafte Instruktionen
- Mehrsprachigkeit (i18next DE/EN) im Produkt

Hinweis: Ein vereinfachter Plan/Freigabe-Flow ist vorhanden, aber die tieferen Enterprise- und Multi-Agent-Faehigkeiten fehlen.

## 4) Dateisystem und File Safety Layer (Kapitel 7.4, IDs 71-100)

- Explizites Folder-Permission-Gating als zentrale Security-Schicht
- Harte Zugriffskontrolle nur auf freigegebene Ordner (Backend-seitig erzwungen)
- Diff-Erzeugung fuer Dateiaenderungen als Standard-Output
- Backup/Restore Mechanismus fuer Batch-Operationen
- Separate Delete-Bestaetigungslogik auf Backend-Ebene
- Dateiwatching (notify) und Aenderungsmonitoring
- Breite Format-Pipeline fuer PDF, Office, CSV, XML, HTML, Bilder, ipynb
- Standardisierte Auditierbarkeit pro Dateioperation

## 5) Tool Sandbox und sichere Ausfuehrung (Kapitel 7.5, IDs 101-120)

- PowerShell Runner mit sicherem Ausfuehrungskontext
- Python Runner mit isolierter venv
- Timeout/Retry/Backoff als Runner-Policy
- Prozessisolation fuer Tool-Aufrufe
- Vollstaendige Tool-Execution-Auditlogs

## 6) Browser Intelligence (Kapitel 7.6, IDs 121-140)

- Webrecherche-Pipeline (Fetch + Quellenaufbereitung)
- Kontrollierte Browser-Automation mit Freigaben
- Playwright-basierte Browser-Steuerung
- URL-Policy/Gating fuer sichere Navigation
- Persistenz von Rechercheergebnissen als Artefakte

## 7) Connector-, Plugin- und Skill-Plattform (Kapitel 7.7, IDs 141-170)

- Connector-Registry mit Lifecycle-Management
- Skill-System (Markdown + YAML Frontmatter) als Produktfunktion
- Plugin Runtime (WASM via Wasmtime oder isolierte Child-Prozesse)
- Capability-Manifeste mit Rechtepruefung
- Signaturpruefung fuer Plugins/Skills
- Connector-Marktplatz-/Verwaltungs-UI

Hinweis: MCP Probe/Call ist vorhanden, aber keine vollstaendige Connector-/Plugin-Plattform.

## 8) Scheduler und Mobile Dispatch (Kapitel 7.8, IDs 186-200)

- Wiederkehrende/geplante Tasks (Cron-basiert)
- Job- und Run-Historisierung
- Retry-State fuer geplante Jobs
- Scheduler-Verwaltung im UI
- Mobile Dispatch fuer Freigaben/Monitoring (spaeterer Scope)

## 9) Artefakt-Pipeline und Exporte (Kapitel 7.9, IDs 201-215)

- Ergebnisartefakte als strukturierte Outputs (Report, Tabellen, Praesentationen)
- Exportfunktionen (z. B. PDF, DOCX, XLSX, PPTX)
- Versionierte Artefakte je Task-Run
- Download-/Ablage-Workflows fuer erzeugte Ergebnisse

## 10) Security und Compliance (Kapitel 7.10, IDs 216-230)

- Zentrale Policy Engine mit Prioritaetsregeln
- Data Redaction/PII-Schutz in Prompts/Outputs/Logs
- Erweiterte Audit-Events mit Compliance-Fokus
- Datenschutzkontrollen fuer sensible Datenfluesse
- Sicherheitstechnische Guardrails je Tool/Connector

## 11) Enterprise Controls, Monitoring, Betrieb (Kapitel 7.11, IDs 231-240)

- OpenTelemetry Instrumentierung und OTLP Export
- SIEM Forwarding
- GPO/MDM verwaltbare Richtlinien
- Enterprise Admin-Oberflaechen
- Flotten-/Policy-Management fuer Unternehmensbetrieb

## 12) UX Foundation und Produktivitaetsfeatures (Kapitel 7.1 UX, IDs 241-250)

- Global Search ueber Verlaeufe, Tasks, Artefakte
- Onboarding- und Guided-Flow fuer Erstnutzung
- Shortcut-System und Command-Palette als vollstaendiges Feature
- Vollstaendige Accessibility-Abdeckung mit Testnachweisen

## 13) Performance und Stabilitaet (Kapitel 7.1 Performance, IDs 251-254)

- Strukturierte Performance-Metriken und Profiling-Pipeline
- Last-/Queue-Kontrollen fuer parallele Workloads
- Caching-Strategien fuer wiederkehrende Operationen
- Definierte Performance-Budgets als enforced Runtime/CI Kriterium

## 14) QA- und Security-Testtiefe (Anforderungsnah, ueber aktuellen Stand hinaus)

- E2E Testabdeckung mit Playwright fuer Kernflows
- Security- und Abuse-Case Tests auf Feature-Ebene
- A11y Regression Tests ueber zentrale Views
- Integrations-/Systemtests fuer Orchestrator + Runner + Policy Engine
