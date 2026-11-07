# Spec: Bot-Account „DerBdu“

## Ziel
BdU-Antworten (inkl. Warnung und Funkstille-Ansage) und Soldbuch-Antworten erscheinen im Chat vom Bot-Konto „DerBdu“ mit „Chat Bot“-Abzeichen statt vom Broadcaster. Entscheidung: ADR 0017.

## Verhalten

### Einrichtung (einmalig, durch den Nutzer)
1. Im eigenen Chat: `/mod DerBdu`.
2. Ein Browserfenster öffnen, in dem bei Twitch „DerBdu“ angemeldet ist (z. B. privates Fenster), und `http://localhost:<PORT>/login-bot` aufrufen.
3. Twitch fragt nach der Freigabe `user:bot` und `user:write:chat`; bestätigen. Der Server speichert ID und Name des Bots in `bot.json` und meldet das in Browser und Konsole.

### `/login-bot` (GET)
- Nur lokal (Loopback-Adresse und Host `localhost`/`127.0.0.1`, wie `/token`, ADR 0013); sonst 403.
- Erzeugt einen zufälligen `state` (gültig `BOT_LOGIN_STATE_TTL_MS` = 10 min, im RAM) und leitet zu `https://id.twitch.tv/oauth2/authorize` weiter: `response_type=code`, `client_id`, `redirect_uri` = `REDIRECT_URI`, `scope` = `BOT_SCOPES` (`user:bot user:write:chat`), `force_verify=true`, `state`.

### `/callback` (bestehend, erweitert)
- Ohne `state`: unverändert Broadcaster-Login.
- Mit `state`, der nicht zum offenen Bot-Login passt oder abgelaufen ist: 400, nichts gespeichert, `tokens.json` unverändert.
- Mit passendem `state` (danach verbraucht): Code tauschen, `GET /helix/users` mit dem erhaltenen Token. Abgelehnt (400, nichts gespeichert), wenn
  - das Konto der Broadcaster ist (Hinweis: im Browser als DerBdu anmelden),
  - die erteilten Scopes nicht `user:bot` und `user:write:chat` enthalten.
- Sonst `bot.json` = `{bot_id, bot_login, bot_name, authorized_at}` schreiben (`saveBotConfig`). Das Bot-Token wird nicht gespeichert. `tokens.json` bleibt unverändert.

### App-Access-Token (`getAppAccessToken`)
- `POST https://id.twitch.tv/oauth2/token` mit `grant_type=client_credentials`. Nur im RAM, wiederverwendet bis 5 min vor Ablauf. Bei HTTP 401 vom Chat-Endpoint einmal neu holen und erneut senden.

### Senden (`sendChatMessage(text, replyToMessageId, feature)`)
- Kürzt auf `CHAT_MAX_CHARS` (500).
- `feature` in `BOT_FEATURES` (`['bdu', 'uboat']`) und Bot eingerichtet: Senden mit App-Token, `sender_id` = Bot-ID, `broadcaster_id` = Broadcaster, ggf. `reply_parent_message_id`.
  - HTTP-Fehler (auch nach dem einen erneuten Versuch bei 401): Konsolenwarnung mit Status und Twitch-Meldung, dann Rückfall: Senden als Broadcaster. Bei 403 zusätzlich Hinweis „Ist DerBdu Moderator (/mod DerBdu) und ist die Freigabe noch gültig (/login-bot)?“.
  - Antwort `is_sent: false`: Konsolenwarnung mit `drop_reason`, kein Rückfall.
- Sonst: Senden als Broadcaster wie bisher (Raid-, Whitelist-Shoutouts und alle übrigen Nachrichten).
- `sendBduChatMessage` nutzt `sendChatMessage(…, 'bdu')`; das Soldbuch `sendChatMessage(…, 'uboat')`.

### Konsole und Status
- `bot show`: eingerichtet ja/nein, Name und ID, welche Funktionen über den Bot laufen, letzter Sendefehler, Einrichtungshinweis.
- `bot remove`: `bot.json` löschen; danach sendet wieder der Broadcaster. Die Freigabe bei Twitch bleibt bestehen (entziehen unter twitch.tv → Einstellungen → Verbindungen, angemeldet als DerBdu).
- Startanzeige: `Bot-Account: DerBdu (BdU-Chat, UBOAT-Soldbuch)` bzw. `Bot-Account: nicht eingerichtet – http://localhost:<PORT>/login-bot`.
- `/status`: `bot_configured`, `bot_login`, `bot_features`.

### Konstanten (oben in `server.js`)
`BOT_FILE = './bot.json'`, `BOT_SCOPES = 'user:bot user:write:chat'`, `BOT_FEATURES = ['bdu', 'uboat']`, `BOT_LOGIN_STATE_TTL_MS = 10 min`, `APP_TOKEN_REFRESH_MARGIN_MS = 5 min`.

## Nicht-Ziele (vorerst)
- Umstellen per Konsole, welche Funktion über den Bot sendet (Wunsch Nutzer, später).
- Flüstern, Empfangen von Chat über den Bot, eigene EventSub-Verbindung des Bots.
- Prüfen der Moderatorrolle per API (bräuchte zusätzlichen Scope beim Broadcaster); Fehler zeigt sich beim Senden.

## Akzeptanzkriterien
- Ohne `bot.json`: BdU und Soldbuch posten als Broadcaster (wie bisher); Startanzeige nennt `/login-bot`.
- `/login-bot` lokal: Weiterleitung mit Bot-Scopes, `force_verify` und `state`; mit fremdem Host: 403.
- `/callback` mit falschem `state`: 400, `bot.json` fehlt, `tokens.json` unverändert. Mit passendem `state` und Bot-Konto: `bot.json` geschrieben, `tokens.json` unverändert. Mit Broadcaster-Konto oder fehlenden Scopes: 400.
- Mit Bot: BdU-Antwort, BdU-Warnung und Soldbuch werden mit App-Token und `sender_id` = Bot gesendet, Antworten als Reply. Raid-Begrüßung und Whitelist-Hinweis bleiben beim Broadcaster (Code unverändert; im Test nur per Quelltextprüfung abgedeckt).
- App-Token wird für mehrere Nachrichten nur einmal geholt; nach 401 einmal neu.
- HTTP 403 vom Bot-Versand: Rückfall auf den Broadcaster, Warnung mit Moderator-Hinweis. `is_sent: false`: kein Rückfall.
- `bot remove`: Datei weg, nächste Nachricht vom Broadcaster. `/status` zeigt die Bot-Felder.
- Tests mit Attrappen (`test/bot-test.js`), kein echter Twitch-Aufruf.

## Status
umgesetzt (Branch `feat/bot-derbdu`). Test mit Attrappen: 24/24 (`test/bot-test.js`, Szenarien `ablauf` und `eingerichtet`). Gegen echtes Twitch noch nicht erprobt: Freigabe über `/login-bot`, Abzeichen „Chat Bot“, Verhalten ohne Moderatorrolle [UNGEKLÄRT, bei der Einrichtung prüfen].
