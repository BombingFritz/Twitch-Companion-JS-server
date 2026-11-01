# Offene Punkte

## Priorität 1
- Ungemergter Branch: 40-Tage-Aktivitätsprüfung für Shoutouts (`getRecentStreamInfo()` über `/helix/videos`, `SHOUTOUT_ACTIVITY_WINDOW_DAYS=40`, Chat-Nachricht mit Datum und Spiel). Fehlt in diesem Code. Zusammenführen mit der Effekt-Queue steht aus.
- Feldnamen in `handleChatNotification` (`chatter_is_anonymous`, `sub.is_gift`, `resub.is_gift`, `source_broadcaster_user_id`) sind gegen reale Twitch-Events nicht belegt [UNGEKLÄRT]. Gegen echte Subs/Gifts prüfen.
- Aktualität: Der Server wird parallel in mehreren Diskussionen weiterentwickelt. Vor jeder Weiterentwicklung klären, welcher Stand gilt. Ab jetzt gilt das GitHub-Repository als maßgeblicher Stand.
- EventSub-Keepalive: `session_keepalive` wird nicht ausgewertet. Bricht die Verbindung still ab (ohne `close`), bemerkt der Server das nicht [UNGEKLÄRT, ob in der Praxis aufgetreten].

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
