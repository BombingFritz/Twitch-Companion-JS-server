# ADR 0026: Stream-Kartei – Spieldaten auf einer öffentlichen Website

**Status:** Akzeptiert (21.11.2026). Issue #84, Spec `docs/specs/stream-kartei.md`. Ergänzt 0016 (UBOAT-Crew) und 0022 (`!privat`).

**Vom Nutzer entschieden (21.11.2026):**
- Der letzte Stand der Spielfiguren kommt auf eine öffentliche Website, die auch ohne Stream und Server erreichbar ist.
- Sie liegt im Repository `BombingFritz/StreamKartei` mit GitHub Pages, ohne laufende Kosten.
- Keine Twitch-Namen auf der Website.
- `!privat`-Zuschauer sind nicht verknüpfbar und werden ausgeblendet; die Zuordnung bleibt.
- Die ganze UBOAT-Crew, Gefallene in einer Ehrentafel. UBOAT zuerst, RimWorld später.

**Von Claude festgelegt, nicht einzeln zur Wahl gestellt:**
- Daten über die GitHub-API in einen eigenen Zweig `data` mit genau einem ersetzten Commit
- Mindestabstand 10 min
- Sicher im Zweifel bei `!privat`
- eigener kleiner GitHub-Client statt `twitchApi`

**Kontext:** Bisher verlässt kein Datum den Streaming-PC außer Richtung Twitch und Home Assistant. Der Server ist bewusst nur lokal erreichbar (ADR 0013). Zuschauer sollen aber jederzeit nachsehen können, wie es ihrer Figur geht. `!soldbuch` geht nur während des Streams und nur im Chat.

**Entscheidung:**
- **Der Server veröffentlicht, nimmt aber nichts an.** Er schiebt einen JSON-Stand per GitHub-API in `StreamKartei`. Von außen ist er weiterhin nicht erreichbar.
- **Die Website ist ein eigener Verbraucher** im Repository `StreamKartei`. Sie liest die Daten im Browser von `raw.githubusercontent.com`. Server und Seite verbindet nur das Datenformat der Spec.
- **Zweig `data` mit genau einem Commit,** der bei jeder Veröffentlichung ersetzt wird:
  - kein Pages-Build je Update,
  - keine wachsende Historie,
  - ausgeblendete `!privat`-Figuren bleiben nicht in alten Ständen des Zweigs.
- **Neues Secret** `STREAM_KARTEI_TOKEN`:
  - fein abgestuftes GitHub-Token nur für `StreamKartei`, Recht „Contents: Read and write“
  - nur in `.env`, nie im Log, in der Webkonsole oder bei Widgets
  - ohne Token ist das Modul aus
- **`!privat` geht vor Aktualität:** Ausblenden sofort. Sind die Namen der `!privat`-Zuschauer nicht ermittelbar, wird nicht veröffentlicht.
- **Optionales Modul,** standardmäßig aus (Produktausrichtung: die meisten Nutzer haben kein GitHub-Token).

**Verworfene Alternativen:**
- **Server aus dem Internet erreichbar machen (Tunnel, Portfreigabe):** Das widerspricht ADR 0013, und die Seite wäre bei ausgeschaltetem Server leer.
- **Daten als normale Commits auf den Pages-Zweig:** Jedes Update löst einen Build aus, GitHub begrenzt die Builds pro Stunde, die Historie wächst, und alte Stände mit inzwischen ausgeblendeten Figuren blieben erhalten.
- **Gist als Datenspeicher:** Ein Token für Gists gilt für alle Gists des Kontos, also mehr Rechte als nötig.
- **Eigener Webhost:** Er kostet laufend Geld, ohne Gewinn. Ein Umzug bleibt durch das feste Datenformat später möglich.
- **Die RimWorld-Mod veröffentlicht selbst:** Dann gäbe es ein zweites Token an einem zweiten Ort. Die Mod liefert stattdessen an den Server.

**Konsequenzen:**
- Erster Datenfluss ins offene Internet. Einmal veröffentlichte Daten können in Caches oder Kopien bleiben, auch wenn der Zweig ersetzt wird. Deshalb gilt: keine Twitch-Namen, keine Zuordnungen, `!privat` zuerst.
- Neuer Eintrag im DATENKATALOG (Kategorie „öffentlich“) mit der Umsetzung.
- Ein abgegriffenes Token erlaubt nur Änderungen an `StreamKartei`. Es läuft ab und muss erneuert werden; die Webkonsole warnt vorher, wenn GitHub das Ablaufdatum liefert.
- Weitere Spiele kommen als weitere Datei im Zweig `data` dazu, mit demselben Modul.
