# ADR 0023: Nur der Server fragt Twitch, Widgets bekommen den letzten Stand

**Status:** Akzeptiert (13.11.2026).
Vom Nutzer entschieden (13.11.2026): Der Server fragt die Zuschauerzahl regelmäßig bei Twitch ab und schreibt sie in die Statistik; will ein Widget sie wissen, gibt der Server den letzten Wert aus und fragt Twitch nicht erneut. So soll es mit allen Werten funktionieren, die der Server erhebt und an Widgets oder Plugins liefert. Abfrage zweimal pro Minute; für den Stream-Bericht ein Verlauf, zu welcher Minute wie viele Zuschauer zuschauten, ohne Zeilen in Konsole oder Textlog. Der Wett-Endpunkt wird später umgebaut, das Wett-Widget läuft bis dahin unverändert.
Von Claude festgelegt, nicht einzeln zur Wahl gestellt: Abfrage nur, solange der Stream erfasst wird und live ist (ohne Statistik immer); erste Abfrage sofort bei `stream.online`; je Minute der höchste Wert; Obergrenze 48 Stunden (2880 Minuten) je Stream; Antwortform `{live, viewers, updatedAt}`; Zugriff wie die übrigen Widget-Endpunkte (Herkunftsliste, ADR 0013); Kurzfassung je Viertelstunde im Textbericht; Anzeige in Übersicht und Reiter „Statistik“.

**Kontext:** Bisher fragen manche Widget-Endpunkte bei jedem Abruf selbst Twitch (`/api/twitch/prediction/current`), und Widgets fragen Twitch teils mit ihrem Token direkt (das Wetten-Widget holt sich die Zuschauerzahl selbst, Issue #44). Mehrere Widgets und Plugins vervielfachen so die Anfragen, und jede Stelle sieht einen etwas anderen Stand.

**Entscheidung:**
- **Grundsatz:** Nur der Server fragt Twitch, per EventSub oder im festen Takt. Widget- und Plugin-Endpunkte geben den letzten bekannten Stand des Servers mit Zeitstempel aus und lösen selbst keine Twitch-Anfrage aus. Die Zahl der Anfragen bei Twitch hängt damit nicht von der Zahl der Widgets ab. In AGENTS.md als Architekturkonvention festgehalten.
- **Zuschauerzahl als erstes Beispiel:** `pollStreamViewers` fragt `GET /helix/streams` alle 30 s (`STREAM_VIEWERS_POLL_MS`), solange der Stream live erfasst wird, und sofort beim Streamstart. Der letzte Stand liegt im Arbeitsspeicher (`streamViewers`). `GET /api/twitch/stream` → `{live, viewers, updatedAt}`.
- **Verlauf:** `lib/stream-session.js` (`noteViewers`) speichert je Minute seit Start den höchsten Wert in `viewers: [[Minute, Zahl], …]` in `stream_stats.json` und damit im Bericht. Daraus: Höchstwert, Durchschnitt über die erfassten Minuten, Anzahl Minuten. Keine Zeile je Abfrage in Konsole oder Live-Log; nur Beginn und Fehler einmal über `logIfChanged`.

**Verworfene Alternativen:**
- **Jede Abfrage protokollieren:** 120 Zeilen je Stunde in Konsole und Live-Log, schlecht auswertbar.
- **Jeden 30-s-Wert speichern:** doppelte Dateigröße ohne erkennbaren Nutzen; der Minutenwert reicht für Verlauf und Endscreen.
- **Widgets fragen Twitch selbst:** vervielfacht die Anfragen und widerspricht dem Grundsatz.

**Konsequenzen:**
- `stream_stats.json` ändert sich während des Streams mindestens alle 30 s und wird damit höchstens alle 30 s geschrieben (`STREAM_SAVE_INTERVAL_MS`, ADR 0019); der Verlauf eines 4-Stunden-Streams sind etwa 240 Zahlenpaare.
- Twitchs Zahl selbst kann einige Minuten alt sein; `updatedAt` ist der Zeitpunkt der Abfrage beim Server.
- `/api/twitch/prediction/current` widerspricht dem Grundsatz noch und wird in einem eigenen Schritt umgebaut (Stand der Wette über EventSub mitführen) [UNGEKLÄRT: nötige Scopes prüfen]. Das Wetten-Widget kann die Zuschauerzahl künftig hier abholen und Twitch nur noch als Ersatz fragen.
