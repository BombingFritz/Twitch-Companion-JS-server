# Offene Punkte

## Priorität 1
- ~~Ungemergter Branch: 40-Tage-Aktivitätsprüfung für Shoutouts~~ – erledigt (05.11.2026): Der alte Code ist nicht mehr auffindbar; neu umgesetzt nach ADR 0015 (nur Whitelist-Shoutouts, aktiv = live oder Video jeder Art höchstens 40 Tage alt). Chat-Hinweis mit Datum und Spiel vor dem Shoutout wieder eingebaut (Nutzer).
- **Testphase Aktivitätsprüfung (ab Nov. 2026):** `SHOUTOUT_ACTIVITY_STRICT = false`, d. h. bei unklarer Aktivität (kein Video, API-Fehler) trotzdem Shoutout. Konsole beobachten („nicht aktiv“, „nicht feststellbar“). Wenn die Prüfung zuverlässig wirkt, auf `true` umstellen (ADR 0015).
- Feldnamen in `handleChatNotification` (`chatter_is_anonymous`, `sub.is_gift`, `resub.is_gift`, `source_broadcaster_user_id`) sind gegen reale Twitch-Events nicht belegt [UNGEKLÄRT]. Gegen echte Subs/Gifts prüfen.
  - **Teilweise belegt (Livestream 03.11.2026):** `notice_type` `resub` (6×) und `sub_gift` ohne `community_gift_id` (1×) lösten je genau einen Effekt aus; beim Einzel-Gift kein zusätzlicher Sub-Effekt für den Empfänger; die Lichter reagierten. Weiter offen: `chatter_is_anonymous`, `is_gift`, `community_sub_gift` (Gift-Bomb), `source_broadcaster_user_id`.
- Aktualität: Der Server wird parallel in mehreren Diskussionen weiterentwickelt. Vor jeder Weiterentwicklung klären, welcher Stand gilt. Ab jetzt gilt das GitHub-Repository als maßgeblicher Stand.
- ~~EventSub-Keepalive~~ – erledigt (Nov. 2026): Stille Verbindungen werden nach Keepalive-Intervall plus 5 s getrennt und neu aufgebaut (ARCHITEKTUR.md, „Verbindungsverwaltung“). Ob stille Abbrüche in der Praxis vorkamen, ist weiter [UNGEKLÄRT]; die Konsole meldet sie jetzt.

## Abgleich mit dem Gesamtkontext (Okt. 2026)

Ergebnis der Prüfung von docs/KONTEXT.md gegen den Code. Entscheidungen stehen aus.

