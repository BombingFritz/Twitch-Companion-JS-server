# ADR 0008: Sub- und Gift-Effekte aus channel.chat.notification

**Status:** Akzeptiert

**Kontext:** Laut Code-Kommentar treffen `channel.subscribe`, `channel.subscription.message` und `channel.subscription.gift` oft Sekunden vor der Chat-Ankündigung ein. Effekte feuerten dadurch zu früh und teils doppelt. Die genaue Twitch-seitige Ursache steht nicht im Material [UNGEKLÄRT].

**Entscheidung:** Effekte für `sub` und `gift` löst nur `channel.chat.notification` aus, also die Chat-Ankündigung. Ein Gift-Bomb erzeugt über `community_sub_gift` genau einen Effekt, einzelne `sub_gift`-Meldungen mit `community_gift_id` zählen nicht. Die frühen Events aktualisieren nur den Sub-Goal-Cache.

**Verworfene Alternativen:** Abgleich der frühen Events mit der Chat-Ankündigung in einem 2-Sekunden-Fenster [UNGEKLÄRT, nur im Chat-Verlauf, nicht in den Anhängen].

**Konsequenzen:** Schlägt `subscribeToChatNotifications` fehl, gibt es keine Sub-/Gift-Effekte (Fehler wird geloggt). Die Feldnamen der Payload sind nicht gegen reale Events belegt (siehe OFFEN.md).
