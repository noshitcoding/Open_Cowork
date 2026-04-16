# Open_Cowork

Open_Cowork ist eine Windows-Desktop-Anwendung (Tauri + React + Rust) fuer agentisches Arbeiten mit lokaler Modellanbindung.

Der aktuelle Stand liefert einen echten vertikalen Slice:
- Native Tauri-App als Host
- React UI fuer Konfiguration und Bedienung
- Rust-Core mit echter Ollama-Integration
- Cowork-Chat mit verlaufsbasierter Antwortgenerierung
- Plan/Freigabe-Flow fuer risikobehaftete Prompts
- MCP-Server-Probing (stdio JSON-RPC `initialize` + `tools/list`)
- Health-Check (`/api/tags`, `/api/version`)
- Plan-Generierung (`/api/generate`)
- Unit-Tests fuer Parsinglogik
- Frontend-Tests mit Vitest

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
cd app
npm run test:ci
cd src-tauri
cargo test
```

## Dokumentation

- `docs/ARCHITECTURE.md`
- `docs/OLLAMA_CONFIGURATION.md`
- `docs/DEVELOPMENT_AND_OPERATIONS.md`

## Hinweis zum Scope

Dieses Repository ist auf iterative Umsetzung ausgelegt. Der aktuelle Stand deckt den ersten lauffaehigen Kern ab (Desktop-Host, Chat + Planung, Modellintegration, MCP-Basis, Basistests, CI- und Security-Gates). Weitere Anforderungen aus der Matrix werden in den naechsten Iterationen umgesetzt.
