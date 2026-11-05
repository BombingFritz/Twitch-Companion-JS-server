# Spec: Whitelist

## Ziel
Bestimmte Streamer beim ersten Chat-Beitrag je Session automatisch shouten.

## Verhalten
- Speicher: `whitelist.json` (`userId` → `userName`).
- Verwaltung nur über Konsolenbefehle (siehe docs/ARCHITEKTUR.md).
- `handleWhitelistShoutout` prüft jede Chat-Nachricht. Ein gelisteter Nutzer wird einmal je Session geshoutet, `shoutedOutThisSession` merkt das.
- Vor dem Shoutout prüft `getChannelActivity()` die Aktivität (ADR 0015): Shoutout nur, wenn der Kanal gerade live ist oder sein neuestes Video (vergangene Übertragung, Highlight, Upload) höchstens `SHOUTOUT_ACTIVITY_WINDOW_DAYS` (40) Tage alt ist. Sonst, ohne Video oder bei API-Fehler: kein Shoutout, Hinweis in der Konsole. Der Nutzer gilt für die Session trotzdem als erledigt.
- `stream.online` leert `shoutedOutThisSession`.
- Ein Raid-Shoutout trägt den Raider ebenfalls in `shoutedOutThisSession` ein (siehe Spec Shoutout).
- Ein Shoutout vor dem Streamstart scheitert bei Twitch (400, Kanal nicht live). Der Nutzer bleibt trotzdem als geshoutet markiert, damit nicht jede weitere Nachricht einen neuen Versuch auslöst; nach `stream.online` folgt der Shoutout bei seiner nächsten Nachricht.

## Nicht-Ziele
- Kein HTTP-Endpoint zur Verwaltung.
- Keine Prüfung, ob eine bei `whitelist add <id> <name>` angegebene ID zum Namen passt.

## Akzeptanzkriterien
- Nach `whitelist add @name` steht der aufgelöste Nutzer mit ID in `whitelist.json`.
- Existiert `@name` nicht, wird eine Meldung ausgegeben und nichts gespeichert.
- `whitelist remove <id>` mit unbekannter ID gibt eine Meldung aus und ändert die Datei nicht.
- Die erste Chat-Nachricht eines gelisteten Nutzers löst genau einen Shoutout aus.
- Weitere Nachrichten desselben Nutzers lösen bis zum nächsten `stream.online` keinen Shoutout aus.
- Nicht gelistete Nutzer werden nie geshoutet.
- Ein gelisteter Streamer, dessen neuestes Video älter als 40 Tage ist und der nicht live ist, erhält keinen Shoutout; die Konsole nennt das Datum.
- Ohne jedes Video und nicht live: kein Shoutout, Hinweis „keine Übertragung, kein Highlight und kein Upload gefunden“.
- Gerade live oder Video (auch Highlight/Upload) höchstens 40 Tage alt: Shoutout.
- Schlägt die Prüfung fehl (API-Fehler): kein Shoutout, Fehlermeldung.
- Weitere Nachrichten desselben Nutzers lösen keine neue Prüfung aus; nach `stream.online` wird neu geprüft.
- Die Whitelist bleibt nach einem Neustart erhalten, `shoutedOutThisSession` nicht.

## Berührte Funktionen/Dateien
`loadWhitelist`, `saveWhitelist`, `addToWhitelist`, `removeFromWhitelist`, `printWhitelist`, `resolveUserByLogin`, `resolveUserById`, `handleWhitelistShoutout`, `getChannelActivity`, `rl.on('line')`; `whitelist.json`
