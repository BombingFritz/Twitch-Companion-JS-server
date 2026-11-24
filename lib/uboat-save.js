// UBOAT-Spielstand lesen (ADR 0016, Spec docs/specs/uboat-personalakte.md).
// Reine Formatlogik: Buffer rein, Daten raus. Kein Dateisystem, kein Twitch.
//
// Format (ermittelt an Spielversion 2026.1 Patch 21, nicht offiziell dokumentiert):
//  - .save = rohes DEFLATE ohne zlib-/gzip-Header
//  - entpackt: eigenes Binärformat, Objektgraph
//      Typdefinition: 00 <int32 -id> <7bit-Länge><Typname inkl. Assembly> <int32 n> n × (<7bit-Länge><Feldname> <Typbeschreibung>)
//      Typbeschreibung: int32 code, int32 nArgs, nArgs × Typbeschreibung (rekursiv)
//      Objekt:          00 <int32 -id> 00 <int32 typ-id> <kurzer Präfix, 1–17 Bytes, Bedeutung offen> Felder
//      Referenz:        00 <int32 +id>   (0 = null)
//      Feld:            int32 Länge + Inhalt; Felder stehen in UMGEKEHRTER Reihenfolge der Typdefinition
//      Zeichenkette:    7bit-Länge + UTF-8; null = Inhalt int32 -1
//      Liste:           int32 Anzahl, dann Elemente (Objekt oder Referenz), hinter eingebetteten Objekten 4 Nullbytes
//      LocalizedString: keyword (Schlüssel in Locales.dat), arguments (je 1 Byte Typ: 07 Zeichenkette, 00 Objekt), flags
//      DateTime-Feld:   21 Byte, Ticks ab Byte 9
//  - ein JSON-Block zum Kommandanten steht nahe am Anfang, dahinter die aktiven Mods (modList)
//  - Karriere (PlayerCareer) einmal je Spielstand: Boote, Gedenktafeln, versenkte Schiffe, Ereignisse, Zahlen (Stream-Kartei Stufe 1b)
'use strict';
const zlib = require('zlib');

const PCD_TYPE = 'UBOAT.Game.Scene.Characters.PlayableCharacterData';
const ROLE_TYPE = 'UBOAT.Game.Scene.Characters.CharacterRole';
const TYPE_LABELS = { 0: 'Matrose', 1: 'Offizier', 2: 'Kommandant', 4: 'Agent', 5: 'NPC', 6: 'Alliierter' };
const CREW_TYPES = [0, 1, 2];
const TICKS_UNIX_EPOCH = 621355968000000000n;
const TICKS_YEAR_1850 = 583487712000000000n;
const TICKS_YEAR_2100 = 662380416000000000n;
const LOCALIZED_STRING_TYPE = 'UBOAT.Game.Core.LocalizedString';
const CAREER_TYPE = 'UBOAT.Game.Sandbox.PlayerCareer';
const CAREER_PROBE_BYTES = 256;
const DATETIME_STRUCT_BYTES = 21;
// Bereiche der Spieltexte: Lebenslauf, Leistungen, Orden und Ladung (Items/, Items/Cargo/), Häfen (Entities/)
const TEXT_PREFIXES = ['UI/RecruitmentUI/Backgrounds/', 'UI/Accomplishments/', 'Items/', 'Entities/'];
const FIELD_PROBE_BYTES = 32;   // Präfix vor dem ersten Feld
const ELEMENT_PROBE_BYTES = 16; // Abstand zwischen zwei Listenelementen (beobachtet: 4 Byte Trailer)
const ELEMENT_TRAILER_BYTES = 4;
// Mod-Liste im Kopf (modList): Kopf-JSON endet nahe am Anfang (beobachtet bei etwa 2 KB), die Liste folgt dicht dahinter
const MOD_HEADER_SEARCH_BYTES = 65536;
const MOD_LIST_SEARCH_BYTES = 4096;
const MOD_LIST_MAX = 500;
const MOD_NAME_MAX_BYTES = 300;

