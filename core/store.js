// Kern: Speichern von Laufzeitdateien (ADR 0027, ADR 0001). Kennt keine Funktion des Servers.
'use strict';
const fs = require('fs');

// Erst in eine Hilfsdatei, dann umbenennen: Ein Absturz mitten im Schreiben zerstört so nicht die ganze Datei.
function writeJsonAtomic(file, data) {
  const tempFile = `${file}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempFile, json, 'utf8');
  try {
    fs.renameSync(tempFile, file);
  } catch {   // z. B. hält OneDrive die Datei gerade fest
    fs.writeFileSync(file, json, 'utf8');
    fs.rmSync(tempFile, { force: true });
  }
}

module.exports = { writeJsonAtomic };
