# Architektur (Ist-Zustand)

Hauptdatei `server.js`; das UBOAT-Soldbuch liegt als eigenes Modul in `lib/` (`uboat-save.js`: Spielstand-Format, `uboat-crew.js`: Einlesen, Beobachtung, Zuordnung, Text; ADR 0016); die Webkonsole liegt in `public/admin/` (ADR 0018). Laufzeit: Node.js ≥ 18, Express 5, `ws`, `axios`, `dotenv`, `cors`, `readline`. Abhängigkeiten in `package.json`, Start mit `npm start`.

## 1. Datenfluss

```
Widget --GET /token, /api/...--> server.js --> Twitch Helix API
Twitch --EventSub WebSocket--> server.js
server.js --scheduleEffect()--> effectQueue --POST--> HA_WEBHOOK_URL
Chat "!raidstats" --> server.js --> Leaderboard in Twitch-Chat
Chat "!BdU …" --> server.js --SSE /api/bdu/stream--> Enigma-Widget (KI) --POST /api/bdu/answer--> server.js --> Antwort im Chat von DerBdu (ohne Bot: "FT vom BdU: …" vom Broadcaster)
UBOAT-Saves-Ordner --nur lesen--> lib/uboat-crew.js (RAM) ; Chat "!soldbuch" --> server.js --> Soldbuch im Chat über Bot DerBdu (kein Treffer: nur Konsole) ; Widget --GET /api/uboat/crew
Bot-Nachrichten: server.js --App-Access-Token, sender_id = Bot--> Helix /chat/messages (Rückfall: Broadcaster-Token; ADR 0017)
Konsole (readline) --> server.js
Browser am Streaming-PC --GET /TwitchCompanionAdmin, /api/admin/overview--> server.js (nur lokal, ADR 0018)
console.log/info/warn/error --> Puffer (RAM, bereinigt) --SSE /api/admin/log/stream--> Reiter Live-Log (nur lokal, ADR 0018)
console.error --> error_log.json (bereinigt, letzte 1000) --GET /api/admin/log/errors--> Fehlerprotokoll im Reiter Live-Log
Browser am Streaming-PC --GET/POST /api/admin/whitelist…--> server.js --> whitelist.json (Name oder ID über Helix aufgelöst)
Browser am Streaming-PC --POST /api/admin/server/shutdown|restart--> server.js --Exit 0 oder 75--> AuthServer.cmd (bei 75 Neustart im selben Fenster)
```

## 2. Module und Funktionen