function parseSave(raw) {
  const buf = zlib.inflateRawSync(raw);
  const r = new Reader(buf);
  r.readTypes();
  const pcd = r.typeIdByName(PCD_TYPE);
  if (!pcd) throw new Error('Personaldaten-Typ nicht gefunden – Spielstand-Format unbekannt');
  const roleType = r.typeIdByName(ROLE_TYPE);
  const roles = new Map();
  if (roleType) {
    for (const [id, off] of r.objectsOfType(roleType)) {
      const parsed = r.parseFieldsAt(off, roleType);
      if (parsed && parsed.rec.name) roles.set(id, r.str(parsed.rec.name));
    }
  }
  const characters = [], recs = new Map();
  for (const [objectId, off] of r.objectsOfType(pcd)) {
    const parsed = r.parseFieldsAt(off, pcd);
    if (!parsed) continue;
    try { characters.push(r.toCharacter(objectId, parsed.rec, roles)); recs.set(objectId, parsed.rec); } catch { /* unvollständiger Datensatz */ }
  }
  const crew = characters
    .filter(c => c.enrolled && CREW_TYPES.includes(c.type))
    .sort((a, b) => b.type - a.type || b.level - a.level || a.name.localeCompare(b.name, 'de'));
  // Lebenslauf, Orden, Leistungen nur für die Crew (Stream-Kartei, ADR 0026); Fehler lassen die Grunddaten stehen
  for (const c of crew) { try { Object.assign(c, r.characterDetails(recs.get(c.objectId))); } catch { /* Grunddaten bleiben */ } }
  let career = null;
  try { career = r.career(); } catch { /* ohne Karrieredaten */ }
  return { gameVersion: r.gameVersion(), commander: r.headerJson(), mods: r.modList(), inflatedBytes: buf.length, characterCount: characters.length, crew, career };
}

class Reader {
  constructor(buf) { this.buf = buf; this.types = new Map(); this.statusNames = new Map(); }

