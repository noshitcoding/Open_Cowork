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
