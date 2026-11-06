# Spec: UBOAT-Personalakte (`!personalakte`)

## Ziel
Zuschauer sind im Spiel UBOAT Crewmitglieder. Mit `!personalakte` bekommt ein Zuschauer die wichtigsten Daten „seines“ Matrosen als Antwort im Chat. Datenquelle ist der neueste Spielstand des Spiels; der Server liest ihn nur. Entscheidung: ADR 0016. Später nutzt ein eigenes Widget („Heute an Bord“) dieselben Daten über `/api/uboat/crew`.

## Verhalten

### Einschalten
- Nur aktiv, wenn `UBOAT_SAVES_DIR` in der `.env` gesetzt ist (Ordner `…\AppData\LocalLow\Deep Water Studio\UBOAT\Saves`). Ohne Wert: kein Einlesen, Befehl und Endpoint melden „aus“.
- Deutsche Namen für Eigenschaften und Fähigkeiten kommen aus `<Saves>\..\Data Sheets\UBOAT - Locales.dat`. Fehlt die Datei, werden die englischen Schlüssel angezeigt.

### Spielstand einlesen (`lib/uboat-crew.js`, Parser `lib/uboat-save.js`)
- Beim Start und bei jeder Änderung im Ordner (Dateibeobachtung, zusätzlich alle `UBOAT_POLL_MS` = 60 s) wird der neueste `*.save` nach Änderungszeit bestimmt.
- Gelesen wird erst, wenn Größe und Änderungszeit seit `UBOAT_SAVE_SETTLE_MS` (3 s) unverändert sind (Spiel schreibt fertig). Die Datei wird in einem Zug gelesen und sofort geschlossen; der Server schreibt nie in den Ordner.
- Scheitert das Einlesen (halb geschriebene Datei, unbekanntes Format), bleibt der letzte gültige Stand erhalten; Hinweis in der Konsole.
- Spielversion aus dem Spielstand (z. B. „2026.1 Patch 21“). Nicht in `UBOAT_KNOWN_GAME_VERSIONS`: einlesen wie gewohnt, einmal Hinweis „ungetestete Spielversion“.
- Crew = Charaktere mit Eintrittsdatum und Typ Matrose (0), Offizier (1) oder Kommandant (2). Rekrutierungspool, Hafenpersonal, Alliierte und Passagiere zählen nicht dazu.
- Pro Person: Name, Typ, Offiziersklasse, Stufe, Erfahrung gesamt und seit der letzten Feindfahrt, Anzahl Auszeichnungen, Todesdatum (falls gesetzt), Charakterzüge und Fähigkeiten (deutsch, nur Einträge mit Locale-Namen; interne Werte wie Move, Fatigue, Officer, Sailor entfallen dadurch; zusätzlich ausgeblendet: `UBOAT_HIDDEN_SKILLS`).

### Kategorie
- Der Befehl antwortet nur, wenn die Twitch-Kategorie in `UBOAT_CATEGORY_NAMES` steht (Vergleich ohne Groß-/Kleinschreibung).
- Kategorie beim `session_welcome` per `GET /helix/channels` holen, danach aktuell halten über EventSub `channel.update` v2 (`subscribeToChannelUpdate`, kein zusätzlicher Scope). Wechsel wird in der Konsole gemeldet.
- Unbekannte Kategorie (Abruf gescheitert): Befehl inaktiv.

### Befehl `!personalakte` (`handleUboatCommand`)
- `channel.chat.message`, Text ist `!personalakte` (Groß-/Kleinschreibung egal; Text danach wird ignoriert, es gibt nur die eigene Akte).
- Nachrichten aus fremdem Shared-Chat-Kanal ignorieren (wie `handleBduCommand`).
- Für alle Zuschauer, kein Mod-Check (wie `!BdU`).
- Modul aus oder Kategorie nicht UBOAT: keine Ausgabe.
- Je Nutzer höchstens eine Antwort je `UBOAT_USER_COOLDOWN_MS` (60 s); innerhalb des Cooldowns keine Ausgabe.
- Zuordnung Zuschauer → Crewmitglied, erste Regel mit Treffer gilt:
  1. Eintrag für `chatter_user_login` in `uboat_crew_map.json` → Name im Spiel.
  2. Login (`chatter_user_login`) gleich Name im Spiel nach Normalisierung.
  3. Anzeigename (`chatter_user_name`) gleich Name im Spiel nach Normalisierung.
  - Normalisierung: Kleinbuchstaben, ä→ae, ö→oe, ü→ue, ß→ss, alles außer a–z und 0–9 entfernen.
  - Passt eine Regel auf mehrere Crewmitglieder: kein Treffer, Hinweis in der Konsole. Kein ungefährer Abgleich.