- **K1 Sicherheit von `/token` und CORS (hoch) – weitgehend erledigt, siehe ADR 0013:** Der Kontext geht von „lokal, hinter der Router-Firewall“ aus. Der Server lauscht aber auf allen Netzwerkschnittstellen (`app.listen(PORT)` ohne Host), erlaubt CORS für jede Origin und gibt den Access-Token ohne Prüfung heraus. Die Firewall schützt nur vor dem Internet. Folgen: (a) Jedes Gerät im LAN kann den Token abrufen. (b) Jede Webseite, die im Browser des Streaming-PCs geöffnet ist, kann per JavaScript `http://localhost:3000/token` lesen. Der Token hat unter anderem `user:write:chat` und `moderator:manage:shoutouts`. (c) Die GET-Endpoints für Modus und Bestätigung kann jede Webseite auslösen. Mögliche Maßnahmen: nur an `127.0.0.1` binden, CORS auf die Widget-Origins beschränken (OBS-Browser-Sources mit lokalen Dateien senden `Origin: null` [UNGEKLÄRT, prüfen]). Berührt ADR 0003 und 0010.
  - **Stand Nov. 2026:** (a) erledigt: `/token` nur noch über Loopback und Host `localhost`/`127.0.0.1`. (b) erledigt: Browser-Herkünfte per Liste, fremde erhalten 403; Host-Check gegen DNS-Rebinding. (c) teilweise: `fetch` von fremden Webseiten wird abgelehnt; einfache Einbindungen ohne `Origin`-Header (z. B. `<img src=…>`) können die GET-Endpoints für Modus und Bestätigung weiterhin auslösen.
  - Offen: Der Server lauscht weiter auf allen Schnittstellen, weil Home Assistant `/api/homeassistant/events` eventuell aus dem LAN abfragt [UNGEKLÄRT]. Herkunft `null` muss erlaubt bleiben (siehe nächster Punkt); `null` senden auch abgeschottete iframes fremder Seiten (kleine Restlücke).
  - **Bestätigt (OBS-Test 01.11.2026):** Die aktuelle OBS-Version sperrt Anfragen von „Lokale Datei“-Seiten (`http://absolute`) an `localhost` („Local Network Access“). Die Anfrage erreicht den Server gar nicht. Lösung vorerst: Widgets in OBS per URL `file:///…` einbinden (Herkunft `null`), so funktioniert das Polling-Widget wieder. Coinflip war ebenso betroffen und ist umgestellt. Enigma war bisher nicht betroffen, weil es keine Anfragen an den Server stellte. Mit dem BdU-Chat (Widget 1.2.0, Chat-Modus an) spricht es `localhost` an und muss ebenfalls per `file:///` eingebunden werden; Einstellungen per Export/Import mitnehmen.
  - **Option für später: Widgets vom Server ausliefern** (`http://localhost:3000/widgets/…`). Bewusst noch nicht umgesetzt.
    - Vorteile: gleiche Herkunft wie der Server, keine Chromium-Sperre, CORS für Widgets unnötig; `null` und `http://absolute` könnten aus der Liste entfallen (Restlücke geschlossen); der Server kann Caching der Widget-Dateien verhindern; einheitliche Adressen, später direkt aus Git-Klonen.
    - Nachteile: Ohne laufenden Server lädt OBS die Seite gar nicht, die Start-Wiederholung der Widgets hilft dann nicht; nach einem Serverabsturz müssten die OBS-Quellen neu geladen werden. Der Server liefert zusätzlich Dateien aus (Widget-Ordner per `.env`, nie der Server-Ordner, sonst wären `.env` und `tokens.json` abrufbar). Jede Browser-Source muss umgestellt werden; Widgets und Server werden enger gekoppelt.
    - Auslöser zum Umsetzen: Ein OBS-Update sperrt auch `file://`, oder die Restlücke durch `null` soll geschlossen werden.
  - Diagnose bei Startproblemen von Widgets: Erscheint in der Konsole keine `[Token] Ausgabe an Widget-Herkunft: …`-Zeile und keine Ablehnung, kommt die Anfrage nicht an (Browser-Sperre). OBS mit `--remote-debugging-port=9222` starten und die Konsole der Browser-Source unter `http://localhost:9222` prüfen.