| Bereich | Funktionen / Zustand |
|---|---|
| Tokens | `loadTokens`, `saveTokens`, `getValidAccessToken` |
| Zugriffsschutz (ADR 0013) | `isAllowedOrigin` (Browser-Herkunft), `isLoopbackRequest` (Aufruf vom eigenen Rechner), `hasLoopbackHost` (Host-Header, gegen DNS-Rebinding); Middleware für Herkunftsprüfung, CORS und `Cache-Control: no-store` |
| Login (ADR 0013, 0017) | `requireLocalRequest` (nur lokal für `/login`, `/login-bot`, `/callback`), `createLoginState`, `takeLoginState`; RAM: `pendingLogins` (state → Art, einmal gültig) |
| Bot-Account (ADR 0017) | `loadBotConfig`, `saveBotConfig`, `getAppAccessToken`, `handleBotCallback`, `sendChatMessageAsBot`, `checkChatSendResult`, `botFeatureLabels`, `printBotStatus`; RAM: `appAccessToken`, `botLastError` |
| Raid-Tracking | `loadRaidLog`, `saveRaidLog`, `getPeriodKey`, `getPeriodWord`, `trackRaid`, `getRanks`, `getLeaderboardText`, `pick` |
| Whitelist | `loadWhitelist`, `saveWhitelist`, `addToWhitelist`, `removeFromWhitelist`, `printWhitelist`, `resolveUserByLogin`, `resolveUserById` |
| Sub-Goal | `loadSubGoalCache`, `saveSubGoalCache`, `refreshSubGoalCache` |
| Event-Log | `loadEventLog`, `saveEventLog`, `appendEvent` |
| Effekt-Modus | `loadEffectMode`, `saveEffectMode`, `setEffectMode` (einziger Weg zum Umschalten, für HTTP und Konsole); RAM: `effectMode`, `pendingManualConfirmation` |
| Modul-Schalter | `loadModuleSwitches`, `saveModuleSwitches`, `setModuleSwitch`, `switchModule` (Konsole `bdu`/`uboat activate\|deactivate` und Webkonsole), `moduleStateLabel`; RAM: `moduleSwitches`. Abgefragt in `handleBduCommand` und `handleUboatCommand` |
| Effekt-Queue | `scheduleEffect`, `enqueueEffect`, `describeEffect`, `triggerEffect`, `runManualConfirmation`, `processEffectQueue`; RAM: `pendingBursts`, `effectQueue`, `isProcessingEffectQueue`, `lastEffectSentAt` |
| Entdoppelung | `pruneOldEntries`, `isDuplicateMessage`, `wasRecentlyTriggered`; RAM: `seenMessageIds`, `recentSubByUser`, `recentFollowByUser` |
| Logging | `logIfChanged`, HTTP-Middleware (unterdrückt direkt aufeinanderfolgende identische `[HTTP] …`-Zeilen) |
| Live-Log (ADR 0018) | `sanitizeLogText`, `recordLogLine`, `writeLogEntry`, `logRedactedValues`, `loadErrorLog`, `saveErrorLog`, `appendErrorLog`; `console.log/info/warn/error` werden umhüllt; RAM: `logBuffer`, `logClients`, `nextLogId`, `logRedactions`, `errorLog` |
| EventSub | `connectEventSub`, `subscribeToRaid`, `subscribeToChat`, `subscribeToStreamOnline`, `subscribeToSubscriptions`, `subscribeToChatNotifications`, `subscribeToFollows`, `subscribeToChannelUpdate`, `handleChatNotification`; in `connectEventSub` intern `armKeepalive` (Zeitgeber für die Keepalive-Überwachung) |
| Chat | `isModOrBroadcaster`, `handleChatCommand`, `handleWhitelistShoutout`, `getChannelActivity`, `buildWhitelistShoutoutMessage`, `formatDateDe`, `loadWhitelistChecks`, `saveWhitelistChecks`, `recordWhitelistCheck`, `printWhitelistChecks` (ADR 0015), `sendChatMessage` (optional als Reply, kürzt auf `CHAT_MAX_CHARS`; mit `feature` aus `BOT_FEATURES` über den Bot), `sendShoutout` |
| Kategorie | `refreshChannelCategory` (beim `session_welcome`), `setCurrentCategory` (auch aus `channel.update`); RAM: `currentCategory` |
| UBOAT-Soldbuch (ADR 0016) | `server.js`: `handleUboatCommand`, `isUboatCategoryActive`, `loadUboatCrewMap`, `saveUboatCrewMap`, `printUboatStatus`; RAM: `uboatCrew`, `uboatLastAnswerByUser`. `lib/uboat-crew.js`: `createUboatCrew` (`start`, `stop`, `reload`, `getState`, `hasData`, `findMember`, `formatAkte`); intern `normalizeName`, `STATUS_LABELS`, `WOUNDED_STATUS_LABELS`; RAM: gelesener Spielstand und Crew. `lib/uboat-save.js`: `parseSave`, `parseLocales` (Aufruf `node lib/uboat-save.js <Spielstand> [Locales.dat]` zur Diagnose) |
| BdU-Chat (ADR 0014) | `handleBduCommand`, `sendBduChatMessage`, `startBduSilence`, `isBduSilenceActive`, `bduDailyLimitReached`, `printBduStatus`, `isLocalWidgetRequest`, `formatClock`; RAM: `bduClients`, `bduPending`, `bduAcceptedByUser`, `bduLastAcceptedAt`, `bduLastWarningAt`, `bduSilenceUntil`, `bduSilenceEndedAt`, `bduDailyKey`, `bduDailyCount`, `bduRequestCounter` |
| Raid | `enqueueRaidEvent`, `processRaidQueue`, `handleRaidEvent`, `buildBaseMessage`, `buildGameMessage`, `buildRankRepeatMessage`, `buildRepeatOnlyMessage`, `buildViewerRankMessage`, `buildClosingMessage`; RAM: `raidQueue`, `isProcessingQueue`, `lastRaidGreetingSentAt`, `lastRaidstatsCommandAt` |
| Sessions | RAM: `shoutedOutThisSession`, `eventSubWs`, `eventSubReconnectTimer` |
| Konsole | `printConsoleHelp`, `rl.on('line', …)` |
| Status | `buildAuthStatus`, `buildRuntimeStatus` (gemeinsam für `/status` und die Webkonsole) |
| Webkonsole (ADR 0018) | `requireAdminPage`, `requireAdminApi`, `requireAdminWrite` (ändernde Aktionen), `endServerFromAdmin`, `parseWhitelistInput`; RAM: `adminOrigins`, `adminExitRequested`. Seite: `public/admin/` (`index.html`, `admin.js` mit Reiterliste `TABS`, `admin.css`) |

## 3. Persistierte Dateien (Arbeitsverzeichnis)

