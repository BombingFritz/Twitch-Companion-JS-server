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
//  - ein JSON-Block zum Kommandanten steht nahe am Anfang
'use strict';
const zlib = require('zlib');

const PCD_TYPE = 'UBOAT.Game.Scene.Characters.PlayableCharacterData';
const ROLE_TYPE = 'UBOAT.Game.Scene.Characters.CharacterRole';
const TYPE_LABELS = { 0: 'Matrose', 1: 'Offizier', 2: 'Kommandant', 4: 'Agent', 5: 'NPC', 6: 'Alliierter' };
const CREW_TYPES = [0, 1, 2];
const TICKS_UNIX_EPOCH = 621355968000000000n;
const FIELD_PROBE_BYTES = 32;   // Präfix vor dem ersten Feld
const ELEMENT_PROBE_BYTES = 16; // Abstand zwischen zwei Listenelementen (beobachtet: 4 Byte Trailer)

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
  const characters = [];
  for (const [objectId, off] of r.objectsOfType(pcd)) {
    const parsed = r.parseFieldsAt(off, pcd);
    if (!parsed) continue;
    try { characters.push(r.toCharacter(objectId, parsed.rec, roles)); } catch { /* unvollständiger Datensatz */ }
  }
  const crew = characters
    .filter(c => c.enrolled && CREW_TYPES.includes(c.type))
    .sort((a, b) => b.type - a.type || b.level - a.level || a.name.localeCompare(b.name, 'de'));
  return { gameVersion: r.gameVersion(), commander: r.headerJson(), inflatedBytes: buf.length, characterCount: characters.length, crew };
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

  // n Felder ab start (+ Präfix); erstes Feld muss bei Typ Zeichenkette gültig sein
  parseFieldsAt(start, typeId) {
    const buf = this.buf, t = this.types.get(typeId);
    if (!t || !t.order.length) return null;
    for (let k = 0; k < FIELD_PROBE_BYTES; k++) {
      let q = start + k; const rec = {}; let ok = true;
      for (let i = 0; i < t.order.length; i++) {
        if (q + 4 > buf.length) { ok = false; break; }
        const size = buf.readInt32LE(q);
        if (size < 0 || q + 4 + size > buf.length) { ok = false; break; }
        const payload = buf.subarray(q + 4, q + 4 + size);
        if (i === 0 && t.order[0].td.code === 7 && !this.isStringPayload(payload)) { ok = false; break; }
        rec[t.order[i].name] = payload; q += 4 + size;
      }
      if (ok) return { rec, end: q };
    }
    return null;
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
  parseObject(p) {
    const buf = this.buf;
    if (p + 5 > buf.length || buf[p] !== 0) return null;
    const id = buf.readInt32LE(p + 1);
    if (id >= 0) return { ref: id, end: p + 5 };
    let q = p + 5;
    if (q + 5 > buf.length || buf[q] !== 0) return null;
    let typeId = buf.readInt32LE(q + 1); q += 5;
    if (typeId < 0) { typeId = -typeId; const t = this.types.get(typeId); if (!t) return null; q = t.schemaEnd; }
    const parsed = this.parseFieldsAt(q, typeId);
    if (!parsed) return null;
    return { id: -id, typeId, type: this.types.get(typeId).name, rec: parsed.rec, end: parsed.end };
  }

  // statuses: int32 Anzahl + Elemente mit Feld "name". Die Anzahl ist teils um eins höher als die
  // vorhandenen Elemente; Ende der Nutzdaten beendet die Liste.
  parseStatusList(payload) {
    if (!payload || payload.length < 4) return { names: [], complete: true };
    const base = payload.byteOffset - this.buf.byteOffset, end = base + payload.length;
    const count = this.buf.readInt32LE(base);
    const names = []; let p = base + 4, complete = true;
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
      const name = o.ref !== undefined ? this.statusNames.get(o.ref) : this.str(o.rec.name);
      if (o.ref === undefined) this.statusNames.set(o.id, name);
      if (name) names.push(name);
      p = o.end;
    }
    return { names, complete };
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
      enrolled: this.date(r.enrollmentTicks),
      died: this.date(r.deathTicks),
      decorations: this.i32(r.decorations),
      accomplishments: this.i32(r.accomplishments),
      statuses: statuses.names,
      statusesComplete: statuses.complete,
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
}

// Locales.dat: <7bit-Länge><Pfad> <Kopf> dann 01 <7bit-Länge><Text> je Sprache (Schlüssel, Englisch, Deutsch, …)
// Liefert deutsche Namen für "Locales/Skills/<X>" (Fähigkeiten) und "Locales/UI/CrewListUI/<X>" (Charakterzüge, Text in <b>…</b>).
function parseLocales(buf) {
  const skills = new Map(), traits = new Map();
  const read7 = p => { let v = 0, s = 0, x; do { x = buf[p++]; v |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) && s < 35); return [v, p]; };
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
  return { skills, traits };
}

module.exports = { parseSave, parseLocales, TYPE_LABELS };

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