  read7(p) { const b = this.buf; let v = 0, s = 0, x; do { x = b[p++]; v |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) && s < 35); return [v, p]; }
  readTypeDesc(p, depth = 0) {
    if (depth > 16) throw new Error('Typbeschreibung zu tief');
    const code = this.buf.readInt32LE(p), n = this.buf.readInt32LE(p + 4); p += 8;
    if (n < 0 || n > 16) throw new Error('Typbeschreibung ungültig');
    const args = []; for (let i = 0; i < n; i++) { const [d, q] = this.readTypeDesc(p, depth + 1); args.push(d); p = q; }
    return [{ code, args }, p];
  }

  // Alle Typdefinitionen: Ende des Typnamens ist "PublicKeyToken=null"
  readTypes() {
    const buf = this.buf, marker = Buffer.from('PublicKeyToken=null');
    let p = 0;
    while ((p = buf.indexOf(marker, p)) !== -1) {
      const end = p + marker.length;
      search: for (let start = p - 1; start > p - 400 && start > 6; start--) {
        for (const lb of [1, 2]) {
          const lp = start - lb;
          const [len, q] = this.read7(lp);
          if (q !== start || len !== end - start) continue;
          if (buf[lp - 5] !== 0) continue;
          const id = buf.readInt32LE(lp - 4);
          if (id >= 0) continue;
          const name = buf.toString('latin1', start, end).split(',')[0];
          let s = end; const fields = [];
          try {
            const n = buf.readInt32LE(s); s += 4;
            if (n < 0 || n > 500) throw new Error();
            for (let i = 0; i < n; i++) {
              const [fl, fq] = this.read7(s);
              const fname = buf.toString('utf8', fq, fq + fl);
              const [td, r] = this.readTypeDesc(fq + fl);
              fields.push({ name: fname, td }); s = r;
            }
          } catch { fields.length = 0; }
          this.types.set(-id, { name, fields, order: fields.slice().reverse(), schemaEnd: s });
          break search;
        }
      }
      p++;
    }
  }
  typeIdByName(name) { for (const [id, t] of this.types) if (t.name === name) return id; return null; }

  // Objekt-ID -> Position direkt nach dem Objektkopf
  objectsOfType(typeId) {
    const buf = this.buf, out = new Map();
    const needle = Buffer.alloc(5); needle.writeInt32LE(typeId, 1);
    let p = 0;
    while ((p = buf.indexOf(needle, p)) !== -1) {
      if (p >= 5 && buf[p - 5] === 0) { const id = buf.readInt32LE(p - 4); if (id < 0) out.set(-id, p + 5); }
      p++;
    }
    // erste Instanz trägt die Typdefinition inline
    const def = Buffer.alloc(5); def.writeInt32LE(-typeId, 1);
    const d = buf.indexOf(def);
    if (d > 5 && buf[d - 5] === 0 && buf.readInt32LE(d - 4) < 0) out.set(-buf.readInt32LE(d - 4), this.types.get(typeId).schemaEnd);
    return out;
  }

  // n Felder ab start (+ Präfix); erstes Feld muss bei Typ Zeichenkette gültig sein.
  // strict: jedes Feld muss zu seinem Typcode passen (für kleine Objekte in Listen, deren erstes Feld keine Zeichenkette ist)
  parseFieldsAt(start, typeId, { strict = false, limit = this.buf.length, probe = FIELD_PROBE_BYTES } = {}) {
    const buf = this.buf, t = this.types.get(typeId);
    if (!t || !t.order.length) return null;
    for (let k = 0; k < probe; k++) {
      let q = start + k; const rec = {}; let ok = true;
      for (let i = 0; i < t.order.length; i++) {
        if (q + 4 > limit) { ok = false; break; }
        const size = buf.readInt32LE(q);
        if (size < 0 || q + 4 + size > limit) { ok = false; break; }
        const payload = buf.subarray(q + 4, q + 4 + size);
        if (i === 0 && t.order[0].td.code === 7 && !this.isStringPayload(payload)) { ok = false; break; }
        if (strict && !this.fitsCode(payload, t.order[i].td.code)) { ok = false; break; }
        rec[t.order[i].name] = payload; q += 4 + size;
      }
      if (ok) return { rec, end: q };
    }
    return null;
  }
  // Typcodes (beobachtet): 0 Objekt, 1 DateTime, 3 und 4 Listen, 5 Wörterbuch, 7 Zeichenkette, 8 Flags, 13 int32,
  // 15 int64, 17 float, 18 double, 19 bool, 20 Koordinate
  fitsCode(p, code) {
    if (code === 7) return this.isStringPayload(p);
    if (code === 13 || code === 17) return p.length === 4;
    if (code === 15 || code === 18) return p.length === 8;
    if (code === 19) return p.length === 1;
    if (code === 0) return p.length === 5 ? p[0] === 0 : p.length >= 10 && p[0] === 0;
    return true;
  }
  f32(p) { return p && p.length === 4 ? p.readFloatLE(0) : null; }
  f64(p) { return p && p.length === 8 ? p.readDoubleLE(0) : null; }
  i64(p) { return p && p.length === 8 ? Number(p.readBigInt64LE(0)) : null; }
  bool(p) { return p && p.length === 1 ? p[0] !== 0 : null; }
  // DateTime als Struktur (Typcode 1), beobachtet 21 Byte: int32, 00, int32 8 (Länge), int64 Ticks, int32
  dateTime(p) {
    const t = this.dateTimeTicks(p);
    return t !== null ? new Date(Number((t - TICKS_UNIX_EPOCH) / 10000n)).toISOString().slice(0, 10) : null;
  }
  dateTimeTicks(p) {
    if (!p || p.length !== DATETIME_STRUCT_BYTES || p.readInt32LE(5) !== 8) return null;
    const t = p.readBigInt64LE(9) & 0x3fffffffffffffffn;   // obere 2 Bit: DateTimeKind
    return t > TICKS_YEAR_1850 && t < TICKS_YEAR_2100 ? t : null;
  }

  // Objekt mit Objekt-ID irgendwo im Spielstand (Ziel einer Referenz); Ergebnis zwischengespeichert
  findObject(id) {
    if (!this.objectCache) this.objectCache = new Map();
    if (this.objectCache.has(id)) return this.objectCache.get(id);
    const buf = this.buf, needle = Buffer.alloc(6);
    needle.writeInt32LE(-id, 1);
    let found = null, p = 0;
    while (!found && (p = buf.indexOf(needle.subarray(0, 5), p)) !== -1) {
      if (buf[p + 5] === 0) { try { const o = this.parseObject(p, { strict: true }); if (o && o.id === id) found = o; } catch { /* weiter */ } }
      p++;
    }
    this.objectCache.set(id, found);
    return found;
  }
  // Feld vom Typ Objekt: Referenz (aufgelöst), eingebettetes Objekt oder null
  object(p) {
    if (!p || p.length < 5 || p[0] !== 0) return null;
    const id = p.readInt32LE(1);
    if (id === 0) return null;
    if (id > 0) return p.length === 5 ? this.findObject(id) : null;
    const base = p.byteOffset - this.buf.byteOffset;
    try { return this.parseObject(base, { strict: true, limit: base + p.length }); } catch { return null; }
  }
  // Feld vom Typ Liste von Objekten: int32 Anzahl, dann Elemente (eingebettet oder Referenz) mit kurzem Abstand dazwischen
  list(p) {
    if (!p || p.length < 4) return [];
    const base = p.byteOffset - this.buf.byteOffset, end = base + p.length;
    const count = this.buf.readInt32LE(base), out = [];
    let q = base + 4;
    for (let i = 0; i < count && q + 5 <= end; i++) {
      let o = null;
      for (let k = 0; k <= ELEMENT_PROBE_BYTES && !o && q + k + 5 <= end; k++) {
        try {
          const c = this.parseObject(q + k, { strict: true, limit: end });
          // Referenz nur > 0, direkt an der Position oder genau nach dem Trailer (4 Nullbytes) des vorigen Elements
          const atRef = k === 0 || (k === ELEMENT_TRAILER_BYTES && this.buf.readInt32LE(q) === 0);
          if (c && c.end <= end && (c.ref === undefined || (atRef && c.ref > 0))) o = c;
        } catch { /* nächste Position */ }
      }
      if (!o) break;
      out.push(o.ref !== undefined ? this.findObject(o.ref) : o);
      q = o.end;
    }
    return out.filter(Boolean);
  }
  // LocalizedString: Schlüssel und Argumente. Argument = 1 Byte Typ: 07 Zeichenkette, 00 Objekt (Referenz oder eingebettet,
  // beobachtet: wieder ein LocalizedString). Unbekannter Typ beendet die Argumente.
  locString(o, depth = 0) {
    if (!o || o.type !== LOCALIZED_STRING_TYPE || depth > 3) return null;
    const key = this.str(o.rec.keyword);
    const a = o.rec.arguments, args = [];
    if (a && a.length >= 4) {
      const n = a.readInt32LE(0); let j = 4;
      for (let i = 0; i < n && j < a.length; i++) {
        if (a[j] === 7) {
          let v = 0, s = 0, x, k = j + 1;
          do { x = a[k++]; v |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) && s < 35);
          args.push(a.toString('utf8', k, k + v)); j = k + v;
        } else if (a[j] === 0 && j + 5 <= a.length) {
          const base = a.byteOffset - this.buf.byteOffset + j;
          const c = this.parseObject(base, { strict: true, limit: base + a.length - j });
          if (!c) break;
          const target = c.ref !== undefined ? (c.ref > 0 ? this.findObject(c.ref) : null) : c;
          args.push(this.locString(target, depth + 1));
          j += c.end - base;
          if (c.ref === undefined && a.readInt32LE(j) === 0) j += ELEMENT_TRAILER_BYTES;
        } else break;
      }
    }
    return key ? { key, args } : null;
  }
  isStringPayload(p) {
    if (p.length === 4 && p.readInt32LE(0) === -1) return true;
    if (p.length === 0) return false;
    let v = 0, s = 0, j = 0, x;
    do { x = p[j++]; v |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) && j < 5);
    return j + v === p.length;
  }
  str(p) {
    if (!p || p.length === 0) return '';
    if (p.length === 4 && p.readInt32LE(0) === -1) return null;
    let v = 0, s = 0, j = 0, x;
    do { x = p[j++]; v |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) && j < 5);
    return p.toString('utf8', j, j + v);
  }
  i32(p) { return p && p.length >= 4 ? p.readInt32LE(0) : 0; }
  date(p) {
    if (!p || p.length < 8) return null;
    const t = p.readBigInt64LE(0);
    return t > 0n ? new Date(Number((t - TICKS_UNIX_EPOCH) / 10000n)).toISOString().slice(0, 10) : null;
  }
  ref(p) { return p && p.length === 5 && p[0] === 0 ? p.readInt32LE(1) : null; }

  // Listenelement oder Referenz ab p
  parseObject(p, opts) {
    const buf = this.buf;
    if (p + 5 > buf.length || buf[p] !== 0) return null;
    const id = buf.readInt32LE(p + 1);
    if (id >= 0) return { ref: id, end: p + 5 };
    let q = p + 5;
    if (q + 5 > buf.length || buf[q] !== 0) return null;
    let typeId = buf.readInt32LE(q + 1); q += 5;
    if (typeId < 0) { typeId = -typeId; const t = this.types.get(typeId); if (!t) return null; q = t.schemaEnd; }
    if (!this.types.has(typeId)) return null;
    const parsed = this.parseFieldsAt(q, typeId, opts);
    if (!parsed) return null;
    return { id: -id, typeId, type: this.types.get(typeId).name, rec: parsed.rec, end: parsed.end };
  }

  // statuses: int32 Anzahl + Elemente mit Feld "name". Die Anzahl ist teils um eins höher als die
  // vorhandenen Elemente; Ende der Nutzdaten beendet die Liste.
  parseStatusList(payload) {
    if (!payload || payload.length < 4) return { names: [], hidden: [], complete: true };
    const base = payload.byteOffset - this.buf.byteOffset, end = base + payload.length;
    const count = this.buf.readInt32LE(base);
    const names = [], hidden = []; let p = base + 4, complete = true;
    for (let i = 0; i < count && p + 5 <= end; i++) {
      let o = null;
      for (let k = 0; k <= ELEMENT_PROBE_BYTES && !o && p + k + 5 <= end; k++) {
        try {
          const c = this.parseObject(p + k);
          // Referenzen nur direkt an der Position und nur > 0: der Trailer (00 00 00 00) plus das
          // erste Byte des nächsten Elements sähe sonst wie eine Null-Referenz aus.
          if (c && c.end <= end && (c.ref !== undefined ? (k === 0 && c.ref > 0) : c.rec.name)) o = c;
        } catch { /* nächste Position */ }
      }
      if (!o) { complete = false; break; }
      // Feld "hidden": im Spiel (noch) nicht aufgedeckt, z. B. Charakterzüge vor dem auslösenden Ereignis
      const info = o.ref !== undefined ? this.statusNames.get(o.ref) : { name: this.str(o.rec.name), hidden: this.bool(o.rec.hidden) === true };
      if (o.ref === undefined) this.statusNames.set(o.id, info);
      if (info && info.name) { names.push(info.name); if (info.hidden) hidden.push(info.name); }
      p = o.end;
    }
    return { names, hidden, complete };
  }

  toCharacter(objectId, r, roles) {
    const type = this.i32(r.characterType);
    const roleId = this.ref(r.role);
    const statuses = this.parseStatusList(r.statuses);
    return {
      objectId,
      name: this.str(r.name),
      type,
      typeLabel: TYPE_LABELS[type] || String(type),
      characterClass: this.str(r.characterClass) || null,
      level: this.i32(r.level),
      experiencePoints: this.i32(r.experiencePoints),
      experiencePointsFromLastPatrol: this.i32(r.experiencePointsFromLastPatrol),
      status: this.i32(r.status),
      fate: this.i32(r.fate),
      role: roleId ? (roles.get(roleId) || null) : null,
      born: this.date(r.birthDateTicks),
      // genauer Geburtszeitpunkt: mit Typ und Eigenschaften Merkmal einer Person über Umbenennungen hinweg (Stufe 1c)
      birthTicks: r.birthDateTicks && r.birthDateTicks.length === 8 ? r.birthDateTicks.readBigInt64LE(0).toString() : null,
      enrolled: this.date(r.enrollmentTicks),
      died: this.date(r.deathTicks),
      decorations: this.i32(r.decorations),
      accomplishments: this.i32(r.accomplishments),
      statuses: statuses.names,
      hiddenStatuses: statuses.hidden,
      statusesComplete: statuses.complete,
    };
  }

  // Lebenslauf (LocalizedString, Argument 0 = Name bei der Anwerbung), Orden (Namen), Leistungen (LocalizedString + Ordenart)
  characterDetails(rec) {
    if (!rec) return {};
    const background = this.locString(this.object(rec.backgroundStory));
    const decorationNames = this.list(rec.decorations).map(o => this.str(o.rec.name)).filter(Boolean);
    const accomplishments = this.list(rec.accomplishments).map(o => {
      const text = this.locString(this.object(o.rec.Name));
      return text ? { ...text, awardType: this.str(o.rec.AwardType) || null, points: this.f32(o.rec.Points) } : null;
    }).filter(Boolean);
    return { background, decorationNames, accomplishments };
  }

  // Karriere (PlayerCareer, einmal je Spielstand): Boote, Versenkungen, Zahlen
  career() {
    const typeId = this.typeIdByName(CAREER_TYPE);
    if (!typeId) return null;
    let rec = null;
    // Präfix hier länger (beobachtet 33 Byte: Ereignis-Abonnenten)
    for (const [, off] of this.objectsOfType(typeId)) { const parsed = this.parseFieldsAt(off, typeId, { strict: true, probe: CAREER_PROBE_BYTES }); if (parsed) { rec = parsed.rec; break; } }
    if (!rec) return null;
    const ships = this.list(rec.playerShipInfos).map(o => ({
      name: this.str(o.rec.Name), type: this.str(o.rec.Type), commissioned: this.dateTime(o.rec.CommisionedDate),
      tonnageSunk: this.i32(o.rec.TonnageSunk), merchantShipsSunk: this.i32(o.rec.MerchantShipsSunk),
      warshipsSunk: this.i32(o.rec.WarshipsSunk), aircraftShotDown: this.i32(o.rec.AircraftShotDown),
    }));
    const plaques = this.list(rec.commemorativePlaqueInfos).map(o => ({ boat: this.str(o.rec.BoatName), port: this.str(o.rec.PortName), emblem: this.str(o.rec.EmblemName) }));
    // Blueprint (Schiffsklasse) bleibt aus: Verweis auf ein Spielobjekt außerhalb des Objektgraphen, Suche teuer und ohne Treffer
    const sinkings = this.list(rec.pacifiedEntities).map(o => ({
      name: this.str(o.rec.Name), grt: this.i32(o.rec.GRT), purpose: this.str(o.rec.EntityPurpose), group: this.str(o.rec.GroupId),
      destination: this.locString(this.object(o.rec.DestinationName)), assignmentIndex: this.i32(o.rec.AssignmentIndex),
      damagedOnly: this.bool(o.rec.WasOnlyDamaged),
    }));
    const events = this.list(rec.notableEvents).map(o => ({
      id: this.str(o.rec.Id), date: this.dateTime(o.rec.Date), assignmentIndex: this.i32(o.rec.AssignmentIndex),
      title: this.locString(this.object(o.rec.Title)), subtitle: this.locString(this.object(o.rec.Subtitle)),
      description: this.locString(this.object(o.rec.Description)),
    }));
    // Auf See: zuletzt angelegt (lastDockTicks, DateTime-Ticks) nicht nach dem Start der laufenden Feindfahrt.
    // Beobachtet: auf See gleicher Tag wie der Start, im Hafen nach der Rückkehr später.
    const patrolStartTicks = this.dateTimeTicks(rec.currentPatrolStartDate);
    const lastDock = rec.lastDockTicks && rec.lastDockTicks.length === 8 ? rec.lastDockTicks.readBigInt64LE(0) & 0x3fffffffffffffffn : null;
    const atSea = patrolStartTicks !== null ? (lastDock === null || lastDock === 0n || lastDock <= patrolStartTicks) : null;
    return {
      startDate: this.dateTime(rec.startDate), startScenarioId: this.str(rec.startScenarioId),
      patrolStart: this.dateTime(rec.currentPatrolStartDate), atSea,
      tonnageSunk: this.i32(rec.tonnageSunk), warshipTonnageSunk: this.i32(rec.warshipTonnageSunk),
      assignmentIndex: this.i32(rec.assignmentIndex), attackMissions: this.i32(rec.attackMissions),
      espionageMissions: this.i32(rec.espionageMissions), escortMissions: this.i32(rec.escortMissions), joinFlotillaMissions: this.i32(rec.joinFlotillaMissions),
      torpedoesFired: this.i32(rec.totalTorpedoesFired), torpedoHits: this.i32(rec.totalTorpedoHits),
      farthestTorpedoHit: this.f32(rec.farthestTorpedoHitDistance), torpedoHitsDistance: this.f32(rec.totalTorpedoHitsDistance),
      deckGunShots: this.i32(rec.totalDeckGunShotsFired), deckGunHits: this.i32(rec.totalDeckGunHits),
      flakShots: this.i32(rec.totalFlakShotsFired), flakHits: this.i32(rec.totalFlakHits),
      distanceTravelled: this.f64(rec.totalDistanceTravelled), fuelConsumedLitres: this.f64(rec.totalFuelConsumedInLitres),
      maximumDepth: this.f32(rec.maximumDepth), totalTimeUnderWaterTicks: this.i64(rec.totalTimeUnderWater),
      timeOnSeaTicks: this.i64(rec.totalTimeOnSeaOnPreviousDepartures),
      casualties: this.list(rec.casualties).length,
      ships, plaques, sinkings, events,
    };
  }

  gameVersion() {
    const m = this.buf.toString('latin1', 0, Math.min(this.buf.length, 65536)).match(/\d{4}\.\d+ Patch \d+/);
    return m ? m[0] : null;
  }
  headerJson() {
    const b = this.buf, i = b.indexOf('{\n');
    if (i < 0 || i > 65536) return null;
    const j = b.indexOf('\n}', i);
    try { return JSON.parse(b.toString('utf8', i, j + 2)); } catch { return null; }
  }

  // Aktive Mods beim Speichern (Kopf GameStateExtendedData, Felder ModIds und ModNames; Stream-Kartei, Nutzer 24.11.2026).
  // Beobachtet ab Patch 8: hinter dem Kopf-JSON und InitialVersion zwei Blöcke <int32 Bytes><int32 Anzahl><Anzahl × 7-Bit-Länge + UTF-8>,
  // erst die IDs, dann die Namen in gleicher Reihenfolge. Das Spiel selbst ("uboat") steht immer darin.
  // Ergebnis: [{id, name}] in der Reihenfolge des Spielstands; null, wenn die Liste fehlt (ältere Spielstände) oder nicht passt.
  modList() {
    const b = this.buf, head = b.indexOf('\n}');
    if (head < 0 || head > MOD_HEADER_SEARCH_BYTES) return null;
    const end = Math.min(b.length - 8, head + MOD_LIST_SEARCH_BYTES);
    const block = p => {
      if (p + 8 > b.length) return null;
      const bytes = b.readInt32LE(p), count = b.readInt32LE(p + 4);
      if (count < 1 || count > MOD_LIST_MAX || bytes < 4 + count || p + 4 + bytes > b.length) return null;
      const out = []; let q = p + 8;
      for (let i = 0; i < count; i++) {
        let len = 0, s = 0, x;
        do { x = b[q++]; len |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) && s < 21);
        if (len < 1 || len > MOD_NAME_MAX_BYTES || q + len > p + 4 + bytes) return null;
        const t = b.toString('utf8', q, q + len);
        if (/[\x00-\x1f�]/.test(t)) return null;
        out.push(t); q += len;
      }
      return q === p + 4 + bytes ? { list: out, next: q } : null;
    };
    for (let p = head + 2; p < end; p++) {
      const ids = block(p);
      if (!ids || !ids.list.includes('uboat')) continue;
      const names = block(ids.next);
      if (!names || names.list.length !== ids.list.length) continue;
      // IDs ohne "steam:" (Spiel, DLC, eigene Mods) tragen ihren Namen als ID
      if (!ids.list.every((id, i) => /^steam:\d+$/.test(id) || id === names.list[i])) continue;
      return ids.list.map((id, i) => ({ id, name: names.list[i] }));
    }
    return null;
  }
}

