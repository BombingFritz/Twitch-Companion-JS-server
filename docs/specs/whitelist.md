# Spec: Whitelist

## Ziel
Bestimmte Streamer beim ersten Chat-Beitrag je Session automatisch shouten.

## Verhalten
- Speicher: `whitelist.json` (`userId` → `userName`).
- Verwaltung nur über Konsolenbefehle (siehe docs/ARCHITEKTUR.md).
- `handleWhitelistShoutout` prüft jede Chat-Nachricht. Ein gelisteter Nutzer wird einmal je Session geshoutet, `shoutedOutThisSession` merkt das.
- `stream.online` leert `shoutedOutThisSession`.

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
- Die Whitelist bleibt nach einem Neustart erhalten, `shoutedOutThisSession` nicht.

## Berührte Funktionen/Dateien
`loadWhitelist`, `saveWhitelist`, `addToWhitelist`, `removeFromWhitelist`, `printWhitelist`, `resolveUserByLogin`, `resolveUserById`, `handleWhitelistShoutout`, `rl.on('line')`; `whitelist.json`