| Datei | Struktur |
|---|---|
| `tokens.json` | `{access_token, refresh_token, broadcaster_id, broadcaster_name, obtained_at, expires_in, expires_at}` |
| `raids.json` | `{ "<Periode>": { "<raiderId>": {name, count, totalViewers} } }`, Periode bis 2026 je Quartal (z. B. `2026-Q4`), ab 2027 je Jahr (z. B. `2027`), ADR 0012 |
| `whitelist.json` | `{ "<userId>": "<userName>" }` |
| `subgoal_cache.json` | `{current, target, title, goalId, status, lastUpdated}` |
| `events.json` | Array, max. 200 Einträge: `{type, ...meta, count, timestamp[, skippedManualTimeout]}` |
| `effect_mode.json` | `{mode}` mit `auto`, `manual` oder `off`; fehlt die Datei oder ist ungültig: `auto` |
| `whitelist_checks.json` | Array, max. 500 Einträge: `{timestamp, userId, userName, result: live\|inaktiv\|unklar, shoutout, lastActiveAt, lastLiveAt, game, error?}` (ADR 0015) |
| `uboat_crew_map.json` | `{ "<twitch_login>": "<Name im Spiel>" }`, Login in Kleinbuchstaben (ADR 0016); fehlt die Datei: leer |
| `modules.json` | `{bdu, uboat}` je `true`/`false` (Modul-Schalter); fehlt die Datei, ein Eintrag oder ist sie ungültig: Modul an |
| `bot.json` | `{bot_id, bot_login, bot_name, authorized_at}` (ADR 0017), keine Tokens; fehlt die Datei: kein Bot, alles als Broadcaster |
| `error_log.json` | Array, max. 1000 Einträge, älteste zuerst: `{at, pid, text}`, Text bereinigt (ADR 0018); fehlt die Datei oder ist sie ungültig: leer. Geschrieben über `error_log.json.tmp` |

Gelesen, nie geschrieben: der neueste `*.save` in `UBOAT_SAVES_DIR` und `..\Data Sheets\UBOAT - Locales.dat` (deutsche Namen).

## 4. HTTP-Endpoints

Alle GET außer `POST /api/bdu/answer` (ADR 0014), `POST /api/admin/server/…`, `POST /api/admin/whitelist/…` und `POST /api/admin/modules` (ADR 0018). Alle Antworten mit `Cache-Control: no-store`.

Zugriffsschutz (ADR 0013):
- Browser-Anfragen mit `Origin`-Header werden nur von erlaubten Herkünften angenommen, sonst `403 {error, origin}`, bevor ein Endpoint etwas ausführt. Standard: `http://absolute` (OBS-Browser-Source mit „Lokale Datei“) und `null` (Datei per `file://`), dazu immer `http://localhost:<PORT>` und `http://127.0.0.1:<PORT>`. Änderbar über `CORS_ORIGINS`; `*` stellt das alte Verhalten (jede Herkunft) wieder her.
- Anfragen ohne `Origin` (Stream Deck, Home Assistant, Adresszeile des Browsers) sind nicht betroffen.
- OBS-Widgets werden per URL `file:///…` eingebunden (Herkunft `null`), nicht als „Lokale Datei“: Neuere OBS-Versionen sperren Anfragen von `http://absolute` an `localhost`, bevor sie den Server erreichen.
- `/token` antwortet nur auf Aufrufe vom selben Rechner (Loopback-Adresse) mit Host `localhost`, `127.0.0.1` oder `[::1]`, sonst `403`. Der Host-Check verhindert DNS-Rebinding.
- `/TwitchCompanionAdmin` und `/api/admin/…` sind ebenso nur lokal. Für `/api/admin/…` muss ein gesetzter `Origin` zusätzlich genau `http://localhost:<PORT>` oder `http://127.0.0.1:<PORT>` sein; `null`, `http://absolute` und `CORS_ORIGINS` (auch `*`) gelten dort nicht (ADR 0018).

