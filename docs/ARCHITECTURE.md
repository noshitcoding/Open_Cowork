# Architektur

## Uebersicht

Open_Cowork verwendet eine lokale Desktop-Architektur mit klarer Trennung zwischen UI und privilegierten Operationen.

```text
[React UI]
    |
    v (Tauri invoke)
[Rust Core / Commands]
    |
    +--> [Ollama Client]
  +--> [Cowork Chat Turn Logic]
  +--> [MCP Probe Client]
    +--> [Task Orchestrator (initial)]
    +--> [Logging]
```

## Komponenten

## 1. Frontend (`app/src`)

- Bedienoberflaeche fuer Modellkonfiguration
- Trigger fuer Health-Check und Plan-Generierung
- Chat-Thread mit Verlauf und Agent-Antworten
- Freigabebox fuer risikobehaftete Aktionsplaene
- MCP-Server-Konfiguration und Toolauflistung
- Persistenz der Konfiguration in `localStorage`
- Fehleranzeige und Ergebnisdarstellung

## 2. Tauri Shell (`app/src-tauri/src/lib.rs`)

- Registry fuer Commands:
  - `ollama_health_check`
  - `generate_plan`
  - `chat_turn`
  - `mcp_probe`
- Fehler-Mapping in nutzerlesbare Strings
- Initiales Logging-Plugin in Debug-Builds

## 3. Ollama Client (`app/src-tauri/src/ollama.rs`)

- Konfigurierbarer Endpoint, Modellname, Timeout
- Endpoint-Validierung via URL-Parser
- HTTP-Aufrufe via `reqwest` mit Timeout
- Parse-Logik fuer nummerierte Schritte
- Chat-Turn-Logik mit Verlaufseinbettung
- Risikoheuristik fuer Freigabeanforderungen

## 4. MCP Probe Client (`app/src-tauri/src/mcp.rs`)

- Startet MCP-Server-Prozesse via stdio
- Sendet JSON-RPC `initialize` und `tools/list`
- Liest Antworten mit Timeout und gibt Tool-Metadaten an UI weiter

## Sicherheits- und Robustheitsprinzipien (aktueller Stand)

- Keine Mock-Integration fuer LLM-Aufrufe
- Explizite Fehlerbehandlung bei Netzwerk- und Parsefehlern
- Defensive Defaults (`http://192.168.178.82:11434`, `llama3.1:8b`)
- Unit-Tests fuer zentrale Antwortnormalisierung

## Geplante naechste Architekturbausteine

- Persistente lokale Datenhaltung (SQLite)
- State-Machine fuer Task-Lifecycle
- Permission- und Policy-Engine
- File-Service mit Diff/Backup/Restore
- Plugin-Layer (WASM/Wasmtime)
- Scheduler + Run-History
