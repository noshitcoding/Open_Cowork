# Desktop Smoke Test

## Ziel

Diese Checkliste validiert den lokalen Windows-Desktop-Pfad fuer Open_Cowork reproduzierbar nach UI-, Engine- oder Tauri-Aenderungen.

## Voraussetzungen

- Windows mit WebView2 Runtime
- Node.js, npm und Rust Toolchain installiert
- Ollama erreichbar unter dem konfigurierten Endpoint
- Workspace sauber installierbar (`npm install` in `app`)

## Vorbereitung

```powershell
cd app
npm install
npm run test:ci
npm run build
```

Erwartung:
- Frontend-Tests grün
- Produktions-Build erfolgreich

## Smoke-Start

```powershell
cd app
npm run tauri dev
```

Erwartung:
- Rust kompiliert ohne Fehler
- das Desktop-Fenster startet
- kein Crash direkt nach dem Start

## Durchklickrunde

1. Startansicht pruefen
Erwartung:
- WelcomeScreen oder aktiver Cowork-Thread wird angezeigt
- Top-Navigation fuer Cowork, Settings, Features ist sichtbar

2. Settings oeffnen
Erwartung:
- die 9 Settings-Kategorien sind erreichbar
- in KI & Modell sind Ollama-Endpoint und Modell sichtbar

3. Health-Check ausfuehren
Erwartung:
- Ollama-Status wird als verbunden oder mit konkreter Fehlermeldung angezeigt
- Modelle koennen geladen werden

4. Neuen Chat anlegen
Erwartung:
- Sidebar legt einen neuen Thread an
- Cowork-Ansicht wird aktiv

5. Prompt senden
Beispiel:
- "Pruefe den aktuellen Build-Status des Projekts"
Erwartung:
- User-Nachricht erscheint im Thread
- Engine-Antwort streamt oder liefert eine sichtbare Fehlermeldung

6. Slash-Kommandos fuer lokalen Betrieb pruefen
Kommandos:
- `/ollama`
- `/local-model`
- `/local-runtime`
Erwartung:
- `/ollama` wechselt in die lokalen Ollama-Einstellungen
- `/local-model` bestaetigt aktuelles Modell und verweist auf lokale Modellwahl
- `/local-runtime` bestaetigt lokalen Desktop-/Ollama-Betrieb ohne Cloud-Backend

7. Persistierte Session aus der Sidebar laden
Erwartung:
- Bereich "Persistierte Sessions" ist sichtbar, sobald Sessions existieren
- Klick auf eine Session hydriert den Thread in die Cowork-Ansicht
- die geladene Session wird aktiver Thread

8. Features-Ansicht oeffnen
Erwartung:
- Tabs und Panels laden ohne White-Screen oder Fehler

9. App schliessen und neu starten
Erwartung:
- bestehende Threads sind weiter verfuegbar
- zuletzt genutzte Sessions koennen erneut geladen werden

## Fehlerprotokoll

Bei einem Fehler festhalten:

- Commit oder Arbeitsstand
- Schritt aus dieser Checkliste
- sichtbares Verhalten
- Terminal-Ausgabe aus `npm run tauri dev`
- falls relevant: Ollama-Endpoint und Modell

## Minimalfreigabe

Der Smoke-Test ist bestanden, wenn alle folgenden Punkte zutreffen:

- `npm run test:ci` erfolgreich
- `npm run build` erfolgreich
- `npm run tauri dev` startet das Desktop-Fenster
- Settings, Cowork und Features sind erreichbar
- ein Prompt kann gesendet werden
- persistierte Sessions lassen sich direkt aus der Sidebar laden