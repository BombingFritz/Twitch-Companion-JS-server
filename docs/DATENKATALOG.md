# Datenkatalog

Welche Daten der Server speichert, im Arbeitsspeicher hält oder weitergibt, wozu, und was wir als Speichererlaubnis und Speicherdauer empfehlen.

**Status:** Entwurf zur Diskussion (12.11.2026). Grundlage für die Felddiskussion und die Aufbewahrungs-Einstellungen; Fristen sind noch nicht entschieden. Umgesetzt: `!privat` (13.11.2026, ADR 0022).

**Vorgaben des Nutzers (12.11.2026):**
- Fristen und Aufbewahrungsregeln werden **in den Einstellungen konfigurierbar**, nicht im Code festgelegt. Was erlaubt ist, hängt auch vom Wohnort des Streamers ab. Die Empfehlungen unten sind Vorschläge für Standardwerte.
- Namen bleiben vorerst gespeichert. Erst werden alle Felder diskutiert, dann wird entschieden. Eine Top 10 mit Namen je Stream festzuhalten und beim Streamabschluss zu zeigen, hält der Nutzer für zulässig.
- `!privat` wird gebaut (siehe Issue #44 und Abschnitt 5; umgesetzt 13.11.2026). Raid-Begrüßungen dürfen Raider und Rang nennen, Raider sind öffentliche Streamer (Nutzer, 13.11.2026). Einschränkungen werden nicht vorsorglich eingebaut, sondern je Feld gemeinsam entschieden. `!datenschutz` vorerst nicht; Hinweise laufen über Chathinweise und später frei konfigurierbare Chatbefehle.
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
| `tokens.json` | `access_token`, `refresh_token`, `broadcaster_id`, `broadcaster_name` | Zugriff auf Twitch | E | bis überschrieben; seit ADR 0024 nur beim Start gelesen, danach im Arbeitsspeicher, atomar geschrieben | löschen, wenn die Freigabe widerrufen wird (Twitch VI F) [UNGEKLÄRT: Erkennung Widerruf vs. Verbindungsfehler] |
| `bot.json` | `bot_id`, `bot_login`, `bot_name` | Senden als DerBdu | E | bis `bot remove` | unverändert |
| `whitelist.json` | ID und Name ausgewählter Streamer | Whitelist-Shoutouts | V (vom Streamer gepflegt) | bis Entfernen | unverändert; Entfernen auf Wunsch |
| `whitelist_checks.json` | `userId`, `userName`, `result`, `lastActiveAt`, `lastLiveAt`, `game`, `timestamp`; max. 500 | Diagnose der Aktivitätsprüfung (ADR 0015), Quelle für den Stream-Bericht | D/V | 500 Einträge, ohne Zeitgrenze | Frist 30 Tage; nach der Testphase abschaltbar |
| `raids.json` | je Zeitraum Raider-ID, Name, Anzahl, mitgebrachte Zuschauer | Begrüßung (Wiederkehrer, Rang), `!raidstats` öffentlich | V | unbegrenzt, je Quartal/Jahr | laufender und vorheriger Zeitraum mit Namen; ältere Zeiträume einstellbar (behalten / nur Summen); Löschen je Kanal auf Wunsch |
| `events.json` | `userName`, bei Follows `userId`, `giftCount`; max. 200 | „Letzte Effekte“ in der Webkonsole, `/api/homeassistant/events` | V | 200 Einträge, ohne Zeitgrenze | Frist 7 Tage |
| `uboat_crew_map.json` | Twitch-Login → Name im Spiel | UBOAT-Soldbuch | V (vom Streamer gepflegt) | bis `uboat unmap` | unverändert; `!privat` entfernt bzw. ignoriert die Zuordnung [zu entscheiden] |
| `stream_stats.json` | `chatters` {ID: Name, Anzahl} (max. 1000; bei `!privat` unter `anon-N` ohne ID und Namen), `stream_ids`; sonst Summen und der Zuschauerverlauf je Minute (ohne Personenbezug, ADR 0023) | laufender Stream: verschiedene Chatter, aktivste Chatter | F | bis zum nächsten Streambeginn | unverändert (wird ohnehin überschrieben) |
| `stream_reports/<ID>.json` | `state.chatters` {ID: Name, Anzahl} (bis 1000), dazu Summen | Bericht je Stream, Gesamtsumme | V + S | unbegrenzt | Summen unbegrenzt. Chatter mit Namen: Optionen für die Diskussion in Abschnitt 6 |
| `stream_reports/<ID>.txt` | Top 10 Chatter mit Anzahl | lesbarer Bericht, Abschlussanzeige | V | unbegrenzt | wie die `.json` |
| `privacy_optouts.json` | User-ID → Zeitpunkt des `!privat` | Zuschauer anonymisiert zählen, Widgets informieren (ADR 0022) | V | bis zum Ausschalten per `!privat` | unverändert (die Liste muss bestehen, solange der Wunsch gilt) |
| `error_log.json` | `text` kann Namen enthalten (z. B. fehlgeschlagener Shoutout); Secrets werden entfernt | Fehlersuche über Neustarts | D | 1000 Einträge, ohne Zeitgrenze | Frist 30 Tage |
| `subgoal_cache.json`, `effect_mode.json`, `modules.json` | keine | Betrieb | E | – | unverändert |
| `topics.json` | keine (Themen und Anzeige-Einstellungen, vom Streamer gepflegt) | Intro-Topics (ADR 0021) | E | bis überschrieben | unverändert |

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
| **Öffentlich im Chat** | Raid-Begrüßung mit Rang, `!raidstats`-Rangliste, Whitelist-Hinweis mit letztem Aktivdatum und Spiel, BdU-Antworten, Soldbuch-Akte, `!privat`-Antwort | bei Auslösung | Veröffentlichung; `!privat` sollte Erwähnungen unterdrücken, wo möglich (Abschnitt 5) |
| **Öffentlich im Chat, von Widgets selbst gesendet** (Übergang bis Issue #50, Abschnitt 1) | Wetten-Widget: Ergebniszeile nach jeder aufgelösten Wette mit Quote und Namen des größten Gewinners (steht er auf der `!privat`-Liste: „ein anonymer Schlaumeier“). SpargelPoll: Ergebniszeile der Abstimmung, ohne Zuschauernamen | je Wette bzw. Abstimmung | gesendet als Broadcaster mit dem Token aus `/token`, am Server vorbei; künftig soll der Server senden, dann gelten `!privat` und dieser Katalog zentral |
| Home Assistant (`HA_WEBHOOK_URL`) | `meta.userName`, bei Follows `userId`; Intro-Topics nur Thema, Nummer, Anzahl | je Effekt | HA speichert in seinem Verlauf; mit Cloud-Anbindung verlässt der Name das Heimnetz. Eine Option ohne Namen würde das Payload ändern und braucht ein ADR |
| Widgets (lokal) | `/api/twitch/stream` (Zuschauerzahl, ohne Personenbezug; genutzt vom Wetten-Widget ab 0.7.0), `/api/privacy/optouts` (User-IDs mit `!privat`, nur lokal; genutzt vom Wetten-Widget ab 0.7.0), `/api/topics`, `/api/topics/stream` (nur Themen und Anzeige, keine Personendaten), `/api/homeassistant/events` (Namen), `/api/twitch/prediction/current` (`topPredictors` live von Twitch), `/api/uboat/crew` (Namen im Spiel), `/api/bdu/stream` (nur Fragetext, kein Name) | auf Abruf | nur lokal bzw. erlaubte Herkünfte (ADR 0013) |
| KI-Dienst über das Enigma-Widget | nur der Fragetext von `!BdU` | wenn BdU-Chat an ist | Hinweis in der Widget-Dokumentation (Nutzer, 12.11.2026) |
| OneDrive | alle Laufzeitdateien im Projektordner | laufend | bewusste Entscheidung des Nutzers; bei Weitergabe des Werkzeugs sollte der Datenordner wählbar sein |

## 5. `!privat` (umgesetzt 13.11.2026, ADR 0022)

Entschieden vom Nutzer (13.11.2026):
- **Statistik:** Wer `!privat` schreibt, wird als „anonymer Schlaumeier“ anonymisiert mitgezählt, ohne ID und Namen. Summen und „verschiedene Chatter“ bleiben richtig.
- **Rückwirkend:** Frühere Einträge im laufenden Stream und in allen Berichten werden anonymisiert.
- **Widerruf:** derselbe Befehl. Die Antwort im Chat sagt jeweils, ob der Modus an- oder ausgeschaltet wurde. Frühere Einträge bleiben anonym.
- **Widgets:** `GET /api/privacy/optouts` → `{userIds: [...]}`, nur lokal. Widgets lassen die Zuschauer selbst weg.
- **Raid-Begrüßung** nennt Raider und Rang weiterhin.

Noch offen (Felddiskussion):
- **Glückspilz des Abends** (Issue #44) und künftige Ranglisten oder Endscreen-Anzeigen müssen die Liste beachten, sobald es sie gibt.
- Andere Dateien und Weitergaben (`events.json`, Home Assistant, `whitelist_checks.json`, Soldbuch-Zuordnung): ob `!privat` dort etwas bewirkt.
- **Was nicht geht:** Twitch-eigene Anzeigen (Sub-Ankündigungen, Ranglisten von Twitch) und bereits gesendete Chatnachrichten bleiben unberührt.

## 6. Offene Punkte für die Felddiskussion

1. **Chatter je Bericht:** volle Liste mit IDs (heute), nur Top 10 mit Namen, oder volle Liste für eine einstellbare Zeit und danach nur Top 10 bzw. nur Summen?
2. **IDs in Berichten:** Sie werden für `!privat` rückwirkend gebraucht (ADR 0022). Ohne IDs ließen sich frühere Einträge nicht mehr anonymisieren.
3. **Raids:** wie lange Namen je Zeitraum. Raider und Rang in Begrüßungen bleiben (Nutzer, 13.11.2026).
4. **Fristen als Einstellungen:** je Datei eine Frist (Tage, „unbegrenzt“, „aus“), Standardwerte aus Abschnitt 2; Aufräumen beim Start und einmal täglich.
5. **Home Assistant:** Namen im Payload optional (neues ADR, da Payload-Änderung).
6. **Chathinweis:** Wortlaut und Ort (Panel, wiederkehrender Hinweis, Endscreen-Zeile).
7. **Auskunft und Löschung auf Anfrage:** Konsolen- oder Webkonsolen-Befehl, der alle Einträge zu einer ID findet bzw. löscht.