// Locales.dat: <7bit-Länge><Pfad> <Kopf> dann 01 <7bit-Länge><Text> je Sprache (Schlüssel, Englisch, Deutsch, …)
// Liefert deutsche Namen für "Locales/Skills/<X>" (Fähigkeiten) und "Locales/UI/CrewListUI/<X>" (Charakterzüge, Text in <b>…</b>).
// texts: deutsche Texte weiterer Bereiche (TEXT_PREFIXES), Schlüssel ohne "Locales/", z. B. "Items/Iron Cross 1st Class".
function parseLocales(buf) {
  const skills = new Map(), traits = new Map(), texts = new Map();
  const read7 = p => { let v = 0, s = 0, x; do { x = buf[p++]; v |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) && s < 35); return [v, p]; };
  for (const prefix of TEXT_PREFIXES) {
    const pre = Buffer.from(`Locales/${prefix}`);
    let p = 0;
    while ((p = buf.indexOf(pre, p)) !== -1) {
      const at = p; p++;
      const [len, q] = read7(at - 1);
      if (q !== at || len <= pre.length || len > 200) continue;
      const key = buf.toString('utf8', at + 'Locales/'.length, at + len).trim();
      const last = key.slice(key.lastIndexOf('/') + 1);
      const found = []; let s = at + len, guard = s + 64;
      while (found.length < 3 && s < buf.length) {
        if (buf[s] === 1) { const [l, t] = read7(s + 1); if (l < 5000 && t + l <= buf.length) { found.push(buf.toString('utf8', t, t + l)); s = t + l; continue; } }
        if (!found.length && s > guard) break;
        s++;
      }
      if (found.length < 3 || found[0].trim() !== last) continue;
      const de = cleanGameText(found[2]);
      if (de && !texts.has(key)) texts.set(key, de);
    }
  }
  for (const [prefix, target] of [['Locales/Skills/', skills], ['Locales/UI/CrewListUI/', traits]]) {
    const pre = Buffer.from(prefix);
    let p = 0;
    while ((p = buf.indexOf(pre, p)) !== -1) {
      const at = p; p++;
      const [len, q] = read7(at - 1);
      if (q !== at || len <= pre.length || len > 200) continue;
      const key = buf.toString('utf8', at + pre.length, at + len);
      if (key.includes('/')) continue;
      const texts = []; let s = at + len, guard = s + 64;
      while (texts.length < 3 && s < buf.length) {
        if (buf[s] === 1) { const [l, t] = read7(s + 1); if (l < 5000 && t + l <= buf.length) { texts.push(buf.toString('utf8', t, t + l)); s = t + l; continue; } }
        if (!texts.length && s > guard) break;
        s++;
      }
      if (texts.length < 3 || texts[0] !== key) continue;
      let de = texts[2];
      if (target === traits) { const m = de.match(/<b>(.*?)<\/b>/); if (!m) continue; de = m[1]; }
      de = de.trim();
      if (de && !target.has(key)) target.set(key, de);
    }
  }
  return { skills, traits, texts };
}