- **K2 Widgets rufen Helix direkt auf, im Gegensatz zu ADR 0003 – erledigt (Nov. 2026): ADR 0003 präzisiert, `/token` liefert `client_id`:** Laut Kontext holen Widgets den Token über `/token` und rufen danach Twitch Helix direkt auf. ADR 0003 heißt „Widgets sprechen nur den Server an“ und nennt den direkten API-Zugriff als verworfene Alternative, allerdings „mit eigenen Credentials“. Helix verlangt außerdem den Header `Client-ID`. `/token` liefert ihn nicht, also muss er im Widget-Code stehen [UNGEKLÄRT]. Die Client-ID ist kein Secret, aber sie dupliziert Konfiguration. Zu klären: ADR 0003 präzisieren (Token ja, Secret nie) und gegebenenfalls `client_id` in `/token` mitliefern.
- **K3 Modus `off` hält eine wartende manuelle Bestätigung nicht auf (Bug) – erledigt (Nov. 2026): `setEffectMode()`, siehe docs/BUGS.md; verworfene Bestätigung ohne Log-Eintrag (Nutzerentscheidung, Schutz vor überlaufendem Log bei Attacken):** Laut Kontext und Spec verwirft `off` neue Effekte. Wird während einer laufenden 30-s-Wartezeit im Modus `manual` auf `off` umgeschaltet, bleibt die Bestätigung offen. Ein Klick auf `/api/effects/confirm` löst den Effekt dann trotz `off` aus. Fix: Beim Wechsel auf `off` eine wartende Bestätigung mit `false` auflösen.
- **K4 „Zentrale“ Effekt-Queue gilt nur für Twitch-Events:** Stream-Deck-Lichteffekte und ESP32-Events gehen direkt an Home Assistant. Die Queue schützt deshalb nicht vor Überlappungen mit diesen Effekten, und `off` schaltet nur die Twitch-Effekte stumm. Ob die Entkopplung in Home Assistant passieren soll (z. B. Script-Modus `queued`) oder Events in den Server eingespeist werden sollen, ist [UNGEKLÄRT].
- **K5 Stream-Deck-Steuerung schon umgesetzt:** Laut Kontext sind Modus-Umschaltung und Bestätigung per Stream Deck „geplant“. Die Endpoints gibt es bereits (ADR 0010). Offen ist, ob die Stream-Deck-Tasten schon eingerichtet sind; danach den Kontext aktualisieren.
- **K6 Name:** Der Kontext nennt den Server noch „Node.js Auth Server“. Bei der nächsten Überarbeitung des Kontexts „Twitch Companion JS server“ verwenden.
- **K7 Startskript und Konsole:** Der Server liest Konsolenbefehle über `stdin`. Startet das Startskript ihn ohne sichtbares Konsolenfenster, sind Whitelist- und Effekt-Befehle nicht erreichbar [UNGEKLÄRT, wie das Skript startet].
  - Stand 04.11.2026: Der Server startet über `AuthServer.cmd` (Windows), jetzt im Repository. Das Stream-Deck-Skript nutzt die `.cmd`; eine inhaltsgleiche `AuthServer.bat` lag lokal daneben, mit ihr klappte der Start per Stream Deck laut Nutzer nicht [UNGEKLÄRT, warum]; sie ist nicht im Repository. Sie öffnet ein eigenes Konsolenfenster mit `node server.js` und `pause`, die Konsolenbefehle sind also erreichbar, sofern das Stream-Deck-Skript, das Server, OBS und WLED-Controller nacheinander startet, die Datei normal (nicht minimiert/versteckt) öffnet [UNGEKLÄRT]. Banner und Fenstertitel tragen jetzt den neuen Namen (K6); der Dateiname bleibt, damit bestehende Verknüpfungen weiter funktionieren.
- **K8 Test- und Live-Daten:** Alle JSON-Dateien liegen im Arbeitsverzeichnis, einen Testmodus gibt es nicht. Ein Testlauf im Projektordner würde echte Raid-Statistik und Event-Log verändern und echte Chat-Nachrichten senden. Das passt zur Entwicklungsrichtung „Stream-, Langzeit- und Testdaten trennen“, ist aber noch nicht umgesetzt.
- **K9 `/status` zeigt abgelaufene Funkstille (Bug, klein, gefunden 03.11.2026) – erledigt (Nov. 2026):** `bdu_silence_until` liest `bduSilenceUntil` direkt. Nach Ablauf einer 30-min-Funkstille bleibt dort die alte Uhrzeit stehen, bis `isBduSilenceActive()` das nächste Mal läuft (nächstes `!BdU` oder `bdu show`). Auf das Verhalten im Chat hat das keinen Einfluss. Fix: in `/status` `isBduSilenceActive()` aufrufen, bevor der Wert gelesen wird.

