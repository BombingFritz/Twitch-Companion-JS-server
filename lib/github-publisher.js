// Stream-Kartei (ADR 0026, Spec docs/specs/stream-kartei.md): Dateien in einen Zweig eines GitHub-Repositorys legen.
// Der Zweig hat danach genau einen Commit ohne Vorgänger (keine wachsende Historie, alte Stände bleiben nicht im Zweig).
// Nicht über twitchApi: ADR 0024 gilt nur für Twitch. Kennt weder Express noch den Server.
'use strict';

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'twitch-companion-js-server';   // allgemeiner Name, keine persönlichen Angaben
const EXPIRATION_HEADER = 'github-authentication-token-expiration';

// "2027-11-21 10:00:00 UTC" bzw. "2027-11-21 10:00:00 +0100" -> ISO oder null
function parseExpiration(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/.exec(value.trim());
  if (!m) return null;
  const zone = m[3] === 'UTC' ? 'Z' : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// http: axios-artig (get, post, patch). repo: "owner/name". branch: Zweig der Daten.
function createGithubPublisher({ http, repo, token, branch = 'data', apiBase = API_BASE, timeoutMs = 15000 }) {
  let tokenExpiresAt = null;
  const base = `${apiBase}/repos/${repo}`;
  const config = () => ({
    timeout: timeoutMs,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': USER_AGENT },
  });
  const note = res => {
    const h = res && res.headers;
    const v = h && (typeof h.get === 'function' ? h.get(EXPIRATION_HEADER) : h[EXPIRATION_HEADER]);
    const parsed = parseExpiration(v);
    if (parsed) tokenExpiresAt = parsed;
    return res;
  };
  const statusOf = err => (err && err.response && err.response.status) || null;
  async function call(method, url, body) {
    try {
      return note(method === 'get' ? await http.get(url, config()) : await http[method](url, body, config()));
    } catch (err) {
      note(err && err.response);
      throw err;
    }
  }

  // Stand des Zweigs: {commitSha, treeSha} oder null, wenn es ihn nicht gibt
  async function head() {
    try {
      const ref = await call('get', `${base}/git/ref/heads/${branch}`);
      const commitSha = ref.data.object.sha;
      const commit = await call('get', `${base}/git/commits/${commitSha}`);
      return { commitSha, treeSha: commit.data.tree.sha };
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  }

  return {
    // Inhalt einer Datei im Zweig als Text, null wenn Datei oder Zweig fehlen
    async readFile(path) {
      try {
        const res = await call('get', `${base}/contents/${path}?ref=${encodeURIComponent(branch)}`);
        return Buffer.from(String(res.data.content || ''), 'base64').toString('utf8');
      } catch (err) {
        if (statusOf(err) === 404) return null;
        throw err;
      }
    },
    // files: { "pfad/datei.json": "Inhalt" }. Andere Dateien im Zweig bleiben (base_tree).
    async publish(files, message) {
      const current = await head();
      const tree = Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content }));
      const newTree = await call('post', `${base}/git/trees`, current ? { base_tree: current.treeSha, tree } : { tree });
      const commit = await call('post', `${base}/git/commits`, { message, tree: newTree.data.sha, parents: [] });
      const sha = commit.data.sha;
      if (current) await call('patch', `${base}/git/refs/heads/${branch}`, { sha, force: true });
      else await call('post', `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha });
      return { commitSha: sha, created: !current };
    },
    tokenExpiresAt: () => tokenExpiresAt,
    statusOf,
  };
}

module.exports = { createGithubPublisher, parseExpiration };
