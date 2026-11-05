# ADR 0007: EventSub über WebSocket

**Status:** Akzeptiert (aus dem Code abgeleitet); Konsequenzen präzisiert (Nov. 2026, Reconnect-Fix)

**Kontext:** Der Server läuft lokal (`http://localhost`).

**Entscheidung:** Ereignisse kommen über eine persistente EventSub-WebSocket-Verbindung (`wss://eventsub.wss.twitch.tv/ws`). Nach Verbindungsende wird nach 5 s neu verbunden.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Bei einer frischen Verbindung (Start, `/callback`, Neuaufbau nach Verbindungsende) müssen alle Subscriptions neu angelegt werden. Bei einem von Twitch angeforderten `session_reconnect` überträgt Twitch die Subscriptions selbst auf die neue Session; sie werden nicht neu angelegt (siehe ARCHITEKTUR.md, „Verbindungsverwaltung“). Während einer Trennung gehen Ereignisse verloren [UNGEKLÄRT, Twitch-Verhalten nicht im Material]. Ein stiller Verbindungsabbruch ohne `close` wird über das Keepalive-Intervall aus `session_welcome` erkannt (Nov. 2026): Bleibt jede Nachricht länger als Intervall plus 5 s aus, wird die Verbindung getrennt und neu aufgebaut.
