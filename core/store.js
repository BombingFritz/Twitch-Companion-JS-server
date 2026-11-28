// Kern: Speichern von Laufzeitdateien (ADR 0027, ADR 0001). Kennt keine Funktion des Servers.
// Alle Laufzeitdateien laufen hierüber (AGENTS.md); der Architekturtest lässt direkte Schreibzugriffe nur in dieser Datei zu.
'use strict';
const fs = require('fs');

// Erst in eine Hilfsdatei, dann umbenennen: Ein Absturz mitten im Schreiben zerstört so nicht die ganze Datei.
function writeTextAtomic(file, text) {
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, text, 'utf8');
  try {
    fs.renameSync(tempFile, file);
  } catch {   // z. B. hält OneDrive die Datei gerade fest
    fs.writeFileSync(file, text, 'utf8');
    fs.rmSync(tempFile, { force: true });
  }
}

function writeJsonAtomic(file, data) {
  writeTextAtomic(file, JSON.stringify(data, null, 2));
}

module.exports = { writeJsonAtomic, writeTextAtomic };
