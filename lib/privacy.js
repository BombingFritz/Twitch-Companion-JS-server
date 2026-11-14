'use strict';
// Anonymisieren von Chatter-Einträgen für !privat (docs/DATENKATALOG.md, Abschnitt 5).
// Ein Eintrag wird nicht gelöscht, sondern unter einem neuen Schlüssel ohne ID und Namen weitergeführt:
// So bleiben Summen und „verschiedene Chatter“ richtig, der Name verschwindet.

const ANON_KEY_PREFIX = 'anon-';

const isAnonKey = key => String(key).startsWith(ANON_KEY_PREFIX);

function freeAnonKey(chatters) {
  for (let n = 1; ; n++) {
    const key = `${ANON_KEY_PREFIX}${n}`;
    if (!Object.hasOwn(chatters, key)) return key;
  }
}

// Verschiebt den Eintrag der ID auf einen anonymen Schlüssel; alle Zahlen bleiben, nur der Name wird ersetzt.
// Gilt für Chatter ({name, count}) und Tipper beim Glückspilz ({name, net, bets, …}).
// Rückgabe: neuer Schlüssel oder null, wenn es keinen Eintrag gab.
function anonymizeChatter(chatters, id, anonName) {
  const key = String(id);
  if (!chatters || isAnonKey(key) || !Object.hasOwn(chatters, key)) return null;
  const anonKey = freeAnonKey(chatters);
  chatters[anonKey] = { ...chatters[key], name: anonName };
  delete chatters[key];
  return anonKey;
}

module.exports = { anonymizeChatter, freeAnonKey, isAnonKey };
