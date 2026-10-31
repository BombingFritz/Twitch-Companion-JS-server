# ADR 0011: Raid-Begrüßung über Warteschlange

**Status:** Akzeptiert

**Kontext:** Mehrere Raids kurz hintereinander würden den Chat fluten.

**Entscheidung:** Raids kommen in `raidQueue`. Zwischen zwei Begrüßungen liegen mindestens 90 s.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Spätere Raids werden verzögert begrüßt. Die Queue liegt im RAM und geht beim Neustart verloren.
