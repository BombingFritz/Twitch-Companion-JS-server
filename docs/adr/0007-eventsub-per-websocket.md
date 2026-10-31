# ADR 0007: EventSub über WebSocket

**Status:** Akzeptiert (aus dem Code abgeleitet)

**Kontext:** Der Server läuft lokal (`http://localhost`).

**Entscheidung:** Ereignisse kommen über eine persistente EventSub-WebSocket-Verbindung (`wss://eventsub.wss.twitch.tv/ws`). Nach Verbindungsende wird nach 5 s neu verbunden.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Subscriptions müssen bei jeder neuen Session neu angelegt werden. Während einer Trennung gehen Ereignisse verloren [UNGEKLÄRT, Twitch-Verhalten nicht im Material].
