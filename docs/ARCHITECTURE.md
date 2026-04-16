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
    +--> [Task Orchestrator (initial)]
    +--> [Logging]
```

## Komponenten

## 1. Frontend (`app/src`)

- Bedienoberflaeche fuer Modellkonfiguration
- Trigger fuer Health-Check und Plan-Generierung
- Persistenz der Konfiguration in `localStorage`
- Fehleranzeige und Ergebnisdarstellung

## 2. Tauri Shell (`app/src-tauri/src/lib.rs`)

- Registry fuer Commands:
  - `ollama_health_check`
  - `generate_plan`
- Fehler-Mapping in nutzerlesbare Strings
- Initiales Logging-Plugin in Debug-Builds

## 3. Ollama Client (`app/src-tauri/src/ollama.rs`)

- Konfigurierbarer Endpoint, Modellname, Timeout
- Endpoint-Validierung via URL-Parser
- HTTP-Aufrufe via `reqwest` mit Timeout
- Parse-Logik fuer nummerierte Schritte

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
