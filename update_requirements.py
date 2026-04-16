import re

with open('WINDOWS_DESKTOP_APP_ANFORDERUNGEN.md', 'r', encoding='utf-8') as f:
    text = f.read()

# Title and Goal
old_title_goal = r'# Programmatische Anforderungsliste: Windows-Desktop-App wie Claude Cowork\n\n## Ziel\n\nDie App ist eine Windows-Desktop-Anwendung fuer agentisches Arbeiten\. Sie nimmt Aufgaben in natuerlicher Sprache entgegen, plant mehrstufige Arbeit, nutzt freigegebene lokale Dateien, Browser, externe Connectors und optionale Automatisierung\. Ergebnisse muessen nachvollziehbar, pruefbar und sicher sein\.'
new_title_goal = '''# Programmatische Anforderungsliste: Open-Source AI Workspace App (Ollama & Lokale Modelle)

## Ziel

Die App ist eine Windows-Desktop-Anwendung fuer agentisches Arbeiten mit starkem Fokus auf **lokale Open-Source Modelle (Ollama, Llama.cpp, LM Studio)**. Sie nimmt Aufgaben in natuerlicher Sprache entgegen, plant mehrstufige Arbeit, nutzt freigegebene lokale Dateien, Browser, externe Connectors (MCP) und optionale Automatisierung. Die Ergebnisse werden "Privacy First" primaer lokal verarbeitet, sind nachvollziehbar, pruefbar und sicher.'''
text = re.sub(old_title_goal, new_title_goal, text)

# Sources
sources_regex = r'## Quellenbasis\n\n.*?## Anforderungen\n'
new_sources = '''## Quellenbasis und Inspiration

- Urspruenglich inspiriert durch agentische Workflows aktueller Desktop-Clients.
- Kern-Fokus: Integration lokaler Sprachmodelle via Ollama API und Model Context Protocol (MCP).

## Anforderungen
'''
text = re.sub(sources_regex, new_sources, text, flags=re.DOTALL)

# Section: Konto -> Lokale Modelle
konto_regex = r'### Konto, Anmeldung und Organisation\n\n.*?(?=### Aufgabenmodus und Agentenarbeit)'
new_konto = '''### LLM-Anbindung, Modelle und lokale Organisation

26. Die App muss eine direkte Anbindung an Ollama unterstuetzen - Lokale Modelle koennen ohne Cloud-Account genutzt und ggf. in der App gewechselt werden.
27. Die App muss weitere lokale Backends unterstuetzen - Llama.cpp, LM Studio oder vLLM koennen als lokale API-Endpoints konfiguriert werden.
28. Die App muss API-Keys (fuer optionale Cloud-Fallbacks) sicher im Windows Credential Manager speichern.
29. Die App muss Modellwechsel waehrend der Laufzeit unterstuetzen - Nutzer kann fuer verschiedene Tasks unterschiedliche lokale Modelle waehlen.
30. Die App muss Systemressourcen (RAM/VRAM) pruefen und anzeigen - Nutzer sieht, ob das gewaehlte Modell lokal performant laeuft.
31. Die App muss Offline-Faehigkeit garantieren - Der lokale Agent arbeitet auch ohne Internetzugang uneingeschraenkt.
32. Die App muss lokale Workspaces/Profile unterstuetzen - Eigene Daten und Einstellungen bleiben auf dem Endgeraet.
33. Die App muss Token- und Kontextauslastung interaktiv anzeigen - Nutzer sieht Ressourcenlimits lokaler Modelle.
34. Die App muss Fallback-Modelle definieren lassen - Bei zu grossem Kontext wird notfalls ein Modell mit groesseren Fenstern vorgeschlagen.
35. Die App muss Datenschutzinformationen anzeigen - Warnindikator, falls externe APIs/Connectors oder Cloud-LLMs eingebunden werden.
36. Die App muss persoenliche Einstellungen lokal speichern - Verschiedene lokale Nutzerprofile vermischen sich nicht.
37. Die App muss den Ollama-Download-Status anzeigen - Neue Modelle (z.B. Llama3, Mistral) lassen sich direkt ueber CLI-Commands/API aus der App pullen.
38. Die App muss lokales Log-Management bieten - Alles bleibt lokal analysierbar, keine erzwungenen Cloud-Logs.
39. Die App muss externe Telemetrie explizit abschaltbar haben - Default ist Opt-Out (kein Datentransfer nach aussen ohne Zustimmung).
40. Die App muss Backend-Verbindungsfehler bei lokalen Servern verstaendlich erklaeren (z.B. "Ollama laeuft nicht").

'''
text = re.sub(konto_regex, new_konto, text, flags=re.DOTALL)

# Replace remaining Claude specific words
text = text.replace('Claude Cowork', 'AI Workspace')
text = text.replace('Claude', 'Der Agent')
text = text.replace('Cowork', 'Workspace')
text = text.replace('Anthropic', 'die Cloud-API')

# Fix Enterprise Sections to Open Source equivalents
text = re.sub(r'### Team/Enterprise', '### Self-Hosted / Local Team', text)
text = text.replace('AI Workspace Enterprise Features', 'Team- und Self-Hosted Features')
text = text.replace('AI Workspace Kernfeatures (detailliert)', 'Workspace Kernfeatures (detailliert)')
text = text.replace('Workspace Projects', 'Task-Projekte')
text = text.replace('Workspace Plugins', 'Plugins und MCP (Model Context Protocol)')
text = text.replace('Workspace Scheduled Tasks', 'Geplante Agenten-Tasks')
text = text.replace('Workspace Monitoring (OpenTelemetry)', 'Monitoring & Telemetrie (OpenTelemetry)')
text = text.replace('Workspace-Tasks an den Desktop-Client binden', 'Agenten-Tasks an den Desktop-Client binden')

# Priorisierung update
prio_regex = r'## Priorisierung\n\n.*?(?=## Nicht-Ziele)'
new_prio = '''## Priorisierung

- MVP: Anforderungen 1-25 (Windows Basis), 26-40 (Ollama/Lokale Modelle), 41-70 (Agentenarbeit), 71-100 (Lokale Dateien), MCP-Basisunterstuetzung.
- Version 1.0: Zusaetzlich Browser-Steuerung, Custom Plugins (MCP), lokale geplante Aufgaben, erweiterte Computer-Steuerung (Screen Use).
- Version 1.5: Optionale BYOC (Bring Your Own Cloud) Anbindung, erweiterte Team-Features fuer Self-Host-Setups, Sub-Agent-Optimierung (Multi-Agent Swarms ueber Ollama).

'''
text = re.sub(prio_regex, new_prio, text, flags=re.DOTALL)

with open('WINDOWS_DESKTOP_APP_ANFORDERUNGEN.md', 'w', encoding='utf-8') as f:
    f.write(text)
