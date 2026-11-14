# Offene Punkte

Gegliedert bei der Inventur am 14.11.2026 (Aufräumgruppe 1). Erledigte und überholte Punkte mit Beleg: [archiv/OFFEN-bis-2026-11-14.md](archiv/OFFEN-bis-2026-11-14.md). Aktive Arbeit läuft zunehmend über GitHub-Issues (AGENTS.md, „Wo was steht“); wo es eines gibt, ist es verlinkt.

## 1. Live-Abnahmen (in den nächsten Streams prüfen)

Checkliste als Issue: #56.

- **Chat-Ankündigungen:** Feldnamen in `handleChatNotification` gegen reale Twitch-Events.
  - Belegt (03.11.2026): `notice_type` `resub` (6×) und `sub_gift` ohne `community_gift_id` (1×) lösten je genau einen Effekt aus; beim Einzel-Gift kein zusätzlicher Sub-Effekt für den Empfänger; die Lichter reagierten.
  - Belegt (11.11.2026, Co-Stream mit geteiltem Chat): `community_sub_gift` mit `total` 2 löste genau einen Gift-Effekt aus und zählte 2.
  - Offen: `chatter_is_anonymous` (anonymes Gift), `is_gift` bei `sub`/`resub`, `source_broadcaster_user_id` aus einem fremden Kanal [UNGEKLÄRT].
