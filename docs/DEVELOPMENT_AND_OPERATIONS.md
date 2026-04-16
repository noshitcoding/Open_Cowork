# Development und Betrieb

## Lokale Entwicklung

```powershell
cd app
npm install
npm run tauri dev
```

## Build

```powershell
cd app
npm run build
cd src-tauri
cargo check
```

## Tests

Frontend:

```powershell
cd app
npm run test:ci
```

Rust:

```powershell
cd app/src-tauri
cargo test
```

## CI-Gates (aktueller Stand)

- Frontend Build muss erfolgreich sein
- Frontend Unit-Tests muessen erfolgreich sein
- Rust Unit-Tests muessen erfolgreich sein
- Rust Compile-Check muss erfolgreich sein
- Semgrep Security Scan muss erfolgreich sein
- Trivy Filesystem Scan muss erfolgreich sein

## Funktionstest: Cowork Chat

1. App starten (`npm run tauri dev`)
2. Health-Check gegen Ollama ausfuehren
3. Im Bereich "Cowork Chat" eine Aufgabe senden
4. Antwort und ggf. Freigabehinweis pruefen
5. Bei Freigabehinweis "Plan freigeben" ausloesen

## Funktionstest: MCP Probe

Beispielkonfiguration:
- Name: `filesystem`
- Command: `npx`
- Args: `-y @modelcontextprotocol/server-filesystem .`

Schritte:
1. Konfiguration im MCP-Bereich eintragen
2. "MCP Server pruefen" ausfuehren
3. Rueckgabe von Protocol-Version und Toolliste pruefen

## Runbook: Startprobleme

## Fall A: `npm run tauri dev` startet nicht

- Node/NPM Versionen pruefen
- Rust Toolchain pruefen (`rustc -V`, `cargo -V`)
- WebView2 Runtime vorhanden?

## Fall B: Ollama nicht erreichbar

- Dienststatus pruefen
- Netzwerkpfad/FW pruefen
- Endpoint in der UI korrigieren

## Fall C: Build in CI rot

- `npm run build` lokal reproduzieren
- `npm run test:ci` lokal reproduzieren
- `cargo test` in `app/src-tauri` reproduzieren

## Backup und Recovery (Initialfassung)

- Git ist Quelle der Wahrheit fuer Quellcode
- Jede relevante Aenderung wird als eigener Commit erfasst
- Recovery erfolgt ueber Checkout eines stabilen Commits/Tags

## Empfohlene Betriebsgrenzen (vorlaeufig)

- Timeout fuer Ollama >= 20s bei groesseren Modellen
- GPU/CPU-Auslastung waehrend Requests beobachten
- Produktivmodelle festlegen und dokumentieren