| Pfad | Antwort | Fehler |
|---|---|---|
| `/login` | Redirect zu Twitch OAuth (`SCOPES`, `+` wird zu Leerzeichen; `state`) | 403 bei Aufruf aus dem Netzwerk oder fremdem Host |
| `/login-bot` | Redirect zu Twitch OAuth für das Bot-Konto (`BOT_SCOPES`, `force_verify`, `state`; ADR 0017) | 403 bei Aufruf aus dem Netzwerk oder fremdem Host |
| `/callback?code=&state=` | `state` von `/login`: tauscht Code gegen Tokens, schreibt `tokens.json`, startet EventSub falls nicht verbunden. `state` von `/login-bot`: schreibt nur `bot.json`. Jeder `state` gilt einmal, 10 min | 403 bei Aufruf aus dem Netzwerk oder fremdem Host; 400 ohne gültigen `state` (nichts gespeichert), ohne `code`, bei Bot-Login mit Broadcaster-Konto oder fehlenden Scopes; 500 bei Fehler |
| `/token` | `{access_token, broadcaster_id, client_id}`; loggt einmal je Herkunft `[Token] Ausgabe an Widget-Herkunft: …` | 401 `{error, hint}`; 403 bei Aufruf aus dem Netzwerk oder fremdem Host |
| `/status` | `{authenticated, broadcaster_id, broadcaster_name, token_valid, expires_in_seconds, expires_in_minutes, auto_refresh, eventsub_connected, raid_queue_length, whitelist_count, effect_mode, effect_queue_length, allowed_origins, modules, bot_configured, bot_login, bot_features, bdu_widget_connected, bdu_silence_until, uboat_enabled, uboat_active, uboat_save, uboat_saved_at, pid, started_at}` (`modules`: `{bdu, uboat}` Modul-Schalter; `bot_*`: Bot-Account laut `bot.json` und `BOT_FEATURES`; `uboat_enabled`: `UBOAT_SAVES_DIR` gesetzt; `uboat_active`: Kategorie ist UBOAT; `uboat_saved_at`: Änderungszeit des gelesenen Spielstands als ISO-Zeit oder `null`; `bdu_silence_until`: `null`, ISO-Zeit oder „bis Streamstart“; `pid`: Prozess-ID, `started_at`: Startzeit als ISO-Zeit, um bei mehreren Prozessen den antwortenden zu erkennen); ohne Tokens `{authenticated:false, message, pid, started_at}` | – |
| `/TwitchCompanionAdmin` | Webkonsole: statische Dateien aus `public/admin/` (leitet auf dieselbe Adresse mit `/` am Ende; Groß-/Kleinschreibung egal), mit `Content-Security-Policy` ohne Einbettung. Nur lokal | 403 bei Aufruf aus dem Netzwerk oder fremdem Host; 404 außerhalb von `public/admin` |
| `/api/admin/overview` | Felder von `/status` ohne `allowed_origins` und `broadcaster_id`, dazu `{version, port, poll_ms, can_restart (Start über AuthServer.cmd), ha_webhook_configured (nur ja/nein, nie die Adresse), category, pending_confirmation: {type,count} oder null, recent_effects[{type, count, userName, giftCount, skipped, timestamp}] (letzte 5, neuester zuerst), subgoal{current, target, title, status, lastUpdated}}`; ohne Tokens `authenticated:false` und die Laufzeitwerte. Erfolgreiche Abrufe erscheinen nicht im HTTP-Protokoll | 403 bei Aufruf aus dem Netzwerk, fremdem Host oder fremder Herkunft |
| `/api/admin/log/stream` | Server-Sent Events für den Live-Log: `retry: 5000`, Ereignis `hello` `{pid, started_at}`, dann der Puffer und jede neue Zeile als `line` `{id, at, level: info/warn/error, text}`, Kommentar-Ping alle 30 s. Texte ohne Secrets, Tokens, Webhook-Adresse und private Adressen | 403 bei Aufruf aus dem Netzwerk, fremdem Host oder fremder Herkunft |
| `/api/admin/log/errors` | `{entries: [{at, pid, text}] (neuester zuerst, höchstens 1000), limit}` aus `error_log.json` | 403 bei Aufruf aus dem Netzwerk, fremdem Host oder fremder Herkunft |
| `/api/admin/whitelist` | `{entries: [{id, name}] (nach Namen), count}` | 403 bei Aufruf aus dem Netzwerk, fremdem Host oder fremder Herkunft |
| `POST /api/admin/whitelist/add` | JSON `{user}` (Name, `@Name` oder ID); `{ok:true, entry:{id, name}}` | 403 wie `POST /api/admin/server/…`; 415 ohne JSON; 400 ungültig; 404 Konto unbekannt; 409 schon gelistet; 413 zu groß; 502 Twitch nicht erreichbar |
| `POST /api/admin/whitelist/remove` | JSON `{id}`; `{ok:true, id}` | 403 und 415 wie oben; 400 ungültige ID; 404 nicht gelistet; 413 zu groß |
| `POST /api/admin/modules` | JSON `{module: bdu/uboat, enabled: true/false}`; `{ok:true, changed, modules:{bdu, uboat}}` | 403 und 415 wie die übrigen POST; 400 unbekanntes Modul oder kein Wahrheitswert; 413 zu groß |
| `POST /api/admin/server/shutdown` | `{ok:true, pid, at}`, danach endet der Prozess nach 300 ms mit Exit-Code 0 | 403 aus dem Netzwerk, mit fremdem Host, ohne oder mit fremder Herkunft; 415 ohne JSON; 409 wenn er schon endet |
| `POST /api/admin/server/restart` | wie oben, Exit-Code 75; `AuthServer.cmd` startet neu | wie oben; zusätzlich 409 ohne `AuthServer.cmd` |
| `/api/twitch/prediction/current` | `{status:'WAITING'}` oder `{predictionId, title, status, outcomes[{id,title,channelPoints,users}], createdAt, locksAt, endsAt}` für die letzte Prediction, auch bei anderem Status als ACTIVE/LOCKED | 500 `{error, status:'ERROR', message}` |
| `/api/twitch/subcounter` | `{current, target, title, goalId, status, lastUpdated, apiStatus:'OK'}`; lädt von Twitch, wenn `current` im Cache `null` ist | 500 `{error, apiStatus:'ERROR', message}` |
| `/api/homeassistant/events` | `{lastEvent, recentEvents (letzte 20), counts{follow,sub,gift}, totalLogged}` | – |
| `/api/effects/mode/:mode` | Setzt Modus (`auto`/`manual`/`off`), `{ok:true, mode}` | 400 `{error}` |
| `/api/effects/mode` | `{mode, queueLength, pendingConfirmation: {type,count} oder null}` | – |
| `/api/effects/confirm` | `{ok, message}`; bestätigt den wartenden Effekt im Modus `manual` | – |
| `/api/uboat/crew` | `{enabled, active, category, source, savedAt, loadedAt, gameVersion, crew[{name, type, typeLabel, characterClass, classLabel, level, experiencePoints, experiencePointsFromLastPatrol, born, decorations, died, traits, skills, status, statusLabel, wounded, woundLabel}]}` (`statusLabel`: „an Bord“, „in Reserve“, „gefallen“ oder `null`; `woundLabel`: „verwundet“, „im Krankenhaus“ oder `null`); ohne `UBOAT_SAVES_DIR` `{enabled:false, active:false, category, crew:[]}` (ADR 0016) | – |
| `/api/bdu/stream` | Server-Sent Events für das Enigma-Widget: `retry: 5000`, Ereignis `hello`, Ereignis `request` mit `{id, text}`, Kommentar-Ping alle 30 s. Nur lokal (wie `/token`) | 403 bei Aufruf aus dem Netzwerk oder fremdem Host |
| `POST /api/bdu/answer` | JSON `{id, status: ok/quota/error, text?, error?}`; `ok` postet die Antwort als Reply (über DerBdu ohne Präfix, als Broadcaster mit „FT vom BdU: “), `quota` startet Funkstille; Antwort `{ok:true}`, bei `quota` `{ok:true, silenceUntil}` (Millisekunden-Zeitstempel; beim Tageskontingent `null`, weil intern `Infinity`). `ok` ohne Text wird wie `error` behandelt. Nur lokal | 404 bei unbekannter/abgelaufener `id`; 403 wie oben |

