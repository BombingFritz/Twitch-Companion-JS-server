# ADR 0003: Widgets sprechen nur den Server an

**Status:** Akzeptiert

**Kontext:** Widgets (z. B. OBS-Overlays) brauchen Twitch-Daten.

**Entscheidung:** Widgets holen Daten über Endpoints des Servers (`/token`, `/api/...`). Sie kennen keine Client-Secrets. Das vereinfacht Token-Handling und Berechtigungen.

**Verworfene Alternativen:** Direkter Zugriff der Widgets auf die Twitch-API mit eigenen Credentials (laut Doku zu vermeiden). Weitere: [UNGEKLÄRT]

**Konsequenzen:** `/token` gibt einen gültigen Access-Token an jeden Aufrufer heraus. CORS ist für alle Origins offen. Neue Widget-Endpoints folgen dem Muster von `/api/twitch/prediction/current`.