## BdU-Chat (`!BdU`) – umgesetzt, erster Livestream-Test 03.11.2026
Umgesetzt nach `docs/specs/bdu-chat.md`, ADR 0014; Gegenstück Enigma-Widget 1.2.0 (`BombingFritz/Uboat-Widget`). Mit den vorgeschlagenen Werten: Funkstille bei Tageskontingent bis Streamstart, Tagesobergrenze 60, Anfragen an das zuletzt verbundene Widget (Konstanten oben in `server.js`).
- Mit echtem Twitch-Chat erprobt (03.11.2026): Erkennung, Weitergabe an das Widget und Antwort als Reply funktionieren (`reply_parent_message_id` bestätigt). Stolperstein: Widget-Quelle in OBS noch als „Lokale Datei“, dann kommt keine Verbindung an (Server meldet „kein Enigma-Widget verbunden“); Lösung `file:///`.
- Livestream-Test 03.11.2026: 6 Anfragen (5 vom Broadcaster, 1 aus dem Publikum), Antworten nach 1–3 s, keine Fehler. Limits, Warnung und Funkstille wurden nicht erreicht, also unter Last weiter unerprobt. Rückmeldung: wenig genutzt, aber Lob für die Idee.
- Das Widget trennt sich beim Ein-/Ausblenden der Quelle bzw. bei manchen Szenenwechseln und verbindet sich neu (OBS lädt die Quelle neu). Erwartet, kein Fehler; in der Zwischenzeit wird `!BdU` still ignoriert.
- Tageszähler je Kalendertag bleibt (Nutzer, 04.11.2026): Bei Streams über Mitternacht gelten 60 vor und 60 nach 0:00.
- Zustand im RAM: Limits und Funkstille beginnen nach einem Neustart neu.
- Erste dauerhafte Widget-Verbindung des Servers; Anknüpfungspunkt für die Idee „Widgets melden sich an“ (nächster Abschnitt).

## Geplant: Bot-Account „DerBdu“ für BdU-Antworten (Nutzer, 03.11.2026)
Ziel: Antworten, Warnung und Funkstille-Ansage des BdU erscheinen nicht als Broadcaster, sondern vom eigenen Bot-Konto „DerBdu“. Reihenfolge laut Nutzer: nach dem Livestream-Test und dem Release Enigma-Widget 1.2.0.
- Partner-Vorteil: Twitch-Partner können bis zu zwei dauerhafte Bot-Abos (Stufe 3) anfordern; der Nutzer klärt das für „DerBdu“ mit dem Support. Das Abo regelt nur Emotes und Abo-Abzeichen, nicht die technische Anbindung.
- Technischer Plan (Vorschlag, noch nicht entschieden):
  - Senden über die Helix-API „Send Chat Message“ mit App-Access-Token (Client-Credentials) und `sender_id` = Bot. Damit zeigt Twitch das „Chat Bot“-Abzeichen; mit Nutzer-Token des Bots erscheint es nicht.
  - Voraussetzungen: Bot-Konto erteilt einmalig `user:bot` (und `user:write:chat`); für den Kanal `channel:bot` oder der Bot ist Moderator (`/mod DerBdu`, empfohlen).
  - Neue Adresse `/login-bot` für die einmalige Freigabe (über die bestehende `/callback`-Redirect-URL), Bot-ID/-Name in eigener Laufzeitdatei (z. B. `bot.json`, in `.gitignore`).
  - `sendBduChatMessage` nutzt den Bot, Rückfall auf den Broadcaster, wenn kein Bot eingerichtet ist oder Twitch ablehnt; Anzeige in `/status` und `bdu show`.
  - Eigenes ADR, Spec, Test mit Attrappen. Am Enigma-Widget ändert sich nichts.
- Offene Frage an den Nutzer: nur BdU-Nachrichten über den Bot (Vorschlag) oder auch Raid-Begrüßung und `!raidstats`?
- Quellen: Twitch Developer Forum „Introducing the Chat Bot badge and chat identity for chatbots“ (28.08.2025); Twitch-Doku „Authenticating and EventSub“ (Chat).

