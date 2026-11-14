// lib/result-messages.js: Ergebniszeilen wie in den Widgets und die Regel, wann eine Zeile fällig ist
// (Spec wetten-abstimmungen.md, Schritt 3b). Reiner Modultest.
const path = require('path');
const { predictionResultMessage, pollResultMessage, createResultAnnouncer, fmtQuote } = require(path.join(__dirname, '..', 'lib', 'result-messages'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

const tp = (userId, userName, used, won) => ({ userId, userName, userLogin: userName.toLowerCase(), channelPointsUsed: used, channelPointsWon: won });
const prediction = (over = {}) => ({
  predictionId: 'w1', title: 'Versenkt er den Tanker?', status: 'RESOLVED', winningOutcomeId: 'ja',
  outcomes: [
    { id: 'ja', title: 'Ja', channelPoints: 42000, users: 5, topPredictors: [tp('7', 'Kaleun_Kalle', 10000, 26905), tp('8', 'Matrose', 2000, 5381)] },
    { id: 'nein', title: 'Nein', channelPoints: 71000, users: 9, topPredictors: [tp('9', 'Pech', 50000, 0)] },
  ],
  ...over,
});

// Abnahmekriterium aus der Spec des Wetten-Widgets (chat-nachricht.md)
check('R1 Vorlage: Sieger, Quote 2,69, größter Gewinner mit Tausenderpunkt',
  predictionResultMessage(prediction()) === 'Die Vorhersage ist beendet! »Ja« gewinnt mit einer Quote von 2,69. Als größter Gewinner räumt Kaleun_Kalle 26.905 Kanalpunkte ab.',
  predictionResultMessage(prediction()));
check('R2 !privat: „ein anonymer Schlaumeier“, niemand rückt nach',
  predictionResultMessage(prediction(), { isPrivate: id => id === '7' }) === 'Die Vorhersage ist beendet! »Ja« gewinnt mit einer Quote von 2,69. Als größter Gewinner räumt ein anonymer Schlaumeier 26.905 Kanalpunkte ab.');
const noWon = prediction(); noWon.outcomes[0].topPredictors = [tp('7', 'Kaleun_Kalle', 10000, 0)];
check('R3 Gewinn noch 0: Einsatz × Quote', predictionResultMessage(noWon).endsWith('räumt Kaleun_Kalle 26.905 Kanalpunkte ab.'), predictionResultMessage(noWon));
const noTop = prediction(); noTop.outcomes[0].topPredictors = [];
check('R4 Ohne Top-Tipper: zweiter Satz entfällt', predictionResultMessage(noTop) === 'Die Vorhersage ist beendet! »Ja« gewinnt mit einer Quote von 2,69.');
const nobody = prediction(); nobody.outcomes[0].channelPoints = 0; nobody.outcomes[0].topPredictors = [];
check('R5 Niemand auf den Sieger gesetzt', predictionResultMessage(nobody) === 'Die Vorhersage ist beendet! »Ja« gewinnt. Niemand hatte darauf gesetzt.');
check('R6 Abbruch, offene Wette, ohne Sieger: keine Zeile',
  predictionResultMessage(prediction({ status: 'CANCELED' })) === null && predictionResultMessage(prediction({ status: 'LOCKED' })) === null && predictionResultMessage(prediction({ winningOutcomeId: null })) === null);
check('R7 Quotenformat wie die Kurstafel', fmtQuote(2.6904) === '2,69' && fmtQuote(12.34) === '12,3' && fmtQuote(123.6) === '124' && fmtQuote(1234.4) === '1.234');

const poll = (choices, over = {}) => ({ pollId: 'v1', title: 'Längster Spargel?', status: 'COMPLETED', choices: choices.map(([title, votes]) => ({ title, votes })), ...over });
check('U1 Normalfall: Sieger und Zweiter mit gerundeten Prozent',
  pollResultMessage(poll([['Weiß', 5], ['Grün', 3], ['Lila', 1]])) === 'Die Umfrage "Längster Spargel?" wurde beendet und hier sind eure Ergebnisse. Den längsten Spargel hat "Weiß" mit 56 Prozent der Stimmen, gefolgt von "Grün" mit 33 Prozent der Stimmen.',
  pollResultMessage(poll([['Weiß', 5], ['Grün', 3], ['Lila', 1]])));
check('U2 Gleichstand: alle mit Höchststimmenzahl, verbunden mit „sowie“',
  pollResultMessage(poll([['Weiß', 2], ['Grün', 2], ['Lila', 1]])) === 'Die Umfrage "Längster Spargel?" wurde beendet und wir haben einen Gleichstand! "Weiß" mit 40 Prozent der Stimmen sowie "Grün" mit 40 Prozent der Stimmen liegen gleichauf.');
check('U3 0:0 ist Gleichstand aller Optionen',
  pollResultMessage(poll([['A', 0], ['B', 0]])) === 'Die Umfrage "Längster Spargel?" wurde beendet und wir haben einen Gleichstand! "A" mit 0 Prozent der Stimmen sowie "B" mit 0 Prozent der Stimmen liegen gleichauf.');
check('U4 Nur eine Option mit Stimmen: ohne „gefolgt von“ bei einer einzigen Option',
  pollResultMessage(poll([['A', 3]])) === 'Die Umfrage "Längster Spargel?" wurde beendet und hier sind eure Ergebnisse. Den längsten Spargel hat "A" mit 100 Prozent der Stimmen.');
check('U5 Abgebrochen und archiviert zählen als Ende, laufend nicht',
  pollResultMessage(poll([['A', 1]], { status: 'TERMINATED' })) !== null && pollResultMessage(poll([['A', 1]], { status: 'ARCHIVED' })) !== null && pollResultMessage(poll([['A', 1]], { status: 'ACTIVE' })) === null);

// Wann ist eine Zeile fällig?
const fired = [];
const a = createResultAnnouncer({ idKey: 'pollId', openStatuses: ['ACTIVE'], finalStatuses: ['COMPLETED', 'TERMINATED', 'ARCHIVED'], onFinal: s => fired.push(`${s.pollId}:${s.status}`) });
a.observe({ pollId: 'alt', status: 'COMPLETED' });
check('A1 Schon beendet beim Start (Ausgangsstand): nichts', fired.length === 0);
a.observe({ pollId: 'p1', status: 'ACTIVE' }); a.observe({ pollId: 'p1', status: 'ACTIVE' });
a.observe({ pollId: 'p1', status: 'COMPLETED' }); a.observe({ pollId: 'p1', status: 'ARCHIVED' }); a.observe({ pollId: 'p1', status: 'COMPLETED' });
check('A2 Offen gesehen, dann Ende: genau einmal, auch bei archived danach', JSON.stringify(fired) === '["p1:COMPLETED"]', JSON.stringify(fired));
a.observe({ pollId: 'p2', status: 'ACTIVE' }); a.observe({ pollId: 'p3', status: 'ACTIVE' }); a.observe({ pollId: 'p2', status: 'TERMINATED' });
check('A3 Verspätetes Ende (Kontrolle) einer offen gesehenen Abstimmung: wird angesagt', fired.includes('p2:TERMINATED'));
check('A4 Ohne ID oder unbekannter Status: nichts', a.observe({ status: 'COMPLETED' }) === false && a.observe({ pollId: 'p3', status: 'MODERATED' }) === false);
const many = createResultAnnouncer({ idKey: 'pollId', openStatuses: ['ACTIVE'], finalStatuses: ['COMPLETED'], onFinal: () => {}, maxRemembered: 3 });
for (let i = 0; i < 10; i++) many.observe({ pollId: `x${i}`, status: 'ACTIVE' });
check('A5 Gemerkte IDs begrenzt (älteste fallen heraus)', many.observe({ pollId: 'x0', status: 'COMPLETED' }) === false && many.observe({ pollId: 'x9', status: 'COMPLETED' }) === true);

for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