## 5. Konsolenbefehle

| Befehl | Wirkung |
|---|---|
| `whitelist add <id> <name>` | Nutzer per ID und Name eintragen |
| `whitelist add <id>` | Name per API auflösen |
| `whitelist add @<name>` | ID per API auflösen |
| `whitelist remove <id>` | Eintrag entfernen |
| `whitelist list` | Whitelist anzeigen |
| `whitelist checks` | Letzte 20 Auffälligkeiten der Aktivitätsprüfung (live beim Chatten, inaktiv, unklar) |
| `subgoal refresh` | Sub-Goal von Twitch laden |
| `subgoal show` | Gecachten Stand anzeigen |
| `events show` | Letzte 10 Log-Einträge anzeigen |
| `effects mode <auto\|manual\|off>` | Effekt-Modus setzen und speichern |
| `effects show` | Modus, Queue-Länge, wartende Bestätigung anzeigen |
| `bdu show` | BdU-Chat: Widget verbunden, Funkstille, offene Anfragen, Tageszähler, nächste mögliche Annahme |
| `bdu silence off` | BdU-Chat: Funkstille sofort aufheben |
| `bdu activate` / `bdu deactivate` | BdU-Chat ein- bzw. ausschalten, gespeichert in `modules.json`. Deaktiviert: `!BdU` wird still ignoriert (Konsolenzeile), offene Anfragen werden verworfen, späte Antworten des Widgets nicht gepostet; Widget-Verbindung bleibt |
| `uboat show` | UBOAT: Ordner, gelesener Spielstand mit Stand und Spielversion, Kategorie, Crew mit Zuordnungen, Zuordnungen ohne passendes Crewmitglied |
| `uboat reload` | UBOAT: neuesten Spielstand sofort einlesen |
| `uboat map <login> <Name im Spiel>` | UBOAT: Zuordnung in `uboat_crew_map.json` setzen (Name darf Leerzeichen enthalten) |
| `uboat unmap <login>` | UBOAT: Zuordnung entfernen |
| `uboat activate` / `uboat deactivate` | UBOAT-Soldbuch ein- bzw. ausschalten, gespeichert in `modules.json`. Deaktiviert: `!soldbuch` wird still ignoriert; der Spielstand wird weiter eingelesen, `/api/uboat/crew` bleibt aktuell. Ohne `UBOAT_SAVES_DIR` bleibt das Soldbuch trotz `activate` aus |
| `bot show` | Bot-Account: Name und ID, Funktionen über den Bot, letzter Sendefehler; ohne Bot Einrichtungshinweis |
| `bot remove` | `bot.json` löschen, danach sendet wieder der Broadcaster (Freigabe bei Twitch bleibt bis zum Entzug durch das Bot-Konto) |
| `help` | Befehlsübersicht (auch beim Start) |

Es gibt keinen Konsolenbefehl zum Bestätigen eines Effekts.

## 6. EventSub

Alle Subscriptions werden beim `session_welcome` einer frischen Verbindung angelegt, Reihenfolge wie unten (nicht nach `session_reconnect`, siehe „Verbindungsverwaltung“).

