# ADR 0003: Widgets sprechen nur den Server an

**Status:** Akzeptiert, präzisiert (Nov. 2026); Konsequenzen zu `/token` und CORS ersetzt durch ADR 0013

**Kontext:** Widgets (z. B. OBS-Overlays) brauchen Twitch-Daten.

**Entscheidung:** Widgets holen Daten über Endpoints des Servers (`/token`, `/api/...`). Sie kennen keine Client-Secrets. Das vereinfacht Token-Handling und Berechtigungen.

**Präzisierung (Nov. 2026):** Widgets dürfen mit dem Token aus `/token` die Twitch Helix API direkt aufrufen (z. B. das Polling-Widget). `/token` liefert dafür auch `client_id` und `broadcaster_id`, damit Widgets keine IDs selbst pflegen. Die Client-ID ist kein Secret; das Client-Secret verlässt den Server nie.

**Verworfene Alternativen:** Direkter Zugriff der Widgets auf die Twitch-API mit eigenen Credentials (laut Doku zu vermeiden). Weitere: [UNGEKLÄRT]

**Konsequenzen:** ~~`/token` gibt einen gültigen Access-Token an jeden Aufrufer heraus. CORS ist für alle Origins offen.~~ Ersetzt durch ADR 0013: `/token` nur lokal, Browser-Herkünfte per Liste. Neue Widget-Endpoints folgen dem Muster von `/api/twitch/prediction/current`.