// Spieltexte enthalten Zeilenumbrüche als "_x000D_" (Excel-Kodierung von CR), teils mehrfach am Ende: entfernen,
// Zeilenumbrüche vereinheitlichen, höchstens eine Leerzeile
function cleanGameText(s) {
  return String(s || '').replace(/_x000D_/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Deutscher Text zu einem LocalizedString; {0}, {1} … durch die Argumente ersetzt. Ohne Text: null.
function localize(texts, ls, override = {}) {
  if (!ls || !texts) return null;
  const t = texts.get(ls.key);
  if (!t) return null;
  return t.replace(/\{(\d+)\}/g, (m, i) => {
    if (override[i] !== undefined) return override[i];
    const a = ls.args[Number(i)];
    if (a && typeof a === 'object') return localize(texts, a) ?? '';
    return a ?? '';
  }).replace(/\s+([.,])/g, '$1').trim();
}

module.exports = { parseSave, parseLocales, localize };

// Diagnose: node lib/uboat-save.js <Kopie eines Spielstands> [Locales.dat]
if (require.main === module) {
  const fs = require('fs');
  const [file, locFile] = process.argv.slice(2);
  if (!file) { console.error('Aufruf: node lib/uboat-save.js <spielstand.save> [UBOAT - Locales.dat]'); process.exit(2); }
  const started = Date.now();
  const res = parseSave(fs.readFileSync(file));
  const loc = locFile ? parseLocales(fs.readFileSync(locFile)) : null;
  if (loc) for (const c of res.crew) c.statusesDe = c.statuses.map(s => loc.skills.get(s) || loc.traits.get(s) || `(${s})`);
  console.log(JSON.stringify({ ...res, ms: Date.now() - started }, null, 2));
}
