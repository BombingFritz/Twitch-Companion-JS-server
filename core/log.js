// Kern: Log (ADR 0027, ADR 0018). Puffer für das Live-Log der Webkonsole, Bereinigung von Secrets und privaten
// Adressen, dauerhaftes Fehlerprotokoll und logIfChanged gegen wiederholte Zeilen. Kennt keine Funktion des Servers.
'use strict';
const fs = require('fs');
const util = require('util');

// Werte, die im Live-Log nie erscheinen dürfen: Secrets, die Webhook-Adresse samt Host und Webhook-ID
function redactedValues({ secrets = [], webhookUrl, loopbackHostnames = [] }) {
  const values = [...secrets];
  if (webhookUrl) values.push(webhookUrl);
  try {
    const url = new URL(webhookUrl);
    if (!loopbackHostnames.includes(url.hostname)) values.push(url.host, url.hostname);
    values.push(url.pathname.split('/').pop());
  } catch { /* keine oder ungültige Webhook-Adresse */ }
  return values.filter(Boolean).sort((a, b) => b.length - a.length);
}

function createLog({ redactions = [], redactedText, privateAddressText, bufferLines, maxChars, errorLogFile, errorLogMax, writeJson, onError = () => {} }) {
  const buffer = [];
  const clients = new Set();     // offene Live-Log-Verbindungen
  let nextId = 1;

  // Nur für den Puffer: Das Konsolenfenster zeigt weiter die unveränderte Zeile.
  function sanitize(text) {
    let clean = text;
    for (const value of redactions) clean = clean.split(value).join(redactedText);
    return clean
      .replace(/((?:access_token|refresh_token|client_secret)["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi, `$1${redactedText}`)
      .replace(/\b(Bearer|OAuth)\s+[\w.~+/=-]+/g, `$1 ${redactedText}`)
      .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/g, redactedText)   // GitHub-Tokens (Stream-Kartei)
      .replace(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, privateAddressText);
  }

  function loadErrorLog() {
    if (!fs.existsSync(errorLogFile)) return [];
    try {
      const list = JSON.parse(fs.readFileSync(errorLogFile, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }

  const errorLog = loadErrorLog();

  function appendErrorLog(entry) {
    errorLog.push({ at: entry.at, pid: process.pid, text: entry.text });
    if (errorLog.length > errorLogMax) errorLog.splice(0, errorLog.length - errorLogMax);
    try {
      writeJson(errorLogFile, errorLog);
    } catch (err) {
      logIfChanged('error-log-write', `[Fehlerprotokoll] ${errorLogFile} konnte nicht geschrieben werden: ${err.message}`, 'warn');
    }
  }

  function writeEntry(res, entry) {
    res.write(`event: line\ndata: ${JSON.stringify(entry)}\n\n`);
  }

  function record(level, args) {
    try {
      const text = sanitize(util.format(...args));
      const entry = {
        id: nextId++,
        at: new Date().toISOString(),
        level,
        text: text.length > maxChars ? `${text.slice(0, maxChars)} … (gekürzt)` : text,
      };
      buffer.push(entry);
      if (buffer.length > bufferLines) buffer.shift();
      for (const res of clients) writeEntry(res, entry);
      if (level === 'error') {
        appendErrorLog(entry);
        onError();
      }
    } catch { /* Das Protokollieren darf den Server nie stören */ }
  }

  // Leitet die Konsolenausgabe zusätzlich in den Puffer; das Konsolenfenster bleibt unverändert.
  function installConsole() {
    for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
      const original = console[method];
      console[method] = (...args) => {
        original.apply(console, args);
        record(level, args);
      };
    }
  }

  // Merkt sich pro Schlüssel die letzte ausgegebene Nachricht. Solange sich die Nachricht für diesen Schlüssel nicht
  // ändert, wird sie nicht erneut ausgegeben (z. B. wiederholte Status und Stände). Bei Änderung sofort wieder.
  const lastLoggedByKey = new Map();

  function logIfChanged(key, message, level = 'log') {
    const prev = lastLoggedByKey.get(key);
    if (prev === message) return;
    lastLoggedByKey.set(key, message);
    if (level === 'error') {
      console.error(message);
    } else if (level === 'warn') {
      console.warn(message);
    } else {
      console.log(message);
    }
  }

  return { buffer, clients, errorLog, writeEntry, sanitize, installConsole, logIfChanged };
}

module.exports = { createLog, redactedValues };
