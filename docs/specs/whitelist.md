# Spec: Whitelist

## Ziel
Bestimmte Streamer beim ersten Chat-Beitrag je Session automatisch shouten.

## Verhalten
- Speicher: `whitelist.json` (`userId` → `userName`).
- Verwaltung über Konsolenbefehle (siehe docs/ARCHITEKTUR.md) und den Reiter „Whitelist“ der Webkonsole (Spec `webkonsole.md`, Stufe 5).
- `handleWhitelistShoutout` prüft jede Chat-Nachricht. Ein gelisteter Nutzer wird einmal je Session geshoutet, `shoutedOutThisSession` merkt das.
- Vor dem Shoutout prüft `getChannelActivity()` den Kanal (ADR 0015):
  - selbst gerade live (chattet hier, während er streamt): kein Hinweis, kein Shoutout, Eintrag im Prüfprotokoll,
  - neuestes Video (vergangene Übertragung, Highlight, Upload) älter als `SHOUTOUT_ACTIVITY_WINDOW_DAYS` (40) Tage: kein Shoutout, Eintrag im Prüfprotokoll,
  - kein Video oder API-Fehler (unklar): Eintrag im Prüfprotokoll; in der Testphase (`SHOUTOUT_ACTIVITY_STRICT = false`) trotzdem Hinweis und Shoutout, sonst keiner,
  - sonst (aktiv): Hinweis und Shoutout.
  Der Nutzer gilt für die Session in jedem Fall als erledigt.
- Hinweis vor dem Shoutout (`buildWhitelistShoutoutMessage`): „Welch netter Besuch! Wir begrüßen @<name>! Dort gab es zuletzt <Spiel>. Lasst gern mal nen Follow da!“ Kein Datum; ohne bekanntes Spiel ohne den mittleren Satz. Der Shoutout folgt nach 2 s (`WHITELIST_SHOUTOUT_DELAY_MS`).
- Prüfprotokoll `whitelist_checks.json` (höchstens 500 Einträge), Anzeige mit `whitelist checks`; Grundlage, um die Whitelist zu überarbeiten, später Teil des Stream-Berichts.
- `stream.online` leert `shoutedOutThisSession`.
- Ein Raid-Shoutout trägt den Raider ebenfalls in `shoutedOutThisSession` ein (siehe Spec Shoutout).
- Ein Shoutout vor dem Streamstart scheitert bei Twitch (400, Kanal nicht live). Der Nutzer bleibt trotzdem als geshoutet markiert, damit nicht jede weitere Nachricht einen neuen Versuch auslöst; nach `stream.online` folgt der Shoutout bei seiner nächsten Nachricht.

## Nicht-Ziele
- Kein HTTP-Endpoint zur Verwaltung außerhalb der geschützten Pfade `/api/admin/…` (ADR 0018).
- Keine Prüfung, ob eine bei `whitelist add <id> <name>` angegebene ID zum Namen passt.

## Akzeptanzkriterien
- Nach `whitelist add @name` steht der aufgelöste Nutzer mit ID in `whitelist.json`.
- Existiert `@name` nicht, wird eine Meldung ausgegeben und nichts gespeichert.
- `whitelist remove <id>` mit unbekannter ID gibt eine Meldung aus und ändert die Datei nicht.
- Die erste Chat-Nachricht eines gelisteten Nutzers löst genau einen Shoutout aus.
- Weitere Nachrichten desselben Nutzers lösen bis zum nächsten `stream.online` keinen Shoutout aus.
- Nicht gelistete Nutzer werden nie geshoutet.
- Ein gelisteter Streamer, dessen neuestes Video älter als 40 Tage ist und der nicht live ist, erhält weder Hinweis noch Shoutout; die Konsole nennt das Datum, `whitelist_checks.json` erhält einen Eintrag `inaktiv`.
- Ein gelisteter Streamer, der beim Chatten selbst live ist, erhält weder Hinweis noch Shoutout; Eintrag `live` mit Spiel.
- Ohne jedes Video und nicht live: Eintrag `unklar`; Testphase: Hinweis und Shoutout, Konsole meldet „nicht feststellbar“; mit `SHOUTOUT_ACTIVITY_STRICT = true` kein Shoutout.
- Der Hinweis lautet exakt „Welch netter Besuch! Wir begrüßen @<name>! Dort gab es zuletzt <Spiel>. Lasst gern mal nen Follow da!“ und enthält nie ein Datum.
- `whitelist checks` listet die Einträge `live`, `inaktiv` und `unklar`; aktive Streamer erzeugen keinen Eintrag.
- Der Shoutout kommt etwa 2 s nach dem Hinweis.
- Video (auch Highlight/Upload) höchstens 40 Tage alt und nicht live: Hinweis und Shoutout.
- Schlägt die Prüfung fehl (API-Fehler): Fehlermeldung, Eintrag `unklar` mit Fehlertext; Testphase: trotzdem Hinweis und Shoutout.
- Weitere Nachrichten desselben Nutzers lösen keine neue Prüfung aus; nach `stream.online` wird neu geprüft.
- Die Whitelist bleibt nach einem Neustart erhalten, `shoutedOutThisSession` nicht.

## Berührte Funktionen/Dateien
`loadWhitelist`, `saveWhitelist`, `addToWhitelist`, `removeFromWhitelist`, `printWhitelist`, `resolveUserByLogin`, `resolveUserById`, `handleWhitelistShoutout`, `getChannelActivity`, `buildWhitelistShoutoutMessage`, `loadWhitelistChecks`, `saveWhitelistChecks`, `recordWhitelistCheck`, `printWhitelistChecks`, `rl.on('line')`; `whitelist.json`, `whitelist_checks.json`
