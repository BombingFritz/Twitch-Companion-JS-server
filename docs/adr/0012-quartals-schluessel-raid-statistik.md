# ADR 0012: Quartalsbasierte Raid-Statistik

**Status:** Akzeptiert

**Kontext:** Das Raid-Leaderboard gilt für einen Zeitraum.

**Entscheidung:** Der Zeitraum-Schlüssel ist das Quartal (z. B. `2026-Q4`), berechnet in `getPeriodKey()`. Im Code steht als Kommentar eine Umstellung auf Jahresbasis ab 2027.

**Verworfene Alternativen:** Jahresbasis (als Kommentar vorbereitet, noch nicht umgesetzt).

**Konsequenzen:** Statistik beginnt je Quartal neu. Die Rang-Texte nennen „Quartal“.
