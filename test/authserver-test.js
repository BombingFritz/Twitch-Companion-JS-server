// AuthServer.cmd (ADR 0018, docs/specs/webkonsole.md): Die Schleife startet den Server nur bei Exit-Code 75 neu.
// Läuft mit dem echten Skript in einem eigenen Ordner, statt server.js liegt dort eine Attrappe, die vorgegebene Exit-Codes liefert.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('OK   S0 AuthServer.cmd läuft nur unter Windows, übersprungen');
  process.exit(0);
}

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const FAKE_SERVER = `
const fs = require('fs');
const plan = JSON.parse(fs.readFileSync('plan.json', 'utf8'));
const runs = fs.existsSync('runs.txt') ? fs.readFileSync('runs.txt', 'utf8').split('\\n').filter(Boolean).length : 0;
fs.appendFileSync('runs.txt', (process.env.TWITCH_COMPANION_SUPERVISED || 'nicht gesetzt') + '\\n');
process.exit(runs < plan.length ? plan[runs] : 0);
`;

function runScript(plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authserver-'));
  try {
    fs.copyFileSync(path.join(__dirname, '..', 'AuthServer.cmd'), path.join(dir, 'AuthServer.cmd'));
    fs.writeFileSync(path.join(dir, 'server.js'), FAKE_SERVER);
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan));
    const env = { ...process.env, PATH: `${path.dirname(process.execPath)};${process.env.PATH}` };
    delete env.TWITCH_COMPANION_SUPERVISED;
    const res = spawnSync('cmd.exe', ['/d', '/c', path.join(dir, 'AuthServer.cmd')], { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 });
    const runs = fs.existsSync(path.join(dir, 'runs.txt')) ? fs.readFileSync(path.join(dir, 'runs.txt'), 'utf8').split(/\r?\n/).filter(Boolean) : [];
    return { runs, output: res.stdout || '', error: res.error };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let r = runScript([0]);
check('S1 Exit 0 (Beenden): kein Neustart', r.runs.length === 1 && !r.error, JSON.stringify(r.runs));
check('S2 Das Skript meldet dem Server, dass es ihn überwacht', r.runs[0] === '1', r.runs[0]);
check('S3 Ohne Neustart keine Neustart-Meldung', !r.output.includes('Neustart aus der Webkonsole'), r.output);
r = runScript([75, 75, 0]);
check('S4 Exit 75: Neustart, bis ein anderer Code kommt', r.runs.length === 3 && r.runs.every(x => x === '1'), JSON.stringify(r.runs));
check('S5 Neustart steht im Fenster', r.output.split('Neustart aus der Webkonsole').length === 3, r.output);
r = runScript([1]);
check('S6 Exit 1 (Absturz, Port belegt): kein Neustart', r.runs.length === 1, JSON.stringify(r.runs));
r = runScript([75, 1]);
check('S7 Absturz nach einem Neustart: keine Schleife', r.runs.length === 2, JSON.stringify(r.runs));
r = runScript([76]);
check('S8 Exit 76: kein Neustart', r.runs.length === 1, JSON.stringify(r.runs));

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