| Typ | Version | Condition | Verarbeitung |
|---|---|---|---|
| `channel.raid` | 1 | `to_broadcaster_user_id` | `enqueueRaidEvent` |
| `channel.chat.message` | 1 | `broadcaster_user_id`, `user_id` (je Broadcaster) | `handleChatCommand`, `handleBduCommand`, `handleUboatCommand`, `handleWhitelistShoutout` |
| `stream.online` | 1 | `broadcaster_user_id` | `shoutedOutThisSession` leeren, `refreshSubGoalCache` |
| `channel.subscribe` | 1 | `broadcaster_user_id` | nur `refreshSubGoalCache` |
| `channel.subscription.gift` | 1 | `broadcaster_user_id` | nur `refreshSubGoalCache` |
| `channel.subscription.message` | 1 | `broadcaster_user_id` | nur `refreshSubGoalCache` |
| `channel.chat.notification` | 1 | `broadcaster_user_id`, `user_id` (je Broadcaster) | `handleChatNotification` |
| `channel.follow` | 2 | `broadcaster_user_id`, `moderator_user_id` (Broadcaster) | `scheduleEffect('follow')` |
| `channel.update` | 2 | `broadcaster_user_id` | `setCurrentCategory(category_name)`; kein Scope nötig |

Nach den Subscriptions holt `refreshChannelCategory()` die aktuelle Kategorie per `GET /helix/channels`.

Für jede Notification gilt vorab: Eine bereits gesehene `metadata.message_id` wird ignoriert.

### Verbindungsverwaltung

- `eventSubWs` ist die aktive Verbindung. Nur ihr Ende löst einen Neuaufbau aus.
- `session_reconnect`: `connectEventSub(reconnect_url)` öffnet eine zweite Verbindung. Die alte bleibt offen, bis die neue `session_welcome` erhält. Dann wird die neue aktiv und die alte geschlossen. Subscriptions werden dabei nicht neu angelegt, Twitch überträgt sie auf die neue Session.
- Scheitert die Reconnect-Verbindung vor dem Welcome, bleibt die alte aktiv.
- Unerwartetes Ende der aktiven Verbindung: nach `EVENTSUB_RECONNECT_DELAY_MS` frische Verbindung zu `EVENTSUB_WS_URL` mit neuen Subscriptions. Es ist höchstens ein Neuaufbau geplant (`eventSubReconnectTimer`); `/callback` während der Wartezeit ersetzt ihn.
- Keepalive: Jede Verbindung merkt sich nach `session_welcome` das Intervall `keepalive_timeout_seconds` (fehlt es: `EVENTSUB_KEEPALIVE_DEFAULT_S`). Jede Nachricht (Ereignis, `session_keepalive`, Reconnect) setzt die Frist neu. Kommt länger als Intervall plus `EVENTSUB_KEEPALIVE_GRACE_MS` nichts, wird die Verbindung hart getrennt (`terminate`). Bei der aktiven Verbindung folgt der übliche Neuaufbau, eine nicht aktive wird nur geschlossen.

### Effekt-Auslöser

| Effekt-Typ | Quelle |
|---|---|
| `follow` | `channel.follow`, pro `user_id` einmal je 60 s |
| `sub` | `channel.chat.notification` mit `notice_type` `sub` oder `resub`, pro Nutzer einmal je 60 s; Meldungen mit `is_gift` und Meldungen aus fremdem Shared-Chat-Kanal werden ignoriert |
| `gift` | `notice_type` `community_sub_gift` (ein Effekt, `giftCount` = `total`) oder `sub_gift` ohne `community_gift_id` (`giftCount` 1) |

## 7. Konstanten

