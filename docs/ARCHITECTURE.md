# Architektur

## Uebersicht

Open_Cowork verwendet eine lokale Desktop-Architektur mit klarer Trennung zwischen UI und privilegierten Operationen.

```text
[React UI (Zustand Stores)]
    |
    v (Tauri invoke)
[Rust Core / Commands]
    |
    +--> [Ollama Client]
    +--> [Cowork Chat Turn Logic]
    +--> [MCP Client (probe + tool call)]
    +--> [SQLite Persistence (rusqlite)]
    +--> [Logging]
```

## Komponenten

## 1. Frontend (`app/src`)

### Routing & Layout
- React Router mit 4 Routen: Chat (`/`), Tasks (`/tasks`), MCP (`/mcp`), Einstellungen (`/settings`)
- Persistenter Sidebar-Layout mit Navigation

### Zustand Stores
- **configStore**: Ollama-Konfiguration (baseUrl, model, timeout) und MCP-Server-Konfiguration, localStorage-Persistenz
- **chatStore**: Chat-Threads, Messages, Approval-State, DB-Sync via Tauri-Commands
- **taskStore**: Task-Lifecycle, Steps mit Status, DB-Sync via Tauri-Commands

### Views
- **ChatView**: Thread-Management, Nachrichtenverlauf, Approval-Box, Ollama-Integration
- **TaskView**: Task-Liste mit Statusbadges, Schritt-Anzeige, Freigabe/Abbruch
- **McpView**: Server-Konfiguration, Probe, Tool-Ausfuehrung mit JSON-Argumenten
- **SettingsView**: Ollama-Konfiguration und Health-Check

## 2. Tauri Shell (`app/src-tauri/src/lib.rs`)

- Registry fuer Commands:
  - Ollama: `ollama_health_check`, `generate_plan`, `chat_turn`
  - MCP: `mcp_probe`, `mcp_call_tool`
  - Persistenz: `db_save_thread`, `db_list_threads`, `db_delete_thread`,
    `db_save_message`, `db_list_messages`, `db_save_task`, `db_update_task_status`,
    `db_list_tasks`, `db_save_step`, `db_update_step`, `db_list_steps`
- SQLite-Datenbank-Initialisierung im `setup()` Hook
- Fehler-Mapping in nutzerlesbare Strings
- Logging-Plugin in Debug-Builds

## 3. Ollama Client (`app/src-tauri/src/ollama.rs`)

- Konfigurierbarer Endpoint, Modellname, Timeout
- Endpoint-Validierung via URL-Parser
- HTTP-Aufrufe via `reqwest` mit Timeout
- Parse-Logik fuer nummerierte Schritte
- Chat-Turn-Logik mit Verlaufseinbettung
- Risikoheuristik fuer Freigabeanforderungen

## 4. MCP Client (`app/src-tauri/src/mcp.rs`)

- `probe_server`: Startet MCP-Server-Prozesse via stdio, sendet JSON-RPC `initialize` und `tools/list`, gibt Tool-Metadaten zurueck
- `call_tool`: Startet MCP-Server, initialisiert, sendet `tools/call` mit Argumenten, parst Content-Array aus Ergebnis

## 5. SQLite Persistenz (`app/src-tauri/src/db.rs`)

- Schema-Migration mit Versionierung
- Tabellen: `chat_threads`, `chat_messages`, `tasks`, `task_steps`, `audit_events`
- WAL-Modus fuer Performance, Foreign Keys aktiv
- Thread-safe via `Mutex<Connection>`
- In-Memory-Modus fuer Tests
- Datenbank-Pfad: `%APPDATA%/io.noshitcoding.opencowork/open_cowork.db`

## Sicherheits- und Robustheitsprinzipien

- Keine Mock-Integration fuer LLM-Aufrufe
- Explizite Fehlerbehandlung bei Netzwerk- und Parsefehlern
- Defensive Defaults (`http://192.168.178.82:11434`, `llama3.1:8b`)
- Input-Validierung (leere Commands, ungueltige URLs)
- Foreign Key Constraints mit CASCADE-Loeschung
- Unit-Tests fuer DB, Parsing, Store-Logik