- **Sub ohne Chat-Ankündigung:** Am 11.11.2026 kam ein `channel.subscribe` ganz ohne Ankündigung (kein Effekt, keine Zählung); Twitchs Übersicht stimmt trotzdem mit Subs + verschenkten Subs überein. Seit 12.11.2026 nennt das Protokoll Stufe und „geschenkt“ und meldet nicht ausgewertete Ankündigungen (ADR 0008, Nachtrag). Nach den nächsten Streams entscheiden, ob ein Ersatzweg nötig ist.
- **Abweichungen zu Twitchs Stream-Übersicht (11.11.2026):** Follows 3 statt 4; jeder `channel.follow` wird protokolliert, es kamen nur 3 [UNGEKLÄRT; Vermutung des Nutzers: sofort wieder entfolgt oder blockiert]. Eindeutige Chatter 38 statt 102, weil Twitch im Co-Stream den Partnerchat mitzählt und der Server Broadcaster, Bots und fremde Kanäle ausnimmt (gewollt). Zuschauerzahlen erfasst der Server seit ADR 0023 (13.11.2026) als Verlauf je Minute mit Höchstwert und Schnitt; Twitchs „Einzelne Zuschauer“ und „Live-Aufrufe“ gibt die API nicht her.
- **Seit 13./14.11.2026 umgesetzt, im echten Stream noch nicht beobachtet:** Token-Erneuerung im laufenden Betrieb, Raid-Begrüßung und Shoutout über den zentralen Twitch-Zugriff, Zeile „API-Anfragen“ in der Webkonsole (ADR 0024, #54); Zuschauerverlauf während eines Streams (ADR 0023, #49); `!privat` im echten Chat (ADR 0022, #48).
- **Testphase Aktivitätsprüfung (ab Nov. 2026):** `SHOUTOUT_ACTIVITY_STRICT = false`, d. h. bei unklarer Aktivität (kein Video, API-Fehler) trotzdem Shoutout. Konsole bzw. `whitelist checks` beobachten (Einträge `inaktiv`, `unklar`, `live`). Wenn die Prüfung zuverlässig wirkt, auf `true` umstellen (ADR 0015).
- **UBOAT-Soldbuch** (`docs/specs/uboat-personalakte.md`, ADR 0016): Kategoriename „UBOAT“ ist bestätigt (Log 11.11.2026: „Twitch-Kategorie: UBOAT (Abruf) – UBOAT-Soldbuch aktiv“).
  - `status` 0/1/2 = Reserve/an Bord/gefallen: im Spielcode bestätigt (Enum `PlayableCharacterStatus`, 07.11.2026). Offen bleibt die Anzeige der Stufe im Spiel (Sterne oder Zahl) [UNGEKLÄRT].
  - Verwundung: umgesetzt nach den Klassennamen im Spielcode (`Bleeding`, `Treatment` → „verwundet“, `Hospitalization` → „im Krankenhaus“), aber noch in keinem echten Spielstand gesehen. Beim ersten Verwundeten einen Spielstand sichern und prüfen, ob „verwundet“ erscheint (`uboat show` bzw. `node lib/uboat-save.js <Kopie>`) [UNGEKLÄRT].
  - `fate`-Werte: noch nicht in einem Spielstand beobachtet [UNGEKLÄRT].
  - Ein Spiel-Update kann das Format ändern: dann Konsolenhinweis „Ungetestete Spielversion“ bzw. „nicht lesbar“; Diagnose mit `node lib/uboat-save.js <Kopie des Spielstands>`.
- **BdU-Chat** (`docs/specs/bdu-chat.md`, ADR 0014): mit echtem Chat erprobt (03.11.2026, 6 Anfragen, Antworten nach 1–3 s). Limits, Warnung und Funkstille wurden nicht erreicht, also unter Last weiter unerprobt.
- **EventSub:** Ob stille Abbrüche in der Praxis vorkommen, ist [UNGEKLÄRT]; die Konsole meldet sie seit dem Keepalive-Fix.
- **Intro-Topics:** Home-Assistant-Automation für die Effekte `topic_active`, `topic_done`, `topics_complete` (FAHRPLAN Schritt 6).

## 2. Sicherheit und Datenschutz

Issues: Sicherheitsprüfung #57, Datenschutz #58.

- **Erreichbarkeit im Netzwerk (Entscheidung Nutzer, 14.11.2026):** Der Server lauscht bisher auf allen Netzwerkschnittstellen. Home Assistant fragt ihn nicht ab, es bekommt nur Webhooks; kein anderes Gerät braucht ihn. Deshalb wird er nur noch an `127.0.0.1` gebunden (eigener PR). Später, z. B. für kleine ESP32-Bildschirme, die direkt oder über Home Assistant angesteuert werden: Zugang aus dem LAN/WLAN in den Einstellungen an- und abschaltbar und nur mit Sicherheitsmechanismus (Schlüssel o. Ä.) [Umsetzung offen].
- **Herkunft `null` und Zugangsschlüssel für Widgets (Nahziel, Nutzer 14.11.2026):** Widgets, die per `file:///` in OBS eingebunden sind, melden die Herkunft `null`; der Server muss sie erlauben. Dieselbe Herkunft kann eine präparierte Webseite über einen abgeschotteten Rahmen vortäuschen und so im Browser des Streaming-PCs `/token` lesen. Nahziel: eine einfache, halbwegs sichere Anmeldung der Widgets mit wenig Bau- und Betriebsaufwand, z. B. ein vom Server erzeugter Widget-Schlüssel, der in der OBS-Adresse des Widgets steht und bei `/token` und den Widget-Endpunkten mitgeschickt wird; ohne Schlüssel kein Token. Betrifft alle Widget-Repositories (Issues dort), braucht ein ADR. Fernziel bleibt, dass der Server die Widgets selbst ausliefert (P3); dann entfällt `null`.
- **Begrenzung eingehender Anfragen und Abhängigkeiten:** Anfragen an den Server sind nicht begrenzt (ausgehende Twitch-Anfragen seit ADR 0024 schon); `npm audit` ist noch nie gelaufen.
- **Datenschutz-Durchgang (Nutzer, 12.11.2026):** Prüfen, welche personenbezogenen Daten der Server speichert und wie lange: u. a. Chatter-Namen in `stream_stats.json` und `stream_reports/`, `whitelist_checks.json`, `raids.json`, `events.json`, Fehlerprotokoll und Live-Log. Vorgabe: keine Daten aus fremden Kanälen (Partnerchat im Co-Stream) erfassen; das ist bereits so.
  - Stand: `docs/DATENKATALOG.md` mit allen Feldern, Zwecken und Empfehlungen; `!privat` umgesetzt (ADR 0022). Offen: Felddiskussion (Katalog, Abschnitt 6), Fristen als Einstellungen statt fester Werte im Code (Nutzer). Namen bleiben bis zur Entscheidung gespeichert.
- **Chat-Zeilen der Widgets:** Wetten-Widget und SpargelPoll senden ihre Ergebniszeilen mit dem Token aus `/token` selbst in den Chat, am Server vorbei. Künftig sendet der Server (Issue #50, Abschnitt 1); dann gelten `!privat`, Drosselung und Datenkatalog zentral.

## 3. Technische Schuld

- **`server.js` aufteilen:** rund 3300 Zeilen. Die Größe kostet keine Rechenleistung (Nutzer, 14.11.2026: 0 % CPU, 27 MB Arbeitsspeicher kurz nach dem Start), erschwert aber Übersicht und parallele Arbeit. Erkennbare Bereiche: Webkonsole, Statistik, Widget-Schnittstelle, Twitch-Zugriff (seit ADR 0024 in `lib/twitch-api.js`), EventSub, Chat-Befehle, Raid und Shoutouts. Vorgehen: schrittweise nach `lib/`, jeweils wenn ein Bereich ohnehin angefasst wird, ohne gleichzeitig das Verhalten neu zu gestalten.
- **Wett-Endpunkt nach ADR 0023:** `/api/twitch/prediction/current` fragt Twitch noch bei jedem Abruf. Ziel: Stand der Wette über `channel.prediction.begin/progress/lock/end` mitführen (Scope `channel:read:predictions` ist vorhanden), Endpunkt gibt den letzten Stand mit Zeitstempel aus; ebenso für Abstimmungen (`channel:read:polls` vorhanden). Dazu Glückspilz des Abends (#44) und Chat-Zeilen über den Server (#50).
- **Sub-Goal über EventSub (#60):** `refreshSubGoalCache` fragt Twitch bei jedem Sub-Ereignis, bei einem Gift-Bomb mehrfach. Ziel: `channel.goal.begin/progress/end` abonnieren (Scope `channel:read:goals` vorhanden) und den Stand aus den Ereignissen führen.
- **`events.json`:** wird bei jedem Effekt geschrieben, die Übersicht der Webkonsole liest die Datei alle 5 s. Im Arbeitsspeicher halten und gebündelt schreiben (Projektordner in der Cloud).
- **`widget-log`-Anfragen:** Das Wetten-Widget schickt Testmeldungen an `/widget-log/…`, im Live-Log erscheinen sie als 404. Entweder nimmt der Server sie als `[Widget] …` an, oder das Widget lässt sie weg, sobald der Server die Wetten auswertet (#50).
- **Tests mit festen Wartezeiten:** `shoutout-test` und `uboat-test` warten seit #54 auf das Ergebnis; weitere Tests nutzen feste Wartezeiten (z. B. `topics-test`, 40 s) und können auf langsamen Rechnern scheitern.
- **Entwicklungsmodus (früher K8):** Die Tests sind isoliert (Attrappen, temporäre Ordner, CI). Ein Modus, in dem der echte Server mit Testdaten statt der Laufzeitdateien läuft, fehlt noch; ein Lauf im Projektordner nutzt echte Statistik und sendet echte Chat-Nachrichten.
- **Undokumentiert:** Funktionsdetails der Widgets (Polling-Widget: dokumentiert im Repository BombingFritz/TwitchPoll als `SpargelPoll.html`; `bFCoinFlipV9_final.html`); die Anhänge `pollingWidget.html` und `Creator-Overlay.html` sind nicht ausgewertet. Wirkung des Home-Assistant-Scripts und der WLED-Effektauswahl: separate Doku, nicht Teil dieses Repos [UNGEKLÄRT]. Ob Twitch `channel.chat.notification` zeitgleich mit der Chat-Anzeige und den Overlay-Alerts liefert, ist nicht belegt [UNGEKLÄRT].
- Alte `Server_Dokumentation.md` durch diese Struktur ersetzen. Die Datei liegt nicht im Repository [UNGEKLÄRT, ob der Punkt erledigt ist oder die Datei nur lokal existiert].

## 4. Offene Entscheidungen

- **Glückspilz des Abends (#44):** Wertung als Summe der Auszahlungen oder Reingewinn.
- **Datenschutz:** Felder und Fristen (Abschnitt 2, Datenkatalog Abschnitt 6).
- **Einstellungen statt Konstanten (Nutzer, 14.11.2026):** Raid-Shoutout-Schwelle (`RAID_SHOUTOUT_MIN_VIEWERS`, heute 3), Shoutout- und Begrüßungstexte, dazu aus den Webkonsolen-Ideen: Auto-Shoutout an/aus, Raid-Begrüßung an/aus, Timer und Limits, manueller Token-Refresh. Gehört in den gemeinsamen Einstellungs-Reiter für Module und Plugins (AGENTS.md).
- **Review der Testpraxis (Nutzer, 13.11.2026; #59):** Seit `ci/tests` laufen lokal vor jedem Commit nur `node --check` und die Tests der geänderten Bereiche, die volle Testreihe nur in der CI (AGENTS.md, Pflicht-Checks). Nach etwa zehn weiteren Versionen prüfen, ob das gut funktioniert: Wie oft war die CI rot, obwohl die gezielten lokalen Tests grün waren? Sind Fehler auf `main` gelandet, die die volle lokale Testreihe gefunden hätte? Wie viel Zeit hat es gespart? Danach beibehalten, anpassen oder zurück zur vollen lokalen Testreihe. Bisher (14.11.2026): Die CI fand zwei zu knapp getaktete Tests, die lokal nie aufgefallen waren.
- **Effekt-Queue nur für Twitch-Events (früher K4):** Stream-Deck-Lichteffekte und ESP32-Events gehen direkt an Home Assistant. Die Queue schützt deshalb nicht vor Überlappungen mit diesen Effekten, und `off` schaltet nur die Twitch-Effekte stumm. Ob die Entkopplung in Home Assistant passieren soll (z. B. Script-Modus `queued`) oder Events in den Server eingespeist werden sollen, ist [UNGEKLÄRT].
- **Lizenz:** entschieden in der Projektvorgabe „Lizenz- und Entwicklungskontext“ (12.11.2026; internes Dokument beim Nutzer, nicht im Repository): Server Ziel PolyForm Perimeter 1.0.1, Widgets und Stream-Deck-Plugin als eigenständige Module unter MIT. Offen ist nur die Umstellung im Repository (`LICENSE`, `package.json` sagt noch `ISC`) als eigener Schritt.

## 5. Geplant und Ideen

### Abfrage-Automatik für Widgets (Idee, Nutzer 14.11.2026)
Der Server kennt sein Twitch-Kontingent (Ratelimit-Header, ADR 0024) und weiß, wann Wetten und Abstimmungen laufen. Er könnte in diesen Zeiten öfter nach deren Stand fragen, wenn genug Kontingent frei ist, damit Widgets nahezu sekundengenaue Daten für eine flüssigere Darstellung bekommen, ohne die Schnittstelle zu überfordern oder andere Funktionen zu stören. Mehrere gleichzeitige Vorgänge berücksichtigen. Einfach halten. Hinweis: Für Wetten und Abstimmungen liefert EventSub Fortschrittsereignisse (`channel.prediction.progress`, `channel.poll.progress`) ohne Abfrage; die Automatik wäre vor allem für Werte ohne Ereignis gedacht (z. B. Zuschauerzahl) oder als Ergänzung.

### Intro-Topics und Stream-Deck-Plugin (Nutzer, 12.11.2026)
- Abhakbare Themenliste fürs Intro (CheckTalk-Widget), bedient per Stream Deck, optional mit Lichteffekt; dazu eine allgemeine Stream-Deck-Schnittstelle mit eigenem Plugin und der Clip-Moment-Taste. Fahrplan und Stand: [FAHRPLAN.md](FAHRPLAN.md); Specs `intro-topics.md` und `stream-deck.md`; ADR 0020 und 0021.
  - **Stand 13.11.2026:** Funktioniert in OBS (Nutzer). Design-Feinschliff folgt später; zusätzlich Theme `clean` (nur Text) als Testdesign, Widget 0.3.0. Die Einstellungen ziehen später in einen gemeinsamen Reiter für alle Module und Plugins (Nutzer; AGENTS.md, `webkonsole.md`).
  - **Stand 12.11.2026:** Server-Teil, Reiter „Topics“ und CheckTalk-Widget 0.2.0 umgesetzt und mit Attrappen geprüft. Offen: Test am echten Server und in OBS, HA-Automation für die Topic-Effekte, Clip-Moment, eigenes Stream-Deck-Plugin.

### Statistik und Endscreen (Nutzer, 09.11.2026)
Ziele und Stufen in [specs/statistik.md](specs/statistik.md), Grundgerüst in ADR 0019. Umgesetzt: Server-Instanz, Stream-Ablauf, Archiv je Stream mit Berichten und Gesamtsumme, Knopf „Streamlog beenden“, Zuschauerverlauf (ADR 0023), `!privat` (ADR 0022). Offen: Endscreen-Widget, Tags, Alarm „Stream läuft nach dem Raid weiter“, Stufe 4 (Hype Trains, Bits, Kanalpunkte; neue Scopes), Clip-Kandidaten. Zurückgestellt: erste und wiederkehrende Chatter.

### Stream-Bericht mit Clip-Kandidaten und Spielbewertung (Nutzer, 04.11.2026)
Vorlage des Nutzers, ausgearbeitet in [specs/stream-bericht.md](specs/stream-bericht.md); der dort beschriebene Teil „Stream-Dokumentation“ ist inzwischen weitgehend in `statistik.md` umgesetzt (siehe Statusabschnitt der Spec). Noch nicht entschieden, kein ADR.
- Kurz: Nach jedem Stream ein Bericht mit zwei Teilen: (1) Stream-Dokumentation mit den wichtigsten Daten: Raids, Follows, Subs, Gifts, Hype Trains, Watch-Serien, Top 10 der Chatter, Whitelist-Auffälligkeiten (ADR 0015) und die Spielbewertung (je Spiel; bevorzugt per zwei Kanalpunkte-Belohnungen, Namen offen, falls unsichtbar einlösbar; später stündlicher Zwischenstand durch den Bot); (2) Clip-Kandidaten (Enigma-Antworten, Hype Trains, Alarm-Taste, Stream-Deck-Marker) mit Timecode und VOD-Link. Raids sind keine Clip-Kandidaten; die separate Raid-Statistik bleibt. Später Ein-Klick-Clips und Shorts.
- Offene Punkte stehen in der Spec unter „Abgleich“: eigener Kandidaten-Sammler statt `scheduleEffect()`, neue EventSub-Typen (Hype Train), neue Scopes und deren Wirkung auf `/token` (P2), Absicherung des Alarm-Endpoints, Testdaten.
- Vorgeschlagene Reihenfolge: 1a Spielbewertung, 1b Kandidaten-Sammler, 1c Bericht, 1d Marker und Hype Train, 1e Alarm-Endpoint.
- Vorgaben Nutzer 07.11.2026: Bericht als `.txt`-Datei mit dem Datum des Streams, erstellt am Streamende. Auslöser noch offen: EventSub `stream.offline` (meldet Twitch beim Offline-Gehen), Beginn des Abschluss-Raids (Nutzer beendet jeden Stream mit einem Raid; EventSub `channel.raid` mit dem Broadcaster als Absender) oder ein manueller Befehl, damit der Bericht am Ende vorgelesen bzw. später in der Stream-Ende-Szene gezeigt werden kann. Erst nach DerBdu angehen.
- Vorgaben Nutzer 08.11.2026: Start über das Twitch-Ereignis beim Live-Gehen. Knopf „Streamlog beenden“ auf der Hauptseite der Webkonsole, damit der Bericht schon vorliegt, wenn der Nutzer in den Stream-Ende-Bildschirm geht und die Ergebnisse vorlesen will. Wird der Knopf vergessen, beendet spätestens der eigene Abschluss-Raid den Log und speichert ihn. Abbrüche sind zu berücksichtigen: Verbindungsabbruch (eventuell neues Live-Ereignis) und Rechnerabsturz (Log bricht einfach ab). Nutzer: Kommt nach `stream.offline` binnen 2 Stunden kein neues Live-Ereignis, ist der Log abgeschlossen; ein regulärer neuer Stream binnen 2 Stunden kommt nicht vor, ein Reconnect kann bis etwa 15 Minuten dauern. Weitere Einzelheiten (Knopf vor dem Stream-Ende, Absturz) folgen im eigenen ADR. Hinweis zum Abschluss-Raid: `channel.raid` erlaubt je Abo nur `from_` oder `to_broadcaster_user_id`, für ausgehende Raids braucht es ein zweites Abo (Twitch-Doku, geprüft 08.11.2026).
- Stand 11.11.2026: Stream-Ablauf, Knopf „Streamlog beenden“, Abschlussmeldung und Bericht je Stream (`stream_reports/<Startzeit>.txt` und `.json`) sind als Statistik Stufe 2 und 3 umgesetzt (ADR 0019, Spec `statistik.md`). Offen bleiben Spielbewertung, Kandidaten-Sammler, Marker, Hype Train, Alarm-Endpoint und das Vorlesen bzw. der Endscreen.

### UBOAT-Soldbuch, weitere Ideen
Umgesetzt nach `docs/specs/uboat-personalakte.md`, ADR 0016. Befehl bis 06.11.2026 `!personalakte`, seit 07.11.2026 `!soldbuch` (Nutzer).
- Matrosen: Jahrgang steht jetzt hinter dem Namen (Nutzer, 07.11.2026). Hintergrundgeschichte (`backgroundStory`) bleibt draußen (Nutzer, 07.11.2026).
- Fester Posten bzw. Schicht: Rollen-Objekte wie „Frühschicht“ stehen im Spielstand, hängen vermutlich am Szenen-Charakter (`PlayableCharacter`), noch nicht ausgelesen.
- Kein Treffer im Chat: keine Antwort mehr, nur Konsolenzeile „Kein Soldbuch für @… – keine Antwort im Chat“ mit `uboat map`-Vorschlag. Zuschauer merken also nicht, dass sie nicht gefunden wurden.
- Namen im Spiel weichen teils vom Twitch-Namen ab; Nutzer überlegt, sie im Spiel anzupassen. Bis dahin `uboat map <login> <Name>`.
- Später: Widget „Heute an Bord“ (Daten über `/api/uboat/crew`), Crew-Ereignisse (befördert, verwundet, gefallen) über die Effekt-Queue und den Stream-Bericht.

### BdU-Chat und Bot-Account, weitere Ideen
- BdU-Chat: Das Widget trennt sich beim Ein-/Ausblenden der Quelle bzw. bei manchen Szenenwechseln und verbindet sich neu (OBS lädt die Quelle neu). Erwartet, kein Fehler; in der Zwischenzeit wird `!BdU` still ignoriert. Tageszähler je Kalendertag bleibt (Nutzer, 04.11.2026): Bei Streams über Mitternacht gelten 60 vor und 60 nach 0:00. Zustand im RAM: Limits und Funkstille beginnen nach einem Neustart neu.
- Bot-Account DerBdu (ADR 0017): sendet BdU- und Soldbuch-Nachrichten mit dem Abzeichen „Chat Bot“ (vom Nutzer bestätigt, 14.11.2026). Raid- und Whitelist-Shoutouts bleiben vorerst beim Broadcaster; später umverteilbar, am liebsten per Konsole (Wunsch Nutzer, noch nicht umgesetzt; Grundlage: `BOT_FEATURES`). Weiterer möglicher Nutzen: Bewertungen per Flüstern an den Bot statt offen im Chat (siehe specs/stream-bericht.md, Spielbewertung).

### Ideen zum Enigma-Widget (Nutzer, 11.11.2026)
Noch nicht entschieden, nicht spezifiziert. Gegenstück in `docs/OFFEN.md` des Repositorys Uboat-Widget.
1. **Landurlaub-Antwort auf `!BdU`:** Läuft das Enigma-Widget nicht oder ist die Twitch-Kategorie keine der hinterlegten (z. B. UBOAT, Wolfpack, Sonar; genaue Namen [UNGEKLÄRT], Muster `UBOAT_CATEGORY_NAMES`), antwortet der BdU anders, mit Hinweis auf Freiwache bzw. Landurlaub („Schön, dass du dich bei mir sogar aus deinem Landurlaub meldest, Soldat, aber …“). Heute ignoriert der Server `!BdU` ohne verbundenes Widget still (ADR 0014). Der Server kennt Kategorie (`currentCategory`) und Verbindung (`bduClients`) bereits. Zu klären: Ohne Widget keine KI (ADR 0004 des Widgets: der Server ruft keine KI auf), also feste Texte im Server; mit Widget außerhalb der Kategorie Antwort per KI mit Landurlaub-Hinweis. Limits (Cooldown, Tagesgrenze) gelten weiter.
2. **Enigma per Stream Deck ein- und ausblenden, unaufgeforderte Funktelegramme:** Die Browserquelle bleibt dauerhaft offen; ein Stream-Deck-Knopf lässt das Widget sich selbst ein- und ausblenden. Andere Ereignisse (z. B. aus dem Chat) können die Funkkonsole öffnen und ein Funktelegramm „eingehen“ lassen. Möglicher Weg: Stream Deck → Server-Endpoint → Widget über die bestehende Server-Sent-Events-Verbindung (`/api/bdu/stream`). Zu klären: Endpoint und Absicherung, welche Ereignisse, Verhalten ohne Server.

### Idee: Widgets melden sich beim Server an (Nutzer, 02.11.2026)
Noch nicht entschieden, nicht spezifiziert.
- Ziel: Der Server weiß, welche Widgets laufen, wann eines ausfällt oder beim Verbindungsaufbau scheitert; umgekehrt sehen die Widgets den Zustand des Servers. Übersicht über die Stabilität an einer Stelle (Konsole, `/status`), Timings gezielter einstellen, Fehler früher sehen.
- Anknüpfungspunkt: Der BdU-Chat (ADR 0014) bringt die erste dauerhafte Widget-Verbindung (Server-Sent Events). Der Server sieht damit schon, ob das Enigma-Widget verbunden ist. Daraus ließe sich ein gemeinsames Muster für alle Widgets machen, z. B. Anmeldung mit Name und Version, Lebenszeichen, Fehlermeldungen des Widgets an den Server, Übersicht „zuletzt gesehen“ je Widget.
- Weniger Abfragen bringt die Anmeldung allein nicht: SpargelPoll fragt Twitch selbst per REST ab (dortiges ADR 0002). Einsparen ließe sich das erst, wenn der Server Ereignisse (z. B. Umfragen per EventSub) an die Widgets weiterreicht. Das berührt ADRs in den Widget-Repositories.
- Zu klären: welche Widgets (SpargelPoll, Coinflip, Enigma, weitere), was „Fehler“ jeweils heißt, ob Widgets auf Server-Ausfälle anders reagieren sollen als heute (Start-Wiederholung), Darstellung der Übersicht.

### Ausbau zur Plattform (Nutzer, 03.11.2026)
Vorgemerkt, noch nicht entschieden oder spezifiziert. Reihenfolge und Umfang [UNGEKLÄRT]. Je Punkt vor der Umsetzung eigenes ADR und eigene Spec. P1 (Webkonsole) ist umgesetzt, siehe Archiv.

#### P2 Sicherheitsprüfung
- Ziel: Server systematisch auf Sicherheitslücken prüfen und gefundene schließen.
- Bekannte Ansatzpunkte: siehe Abschnitt 2 (Netzwerk, Herkunft `null`, eingehende Anfragen, `npm audit`).
- Sinnvoll vor P3 und zwingend vor P4.

#### P3 Widgets vom Server ausliefern, als optionale Module
- Ziel: Der Server liefert die Browser-Widgets aus (`http://localhost:3000/widgets/…`), alles liegt an einem Ort; jedes Widget ist ein optionales Modul, das sich ein- und ausschalten lässt.
- Vorteile: gleiche Herkunft wie der Server, keine Chromium-Sperre, CORS für Widgets unnötig; `null` und `http://absolute` könnten aus der Liste entfallen (Restlücke geschlossen); der Server kann Caching der Widget-Dateien verhindern; einheitliche Adressen, später direkt aus Git-Klonen.
- Nachteile: Ohne laufenden Server lädt OBS die Seite gar nicht, die Start-Wiederholung der Widgets hilft dann nicht; nach einem Serverabsturz müssten die OBS-Quellen neu geladen werden. Der Server liefert zusätzlich Dateien aus (Widget-Ordner per `.env`, nie der Server-Ordner, sonst wären `.env` und `tokens.json` abrufbar). Jede Browser-Source muss umgestellt werden; Widgets und Server werden enger gekoppelt.
- Auslöser zum Umsetzen: Ein OBS-Update sperrt auch `file://`, oder die Restlücke durch `null` soll geschlossen werden. Berührt **ADR 0013** (Herkünfte `null` und `http://absolute` könnten entfallen) und die ADRs der Widget-Repositories (`BombingFritz/TwitchPoll`, `BombingFritz/Uboat-Widget`).
- Fernziel (Nutzer, 08.11.2026): Zusatzfunktionen wie HA-Effekte, UBOAT-Soldbuch, BdU-Chat und Sub-Goal werden später zu Modulen, die man an- und ausschalten und gegebenenfalls deinstallieren kann. Auf der Hauptseite der Webkonsole stehen sie schon als Gruppe „Optionale Module“ (ADR 0018); im Code sind sie noch keine eigenständigen Module.
- Zu klären: Modul-Schnittstelle (z. B. Name, Version, eigene Endpoints, eigene Einstellungen), ob Widgets im Server-Repository liegen oder als eigene Repositories eingebunden werden, Verhalten der OBS-Quellen, wenn der Server nicht läuft.

#### P4 Öffentliche Veröffentlichung für andere Streamer
- Ziel: Andere Streamer können den Server einfach, sicher und bequem einsetzen, möglichst ohne eigene Twitch-App in der Developer Console.
- Kernproblem: Heute braucht jede Installation `CLIENT_ID` und `CLIENT_SECRET` einer eigenen App. Ein gemeinsames Client-Secret darf nicht mit ausgeliefert werden.
- Mögliche Wege (nicht geprüft):
  - Twitch „Device Code Grant Flow“ mit einer öffentlichen App (Client-Typ „Public“): Anmeldung ohne Client-Secret, nur mit der gemeinsamen Client-ID. Laufzeit und Erneuerung der Refresh-Tokens bei öffentlichen Clients [UNGEKLÄRT, gegen die Twitch-Doku prüfen].
  - Zentraler, von dir betriebener Anmeldedienst, der das Secret hält. Das widerspricht dem bisherigen rein lokalen Betrieb und bringt Betriebs- und Datenschutzpflichten.
- Einschränkungen: Der Bot-Account (App-Access-Token mit Client-Secret) passt nicht ohne Weiteres zu einem öffentlichen Client [UNGEKLÄRT]. Rate-Limits und Bedingungen von Twitch gelten dann für alle Nutzer einer gemeinsamen Client-ID [UNGEKLÄRT].
- Weitere Voraussetzungen: P2 abgeschlossen; Installation ohne Programmierkenntnisse; Einstellungen ohne `.env` (z. B. über die Webkonsole); Home Assistant optional; Texte und Branding (Spargel, BdU) konfigurierbar statt fest im Code; Lizenz im Repository umstellen (siehe Abschnitt 4); Test- und Live-Daten getrennt (Abschnitt 3, Entwicklungsmodus).

### Ausbau der Webkonsole und spätere Module (Nutzer, 09.11.2026)
Noch nicht entschieden oder spezifiziert; je Punkt vor der Umsetzung Spec und, wo es eine Entscheidung braucht, ADR.

1. **Mehr Einstellungen in der Webkonsole:** siehe Abschnitt 4, „Einstellungen statt Konstanten“.
2. **Soldbuch in der Webkonsole:** alle Namen aus dem Spielstand anzeigen, kennzeichnen, welche mit einem Chatter-Namen verknüpft sind, und sie direkt mit einem Twitch-Nutzernamen verknüpfen. Grundlage: `uboat_crew_map.json` und `uboat map` (ADR 0016).
3. **Usability im Blick behalten:** Die Module (BdU-Chat, Soldbuch) werden auf einer eigenen Seite verwaltet und nicht mit den Grundeinstellungen vermischt. Hat ein Modul sehr umfangreiche Einstellungen, füllen sie eventuell nach einem Klick die ganze Seite oder lassen sich auf- und einklappen. Vorgabe seit 13.11.2026: gemeinsamer Reiter für die Einstellungen aller Module und Plugins, Klick auf den Modulnamen auf der Startseite führt dorthin (AGENTS.md).
4. **Modul Bot-Timer:** wiederholte Chat-Meldungen nach X Minuten. Bedingungen bei Bedarf: gestreamte Kategorie, bisherige Dauer des Streams, Uhrzeit, Anzahl der Zuschauer. Dazu wählbar, welcher Bot sendet und welcher Hook (HA-Server) mit der Meldung verknüpft wird. Effekte nur über `scheduleEffect()` (ADR 0004).
5. **Channel-Emotes durch den Bot:** Der Bot-Account kann inzwischen die Channel-Emotes des Nutzers benutzen, vermutlich über die eigenen Prefixes [UNGEKLÄRT]. Er soll das nach Möglichkeit tun. Herauszufinden ist, ob sich das sinnvoll in `!BdU` einbauen lässt; die Antworten kommen vom Enigma-Widget (ADR 0014, ADR 0017).
6. **Kleiner Monitor am ESP32:** Hinweise an den Nutzer ausgeben, z. B. „>100 Zuschauer, automatisch Werbung steht an“, „Nutzer xyz hat über 20er Stream-Serie erreicht“, „Erster Chatter schreibt“, „VIP/Gifter schreibt heute zum ersten Mal“. Der Server liefert nur `type` und `meta`, Hardwaresteuerung gehört nicht in den Server (AGENTS.md); Anbindung vor der Umsetzung klären, Zugang aus dem LAN siehe Abschnitt 2 [UNGEKLÄRT].
7. **Modul Chat-Auswertung:** Zusammenfassung des Chats des gesamten Streams, Chat-Statistiken und Chat-Zusammenfassungen einzelner Streamer. Geht vermutlich nur mit API-Anbindung; weiter ausloten [UNGEKLÄRT, welcher Dienst, Kosten, Umgang mit Chat-Daten].
