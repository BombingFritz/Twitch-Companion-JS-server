# Offene Punkte

## Priorität 1
- Ungemergter Branch: 40-Tage-Aktivitätsprüfung für Shoutouts (`getRecentStreamInfo()` über `/helix/videos`, `SHOUTOUT_ACTIVITY_WINDOW_DAYS=40`, Chat-Nachricht mit Datum und Spiel). Fehlt in diesem Code. Zusammenführen mit der Effekt-Queue steht aus.
- Feldnamen in `handleChatNotification` (`chatter_is_anonymous`, `sub.is_gift`, `resub.is_gift`, `source_broadcaster_user_id`) sind gegen reale Twitch-Events nicht belegt [UNGEKLÄRT]. Gegen echte Subs/Gifts prüfen.
- Aktualität: Der Server wird parallel in mehreren Diskussionen weiterentwickelt. Vor jeder Weiterentwicklung klären, welcher Stand gilt. Ab jetzt gilt das GitHub-Repository als maßgeblicher Stand.
- EventSub-Keepalive: `session_keepalive` wird nicht ausgewertet. Bricht die Verbindung still ab (ohne `close`), bemerkt der Server das nicht [UNGEKLÄRT, ob in der Praxis aufgetreten].

## Abgleich mit dem Gesamtkontext (Okt. 2026)

Ergebnis der Prüfung von docs/KONTEXT.md gegen den Code. Entscheidungen stehen aus.

- **K1 Sicherheit von `/token` und CORS (hoch):** Der Kontext geht von „lokal, hinter der Router-Firewall“ aus. Der Server lauscht aber auf allen Netzwerkschnittstellen (`app.listen(PORT)` ohne Host), erlaubt CORS für jede Origin und gibt den Access-Token ohne Prüfung heraus. Die Firewall schützt nur vor dem Internet. Folgen: (a) Jedes Gerät im LAN kann den Token abrufen. (b) Jede Webseite, die im Browser des Streaming-PCs geöffnet ist, kann per JavaScript `http://localhost:3000/token` lesen. Der Token hat unter anderem `user:write:chat` und `moderator:manage:shoutouts`. (c) Die GET-Endpoints für Modus und Bestätigung kann jede Webseite auslösen. Mögliche Maßnahmen: nur an `127.0.0.1` binden, CORS auf die Widget-Origins beschränken (OBS-Browser-Sources mit lokalen Dateien senden `Origin: null` [UNGEKLÄRT, prüfen]). Berührt ADR 0003 und 0010.
- **K2 Widgets rufen Helix direkt auf, im Gegensatz zu ADR 0003:** Laut Kontext holen Widgets den Token über `/token` und rufen danach Twitch Helix direkt auf. ADR 0003 heißt „Widgets sprechen nur den Server an“ und nennt den direkten API-Zugriff als verworfene Alternative, allerdings „mit eigenen Credentials“. Helix verlangt außerdem den Header `Client-ID`. `/token` liefert ihn nicht, also muss er im Widget-Code stehen [UNGEKLÄRT]. Die Client-ID ist kein Secret, aber sie dupliziert Konfiguration. Zu klären: ADR 0003 präzisieren (Token ja, Secret nie) und gegebenenfalls `client_id` in `/token` mitliefern.
- **K3 Modus `off` hält eine wartende manuelle Bestätigung nicht auf (Bug):** Laut Kontext und Spec verwirft `off` neue Effekte. Wird während einer laufenden 30-s-Wartezeit im Modus `manual` auf `off` umgeschaltet, bleibt die Bestätigung offen. Ein Klick auf `/api/effects/confirm` löst den Effekt dann trotz `off` aus. Fix: Beim Wechsel auf `off` eine wartende Bestätigung mit `false` auflösen.
- **K4 „Zentrale“ Effekt-Queue gilt nur für Twitch-Events:** Stream-Deck-Lichteffekte und ESP32-Events gehen direkt an Home Assistant. Die Queue schützt deshalb nicht vor Überlappungen mit diesen Effekten, und `off` schaltet nur die Twitch-Effekte stumm. Ob die Entkopplung in Home Assistant passieren soll (z. B. Script-Modus `queued`) oder Events in den Server eingespeist werden sollen, ist [UNGEKLÄRT].
- **K5 Stream-Deck-Steuerung schon umgesetzt:** Laut Kontext sind Modus-Umschaltung und Bestätigung per Stream Deck „geplant“. Die Endpoints gibt es bereits (ADR 0010). Offen ist, ob die Stream-Deck-Tasten schon eingerichtet sind; danach den Kontext aktualisieren.
- **K6 Name:** Der Kontext nennt den Server noch „Node.js Auth Server“. Bei der nächsten Überarbeitung des Kontexts „Twitch Companion JS server“ verwenden.
- **K7 Startskript und Konsole:** Der Server liest Konsolenbefehle über `stdin`. Startet das Startskript ihn ohne sichtbares Konsolenfenster, sind Whitelist- und Effekt-Befehle nicht erreichbar [UNGEKLÄRT, wie das Skript startet].
- **K8 Test- und Live-Daten:** Alle JSON-Dateien liegen im Arbeitsverzeichnis, einen Testmodus gibt es nicht. Ein Testlauf im Projektordner würde echte Raid-Statistik und Event-Log verändern und echte Chat-Nachrichten senden. Das passt zur Entwicklungsrichtung „Stream-, Langzeit- und Testdaten trennen“, ist aber noch nicht umgesetzt.

## Priorität 2
- Viewer-Schwelle für Raid-Shoutout (3) ist hart im Code, keine Variable.
- Zustandsändernde Endpoints (`/api/effects/mode/:mode`, `/api/effects/confirm`) sind GET ohne Authentifizierung; `/token` gibt den Access-Token heraus; CORS ist offen. Bewertung: [UNGEKLÄRT].
- Funktionsdetails der Widgets (`polling-soundChat2-2.html`, `bFCoinFlipV9_final.html`) sind nicht dokumentiert. Die Anhänge `pollingWidget.html` und `Creator-Overlay.html` sind nicht ausgewertet.
- Wirkung des Home-Assistant-Scripts und der WLED-Effektauswahl: separate Doku, nicht Teil dieses Repos [UNGEKLÄRT].
- Ob Twitch `channel.chat.notification` zeitgleich mit der Chat-Anzeige und den Overlay-Alerts liefert, ist nicht belegt [UNGEKLÄRT].

## Priorität 3 (Ideen)
- Konsolenbefehl `effects confirm` zum Bestätigen im Modus `manual` (bisher nur HTTP).
- Umstellung der Raid-Statistik auf Jahresbasis ab 2027 (Kommentar im Code).
- `refreshSubGoalCache` läuft bei jedem Sub-Event einzeln, bei einem Gift-Bomb entsprechend oft.
- Alte `Server_Dokumentation.md` durch diese Struktur ersetzen.
