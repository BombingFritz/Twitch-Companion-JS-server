# Offene Punkte

## Priorität 1
- Ungemergter Branch: 40-Tage-Aktivitätsprüfung für Shoutouts (`getRecentStreamInfo()` über `/helix/videos`, `SHOUTOUT_ACTIVITY_WINDOW_DAYS=40`, Chat-Nachricht mit Datum und Spiel). Fehlt in diesem Code. Zusammenführen mit der Effekt-Queue steht aus.
- Feldnamen in `handleChatNotification` (`chatter_is_anonymous`, `sub.is_gift`, `resub.is_gift`, `source_broadcaster_user_id`) sind gegen reale Twitch-Events nicht belegt [UNGEKLÄRT]. Gegen echte Subs/Gifts prüfen.
- Aktualität: Der Server wird parallel in mehreren Diskussionen weiterentwickelt. Vor jeder Weiterentwicklung klären, welcher Stand gilt. Ab jetzt gilt das GitHub-Repository als maßgeblicher Stand.
- EventSub-Keepalive: `session_keepalive` wird nicht ausgewertet. Bricht die Verbindung still ab (ohne `close`), bemerkt der Server das nicht [UNGEKLÄRT, ob in der Praxis aufgetreten].

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
- **K3 Modus `off` hält eine wartende manuelle Bestätigung nicht auf (Bug):** Laut Kontext und Spec verwirft `off` neue Effekte. Wird während einer laufenden 30-s-Wartezeit im Modus `manual` auf `off` umgeschaltet, bleibt die Bestätigung offen. Ein Klick auf `/api/effects/confirm` löst den Effekt dann trotz `off` aus. Fix: Beim Wechsel auf `off` eine wartende Bestätigung mit `false` auflösen.
- **K4 „Zentrale“ Effekt-Queue gilt nur für Twitch-Events:** Stream-Deck-Lichteffekte und ESP32-Events gehen direkt an Home Assistant. Die Queue schützt deshalb nicht vor Überlappungen mit diesen Effekten, und `off` schaltet nur die Twitch-Effekte stumm. Ob die Entkopplung in Home Assistant passieren soll (z. B. Script-Modus `queued`) oder Events in den Server eingespeist werden sollen, ist [UNGEKLÄRT].
- **K5 Stream-Deck-Steuerung schon umgesetzt:** Laut Kontext sind Modus-Umschaltung und Bestätigung per Stream Deck „geplant“. Die Endpoints gibt es bereits (ADR 0010). Offen ist, ob die Stream-Deck-Tasten schon eingerichtet sind; danach den Kontext aktualisieren.
- **K6 Name:** Der Kontext nennt den Server noch „Node.js Auth Server“. Bei der nächsten Überarbeitung des Kontexts „Twitch Companion JS server“ verwenden.
- **K7 Startskript und Konsole:** Der Server liest Konsolenbefehle über `stdin`. Startet das Startskript ihn ohne sichtbares Konsolenfenster, sind Whitelist- und Effekt-Befehle nicht erreichbar [UNGEKLÄRT, wie das Skript startet].
- **K8 Test- und Live-Daten:** Alle JSON-Dateien liegen im Arbeitsverzeichnis, einen Testmodus gibt es nicht. Ein Testlauf im Projektordner würde echte Raid-Statistik und Event-Log verändern und echte Chat-Nachrichten senden. Das passt zur Entwicklungsrichtung „Stream-, Langzeit- und Testdaten trennen“, ist aber noch nicht umgesetzt.

## BdU-Chat (`!BdU`) – umgesetzt, Live-Test ausstehend
Umgesetzt nach `docs/specs/bdu-chat.md`, ADR 0014; Gegenstück Enigma-Widget 1.2.0 (`BombingFritz/Uboat-Widget`). Mit den vorgeschlagenen Werten: Funkstille bei Tageskontingent bis Streamstart, Tagesobergrenze 60, Anfragen an das zuletzt verbundene Widget (Konstanten oben in `server.js`).
- Offen: Test mit echtem Twitch-Chat und Stream; `reply_parent_message_id` und `is_sent`/`drop_reason` gegen echte Antworten prüfen.
- Zustand im RAM: Limits und Funkstille beginnen nach einem Neustart neu.
- Erste dauerhafte Widget-Verbindung des Servers; Anknüpfungspunkt für die Idee „Widgets melden sich an“ (nächster Abschnitt).

## Idee: Widgets melden sich beim Server an (Nutzer, 02.11.2026)
Noch nicht entschieden, nicht spezifiziert.
- Ziel: Der Server weiß, welche Widgets laufen, wann eines ausfällt oder beim Verbindungsaufbau scheitert; umgekehrt sehen die Widgets den Zustand des Servers. Übersicht über die Stabilität an einer Stelle (Konsole, `/status`), Timings gezielter einstellen, Fehler früher sehen.
- Anknüpfungspunkt: Der BdU-Chat (ADR 0014) bringt die erste dauerhafte Widget-Verbindung (Server-Sent Events). Der Server sieht damit schon, ob das Enigma-Widget verbunden ist. Daraus ließe sich ein gemeinsames Muster für alle Widgets machen, z. B. Anmeldung mit Name und Version, Lebenszeichen, Fehlermeldungen des Widgets an den Server, Übersicht „zuletzt gesehen“ je Widget.
- Weniger Abfragen bringt die Anmeldung allein nicht: SpargelPoll fragt Twitch selbst per REST ab (dortiges ADR 0002). Einsparen ließe sich das erst, wenn der Server Ereignisse (z. B. Umfragen per EventSub) an die Widgets weiterreicht. Das berührt ADRs in den Widget-Repositories.
- Zu klären: welche Widgets (SpargelPoll, Coinflip, Enigma, weitere), was „Fehler“ jeweils heißt, ob Widgets auf Server-Ausfälle anders reagieren sollen als heute (Start-Wiederholung), Darstellung der Übersicht.

## Priorität 2
- Viewer-Schwelle für Raid-Shoutout (3) ist hart im Code, keine Variable.
- Zustandsändernde Endpoints (`/api/effects/mode/:mode`, `/api/effects/confirm`) sind GET ohne Authentifizierung. Fremde Webseiten werden per Herkunftsprüfung abgelehnt, Einbindungen ohne `Origin` nicht (siehe K1). Bewertung: [UNGEKLÄRT].
- Funktionsdetails der Widgets (Polling-Widget: dokumentiert im Repository BombingFritz/TwitchPoll als `SpargelPoll.html`; `bFCoinFlipV9_final.html`) sind nicht dokumentiert. Die Anhänge `pollingWidget.html` und `Creator-Overlay.html` sind nicht ausgewertet.
- Wirkung des Home-Assistant-Scripts und der WLED-Effektauswahl: separate Doku, nicht Teil dieses Repos [UNGEKLÄRT].
- Ob Twitch `channel.chat.notification` zeitgleich mit der Chat-Anzeige und den Overlay-Alerts liefert, ist nicht belegt [UNGEKLÄRT].

## Priorität 3 (Ideen)
- Konsolenbefehl `effects confirm` zum Bestätigen im Modus `manual` (bisher nur HTTP).
- Umstellung der Raid-Statistik auf Jahresbasis ab 2027 (Kommentar im Code).
- `refreshSubGoalCache` läuft bei jedem Sub-Event einzeln, bei einem Gift-Bomb entsprechend oft.
- Alte `Server_Dokumentation.md` durch diese Struktur ersetzen.
