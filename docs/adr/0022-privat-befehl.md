# ADR 0022: `!privat` – Zuschauer schalten ihre Namensnennung in der Statistik selbst um

**Status:** Akzeptiert (13.11.2026). Grundlage: `docs/DATENKATALOG.md` (Abschnitt 5), Issue #44.
Vom Nutzer entschieden (13.11.2026): Wer `!privat` schreibt, wird als „anonymer Schlaumeier“ anonymisiert mitgezählt; auch frühere Einträge werden anonymisiert; derselbe Befehl schaltet wieder aus, die Antwort sagt jeweils, ob der Modus an- oder ausgeschaltet wurde; Widgets bekommen gleich einen Endpunkt mit der Liste. Raid-Begrüßungen nennen Raider und Rang weiterhin, Raider sind öffentliche Streamer. Was sonst mit Namen geschieht, wird erst in der Felddiskussion entschieden.
Von Claude festgelegt, nicht einzeln zur Wahl gestellt: Liste als eigene Datei `privacy_optouts.json` mit User-ID und Zeitpunkt; anonyme Einträge unter eigenen Schlüsseln `anon-1`, `anon-2` … statt eines Sammeleintrags; Abklingzeit 10 s je Zuschauer; Antwort als Antwort auf die Nachricht, gesendet als Broadcaster; Endpunkt nur lokal wie `/token`; Wortlaut der Antworten.

**Kontext:** Die Statistik speichert je Stream Chatter mit ID, Name und Anzahl der Nachrichten (ADR 0019), auch in den Berichten unter `stream_reports/`. Zuschauer sollen selbst bestimmen können, ob sie dort mit Namen erscheinen, ohne dass die Summen falsch werden. Das Wetten-Widget will dieselben Zuschauer in Laufband und Ergebnis weglassen (Issue #44).

**Entscheidung:**
- **Befehl:** `!privat` (Groß-/Kleinschreibung egal) schaltet um. Jeder Zuschauer, kein Mod-Recht nötig. Nachrichten aus fremden Kanälen im geteilten Chat werden ignoriert. Innerhalb von 10 s (`PRIVACY_COMMAND_COOLDOWN_MS`) zählt ein zweites `!privat` nicht, damit ein Doppelklick nicht gleich zurückschaltet.
- **Einschalten:** ID mit Zeitpunkt in `privacy_optouts.json`. Der Eintrag im laufenden Stream (`stream_stats.json`) und in allen Berichten (`.json` und `.txt`) wird sofort auf einen anonymen Schlüssel verschoben: Name „anonymer Schlaumeier“, keine ID, Anzahl bleibt. Neue Nachrichten zählen beim selben anonymen Eintrag weiter (die Zuordnung liegt nur im Arbeitsspeicher; nach einem Neustart bekommt dieselbe Person im laufenden Stream einen neuen anonymen Eintrag).
- **Ausschalten:** ID wird entfernt, neue Nachrichten zählen wieder mit Namen. Frühere Einträge bleiben anonym, eine Rückführung ist nicht möglich.
- **Summen** (Chatnachrichten, verschiedene Chatter) bleiben unverändert richtig, weil jede Person einen eigenen anonymen Eintrag hat.
- **Widgets:** `GET /api/privacy/optouts` → `{userIds: [...]}`, nur lokal (Loopback und Host `localhost`/`127.0.0.1`), Herkunft `null` erlaubt wie bei den übrigen Widget-Endpunkten. Widgets lassen die Zuschauer selbst weg.
- Modul `lib/privacy.js` mit `anonymizeChatter`; `lib/stream-session.js` (`anonymize`, Option `isPrivate`) und `lib/stream-reports.js` (`anonymize`) nutzen es.

**Verworfene Alternativen:**
- **Einträge löschen:** Summen und „verschiedene Chatter“ würden falsch.
- **Ein gemeinsamer Eintrag für alle Privaten:** „verschiedene Chatter“ wäre zu niedrig, und mehrere Personen ergäben zusammen eine Platzierung, die niemandem gehört.
- **Gehashte IDs statt anonymer Schlüssel:** wären nur pseudonym und ließen sich der Person wieder zuordnen.
- **Getrennte Befehle für an und aus:** vom Nutzer nicht gewünscht.

**Konsequenzen:**
- Die Liste selbst ist personenbezogen (User-IDs). Sie liegt lokal und wird nur an lokale Widgets ausgegeben.
- Bereits gesendete Chatnachrichten, Twitch-eigene Anzeigen und andere Dateien (z. B. `events.json`, Home-Assistant-Meldungen, `raids.json`) sind nicht betroffen; ob dort etwas geschieht, klärt die Felddiskussion.
- Künftige Ranglisten und Anzeigen mit Zuschauernamen (z. B. „Glückspilz des Abends“, Endscreen) müssen die Liste beachten.
