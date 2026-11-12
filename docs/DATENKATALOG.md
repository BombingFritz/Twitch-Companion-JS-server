# Datenkatalog

Welche Daten der Server speichert, im Arbeitsspeicher hält oder weitergibt, wozu, und was wir als Speichererlaubnis und Speicherdauer empfehlen.

**Status:** Entwurf zur Diskussion (12.11.2026). Grundlage für die Felddiskussion, die Aufbewahrungs-Einstellungen und `!privat`. Noch nichts davon ist entschieden oder umgesetzt.

**Vorgaben des Nutzers (12.11.2026):**
- Fristen und Aufbewahrungsregeln werden **in den Einstellungen konfigurierbar**, nicht im Code festgelegt. Was erlaubt ist, hängt auch vom Wohnort des Streamers ab. Die Empfehlungen unten sind Vorschläge für Standardwerte.
- Namen bleiben vorerst gespeichert. Erst werden alle Felder diskutiert, dann wird entschieden. Eine Top 10 mit Namen je Stream festzuhalten und beim Streamabschluss zu zeigen, hält der Nutzer für zulässig.
- `!privat` wird gebaut (siehe Issue #44 und Abschnitt 5). `!datenschutz` vorerst nicht; Hinweise laufen über Chathinweise und später frei konfigurierbare Chatbefehle.
- Keine Daten aus fremden Kanälen (Partnerchat im Co-Stream). Das ist bereits so.
- BdU-Chat: An die KI geht nur der Fragetext, nicht der Name; er wurde bewusst geschickt. Der Hinweis, wohin das Enigma-Widget Daten liefert, gehört in dessen Dokumentation.

**Einordnung:** Die Empfehlungen sind eine technische und organisatorische Einschätzung von Claude, keine Rechtsberatung. Herangezogen wurden das Twitch Developer Services Agreement (u. a. Schedule 1 C: Speichern über 24 Stunden nur mit Erlaubnis, eigenen Rechten oder als Zwischenspeicher; Schedule 1 D.2: Chatlogs nur so lange wie für den Dienst nötig, mit Opt-out und Löschung) und die DSGVO-Grundsätze Zweckbindung, Datenminimierung und Speicherbegrenzung. Ein öffentlicher Stream fällt nach unserer Einschätzung nicht unter die Ausnahme für rein private Tätigkeiten; Rechtsgrundlage wäre in der Regel das berechtigte Interesse, abgewogen gegen die Interessen der Zuschauer.

## 1. Kategorien

| Kürzel | Kategorie | Typisch | Grundhaltung (Vorschlag) |
|---|---|---|---|
| **E** | Eigene Daten des Streamers | Tokens, Konfiguration | so lange wie nötig; nach Widerruf der Twitch-Freigabe löschen |
| **F** | Funktionsdaten | Entdoppelung, Warteschlangen, laufender Stream | nur so lange, wie die Funktion sie braucht |
| **V** | Personenbezogener Verlauf | Raids je Kanal, Chatter je Stream, letzte Effekte | Zweck benennen, Frist einstellbar, `!privat` beachten |
| **S** | Summen ohne Personenbezug | Anzahl Follows, Subs, Chatnachrichten je Stream | langfristig, solange niemand daraus bestimmbar ist |
| **D** | Diagnose | Fehlerprotokoll, Live-Log | kurz; Namen nur, wo sie zur Fehlersuche nötig sind |

## 2. Dateien im Arbeitsverzeichnis

Spalte „heute“: aktuelles Verhalten. Spalte „Vorschlag“: Standardwert für die spätere Einstellung (Vorschlag von Claude, nicht entschieden).

| Datei | Felder mit Personenbezug | Zweck | Kat. | Heute | Vorschlag |
|---|---|---|---|---|---|
| `.env` | `CLIENT_SECRET`, `HA_WEBHOOK_URL` (keine Zuschauerdaten) | Anmeldung, Effekte | E | dauerhaft | unverändert; nie ins Repo |
| `tokens.json` | `access_token`, `refresh_token`, `broadcaster_id`, `broadcaster_name` | Zugriff auf Twitch | E | bis überschrieben | löschen, wenn die Freigabe widerrufen wird (Twitch VI F) [UNGEKLÄRT: Erkennung Widerruf vs. Verbindungsfehler] |
| `bot.json` | `bot_id`, `bot_login`, `bot_name` | Senden als DerBdu | E | bis `bot remove` | unverändert |
| `whitelist.json` | ID und Name ausgewählter Streamer | Whitelist-Shoutouts | V (vom Streamer gepflegt) | bis Entfernen | unverändert; Entfernen auf Wunsch |
| `whitelist_checks.json` | `userId`, `userName`, `result`, `lastActiveAt`, `lastLiveAt`, `game`, `timestamp`; max. 500 | Diagnose der Aktivitätsprüfung (ADR 0015), Quelle für den Stream-Bericht | D/V | 500 Einträge, ohne Zeitgrenze | Frist 30 Tage; nach der Testphase abschaltbar |
| `raids.json` | je Zeitraum Raider-ID, Name, Anzahl, mitgebrachte Zuschauer | Begrüßung (Wiederkehrer, Rang), `!raidstats` öffentlich | V | unbegrenzt, je Quartal/Jahr | laufender und vorheriger Zeitraum mit Namen; ältere Zeiträume einstellbar (behalten / nur Summen); Löschen je Kanal auf Wunsch |
| `events.json` | `userName`, bei Follows `userId`, `giftCount`; max. 200 | „Letzte Effekte“ in der Webkonsole, `/api/homeassistant/events` | V | 200 Einträge, ohne Zeitgrenze | Frist 7 Tage |
| `uboat_crew_map.json` | Twitch-Login → Name im Spiel | UBOAT-Soldbuch | V (vom Streamer gepflegt) | bis `uboat unmap` | unverändert; `!privat` entfernt bzw. ignoriert die Zuordnung [zu entscheiden] |
| `stream_stats.json` | `chatters` {ID: Name, Anzahl} (max. 1000), `stream_ids`; sonst Summen | laufender Stream: verschiedene Chatter, aktivste Chatter | F | bis zum nächsten Streambeginn | unverändert (wird ohnehin überschrieben) |
| `stream_reports/<ID>.json` | `state.chatters` {ID: Name, Anzahl} (bis 1000), dazu Summen | Bericht je Stream, Gesamtsumme | V + S | unbegrenzt | Summen unbegrenzt. Chatter mit Namen: Optionen für die Diskussion in Abschnitt 6 |
| `stream_reports/<ID>.txt` | Top 10 Chatter mit Anzahl | lesbarer Bericht, Abschlussanzeige | V | unbegrenzt | wie die `.json` |
| `error_log.json` | `text` kann Namen enthalten (z. B. fehlgeschlagener Shoutout); Secrets werden entfernt | Fehlersuche über Neustarts | D | 1000 Einträge, ohne Zeitgrenze | Frist 30 Tage |
| `subgoal_cache.json`, `effect_mode.json`, `modules.json` | keine | Betrieb | E | – | unverändert |

## 3. Nur im Arbeitsspeicher (bis Neustart oder kürzer)

| Daten | Personenbezug | Zweck | Dauer heute |
|---|---|---|---|
| `seenMessageIds` | Nachrichten-IDs | Doppelte Zustellung erkennen | 10 min |
| `recentSubByUser`, `recentFollowByUser` | User-IDs | Effekt nicht doppelt auslösen | 60 s |
| `shoutedOutThisSession` | User-IDs | Shoutout nur einmal je Stream | bis Streambeginn bzw. Neustart |
| `bduPending`, `bduAcceptedByUser` | Login, Nachrichten-ID | Antwort zuordnen, Limit je Nutzer | bis Antwort bzw. Ablauf der Sperre |
| `uboatLastAnswerByUser` | Login | Abklingzeit je Nutzer | Abklingzeit |
| `raidQueue` | Raider-ID, Name | Begrüßungen nacheinander | bis verarbeitet |
| Live-Log-Puffer (1000 Zeilen) und Konsole | Namen, BdU-Fragetexte, Befehle, Widget-Protokollzeilen (z. B. `Tipper_…` aus dem Wetten-Widget, Issue #44) | Beobachten im Stream | bis Neustart |

## 4. Weitergaben

| Empfänger | Was | Wann | Bemerkung |
|---|---|---|---|
| Twitch (API, EventSub, Chat) | Anfragen, Chatnachrichten des Servers | immer | notwendig |
| **Öffentlich im Chat** | Raid-Begrüßung mit Rang, `!raidstats`-Rangliste, Whitelist-Hinweis mit letztem Aktivdatum und Spiel, BdU-Antworten, Soldbuch-Akte | bei Auslösung | Veröffentlichung; `!privat` sollte Erwähnungen unterdrücken, wo möglich (Abschnitt 5) |
| Home Assistant (`HA_WEBHOOK_URL`) | `meta.userName`, bei Follows `userId` | je Effekt | HA speichert in seinem Verlauf; mit Cloud-Anbindung verlässt der Name das Heimnetz. Eine Option ohne Namen würde das Payload ändern und braucht ein ADR |
| Widgets (lokal) | `/api/homeassistant/events` (Namen), `/api/twitch/prediction/current` (`topPredictors` live von Twitch), `/api/uboat/crew` (Namen im Spiel), `/api/bdu/stream` (nur Fragetext, kein Name) | auf Abruf | nur lokal bzw. erlaubte Herkünfte (ADR 0013) |
| KI-Dienst über das Enigma-Widget | nur der Fragetext von `!BdU` | wenn BdU-Chat an ist | Hinweis in der Widget-Dokumentation (Nutzer, 12.11.2026) |
| OneDrive | alle Laufzeitdateien im Projektordner | laufend | bewusste Entscheidung des Nutzers; bei Weitergabe des Werkzeugs sollte der Datenordner wählbar sein |

## 5. `!privat` (geplant, eigener Schritt)

Ziel laut Issue #44: Wer `!privat` schreibt, wird nicht mehr getrackt und nicht mehr erwähnt. Zu entscheiden bzw. zu prüfen:

- **Speicherung der Liste:** User-ID und Zeitpunkt, bis zum Widerruf (z. B. `!privat aus`). Die Liste ist selbst personenbezogen; Zugriff nur lokal.
- **Statistik:** Nachrichten anonym in den Summen mitzählen oder gar nicht? Name und ID nicht in `chatters`, nicht in Top-Listen, Berichten und Abschlussanzeige. Bereits gespeicherte Einträge löschen?
- **Widgets:** Endpunkt mit der Liste der IDs (Vorschlag aus Issue #44: `GET /api/privacy/optouts`), Zugriffsschutz wie die übrigen Endpunkte.
- **Glückspilz des Abends** (Issue #44) und künftige Ranglisten beachten die Liste.
- **Öffentliche Erwähnungen:** Raid-Begrüßung (Name des Raiders nennen, aber ohne Rang?), `!raidstats`, Whitelist-Hinweis, Soldbuch.
- **Was nicht geht:** Twitch-eigene Anzeigen (Sub-Ankündigungen, Ranglisten von Twitch) bleiben unberührt.

## 6. Offene Punkte für die Felddiskussion

1. **Chatter je Bericht:** volle Liste mit IDs (heute), nur Top 10 mit Namen, oder volle Liste für eine einstellbare Zeit und danach nur Top 10 bzw. nur Summen?
2. **IDs in Berichten:** werden sie nach dem Stream noch gebraucht (z. B. für `!privat` rückwirkend)? Ohne IDs sind Namensänderungen nicht mehr zuzuordnen.
3. **Raids:** wie lange Namen je Zeitraum, und ob `!raidstats` ausgenommene Kanäle weglässt.
4. **Fristen als Einstellungen:** je Datei eine Frist (Tage, „unbegrenzt“, „aus“), Standardwerte aus Abschnitt 2; Aufräumen beim Start und einmal täglich.
5. **Home Assistant:** Namen im Payload optional (neues ADR, da Payload-Änderung).
6. **Chathinweis:** Wortlaut und Ort (Panel, wiederkehrender Hinweis, Endscreen-Zeile).
7. **Auskunft und Löschung auf Anfrage:** Konsolen- oder Webkonsolen-Befehl, der alle Einträge zu einer ID findet bzw. löscht.
