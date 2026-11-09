# ADR 0019: Statistik in drei Bereichen mit eigenem Modul und gezähltem Arbeitsspeicher

**Status:** Akzeptiert (09.11.2026). Umsetzung in Stufen, siehe `specs/statistik.md`.
Vom Nutzer entschieden (09.11.2026): drei Bereiche (Server-Instanz, laufender oder letzter Stream, global); die Server-Instanz liegt im Arbeitsspeicher; `stream_stats.json` wird laufend geschrieben und am Ende archiviert, sodass je beendetem Stream eine Datei entsteht; höchstens alle 30 s schreiben; alles bleibt in der Cloud, Dateigrößen und Schreibhäufigkeit werden geprüft; ein Endscreen muss vor dem Streamende aus den laufenden Werten lesen können und hat eine eigene, in OBS einbindbare Adresse; Alarm und Marker melden sich per zusätzlicher Stream-Deck-Aktion direkt beim Server; Broadcaster und genutzte Chat-Bots (Nightbot, StreamElements, DerBdu) zählen nicht in Chatnachrichten und Ranglisten, die Bots sind im Reiter „Whitelist“ bearbeitbar; Abstimmungen und Stimmen laufen über Twitch-Polls (auch das eigene Poll-Widget nutzt sie) und die noch zu bauende Spielbewertung; Kanalpunkte und monetärer Support jeweils alles zusammen, Bits eingeschlossen; erste und wiederkehrende Chatter sowie API-Anfragen sind zurückgestellt.
Von Claude vorgeschlagen, vom Nutzer gebilligt: eigenes Modul `lib/stats.js`, zentrale Liste der Kennzahlen, Summe des Global-Bereichs erst beim Anzeigen, ein einziger Stream-Ablauf für Statistik, Streamlog und Stream-Bericht, Reihenfolge der Stufen.
Von Claude festgelegt, nicht einzeln zur Wahl gestellt: Abschalten über die Konstante `STATS_ENABLED`, Gifts als eigene Kennzahl auch in der Server-Instanz, eine Zählung je ausgelöstem Effekt.

**Kontext:** Der Reiter „Statistik“ (ADR 0018) und ein späterer Endscreen brauchen Zahlen zur Laufzeit des Servers, zum Stream und über alle Streams. Die Zähler sitzen an vielen Stellen von `server.js`. Der Projektordner liegt in der Cloud, jede geschriebene Datei wird vermutlich neu synchronisiert. Chatnachrichten können häufig sein.

**Entscheidung:**
- **Modul:** `lib/stats.js` kennt weder Twitch noch Express. An den Ereignisstellen steht nur `stats.count('schluessel')`. Fehler werden im Modul abgefangen, die Statistik kann keine andere Funktion stören.
- **Kennzahlen:** Eine zentrale Liste (Schlüssel, Bezeichnung, Bereiche). Ergänzen heißt ein Listeneintrag und eine Zeile, Beschneiden heißt beides löschen. Fehlende Werte gelten als 0, alte Berichte bleiben gültig. Ein unbekannter Schlüssel wird einmal gewarnt und nicht gezählt.
- **Zählen und Speichern sind getrennt:** Jede Zählung ist nur eine Erhöhung im Arbeitsspeicher. Lesen geschieht immer aus dem Arbeitsspeicher des Servers.
- **Bereiche:** Server-Instanz nur im Arbeitsspeicher. Stream in `stream_stats.json`, höchstens alle 30 s und nur bei Änderung geschrieben, sofort bei Streambeginn und Streamende, atomar über eine Hilfsdatei. Beim Abschluss entsteht eine Datei je Stream; `stream_stats.json` bleibt bis zum nächsten Streambeginn stehen. Global wird beim Anzeigen aus diesen Dateien summiert, es gibt keinen zweiten Zähler, und ein falscher Bericht lässt sich löschen.
- **Stream-Ablauf:** Einmal gebaut für Statistik, Streamlog und Stream-Bericht: kein Stream, live, beendet mit 2-Stunden-Frist, abgeschlossen (OFFEN.md, Vorgaben vom 08.11.2026).
- **Endscreen:** Eine eigene Adresse auf dem Server liefert nur öffentliche Zahlen aus dem Arbeitsspeicher des Servers. Das Widget ist unabhängig von der Webkonsole und ihren Daten im Browser und lässt sich in OBS einbinden. Die Häufigkeit der Abfrage bestimmt das Widget, sie kostet keine Schreibvorgänge. Aktualisieren im Sekundentakt, solange der Endscreen sichtbar ist, ist für später vorgemerkt.
- **Alarm und Marker:** Eine zusätzliche Aktion in der Stream-Deck-Multi-Aktion ruft den Server auf dem Streaming-PC an. Das bleibt lokal, braucht keinen neuen Scope und funktioniert ohne Home Assistant. Die Position im VOD wird aus der Uhrzeit berechnet.
- **Neue Scopes** (`channel:read:hype_train`, `bits:read`, `channel:read:redemptions`) sind reine Leserechte und werden gemeinsam mit einem neuen Login eingeführt, wenn die jeweilige Kennzahl dran ist.

**Verworfene Alternativen:**
- **Bei jeder Zählung schreiben:** zu viele Schreibvorgänge und Cloud-Synchronisationen.
- **Datenbank:** widerspricht ADR 0001, für Zähler nicht nötig.
- **Globale Summe mitführen:** kann von den Berichten abweichen und lässt sich nicht einfach korrigieren.
- **Zähler direkt in `server.js`:** schwer zu finden, zu testen und wieder zu entfernen.
- **Endscreen liest aus der Webkonsole:** Das Widget läuft getrennt in OBS und hätte darauf keinen Zugriff.
- **IRC zusätzlich für erste und wiederkehrende Chatter:** zweite Verbindung nur für diese Werte, zurückgestellt.

**Konsequenzen:**
- Ein Absturz verliert höchstens die letzten 30 s des Streams.
- Der Stream-Ablauf ist der heikle Teil, von ihm hängen die Bereiche 2 und 3 ab.
- Berichte wachsen um eine kleine Datei je Stream; Ranglisten werden begrenzt, damit die Dateien klein bleiben.