- Antworten (als Reply auf die Nachricht, `reply_parent_message_id`, höchstens 500 Zeichen):
  - Treffer („Soldbuch“, Wunsch Nutzer 06.11.2026): `Soldbuch <Name> – <Typ>[ (<Klasse>)][, an Bord|, in Reserve][: <Details>].[ Charakter: <…>.][ Fähigkeiten: <…>.][ Gefallen am <TT.MM.JJJJ>.][ Der Eintrag ist aktuell.]` (Klammern = nur wenn vorhanden bzw. größer 0).
    - Details: bei Offizieren und Kommandant `Stufe <n>, <EP> EP[ (+<EP> letzte Feindfahrt)]`; bei Matrosen entfällt das (im Spielstand vom 04.11.2026 haben alle 22 Matrosen Stufe 0, nur zwei haben überhaupt EP). Dazu bei allen `<n> Auszeichnung(en)`, wenn größer 0.
    - „Der Eintrag ist aktuell.“ nur, wenn der gelesene Spielstand (Änderungszeit der Datei) höchstens `UBOAT_FRESH_MS` (60 min) alt ist; sonst kein Hinweis. Datum und Uhrzeit des Speicherns werden nicht genannt.
    - Beispiele: „Soldbuch Alpaka – Offizier (Funker), an Bord: Stufe 3, 484 EP (+140 letzte Feindfahrt), 1 Auszeichnung. Charakter: Ängstlich. Fähigkeiten: Spanischsprachig, Gutes Gehör, Erkennung von Schiffsschrauben. Der Eintrag ist aktuell.“ – „Soldbuch Kobold – Matrose, an Bord. Charakter: Ängstlich. Fähigkeiten: Hart im Nehmen.“
  - Aufenthalt aus dem Feld `status`: 1 = „an Bord“, 0 = „in Reserve“ (Nutzer, 06.11.2026); andere Werte und Gefallene: kein Zusatz.
  - Charakter = Charakterzüge aus `Locales/UI/CrewListUI` (z. B. Seewolf, Ängstlich, Gesundheitsprobleme); Fähigkeiten = Einträge aus `Locales/Skills`, ohne die zur Offiziersklasse gleichnamige Fähigkeit.
  - Kein Treffer: „Zu deinem Namen liegt kein Soldbuch vor.“
  - Noch kein Spielstand gelesen: „Die Soldbücher sind gerade nicht verfügbar.“
  - Der Befehl heißt weiterhin `!personalakte`.
- Typ: Matrose, Offizier, Kommandant. Klasse (nur Offiziere): deutscher Name aus den Locales (Leader → Befehlshaber, Engineer → Ingenieur, Radioman → Funker).

### Zuordnungsdatei `uboat_crew_map.json` (ADR 0001)
- `{ "<twitch_login>": "<Name im Spiel>" }`, Login in Kleinbuchstaben. `loadUboatCrewMap()`/`saveUboatCrewMap()`. Fehlt die Datei: leer. Laufzeitdatei, nicht im Repository.

### Endpoint `GET /api/uboat/crew`
`{enabled, active, category, source, savedAt, loadedAt, gameVersion, crew: [{name, type, typeLabel, characterClass, classLabel, level, experiencePoints, experiencePointsFromLastPatrol, decorations, died, traits, skills, status, statusLabel}]}` (`statusLabel`: „an Bord“, „in Reserve“ oder `null`). `active`: Kategorie ist UBOAT. Herkunftsprüfung wie alle Endpoints (ADR 0013); keine Twitch-Daten, kein Token.

### Status und Konsole
- `/status`: `uboat_enabled`, `uboat_active`, `uboat_save`, `uboat_saved_at`.
- `uboat show`: Ordner, gelesener Spielstand mit Zeit und Spielversion, Kategorie, Crew mit Typ und Stufe, Zuordnungen.
- `uboat reload`: neuesten Spielstand sofort einlesen.
- `uboat map <login> <Name im Spiel>` / `uboat unmap <login>`: Zuordnung setzen bzw. entfernen.

### Konstanten (oben in `server.js`)
`UBOAT_COMMAND = '!personalakte'`, `UBOAT_USER_COOLDOWN_MS = 60 s`, `UBOAT_CATEGORY_NAMES = ['UBOAT']`, `UBOAT_SAVE_SETTLE_MS = 3 s`, `UBOAT_POLL_MS = 60 s`, `UBOAT_FRESH_MS = 60 min`, `UBOAT_CREW_MAP_FILE = 'uboat_crew_map.json'`, `UBOAT_KNOWN_GAME_VERSIONS = ['2026.1 Patch 21']`, `UBOAT_HIDDEN_SKILLS = ['Authority', 'Skipper']`, Antworttexte.

