# Open_Cowork

Open_Cowork ist eine Windows-Desktop-Anwendung (Tauri + React + Rust) fuer agentisches Arbeiten mit lokaler Modellanbindung.

## Features

- **Chat-Interface** mit Thread-Management und persistenten Verlaeufen (SQLite)
- **Ollama-Integration** fuer lokale LLM-Anbindung (Chat, Planung, Health-Check)
- **Plan/Freigabe-Flow** fuer risikobehaftete Prompts mit Approval-UI
- **Task-Management** mit Status-Lifecycle (created → planned → waiting_approval → running → completed/failed/cancelled)
- **MCP-Server-Integration** mit Probing (tools/list) und Tool-Ausfuehrung (tools/call) via stdio JSON-RPC
- **Persistente Datenhaltung** in SQLite (Threads, Messages, Tasks, Steps, Audit-Events)
- **4-View-Layout** mit Sidebar-Navigation (Chat, Tasks, MCP, Einstellungen)
- **CI-Pipeline** mit TypeScript-Check, Vitest, Cargo-Tests, Clippy, Security-Scans

## Projektstruktur

- `app`: Tauri-Anwendung (Frontend + Rust Backend)
- `docs`: Architektur-, Betriebs- und Konfigurationsdokumente
- `WINDOWS_DESKTOP_APP_ANFORDERUNGEN.md`: Anforderungsdokument
- `TRACEABILITY_MATRIX.md`: Traceability-Matrix

## Voraussetzungen

- Windows 11 oder Windows 10
- Node.js 22+
- npm 10+
- Rust (via rustup)
- WebView2 Runtime
- Ollama erreichbar, Standard-Endpunkt: `http://192.168.178.82:11434`

## Schnellstart

1. Frontend + Tauri starten:

```powershell
cd app
npm install
npm run tauri dev
```

2. Produktivbuild erzeugen:

```powershell
cd app
npm run build
cd src-tauri
cargo check
```

## Tests

```powershell
# Frontend (14 Tests: App, chatStore, taskStore)
cd app
npx vitest run

# Backend (8 Tests: db, ollama)
cd app/src-tauri
cargo test
```

## Dokumentation

- `docs/ARCHITECTURE.md`
- `docs/OLLAMA_CONFIGURATION.md`
- `docs/DEVELOPMENT_AND_OPERATIONS.md`

## Hinweis zum Scope

Dieses Repository ist auf iterative Umsetzung ausgelegt. Der aktuelle Stand deckt ab:
- Desktop-Host mit 4-View-Layout und Router
- Chat + Planung mit Ollama-Integration
- SQLite-Persistenz fuer Threads, Tasks, Steps
- MCP-Server Probing und Tool-Ausfuehrung
- Zustand-basiertes State-Management mit DB-Sync
- 22 automatisierte Tests (14 Frontend + 8 Rust)
- CI/CD mit Lint, Test, Security-Gates
