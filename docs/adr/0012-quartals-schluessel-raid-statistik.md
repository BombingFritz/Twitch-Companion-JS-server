# ADR 0012: Zeitraum der Raid-Statistik (Quartal bis 2026, Jahr ab 2027)

**Status:** Akzeptiert; geändert am 05.11.2026 (Nutzerentscheidung): ab 2027 Jahresbasis.

**Kontext:** Das Raid-Leaderboard gilt für einen Zeitraum. Bis Ende 2026 war das Quartal der Zeitraum; im Code stand als Kommentar eine Umstellung auf Jahresbasis ab 2027.

**Entscheidung:** Der Zeitraum-Schlüssel wird in `getPeriodKey()` berechnet: bis einschließlich 2026 das Quartal (z. B. `2026-Q4`), ab `RAID_YEARLY_FROM_YEAR` (2027) das Kalenderjahr (z. B. `2027`). Die Chat-Texte nennen über `getPeriodWord()` passend „Quartal“ oder „Jahr“. Die Raid-Statistik (`raids.json`, `!raidstats`) bleibt eigenständig; Raids können zusätzlich im geplanten Stream-Bericht erscheinen (specs/stream-bericht.md).

**Verworfene Alternativen:**
- Sofort auf Jahresbasis umstellen: Das laufende Quartal 2026-Q4 hätte mitten im Zeitraum neu begonnen.
- Quartale 2026 in das Jahr 2027 übernehmen: nicht gewünscht; 2027 beginnt neu.

**Konsequenzen:** Am 01.01.2027 beginnt die Statistik neu unter dem Schlüssel `2027`. Bestehende Quartalsdaten bleiben unverändert in `raids.json` erhalten, werden aber nicht mehr angezeigt. Zeitzone: Ortszeit des Servers.