| Name | Wert | Bedeutung |
|---|---|---|
| `RAIDSTATS_COOLDOWN_MS` | 30000 | Abstand zwischen `!raidstats` |
| `RAID_GREETING_MIN_GAP_MS` | 90000 | Abstand zwischen Raid-Begrüßungen |
| `RAID_YEARLY_FROM_YEAR` | 2027 | Ab diesem Jahr Raid-Statistik je Kalenderjahr statt je Quartal |
| `SHOUTOUT_ACTIVITY_WINDOW_DAYS` | 40 | Whitelist-Shoutout nur bei Aktivität in diesem Zeitraum (ADR 0015) |
| `SHOUTOUT_ACTIVITY_STRICT` | `false` | Testphase: bei unklarer Aktivität (kein Video, API-Fehler) trotzdem Shoutout; später `true` |
| `WHITELIST_SHOUTOUT_DELAY_MS` | 2000 | Abstand zwischen Chat-Hinweis und Whitelist-Shoutout |
| `WHITELIST_CHECKS_MAX` | 500 | Einträge in `whitelist_checks.json` |
| `WHITELIST_CHECK_LABELS` | Texte je Ergebnis (`live`, `inaktiv`, `unklar`) | Anzeige in `whitelist checks` |
| `MODULE_NAMES` | `{bdu: 'BdU-Chat', uboat: 'UBOAT-Soldbuch'}` | Per Konsole schaltbare Chat-Module und ihre Anzeigenamen; Dateinamen der Laufzeitdateien stehen in Abschnitt 3 |
| `EFFECT_BURST_WINDOW_MS` | 2500 | Bündelungsfenster je Effekt-Typ, Timer startet bei jedem Ereignis neu |
| `EFFECT_MIN_GAP_MS` | 4000 | Abstand zwischen zwei Effekten |
| `EFFECT_MANUAL_CONFIRM_TIMEOUT_MS` | 30000 | Wartezeit auf Bestätigung im Modus `manual` |
| `EVENT_MESSAGE_ID_TTL_MS` | 600000 | Merkdauer von `message_id` |
| `SUB_DEDUPE_WINDOW_MS` | 60000 | Sub-Effekt pro Nutzer |
| `FOLLOW_DEDUPE_WINDOW_MS` | 60000 | Follow-Effekt pro Nutzer |
| `EVENTSUB_WS_URL` | `wss://eventsub.wss.twitch.tv/ws` | Standard-URL für frische EventSub-Verbindungen |
| `EVENTSUB_RECONNECT_DELAY_MS` | 5000 | Wartezeit vor Neuaufbau nach Verbindungsende |
| `EVENTSUB_KEEPALIVE_DEFAULT_S` | 10 | Keepalive-Intervall, falls `session_welcome` keines liefert |
| `EVENTSUB_KEEPALIVE_GRACE_MS` | 5000 | Zuschlag, bevor eine stille Verbindung als abgebrochen gilt |
| `DEFAULT_CORS_ORIGINS` | `['http://absolute', 'null']` | Erlaubte Browser-Herkünfte, wenn `CORS_ORIGINS` leer ist |
| `LOOPBACK_ADDRESSES` | `127.0.0.1`, `::1`, `::ffff:127.0.0.1` | Erlaubte Absender-Adressen für `/token` |
| `LOOPBACK_HOSTNAMES` | `localhost`, `127.0.0.1`, `[::1]` | Erlaubte Host-Header für `/token` und die BdU-Endpoints |
| `ADMIN_DIR` | `public/admin` neben `server.js` | Einziger Ordner, den die Webkonsole ausliefert |
| `ADMIN_PAGE_PATH` | `/TwitchCompanionAdmin` | Adresse der Webkonsole im Browser |
| `ADMIN_OVERVIEW_PATH` / `ADMIN_POLL_MS` / `ADMIN_RECENT_EFFECTS` | `/api/admin/overview` / 5000 / 5 | Datenquelle der Hauptseite, Abfrageabstand, Anzahl letzter Effekte |
| `ADMIN_CSP` | `default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` | Header der Webkonsole |
| `ADMIN_SHUTDOWN_PATH` / `ADMIN_RESTART_PATH` | `/api/admin/server/shutdown` / `/api/admin/server/restart` | Knöpfe der Webkonsole |
| `ADMIN_EXIT_DELAY_MS` | 300 | Zeit für die Antwort an die Seite, bevor der Prozess endet |
| `SERVER_RESTART_EXIT_CODE` | 75 | `AuthServer.cmd` startet nur bei diesem Code neu |
| `SERVER_SUPERVISED` | `TWITCH_COMPANION_SUPERVISED=1`, gesetzt von `AuthServer.cmd` | Neustart aus der Webkonsole möglich |
| `ADMIN_LOG_STREAM_PATH` / `ADMIN_LOG_PING_MS` | `/api/admin/log/stream` / 30000 | Live-Log-Verbindung und Lebenszeichen |
| `ADMIN_LOG_BUFFER_LINES` / `ADMIN_LOG_MAX_CHARS` | 1000 / 4000 | Größe des Log-Puffers, Kürzung langer Einträge |
| `LOG_REDACTED` / `LOG_PRIVATE_ADDRESS` | `<entfernt>` / `<privat>` | Platzhalter im Live-Log |
| `ADMIN_ERROR_LOG_PATH` / `ERROR_LOG_MAX_ENTRIES` | `/api/admin/log/errors` / 1000 | Fehlerprotokoll |
| `ADMIN_WHITELIST_PATH` / `ADMIN_MODULES_PATH` / `ADMIN_JSON_LIMIT` | `/api/admin/whitelist` / `/api/admin/modules` / `1kb` | Pfade der Webkonsole, Größe ihrer JSON-Anfragen |
| `TWITCH_LOGIN_PATTERN` / `TWITCH_ID_PATTERN` | `^[a-z0-9_]{1,25}$` / `^\d{1,20}$` | Prüfung von Eingaben der Webkonsole |
| `APP_VERSION` | aus `package.json` | Anzeige in der Webkonsole |
| `BDU_COMMAND` | `!bdu` | Chat-Befehl (Groß-/Kleinschreibung egal) |
| `BDU_MAX_INPUT_CHARS` | 200 | Kürzung des Textes nach dem Befehl |
| `BDU_GLOBAL_COOLDOWN_MS` | 180000 | Abstand zwischen angenommenen Anfragen |
| `BDU_USER_WINDOW_MS` / `BDU_USER_MAX` | 1800000 / 3 | Anfragen je Nutzer im Zeitfenster |
| `BDU_WARNING_COOLDOWN_MS` | 600000 | Abstand zwischen Warnungen |
| `BDU_ANSWER_TIMEOUT_MS` | 120000 | Wartezeit auf die Antwort des Widgets |
| `BDU_SILENCE_MS` | 1800000 | Funkstille nach Minutenlimit der KI |
| `BDU_DAILY_LIMIT` | 60 | Angenommene Anfragen je Kalendertag (0 = aus) |
| `BDU_SSE_PING_MS` | 30000 | Lebenszeichen auf der Events-Verbindung |
| `BDU_REPLY_PREFIX` | `FT vom BdU: ` | Präfix (nur wenn der Broadcaster sendet, ADR 0017); Längengrenze über `CHAT_MAX_CHARS` |
| `BDU_WARNING_TEXT` | „Funkverkehr einschränken, Feind peilt ein!“ | Warnung bei Limit-Verstoß |
| `CHAT_MAX_CHARS` | 500 | Twitch-Längengrenze in `sendChatMessage` |
| `BOT_SCOPES` | `user:bot user:write:chat` | Freigabe des Bot-Kontos über `/login-bot` (ADR 0017) |
| `BOT_FEATURES` | `['bdu', 'uboat']` | Diese Funktionen senden über den Bot; alles andere als Broadcaster |
| `LOGIN_STATE_TTL_MS` / `APP_TOKEN_REFRESH_MARGIN_MS` | 600000 / 300000 | Gültigkeit eines begonnenen Logins (`state`, Broadcaster und Bot); App-Token so lange vor Ablauf erneuern |
| `UBOAT_COMMAND` | `!soldbuch` | Chat-Befehl (Groß-/Kleinschreibung egal) |
| `UBOAT_USER_COOLDOWN_MS` | 60000 | Höchstens eine Antwort je Zuschauer |
| `UBOAT_CATEGORY_NAMES` | `['UBOAT']` | Kategorie, in der der Befehl antwortet [UNGEKLÄRT: Name bei Twitch prüfen] |
| `UBOAT_SAVE_SETTLE_MS` | 3000 | Spielstand erst lesen, wenn so lange unverändert |
| `UBOAT_POLL_MS` | 60000 | Abfrage des Ordners zusätzlich zur Dateibeobachtung |
| `UBOAT_KNOWN_GAME_VERSIONS` | `['2026.1 Patch 21']` | Erprobte Spielversionen; andere: Konsolenhinweis |
| `UBOAT_HIDDEN_SKILLS` | `['Authority', 'Skipper']` | Im Soldbuch nicht genannt |
| `UBOAT_FRESH_MS` | 3600000 | Spielstand höchstens so alt: „Der Eintrag ist aktuell.“ im Soldbuch |
| `UBOAT_TEXT_UNAVAILABLE` | „Die Soldbücher sind gerade nicht verfügbar.“ | Antwort, solange kein Spielstand gelesen ist; kein Treffer: keine Chat-Antwort, nur Konsole |
| Viewer-Schwelle Raid-Shoutout | 3 (inline, `viewers >= 3`) | |
| Shoutout-Verzögerung nach Begrüßung | 2000 ms (inline) | |
| Zusatztext Begrüßung | `viewers > 50` (inline) | |
| Rang-Grenzen | Top 5 Häufigkeit, Top 3 Zuschauer (inline) | |
| Token-Puffer | 5 Minuten vor Ablauf (inline) | |
| Event-Log-Länge | 200 (inline) | |
| `PORT` | Standard 3000 | |

