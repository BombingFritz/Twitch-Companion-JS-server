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
- Widgets vom Server ausliefern (gleiche Herkunft): robuster, aber größere Strukturänderung. Abwägung und Auslöser siehe OFFEN.md (K1). Vorerst bewusst nicht umgesetzt.
- Geheimer Schlüssel je Widget: zusätzliche Konfiguration in jeder Browser-Source.

**Nachtrag (01.11.2026, OBS-Test):** Die aktuelle OBS-Version sperrt Anfragen von „Lokale Datei“-Seiten (`http://absolute`) an `localhost` selbst („Local Network Access“), sie erreichen den Server gar nicht. Widgets werden deshalb per URL `file:///…` eingebunden (Herkunft `null`). `null` muss damit dauerhaft erlaubt bleiben; `http://absolute` bleibt für ältere OBS-Versionen in der Liste.

**Nachtrag (07.11.2026, Code-Prüfung):** `/login` und `/callback` waren aus dem LAN erreichbar, der Broadcaster-Login hatte keinen `state`. Ein Gerät im Heimnetz konnte einen Twitch-Code für ein fremdes Konto an `/callback` schicken; der Server tauschte ihn mit dem eigenen Client-Secret und überschrieb `tokens.json` (Login-CSRF). Die Client-ID dafür verriet `/login`. Neu, vom Nutzer freigegeben: `/login`, `/login-bot` und `/callback` nur lokal (Loopback-Adresse und Host wie bei `/token`; `REDIRECT_URI` zeigt auf `localhost`, die Rückkehr von Twitch kommt also immer lokal an). Beide Logins tragen einen zufälligen, einmal gültigen `state` (10 min); `/callback` speichert nur mit gültigem `state` und entscheidet daran, ob Broadcaster- oder Bot-Login. Das HTTP-Protokoll zeigt `code` und `state` nicht mehr.

**Nachtrag (14.11.2026, Nutzer):** Home Assistant fragt den Server nicht ab, es bekommt nur Webhooks; kein anderes Gerät im Heimnetz braucht ihn. Der Grund für die verworfene Alternative „nur an `127.0.0.1` binden“ entfällt damit. Neu: Der Server lauscht nur noch auf den Loopback-Adressen `127.0.0.1` und zusätzlich `::1` (manche Programme lösen `localhost` als IPv6 auf; fehlt IPv6, läuft er über `127.0.0.1` weiter). Von Claude festgelegt: die zusätzliche IPv6-Bindung, die Startanzeige „nur auf diesem PC erreichbar“, kein Schalter in `.env`. Später, z. B. für ESP32-Bildschirme: Zugang aus dem LAN in den Einstellungen schaltbar und nur mit Schlüssel (Issue #57, eigenes ADR). Ebenfalls Nahziel: ein einfacher Zugangsschlüssel für Widgets gegen die Restlücke durch die Herkunft `null` (#57); die früher verworfene Alternative „Geheimer Schlüssel je Widget“ wird damit neu bewertet.

**Konsequenzen:** Anfragen ohne `Origin` (Stream Deck, Home Assistant) funktionieren unverändert. Eigene Widgets mit anderer Herkunft müssen in `CORS_ORIGINS` eingetragen werden; der Server loggt abgelehnte Herkünfte einmal je Herkunft. Herkunft `null` bleibt erlaubt, weil die Widgets per `file:///` eingebunden werden; `null` senden auch abgeschottete iframes fremder Seiten (kleine Restlücke, schließbar nur durch Auslieferung der Widgets über den Server). GET-Endpoints können über Einbindungen ohne `Origin` (z. B. `<img>`) weiterhin ausgelöst werden.
