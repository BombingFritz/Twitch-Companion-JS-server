# ADR 0017: Bot-Account „DerBdu“ sendet BdU- und Soldbuch-Nachrichten

**Status:** Akzeptiert (Nutzer, 07.11.2026: Bot genehmigt; „DerBdu“ sendet BdU- und Soldbuch-Nachrichten, Raid- und Whitelist-Shoutouts bleiben beim Broadcaster).

**Kontext:** Bisher postet der Server alles als Broadcaster. Antworten des KI-BdU (ADR 0014) und das Soldbuch (ADR 0016) sollen von einem eigenen Konto kommen, damit sie im Chat als Bot erkennbar sind. Das Konto „DerBdu“ existiert und ist laut Nutzer genehmigt. Laut Twitch-Doku (Chat-Übersicht, geprüft 07.11.2026) zeigt Twitch das „Chat Bot“-Abzeichen nur, wenn der Bot mit einem App-Access-Token sendet. Dafür muss das Bot-Konto der App `user:bot` und `user:write:chat` erteilt haben, und im Kanal braucht es `channel:bot` vom Broadcaster oder Moderatorrechte des Bots.

**Entscheidung:**
- Senden über `POST /helix/chat/messages` mit App-Access-Token (Client-Credentials, nur im RAM, automatisch erneuert) und `sender_id` = Bot.
- Einmalige Freigabe des Bot-Kontos über die neue lokale Adresse `/login-bot` (Scopes `user:bot user:write:chat`, `force_verify`, `state`), Rückkehr über die bestehende `/callback`. Gespeichert werden nur ID und Name des Bots in `bot.json`; Bot-Tokens werden nicht gespeichert, weil das App-Token reicht.
- Im Kanal: Bot als Moderator (`/mod DerBdu`) statt `channel:bot`. Damit bleibt die Anmeldung des Broadcasters unverändert (keine neuen Scopes, kein neues Login).
- Welche Nachrichten der Bot sendet, steht in der Konstante `BOT_FEATURES` (`bdu`, `uboat`). Alles andere bleibt beim Broadcaster. Eine Umstellung per Konsole ist vorgemerkt (Nutzer), aber nicht Teil dieser Entscheidung.
- Rückfall: Ist kein Bot eingerichtet oder lehnt Twitch die Anfrage ab (HTTP-Fehler), postet der Broadcaster und die Konsole meldet den Grund. Hält Twitch eine Nachricht zurück (`is_sent: false`, z. B. AutoMod), gibt es keinen Rückfall, damit der Broadcaster keine Filter umgeht.

**Verworfene Alternativen:**
- **Nutzer-Token des Bots:** kein „Chat Bot“-Abzeichen; zusätzlich müsste ein zweiter Refresh-Token gepflegt werden.
- **`channel:bot` vom Broadcaster:** erfordert ein neues Login des Broadcasters mit erweiterten Scopes; Moderatorrechte genügen und erhöhen das Sendelimit (100 statt 20 Nachrichten je 30 s).
- **Bot als eigener Prozess:** mehr Teile, doppelte EventSub-Verbindung; nicht nötig, da der Bot nur sendet.

**Konsequenzen:**
- Neue Laufzeitdatei `bot.json` (in `.gitignore`), neue Adresse `/login-bot` (nur lokal, Muster `/token`, ADR 0013), Konsolenbefehle `bot show` und `bot remove`, Felder in `/status`.
- Einmalige Einrichtung durch den Nutzer: `/mod DerBdu` im Chat und `/login-bot` in einem Browserfenster, in dem „DerBdu“ bei Twitch angemeldet ist.
- Entzieht das Bot-Konto der App die Freigabe oder verliert es die Moderatorrolle, greift der Rückfall auf den Broadcaster; die Konsole nennt den Fehler.
