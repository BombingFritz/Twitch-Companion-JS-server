# ADR 0006: Whitelist-Verwaltung nur per Konsole

**Status:** Akzeptiert

**Kontext:** Die Whitelist steuert automatische Shoutouts.

**Entscheidung:** Verwaltung ausschließlich über Konsolenbefehle (`readline`). Es gibt keinen HTTP-Endpoint dafür. Die Begründung steht nicht im Material [UNGEKLÄRT].

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Änderungen erfordern Zugriff auf das Terminal des Servers.

**Nachtrag (08.11.2026, Nutzer):** Die Whitelist darf künftig auch über die Webkonsole verwaltet werden (ADR 0018). Das löst „ausschließlich über Konsolenbefehle“ ab, sobald der Reiter „Whitelist“ gebaut ist; bis dahin gilt die Konsole allein. Die Konsolenbefehle bleiben. HTTP-Zugriff nur über die geschützten Pfade `/api/admin/…`.
