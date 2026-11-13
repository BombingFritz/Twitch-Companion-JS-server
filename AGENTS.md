# AGENTS.md – Regeln für KI-Assistenten

## Vor jeder Änderung
- Lies docs/ARCHITEKTUR.md und docs/adr/ (Übersicht nach Themen: docs/adr/README.md; neue ADRs dort eintragen).
- Lies docs/KONTEXT.md für die Einordnung im Stream-Ökosystem (Home Assistant, OBS-Widgets, Stream Deck).
- Lies die passende Spec in docs/specs/.
- Bei Konflikt mit einem ADR: nachfragen, nicht umgehen.
- Der Code ist die Wahrheit. Weicht die Doku ab: melden, nicht stillschweigend glätten.

## Architekturkonventionen
- Neuer EventSub-Typ: eigene `subscribeToXYZ(sessionId)`, Aufruf im `session_welcome`-Block.
- Neuer Chat-Befehl: eigene Handler-Funktion, Cooldown-Konstante, Mod-Check (Muster `handleChatCommand`).
- Neue persistente Daten: eigene JSON-Datei mit `load…()`/`save…()`-Paar.
- Neuer Widget-Endpoint: GET nach Muster `/api/twitch/prediction/current`, Token über `getValidAccessToken()`.
- Home-Assistant-Effekte nur über `scheduleEffect(type, meta)`, nie direkt `axios.post` an `HA_WEBHOOK_URL`.
- Neuer Konsolenbefehl: `if (cmd === '…')`-Block im `rl.on('line')`-Handler plus Zeile in `printConsoleHelp()`.
- Webkonsole: Die Einstellungen aller Module und Plugins (Widgets, Stream-Deck-Plugin) wandern in einen gemeinsamen Reiter (Nutzer, 13.11.2026); eigene Reiter je Modul wie „Topics“ sind ein Übergang. Vor jeder Änderung an Einstellungen oder Reitern den aktuellen Aufbau der Webkonsole auf GitHub prüfen und neue Einstellungen dort einordnen, statt einen weiteren Reiter anzulegen.
- Konstanten oben in `server.js` definieren, nicht inline.
- Wiederholte Log-Zeilen über `logIfChanged()` ausgeben.
- Widgets erhalten nie Client-Secrets.
- Lichtlogik und Hardwaresteuerung gehören nicht in den Server. Home Assistant ist eines von mehreren optionalen Zielen, keine Voraussetzung. Der Server liefert nur `type` und `meta`.

## Produktausrichtung
- Die Architektur soll der größten Gruppe von Nutzern die meiste Funktion liefern. Angenommene Häufigkeit: Nutzer ohne alles > nur mit Stream Deck > mit Stream Deck und eigenem Chatbot > mit Stream Deck, eigenem Chatbot und Home Assistant.
- Möglichst viel Funktion kommt über Module. Eine Grundfunktion läuft ohne alle Module, und Module hängen so wenig wie möglich voneinander ab.
- Der Projektordner samt Laufzeitdateien liegt in der Cloud und wird vermutlich nach jedem Schreiben neu synchronisiert. Dateigrößen im Auge behalten, Vorgänge mit großen oder sehr oft beschriebenen Dateien besonders kritisch prüfen.

## Arbeitsweise
- Kleine, testbare Schritte statt großer Umbauten. Ein Commit je logischer Änderung.
- Fertige Arbeit auf einem eigenen Branch pushen und den Pull Request ohne Rückfrage selbst anlegen (Nutzer, 13.11.2026). Gemergt wird nur vom Nutzer.
- Vor jeder Weiterentwicklung den Stand im GitHub-Repository prüfen. Branches, Entity-Namen, Webhooks und Scopes können sich ändern und werden nicht aus dem Gedächtnis übernommen.
- Produktive Endpoints (Twitch-Chat, Home Assistant) beim Testen nicht ansprechen. Tests laufen mit Attrappen und in einem eigenen Arbeitsverzeichnis, damit die Laufzeit-JSON-Dateien nicht verändert werden. Vorhandene Tests liegen in `test/` (Muster: `ws`, `axios`, `readline` per `Module._load` ersetzen, Ausgabe `OK …`/`FAIL …`); neue Funktionen bekommen dort einen eigenen Test, der in `test/run-all.js` eingetragen wird.

## Pflicht-Checks
- `node --check server.js` und `npm test` (Ergebnis: 0 FAIL) vor jeder Auslieferung.
- Nur beabsichtigte Stellen ändern; Diff gegen die Vorversion prüfen.
- HA-Payload `{type, count, meta, timestamp}` unverändert lassen (siehe docs/ARCHITEKTUR.md).
- Doku (ARCHITEKTUR, Spec, CHANGELOG) im selben Schritt aktualisieren.
- Vor dem Commit `git diff --cached --stat` prüfen: Enthält er alle Dateien, die die Commit-Nachricht nennt, insbesondere die Doku-Dateien? Änderungen an mehreren Dateien nur ganz oder gar nicht anwenden; der Commit folgt nur, wenn alle Schritte davor erfolgreich waren.

## Verbote
- Keine Secrets ausgeben oder committen (`.env`, `tokens.json`). Nur Platzhalter wie `<CLIENT_SECRET>`.
- Keine privaten Netzwerkadressen oder Webhook-IDs in Repo oder Doku, nur Platzhalter wie `<HA_HOST>`.
- Nichts erfinden: Unklares als `[UNGEKLÄRT]` markieren und nachfragen.
- Laufzeit-JSON-Dateien nicht ins Repository.
