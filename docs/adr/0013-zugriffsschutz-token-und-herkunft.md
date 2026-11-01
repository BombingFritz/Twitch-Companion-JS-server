# ADR 0013: Zugriffsschutz für `/token` und Browser-Herkunft

**Status:** Akzeptiert (Nov. 2026). Ersetzt die Konsequenzen zu `/token` und CORS in ADR 0003.

**Kontext:** `/token` gab den Access-Token (u. a. `user:write:chat`, `moderator:manage:shoutouts`) an jeden Aufrufer heraus, CORS war für alle Herkünfte offen, der Server lauscht auf allen Schnittstellen. Damit konnte jede im Browser des Streaming-PCs geöffnete Webseite und jedes Gerät im LAN den Token lesen (OFFEN.md, K1). Die Widgets laufen als OBS-Browser-Sources mit lokalen Dateien; OBS lädt sie unter `http://absolute/…`, im normalen Browser per `file://` ist die Herkunft `null`.

**Entscheidung:**
- Browser-Anfragen mit `Origin`-Header nur von einer Liste erlaubter Herkünfte annehmen, alle anderen mit 403 ablehnen, bevor ein Endpoint etwas ausführt. Standardliste: `http://absolute`, `null`, `http://localhost:<PORT>`, `http://127.0.0.1:<PORT>`. Änderbar über `CORS_ORIGINS`; `*` stellt als Notschalter das alte Verhalten her.
- `/token` nur für Aufrufe vom selben Rechner (Loopback-Adresse) mit Host `localhost`, `127.0.0.1` oder `[::1]`. Der Host-Check verhindert DNS-Rebinding.
- Alle Antworten mit `Cache-Control: no-store`.
- `/token` liefert zusätzlich `client_id` (kein Secret).

**Verworfene Alternativen:**
- Server nur an `127.0.0.1` binden: hätte Home Assistant den Zugriff auf `/api/homeassistant/events` aus dem LAN genommen [UNGEKLÄRT, ob genutzt].
- Widgets vom Server ausliefern (gleiche Herkunft): robuster, aber jede OBS-Browser-Source müsste auf eine URL umgestellt werden. Bleibt Option, falls neuere OBS-Versionen Anfragen von `http://absolute` an `localhost` sperren („Local Network Access“).
- Geheimer Schlüssel je Widget: zusätzliche Konfiguration in jeder Browser-Source.

**Konsequenzen:** Anfragen ohne `Origin` (Stream Deck, Home Assistant) funktionieren unverändert. Eigene Widgets mit anderer Herkunft müssen in `CORS_ORIGINS` eingetragen werden; der Server loggt abgelehnte Herkünfte einmal je Herkunft. Herkunft `null` bleibt erlaubt, bis ein Live-Test die tatsächliche OBS-Herkunft zeigt; `null` senden auch abgeschottete iframes fremder Seiten. GET-Endpoints können über Einbindungen ohne `Origin` (z. B. `<img>`) weiterhin ausgelöst werden.