## 8. Schnittstelle Home Assistant

`POST <HA_WEBHOOK_URL>`, JSON, ein Aufruf pro Effekt-Job. Ohne `HA_WEBHOOK_URL` kein Versand. Fehler werden geloggt, es gibt keinen Retry.

```json
{
  "type": "follow | sub | gift",
  "count": 1,
  "meta": { },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

| `type` | `meta` |
|---|---|
| `follow` | `{userName, userId}` |
| `sub` | `{userName}` |
| `gift` | `{userName, giftCount}` |

- `count`: Anzahl gebündelter Ereignisse des Typs im Bündelungsfenster.
- `meta`: Daten des letzten Ereignisses im Bündel.
- `userName` bei anonymem Gifter: `anonym`.
- Modus `manual`: Aufruf nur nach Bestätigung, bei Timeout kein Aufruf.
- Modus `off`: wartende Jobs werden verworfen, ein laufender Effekt wird nicht abgebrochen. Wartet beim Umschalten ein Effekt im Modus `manual` auf Bestätigung, wird er verworfen: kein Aufruf, kein Eintrag in `events.json`, `/api/effects/confirm` liefert danach `{ok:false}`.

## 9. Umgebungsvariablen

`CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `PORT`, `SCOPES`, `HA_WEBHOOK_URL`, `CORS_ORIGINS` (optional, kommagetrennt; leer = Standard, `*` = jede Herkunft), `UBOAT_SAVES_DIR` (optional; Saves-Ordner von UBOAT, `%VARIABLE%` wird aufgelöst; leer = UBOAT-Soldbuch aus). Vorlage: `.env.example`.
