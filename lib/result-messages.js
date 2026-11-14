// Ergebniszeilen für Wette und Abstimmung (Spec wetten-abstimmungen.md, Schritt 3b).
// Texte wörtlich wie in den Widgets: Wetten-Widget 0.7.0 (resultChatMessage, biggestWinner, fmtQuote; dort Spec
// chat-nachricht.md und ADR 0008) und SpargelPoll 0.8.2 (generateResultChatMessage, calculatePercentages, findWinner).
// Eingabe ist jeweils der Stand aus lib/prediction-state.js bzw. lib/poll-state.js.
'use strict';

const ANON_NAME = 'anonymer Schlaumeier';   // wie in der Statistik (ADR 0022) und im Wetten-Widget (ADR 0008)

const de = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
// Quote wie die Kurstafel des Wetten-Widgets: unter 10 zwei Nachkommastellen, unter 100 eine, sonst ganze Zahl
function fmtQuote(q) { return q < 10 ? de(q, 2) : q < 100 ? de(q, 1) : de(Math.round(q)); }

// Twitch-Auszahlung: Die Gewinner teilen sich den Topf im Verhältnis ihrer Einsätze; Quote = Topf ÷ Punkte des Siegers
function predictionResultMessage(p, { isPrivate = () => false } = {}) {
  if (!p || p.status !== 'RESOLVED') return null;
  const winner = (p.outcomes || []).find(o => o.id === p.winningOutcomeId);
  if (!winner) return null;
  const total = p.outcomes.reduce((sum, o) => sum + (o.channelPoints || 0), 0);
  const q = winner.channelPoints > 0 ? total / winner.channelPoints : 0;
  if (!q) return `Die Vorhersage ist beendet! »${winner.title}« gewinnt. Niemand hatte darauf gesetzt.`;
  let msg = `Die Vorhersage ist beendet! »${winner.title}« gewinnt mit einer Quote von ${fmtQuote(q)}.`;
  // Größter Gewinner: Top-Tipper des Siegers mit dem höchsten Gewinn; meldet Twitch 0, gilt Einsatz × Quote.
  // Wer auf der !privat-Liste steht, heißt „ein anonymer Schlaumeier“; es rückt niemand nach.
  const best = (winner.topPredictors || [])
    .map(t => ({ name: t.userName || t.userLogin, anon: Boolean(t.userId) && isPrivate(t.userId), gain: t.channelPointsWon > 0 ? t.channelPointsWon : t.channelPointsUsed * q }))
    .sort((a, b) => b.gain - a.gain)[0];
  if (best && best.gain > 0) msg += ` Als größter Gewinner räumt ${best.anon ? 'ein ' + ANON_NAME : best.name} ${de(Math.round(best.gain))} Kanalpunkte ab.`;
  return msg;
}

const POLL_FINAL = ['COMPLETED', 'TERMINATED', 'ARCHIVED'];

function pollResultMessage(p) {
  if (!p || !POLL_FINAL.includes(p.status)) return null;
  const options = (p.choices || []).map(c => ({ name: c.title, votes: c.votes || 0 }));
  if (!options.length) return null;
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
  const withPct = options.map(o => ({ ...o, percentage: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0 }));
  const maxVotes = Math.max(0, ...withPct.map(o => o.votes));
  const top = withPct.filter(o => o.votes === maxVotes);
  if (maxVotes === 0 || top.length > 1) {
    // Gleichstand (auch 0:0): alle Optionen mit der Höchststimmenzahl
    const tiedText = top.map(o => `"${o.name}" mit ${o.percentage} Prozent der Stimmen`).join(' sowie ');
    return `Die Umfrage "${p.title}" wurde beendet und wir haben einen Gleichstand! ${tiedText} liegen gleichauf.`;
  }
  const sorted = withPct.slice().sort((a, b) => b.votes - a.votes);
  let msg = `Die Umfrage "${p.title}" wurde beendet und hier sind eure Ergebnisse. Den längsten Spargel hat "${sorted[0].name}" mit ${sorted[0].percentage} Prozent der Stimmen`;
  if (sorted[1]) msg += `, gefolgt von "${sorted[1].name}" mit ${sorted[1].percentage} Prozent der Stimmen`;
  return msg + '.';
}

// Wann eine Zeile fällig ist (Nutzer, 14.11.2026): einmal je ID, sobald ein Endstand vorliegt, aber nur, wenn dieser
// Serverprozess die Wette bzw. Abstimmung vorher offen gesehen hat. Damit löst ein schon beendeter Ausgangsstand nach
// einem Neustart nichts aus; ein verlorenes Ende, das erst die Kontrolle bemerkt, wird verspätet noch angesagt.
function createResultAnnouncer({ idKey, openStatuses, finalStatuses, onFinal, maxRemembered = 50 }) {
  const seenOpen = new Set();
  const done = new Set();
  const remember = (set, id) => { set.add(id); if (set.size > maxRemembered) set.delete(set.values().next().value); };
  return {
    observe(snapshot) {
      const id = snapshot && snapshot[idKey];
      if (!id) return false;
      if (openStatuses.includes(snapshot.status)) { remember(seenOpen, id); return false; }
      if (!finalStatuses.includes(snapshot.status) || !seenOpen.has(id) || done.has(id)) return false;
      remember(done, id);
      onFinal(snapshot);
      return true;
    },
  };
}

module.exports = { predictionResultMessage, pollResultMessage, createResultAnnouncer, fmtQuote, ANON_NAME, POLL_FINAL };
