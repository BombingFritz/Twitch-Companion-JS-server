# ADR 0016: UBOAT-Crew aus dem Spielstand lesen, Parser als eigenes Modul im Server

**Status:** Akzeptiert (Nutzer, 05./06.11.2026: Weg A „Parser“, Server-Modul in eigener Datei, nur eigene Akte).

**Kontext:** Zuschauer sind im Spiel UBOAT Crewmitglieder. Ihre Daten sollen im Chat (`!personalakte`) und später in einem Widget erscheinen. Das Spiel bietet keine Schnittstelle. Untersucht (05.11.2026, Spielversion 2026.1 Patch 21):
- Ein Spielstand ist eine Datei `<Name>.save` im Ordner `…\AppData\LocalLow\Deep Water Studio\UBOAT\Saves`, dazu drei rotierende Autosaves. Inhalt: rohes Deflate ohne Header, darin ein eigenes, selbstbeschreibendes Binärformat (Typnamen und Feldnamen einmal je Typ, jeder Feldwert mit Längenangabe, Objekte mit IDs). Am Anfang ein JSON-Block zum Kommandanten.
- Die Personaldaten (`PlayableCharacterData`) enthalten Name, Stufe, Erfahrung, Typ, Offiziersklasse, Eigenschaften, Auszeichnungen, Ein- und Todesdatum. Die deutschen Anzeigenamen stehen in `Data Sheets\UBOAT - Locales.dat`.
- Lesen eines Spielstands dauert etwa 0,4 s (entpackt ca. 67 MB).

**Entscheidung:**
- Der Server liest den neuesten Spielstand selbst (nur lesen, Datei sofort schließen, erst nach Ruhezeit) und hält die Crew im RAM (ADR 0002).
- Formatlogik in `lib/uboat-save.js` (reine Funktion Buffer → Daten, ohne Twitch-Bezug, einzeln testbar), Einlesen/Beobachtung/Zuordnung/Antworttext in `lib/uboat-crew.js`. `server.js` bindet nur Befehl, Endpoint, Kategorie, Status und Konsole an. Damit weicht der Aufbau vom bisherigen Ein-Datei-Server ab; die UBOAT-Logik bleibt aber gebündelt und ist ohne `UBOAT_SAVES_DIR` abgeschaltet.
- Zuordnung Zuschauer ↔ Crewmitglied über normalisierten Namensvergleich plus Zuordnungsdatei `uboat_crew_map.json`, ohne ungefähren Abgleich.

**Verworfene Alternativen:**
- **UBOAT-Mod (C#), der beim Speichern JSON schreibt:** liefert sauberere und ggf. Live-Daten, braucht aber Entwicklungsumgebung, Analyse des Spielcodes und Pflege bei jedem Spiel-Update. Bleibt Ersatzweg, falls ein Patch das Format bricht.
- **Crew-Liste von Hand pflegen:** unabhängig vom Format, aber Handarbeit, veraltet schnell, keine automatischen Ereignisse.
- **Parser im OBS-Widget (Muster BdU-Chat, ADR 0014):** Ein Browser darf den Saves-Ordner nicht selbst lesen; der Server müsste die Datei ohnehin bereitstellen. Mehr Teile (Endpoint, Anfrage/Antwort, Zeitlimits), abhängig von laufendem OBS.

**Konsequenzen:**
- Nur der Stand des letzten Speicherns ist bekannt (Autosaves etwa alle 30–40 min beobachtet); Anzeigen nennen den Stand.
- Abhängigkeit vom Spielformat: Ein Spiel-Update kann das Einlesen brechen. Dann bleibt der letzte gültige Stand, Konsolenhinweis; bekannte Versionen stehen in `UBOAT_KNOWN_GAME_VERSIONS`.
- Das Einlesen blockiert den Prozess je Spielstand etwa 0,4 s (synchrones Entpacken und Parsen). Bei Bedarf später in einen Worker auslagern.
- Neue Umgebungsvariable `UBOAT_SAVES_DIR`, neue Laufzeitdatei `uboat_crew_map.json` (in `.gitignore`), neuer Ordner `lib/`.
- Neue EventSub-Subscription `channel.update` (kein zusätzlicher Scope).
- Tests nutzen erzeugte Spielstände im gleichen Format; echte Spielstände (Zuschauernamen, mehrere MB) kommen nicht ins Repository.

**Nachträge (ohne Änderung der Entscheidung):**
- 06.11.2026: Antwort heißt „Soldbuch“; statt Datum und Uhrzeit nur „Der Eintrag ist aktuell.“, wenn der Spielstand höchstens 60 min alt ist (Nutzer).
- 07.11.2026: Befehl umbenannt in `!soldbuch`; kein Treffer → keine Chat-Antwort, nur Konsole (Nutzer). Bedeutung von `status` und die Verwundungs-Zustände per Reflexion aus der Spiel-Assembly `com.uboat.game.dll` gelesen (nur lesend, ohne Code auszuführen): `PlayableCharacterStatus` Reserve = 0, Onboard = 1, Deceased = 2; `IWoundedStatus` bei `Bleeding`, `Treatment`, `Hospitalization`.