## Idee: Widgets melden sich beim Server an (Nutzer, 02.11.2026)
Noch nicht entschieden, nicht spezifiziert.
- Ziel: Der Server weiß, welche Widgets laufen, wann eines ausfällt oder beim Verbindungsaufbau scheitert; umgekehrt sehen die Widgets den Zustand des Servers. Übersicht über die Stabilität an einer Stelle (Konsole, `/status`), Timings gezielter einstellen, Fehler früher sehen.
- Anknüpfungspunkt: Der BdU-Chat (ADR 0014) bringt die erste dauerhafte Widget-Verbindung (Server-Sent Events). Der Server sieht damit schon, ob das Enigma-Widget verbunden ist. Daraus ließe sich ein gemeinsames Muster für alle Widgets machen, z. B. Anmeldung mit Name und Version, Lebenszeichen, Fehlermeldungen des Widgets an den Server, Übersicht „zuletzt gesehen“ je Widget.
- Weniger Abfragen bringt die Anmeldung allein nicht: SpargelPoll fragt Twitch selbst per REST ab (dortiges ADR 0002). Einsparen ließe sich das erst, wenn der Server Ereignisse (z. B. Umfragen per EventSub) an die Widgets weiterreicht. Das berührt ADRs in den Widget-Repositories.
- Zu klären: welche Widgets (SpargelPoll, Coinflip, Enigma, weitere), was „Fehler“ jeweils heißt, ob Widgets auf Server-Ausfälle anders reagieren sollen als heute (Start-Wiederholung), Darstellung der Übersicht.

## Geplant: Ausbau zur Plattform (Nutzer, 03.11.2026)
Vorgemerkt, noch nicht entschieden oder spezifiziert. Reihenfolge und Umfang [UNGEKLÄRT]. Je Punkt vor der Umsetzung eigenes ADR und eigene Spec.

### P1 Server-Konsole im Browser
- Ziel: Weboberfläche des Servers (z. B. `http://localhost:3000/admin`) mit ausführlicherem Log, Whitelist-Verwaltung und Einstellungen, etwa Effekt-Modus und manuelles Auslösen von Effekten.
- Berührt **ADR 0006** (Whitelist nur per Konsole): Das ADR müsste abgelöst werden; bei der Umsetzung nachfragen.
- Voraussetzung: Zugriffsschutz für alle zustandsändernden Aktionen (nur lokal wie `/token`, ADR 0013; POST statt GET, siehe Priorität 2). Sonst könnte jede Webseite im Browser des Streaming-PCs die Whitelist ändern oder Effekte auslösen.
- Manuelles Auslösen nur über `scheduleEffect()` (ADR 0004), HA-Payload unverändert.
- Ausführlicher Log: Log-Zeilen bisher nur auf `stdout`; braucht einen Puffer im Server (RAM oder Datei, ADR 0001/0002). Löst nebenbei K7 (Konsole beim Start per Skript ohne Fenster nicht erreichbar).
- Anknüpfungspunkte: Server-Sent Events wie beim BdU-Chat (ADR 0014) für den Live-Log; Idee „Widgets melden sich an“ für eine Übersicht der Widgets.

### P2 Sicherheitsprüfung
- Ziel: Server systematisch auf Sicherheitslücken prüfen und gefundene schließen.
- Bekannte Ansatzpunkte: Zustandsändernde GET-Endpoints ohne Authentifizierung (Priorität 2), Herkunft `null` als Restlücke (K1), Server lauscht auf allen Schnittstellen (K1, [UNGEKLÄRT], ob Home Assistant aus dem LAN abfragt), keine Begrenzung der Anfragerate, Abhängigkeiten (`npm audit`).
- Sinnvoll vor P1 und P3 und zwingend vor P4.

