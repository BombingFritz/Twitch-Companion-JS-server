# AGENTS.md – Regeln für KI-Assistenten

## Vor jeder Änderung
- Lies docs/ARCHITEKTUR.md und docs/adr/.
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
- Konstanten oben in `server.js` definieren, nicht inline.
- Wiederholte Log-Zeilen über `logIfChanged()` ausgeben.
- Widgets erhalten nie Client-Secrets.
- Neue Hardware und Lichtlogik gehören nach Home Assistant, nicht in den Server. Der Server liefert nur `type` und `meta`.

## Arbeitsweise
- Kleine, testbare Schritte statt großer Umbauten. Ein Commit je logischer Änderung.
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
