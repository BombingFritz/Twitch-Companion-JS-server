# Architektur (Ist-Zustand)

Einzelne Datei `server.js`. Laufzeit: Node.js, Express, `ws`, `axios`, `dotenv`, `cors`, `readline`.

## 1. Datenfluss

```
Widget --GET /token, /api/...--> server.js --> Twitch Helix API
Twitch --EventSub WebSocket--> server.js
server.js --scheduleEffect()--> effectQueue --POST--> HA_WEBHOOK_URL
Chat "!raidstats" --> server.js --> Leaderboard in Twitch-Chat
Konsole (readline) --> server.js
```

## 2. Module und Funktionen

| Bereich | Funktionen / Zustand |
|---|---|
| Tokens | `loadTokens`, `saveTokens`, `getValidAccessToken` |
| Raid-Tracking | `loadRaidLog`, `saveRaidLog`, `getPeriodKey`, `trackRaid`, `getRanks`, `getLeaderboardText`, `pick` |
| Whitelist | `loadWhitelist`, `saveWhitelist`, `addToWhitelist`, `removeFromWhitelist`, `printWhitelist`, `resolveUserByLogin`, `resolveUserById` |
| Sub-Goal | `loadSubGoalCache`, `saveSubGoalCache`, `refreshSubGoalCache` |
| Event-Log | `loadEventLog`, `saveEventLog`, `appendEvent` |
| Effekt-Modus | `loadEffectMode`, `saveEffectMode`; RAM: `effectMode`, `pendingManualConfirmation` |
| Effekt-Queue | `scheduleEffect`, `enqueueEffect`, `describeEffect`, `triggerEffect`, `runManualConfirmation`, `processEffectQueue`; RAM: `pendingBursts`, `effectQueue`, `isProcessingEffectQueue`, `lastEffectSentAt` |
| Entdoppelung | `pruneOldEntries`, `isDuplicateMessage`, `wasRecentlyTriggered`; RAM: `seenMessageIds`, `recentSubByUser`, `recentFollowByUser` |
| Logging | `logIfChanged`, HTTP-Middleware (unterdrückt direkt aufeinanderfolgende identische `[HTTP] …`-Zeilen) |
| EventSub | `connectEventSub`, `subscribeToRaid`, `subscribeToChat`, `subscribeToStreamOnline`, `subscribeToSubscriptions`, `subscribeToChatNotifications`, `subscribeToFollows`, `handleChatNotification` |
| Chat | `isModOrBroadcaster`, `handleChatCommand`, `handleWhitelistShoutout`, `sendShoutout` |
| Raid | `enqueueRaidEvent`, `processRaidQueue`, `handleRaidEvent`, `buildBaseMessage`, `buildGameMessage`, `buildRankRepeatMessage`, `buildRepeatOnlyMessage`, `buildViewerRankMessage`, `buildClosingMessage`; RAM: `raidQueue`, `isProcessingQueue`, `lastRaidGreetingSentAt`, `lastRaidstatsCommandAt` |
| Sessions | RAM: `shoutedOutThisSession`, `eventSubWs` |
| Konsole | `printConsoleHelp`, `rl.on('line', …)` |

## 3. Persistierte Dateien (Arbeitsverzeichnis)

| Datei | Struktur |
|---|---|
| `tokens.json` | `{access_token, refresh_token, broadcaster_id, broadcaster_name, obtained_at, expires_in, expires_at}` |
| `raids.json` | `{ "<Periode>": { "<raiderId>": {name, count, totalViewers} } }`, Periode z. B. `2026-Q4` |
| `whitelist.json` | `{ "<userId>": "<userName>" }` |
| `subgoal_cache.json` | `{current, target, title, goalId, status, lastUpdated}` |
| `events.json` | Array, max. 200 Einträge: `{type, ...meta, count, timestamp[, skippedManualTimeout]}` |
| `effect_mode.json` | `{mode}` mit `auto`, `manual` oder `off`; fehlt die Datei oder ist ungültig: `auto` |

## 4. HTTP-Endpoints

Alle GET. CORS für alle Origins.

