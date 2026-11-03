# ADR 0002: Einzelprozess mit Zustand im Arbeitsspeicher

**Status:** Akzeptiert (aus dem Code abgeleitet)

**Kontext:** Queues und Sperren (`raidQueue`, `effectQueue`, `shoutedOutThisSession`, `pendingBursts`, Entdoppelungs-Maps) liegen im RAM. Der Server hält eine aktive EventSub-WebSocket-Verbindung (`eventSubWs`). Nur während eines `session_reconnect` sind kurz zwei Verbindungen offen, bis die neue ihr `session_welcome` erhält (ADR 0007).

**Entscheidung:** Ein Node.js-Prozess hält alle Verbindungen und allen flüchtigen Zustand.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Flüchtiger Zustand geht beim Neustart verloren (z. B. wartende Raid-Begrüßungen, Effekt-Queue). Zwei gleichzeitig laufende Instanzen sind nicht vorgesehen [UNGEKLÄRT, ob je geprüft].