### P3 Widgets vom Server ausliefern, als optionale Module
- Ziel: Der Server liefert die Browser-Widgets aus (`http://localhost:3000/widgets/…`), alles liegt an einem Ort; jedes Widget ist ein optionales Modul, das sich ein- und ausschalten lässt.
- Bisher bewusst zurückgestellt: Vor- und Nachteile, Auslöser und Sicherheitsregel (nur ein eigener Widget-Ordner, nie der Server-Ordner) stehen unter K1, „Option für später“. Berührt **ADR 0013** (Herkünfte `null` und `http://absolute` könnten entfallen) und die ADRs der Widget-Repositories (`BombingFritz/TwitchPoll`, `BombingFritz/Uboat-Widget`).
- Zu klären: Modul-Schnittstelle (z. B. Name, Version, eigene Endpoints, eigene Einstellungen), ob Widgets im Server-Repository liegen oder als eigene Repositories eingebunden werden, Verhalten der OBS-Quellen, wenn der Server nicht läuft.

### P4 Öffentliche Veröffentlichung für andere Streamer
- Ziel: Andere Streamer können den Server einfach, sicher und bequem einsetzen, möglichst ohne eigene Twitch-App in der Developer Console.
- Kernproblem: Heute braucht jede Installation `CLIENT_ID` und `CLIENT_SECRET` einer eigenen App. Ein gemeinsames Client-Secret darf nicht mit ausgeliefert werden.
- Mögliche Wege (nicht geprüft):
  - Twitch „Device Code Grant Flow“ mit einer öffentlichen App (Client-Typ „Public“): Anmeldung ohne Client-Secret, nur mit der gemeinsamen Client-ID. Laufzeit und Erneuerung der Refresh-Tokens bei öffentlichen Clients [UNGEKLÄRT, gegen die Twitch-Doku prüfen].
  - Zentraler, von dir betriebener Anmeldedienst, der das Secret hält. Das widerspricht dem bisherigen rein lokalen Betrieb und bringt Betriebs- und Datenschutzpflichten.
- Einschränkungen: Der geplante Bot-Account (App-Access-Token mit Client-Secret, siehe „Bot-Account DerBdu“) passt nicht ohne Weiteres zu einem öffentlichen Client [UNGEKLÄRT]. Rate-Limits und Bedingungen von Twitch gelten dann für alle Nutzer einer gemeinsamen Client-ID [UNGEKLÄRT].
- Weitere Voraussetzungen: P2 abgeschlossen; Installation ohne Programmierkenntnisse; Einstellungen ohne `.env` (z. B. über P1); Home Assistant optional; Texte und Branding (Spargel, BdU) konfigurierbar statt fest im Code; Lizenz wählen (`package.json`: bisher `ISC`, `private: true`) [UNGEKLÄRT]; Test- und Live-Daten getrennt (K8).

## Priorität 2
- Viewer-Schwelle für Raid-Shoutout (3) ist hart im Code, keine Variable.
- Zustandsändernde Endpoints (`/api/effects/mode/:mode`, `/api/effects/confirm`) sind GET ohne Authentifizierung. Fremde Webseiten werden per Herkunftsprüfung abgelehnt, Einbindungen ohne `Origin` nicht (siehe K1). Bewertung: [UNGEKLÄRT].
- Funktionsdetails der Widgets (Polling-Widget: dokumentiert im Repository BombingFritz/TwitchPoll als `SpargelPoll.html`; `bFCoinFlipV9_final.html`) sind nicht dokumentiert. Die Anhänge `pollingWidget.html` und `Creator-Overlay.html` sind nicht ausgewertet.
- Wirkung des Home-Assistant-Scripts und der WLED-Effektauswahl: separate Doku, nicht Teil dieses Repos [UNGEKLÄRT].
- Ob Twitch `channel.chat.notification` zeitgleich mit der Chat-Anzeige und den Overlay-Alerts liefert, ist nicht belegt [UNGEKLÄRT].

## Priorität 3 (Ideen)
- Konsolenbefehl `effects confirm` zum Bestätigen im Modus `manual` (bisher nur HTTP).
- `refreshSubGoalCache` läuft bei jedem Sub-Event einzeln, bei einem Gift-Bomb entsprechend oft.
- Alte `Server_Dokumentation.md` durch diese Struktur ersetzen. Die Datei liegt nicht im Repository [UNGEKLÄRT, ob der Punkt erledigt ist oder die Datei nur lokal existiert].