| Pfad | Antwort | Fehler |
|---|---|---|
| `/login` | Redirect zu Twitch OAuth (`SCOPES`, `+` wird zu Leerzeichen) | – |
| `/callback?code=` | Tauscht Code gegen Tokens, schreibt `tokens.json`, startet EventSub falls nicht verbunden | 400 ohne `code`, 500 bei Fehler |
| `/token` | `{access_token, broadcaster_id}` | 401 `{error, hint}` |
| `/status` | `{authenticated, broadcaster_id, broadcaster_name, token_valid, expires_in_seconds, expires_in_minutes, auto_refresh, eventsub_connected, raid_queue_length, whitelist_count, effect_mode, effect_queue_length}`; ohne Tokens `{authenticated:false, message}` | – |
| `/api/twitch/prediction/current` | `{status:'WAITING'}` oder `{predictionId, title, status, outcomes[{id,title,channelPoints,users}], createdAt, locksAt, endsAt}` für die letzte Prediction, auch bei anderem Status als ACTIVE/LOCKED | 500 `{error, status:'ERROR', message}` |
| `/api/twitch/subcounter` | `{current, target, title, goalId, status, lastUpdated, apiStatus:'OK'}`; lädt von Twitch, wenn `current` im Cache `null` ist | 500 `{error, apiStatus:'ERROR', message}` |
| `/api/homeassistant/events` | `{lastEvent, recentEvents (letzte 20), counts{follow,sub,gift}, totalLogged}` | – |
| `/api/effects/mode/:mode` | Setzt Modus (`auto`/`manual`/`off`), `{ok:true, mode}` | 400 `{error}` |
| `/api/effects/mode` | `{mode, queueLength, pendingConfirmation: {type,count} oder null}` | – |
| `/api/effects/confirm` | `{ok, message}`; bestätigt den wartenden Effekt im Modus `manual` | – |

## 5. Konsolenbefehle

| Befehl | Wirkung |
|---|---|
| `whitelist add <id> <name>` | Nutzer per ID und Name eintragen |
| `whitelist add <id>` | Name per API auflösen |
| `whitelist add @<name>` | ID per API auflösen |
| `whitelist remove <id>` | Eintrag entfernen |
| `whitelist list` | Whitelist anzeigen |
| `subgoal refresh` | Sub-Goal von Twitch laden |
| `subgoal show` | Gecachten Stand anzeigen |
| `events show` | Letzte 10 Log-Einträge anzeigen |
| `effects mode <auto\|manual\|off>` | Effekt-Modus setzen und speichern |
| `effects show` | Modus, Queue-Länge, wartende Bestätigung anzeigen |
| `help` | Befehlsübersicht (auch beim Start) |

Es gibt keinen Konsolenbefehl zum Bestätigen eines Effekts.

## 6. EventSub

Alle Subscriptions werden bei `session_welcome` angelegt, Reihenfolge wie unten.

| Typ | Version | Condition | Verarbeitung |
|---|---|---|---|
| `channel.raid` | 1 | `to_broadcaster_user_id` | `enqueueRaidEvent` |
| `channel.chat.message` | 1 | `broadcaster_user_id`, `user_id` (je Broadcaster) | `handleChatCommand`, `handleWhitelistShoutout` |
| `stream.online` | 1 | `broadcaster_user_id` | `shoutedOutThisSession` leeren, `refreshSubGoalCache` |
| `channel.subscribe` | 1 | `broadcaster_user_id` | nur `refreshSubGoalCache` |
| `channel.subscription.gift` | 1 | `broadcaster_user_id` | nur `refreshSubGoalCache` |
| `channel.subscription.message` | 1 | `broadcaster_user_id` | nur `refreshSubGoalCache` |
| `channel.chat.notification` | 1 | `broadcaster_user_id`, `user_id` (je Broadcaster) | `handleChatNotification` |
| `channel.follow` | 2 | `broadcaster_user_id`, `moderator_user_id` (Broadcaster) | `scheduleEffect('follow')` |

Für jede Notification gilt vorab: Eine bereits gesehene `metadata.message_id` wird ignoriert. Bei Verbindungsende wird nach 5 s neu verbunden.

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
| `EFFECT_BURST_WINDOW_MS` | 2500 | Bündelungsfenster je Effekt-Typ, Timer startet bei jedem Ereignis neu |
| `EFFECT_MIN_GAP_MS` | 4000 | Abstand zwischen zwei Effekten |
| `EFFECT_MANUAL_CONFIRM_TIMEOUT_MS` | 30000 | Wartezeit auf Bestätigung im Modus `manual` |
| `EVENT_MESSAGE_ID_TTL_MS` | 600000 | Merkdauer von `message_id` |
| `SUB_DEDUPE_WINDOW_MS` | 60000 | Sub-Effekt pro Nutzer |
| `FOLLOW_DEDUPE_WINDOW_MS` | 60000 | Follow-Effekt pro Nutzer |
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
- Modus `off`: wartende Jobs werden verworfen, ein laufender Effekt wird nicht abgebrochen.

## 9. Umgebungsvariablen

`CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `PORT`, `SCOPES`, `HA_WEBHOOK_URL`. Vorlage: `.env.example`.
