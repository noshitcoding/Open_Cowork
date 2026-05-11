# Anforderungen: Task-Chat Collapse & Projekt-Lösch-Button Entfernung

**Datum**: 8. Mai 2026  
**Status**: Anforderungen geklärt, bereit zur Umsetzung

---

## 1. Anforderungsliste (Requirements List)

### Feature 1: Projekte-Lösch-Button im globalen Filter entfernen

| ID | Anforderung | Priorität | Akzeptanzkriterien |
|----|-------------|-----------|-------------------|
| F1-1 | Projekte dürfen im globalen Filter (LeftSidebar) keinen X-Button (Löschen) anzeigen | Hoch | Kein X-Button bei Projekteinträgen im Filter sichtbar |
| F1-2 | Das Löschen von Projekten bleibt über die Projekteinstellungen möglich | Hoch | Bestehende Löschfunktion in Projekteinstellungen bleibt erhalten |
| F1-3 | Änderung betrifft nur den globalen Filter unten in der Sidebar | Mittel | Keine Auswirkungen auf andere UI-Bereiche |

### Feature 2: Zusammenklapp-Buttons für Task-Chats

| ID | Anforderung | Priorität | Akzeptanzkriterien |
|----|-------------|-----------|-------------------|
| F2-1 | Nach jedem Nutzer-Input in Task-Chats erscheint ein Chevron-Button | Hoch | Chevron-Symbol (▼/▲) immer sichtbar nach Nutzer-Nachricht |
| F2-2 | Der Button blendet den folgenden KI-Output aus/ein | Hoch | Klick auf Chevron klappt KI-Output ein/aus |
| F2-3 | Im eingeklappten Zustand wird ein Hinweis angezeigt | Hoch | Text „Output ausgeblendet – klicken zum Anzeigen“ sichtbar |
| F2-4 | Die Funktionalität gilt nur für Task-Chats | Hoch | Chat-Typ „Task“ aus dem Filter, keine anderen Chat-Typen |
| F2-5 | Output wird nur ausgeblendet, nicht gelöscht | Hoch | Nach Expand ist der Output wieder vollständig sichtbar |
| F2-6 | Keine Beschädigung bestehender Funktionalität | Hoch | Alle anderen Chat-Features funktionieren weiterhin normal |

---

## 2. Einzelne Tasks (Individual Tasks)

### Feature 1: Projekte-Lösch-Button entfernen

#### Task 1.1: `onDelete` Callback für Projekte in LeftSidebar.tsx entfernen ✅ **ERLEDIGT**
- **Datei**: `app/src/components/LeftSidebar.tsx`
- **Zeile**: ca. 230-240 (items array, projects.forEach)
- **Aktion**: Entferne die `onDelete: () => deleteProject(project.id)` Zeile aus dem Projekt-Objekt im `items` Array
- **Grund**: Verhindert das Rendern des X-Buttons für Projekte
- **Abhängigkeiten**: Keine
- **Status**: Erledigt am 8. Mai 2026 - Build erfolgreich, TypeScript-Fehler behoben

#### Task 1.2: Testen der Projekt-Lösch-Funktionalität über Projekteinstellungen
- **Aktion**: Manueller Test, ob Projekte weiterhin über ihre eigenen Einstellungen gelöscht werden können
- **Abhängigkeiten**: Task 1.1 abgeschlossen

---

### Feature 2: Zusammenklapp-Buttons für Task-Chats

#### Task 2.1: Zustand für Collapse-Status im Chat-Store oder lokal hinzufügen ✅ **ERLEDIGT**
- **Datei**: `app/src/components/CoworkView.tsx` (lokaler State)
- **Aktion**: `useState<Set<string>>` für `collapsedMessageIds` hinzugefügt
- **Details**: Der Key bezieht sich auf die Nutzer-Nachricht-ID
- **Abhängigkeiten**: Keine
- **Status**: Erledigt am 8. Mai 2026 - Build erfolgreich

#### Task 2.2: Chevron-Button nach Nutzer-Input in Task-Chats rendern ✅ **ERLEDIGT**
- **Datei**: `app/src/components/CoworkView.tsx`
- **Zeile**: Message-Rendering Loop (ca. 3225-3360)
- **Aktion**: 
  - `isTaskChat` Memo hinzugefügt, das prüft ob `activeThread.id` in `workTasks` als `threadId` vorkommt
  - Wenn `msg.role === 'user'` und `isTaskChat`: Chevron-Button (▼/▶) im `msg-role` Div gerendert
  - Button immer sichtbar (inline Style mit `marginLeft: 8, cursor: 'pointer'`)
- **Abhängigkeiten**: Keine
- **Status**: Erledigt am 8. Mai 2026 - Build erfolgreich

#### Task 2.3: Collapse/Expand Logik für KI-Output implementieren ✅ **ERLEDIGT**
- **Datei**: `app/src/components/CoworkView.tsx`
- **Aktion**:
  - `toggleCollapse(messageId)` Funktion hinzugefügt, die `collapsedMessageIds` Set aktualisiert
  - Beim Klick auf Chevron: Toggle des Collapse-Status für die folgende KI-Nachricht
  - Wenn eingeklappt: KI-Output (`msg-content`, `MessageThinking`, `LiveToolCalls`, etc.) ausgeblendet
  - Wenn ausgeklappt: KI-Output normal angezeigt