## Nicht-Ziele (vorerst)
- Live-Daten aus dem laufenden Spiel (nur Stand des letzten Speicherns).
- Akten anderer Zuschauer abfragen.
- Schicht bzw. fester Posten, Verwundungen (siehe Offene Punkte).
- Widget „Heute an Bord“, Crew-Ereignisse über die Effekt-Queue, Stream-Bericht.
- Änderungen am Spiel oder an Spielständen.

## Offene Punkte
- `status` 0/1: laut Nutzer (06.11.2026) „Reserve“ bzw. „an Bord“, so umgesetzt. Im Spielstand vom 04.11.2026 sind 6 von 29 in Reserve; Abgleich mit dem Crew-Bildschirm steht noch aus.
- Fester Posten (Schichten wie „Frühschicht“ sind Rollen-Objekte im Spielstand, hängen vermutlich am Szenen-Charakter, nicht an den Personaldaten) [UNGEKLÄRT].
- Verwundungen und `fate`-Werte: noch nicht in einem Spielstand beobachtet [UNGEKLÄRT].
- Anzeige der Stufe: Spiel zeigt evtl. Sterne statt Zahl [UNGEKLÄRT].
- Twitch-Kategoriename des Spiels: angenommen „UBOAT“ [UNGEKLÄRT, beim ersten Stream in der Konsole prüfen].
- Das Feld `role` der Personaldaten wechselt zwischen Speicherständen (vermutlich gerade ausgeführte Aufgabe) und wird nicht angezeigt.

## Akzeptanzkriterien
- Parser liest einen Spielstand im Testformat: Crew vollständig, Fremdcharaktere ausgefiltert, Charakterzüge und Fähigkeiten deutsch, interne Werte ausgeblendet.
- `!personalakte` bei Kategorie UBOAT: genau eine Reply „Soldbuch …“ mit Name, Typ, „an Bord“ bzw. „in Reserve“; Stufe und EP nur bei Offizieren und Kommandant; keine Zeitangabe.
- Spielstand höchstens 60 min alt: „Der Eintrag ist aktuell.“ am Ende; älter: kein Hinweis.
- Zuordnung über Datei, Login und Anzeigename (inkl. Groß-/Kleinschreibung, Leerzeichen, Umlaute); mehrdeutige Namen: keine Akte.
- Unbekannter Nutzer: Hinweis „kein Soldbuch“.
- Andere Kategorie (auch nach `channel.update`): keine Ausgabe. Wechsel zurück zu UBOAT: Antwort.
- Zweiter Befehl desselben Nutzers binnen 60 s: keine Ausgabe.
- Neuer Spielstand im Ordner: nach Ruhezeit eingelesen, Akte zeigt neue Werte. Defekte Datei: alter Stand bleibt.
- Ohne `UBOAT_SAVES_DIR`: keine Ausgabe, `/api/uboat/crew` meldet `enabled: false`.
- Tests mit Attrappen in `test/`, kein echter Spielstand im Repository (Testdaten werden erzeugt).

## Berührte Funktionen/Dateien
- Neu: `lib/uboat-save.js` (Parser, ohne Twitch-Bezug), `lib/uboat-crew.js` (Einlesen, Beobachtung, Zuordnung, Text), `test/uboat-fixture.js`, `test/uboat-test.js`.
- `server.js`: Konstanten, `UBOAT_SAVES_DIR`, `subscribeToChannelUpdate`, `refreshChannelCategory`/`setCurrentCategory` (Kategorieabruf im `session_welcome`, `channel.update`), `handleUboatCommand`, `sendChatMessage` um optionale Reply-ID und `CHAT_MAX_CHARS` erweitert, `loadUboatCrewMap`/`saveUboatCrewMap`, `GET /api/uboat/crew`, `/status`, Startanzeige, Konsolenbefehle.
- `test/keepalive-test.js`: erwartet eine Subscription mehr (9 statt 8).

## Status
umgesetzt (Branch `feat/uboat-personalakte`). Test mit Attrappen und erzeugten Spielständen: 34/34 (`test/uboat-test.js`, Szenarien `an` und `aus`), `npm test` ohne Fehler. Parser gegen echte Spielstände der Version 2026.1 Patch 21 erprobt (vier Spielstände vom 14.10. bis 04.11.2026, je 29 Crewmitglieder, Eigenschaftslisten vollständig, etwa 0,4 s je Spielstand); ein älterer Spielstand vom April 2026 (ältere Spielversion) liest 31 Personen, bei 3 bleiben die Eigenschaftslisten unvollständig. Gegen echtes Twitch und im Stream noch nicht erprobt.