- **Abhängigkeiten**: Task 2.1, Task 2.2
- **Status**: Erledigt am 8. Mai 2026 - Build erfolgreich

#### Task 2.4: Hinweis für eingeklappten Output anzeigen ✅ **ERLEDIGT**
- **Datei**: `app/src/components/CoworkView.tsx`
- **Aktion**:
  - Wenn KI-Output eingeklappt ist: Zeige `<div className="msg-content-collapsed">` mit Text „Output ausgeblendet – klicken zum Anzeigen“ anstelle des Outputs
  - Klick auf Hinweis klappt Output wieder aus (ruft `toggleCollapse` für die entsprechende Nutzer-Nachricht auf)
- **Abhängigkeiten**: Task 2.3
- **Status**: Erledigt am 8. Mai 2026 - Build erfolgreich

#### Task 2.5: Funktionalität auf Task-Chats einschränken ✅ **ERLEDIGT**
- **Datei**: `app/src/components/CoworkView.tsx`
- **Aktion**:
  - `isTaskChat` Memo prüft, ob der aktive Chat ein Task-Chat ist (über `workTasks.some((task) => task.threadId === activeThread.id)`)
  - Chevron-Buttons nur gerendert, wenn `isTaskChat` true ist
  - Andere Chat-Typen (normal, session, etc.) bleiben unverändert
- **Details**: `useWorkTasksStore` importiert und `workTasks` aus dem Store gelesen
- **Abhängigkeiten**: Task 2.2
- **Status**: Erledigt am 8. Mai 2026 - Build erfolgreich

#### Task 2.6: Styling für Chevron-Button und Collapsed-Hinweis ✅ **ERLEDIGT**
- **Datei**: `app/src/components/CoworkView.tsx` (Inline-Styles)
- **Aktion**:
  - Chevron-Symbol: ▼ (ausgeklappt) / ▶ (eingeklappt)
  - Button-Styling: Kompakt (`fontSize: 12`), unaufdringlich (`background: 'none', border: 'none'`), aber immer sichtbar
  - Collapsed-Hinweis: Dezentes Styling (`color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0'`, klickbar mit `cursor: 'pointer'`)
- **Abhängigkeiten**: Task 2.2, Task 2.4
- **Status**: Erledigt am 8. Mai 2026 - Build erfolgreich

#### Task 2.7: Testen der Task-Chat Collapse-Funktionalität
- **Aktion**: Manueller Test
  - Task-Chat öffnen
  - Prüfen, ob Chevron-Buttons nach Nutzer-Inputs erscheinen
  - Collapse/Expand testen
  - Hinweis im eingeklappten Zustand prüfen
  - Sicherstellen, dass andere Chat-Typen nicht betroffen sind
- **Abhängigkeiten**: Alle Tasks 2.1-2.6 abgeschlossen

---

## 3. Qualitätskriterien (Quality Criteria)

- [ ] Projekte zeigen keinen inline X Löschen-Button im Filter
- [ ] Zusammenklappen blendet Output nur aus, löscht nicht
- [ ] Keine Beschädigung bestehender Funktionalität
- [ ] Chevron-Button immer sichtbar (nicht nur bei Hover)
- [ ] Funktionalität nur für Task-Chats (Chat-Typ „Task“)
- [ ] Projekte weiterhin über Projekteinstellungen löschbar

---

## 4. Technische Hinweise

### Betroffene Dateien
- `app/src/components/LeftSidebar.tsx` (Feature 1)
- `app/src/components/CoworkView.tsx` (Feature 2)
- `app/src/stores/chatStore.ts` (möglicherweise für Collapse-State)

### Relevante Code-Stellen
- **LeftSidebar.tsx Zeile ~230**: `items` Array, Projekt-Objekt mit `onDelete`
- **LeftSidebar.tsx Zeile ~381**: Rendering des X-Buttons (`item.onDelete && (...)`)
- **CoworkView.tsx Zeile ~3225**: `visibleMessages.map((msg, index) => { ... })` Message-Rendering Loop
- **CoworkView.tsx Zeile ~3146**: `findPreviousUserMessage` Funktion (nützlich für Zuordnung)

### Chat-Typ „Task“ identifizieren
- In `LeftSidebar.tsx` wird der Filter-Typ über `SidebarFilter` ('all' | 'project' | 'task' | 'chat' | 'session') gesteuert
- Task-Chats sind Chats, die einem Task zugeordnet sind (siehe `workTasks` und `task.threadId`)
- Prüfung möglich über: `workTasks.some(task => task.threadId === activeThreadId)`

---

## 5. Umsetzungsreihenfolge (Implementation Order)

1. **Feature 1**: Task 1.1 → Task 1.2
2. **Feature 2**: Task 2.1 → Task 2.5 → Task 2.3 → Task 2.4 → Task 2.6 → Task 2.7

---

**Erstellt von**: GitHub Copilot  
**Bestätigung durch Nutzer**: 8. Mai 2026 ✓
