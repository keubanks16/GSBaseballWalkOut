// GS Baseball Walkout Songs — serves the app and makes announcer clips.
// Pro: ElevenLabs v3 (through Cloudflare AI Gateway, paid with AI Gateway credits).
// Basic: Deepgram Aura-2 on Workers AI.
const AURA = new Set(['zeus', 'orion', 'atlas', 'apollo', 'arcas', 'aries', 'draco', 'hermes', 'hyperion', 'janus', 'jupiter', 'mars', 'neptune', 'odysseus', 'orpheus', 'pluto', 'saturn',
  'athena', 'hera', 'luna', 'thalia', 'andromeda', 'asteria', 'aurora', 'helena', 'iris', 'juno', 'minerva', 'phoebe', 'vesta']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Team-Code, X-Audio-Name', 'Access-Control-Expose-Headers': 'X-Audio-Name', 'Access-Control-Max-Age': '86400' };
const err = (msg, status) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const b64 = s => Uint8Array.from(atob(s.replace(/^data:[^,]+,/, '')), c => c.charCodeAt(0));

async function fetchAudio(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not download announcer audio (' + r.status + ')');
  return r.body;
}
async function toAudio(out) {
  if (out instanceof Response) {
    if (!out.ok) throw new Error(await out.text());
    if ((out.headers.get('content-type') || '').includes('json')) return toAudio(await out.json());
    return out.body;
  }
  if (out instanceof ReadableStream || out instanceof ArrayBuffer || ArrayBuffer.isView(out)) return out;
  if (typeof out === 'string') return /^https?:/.test(out) ? fetchAudio(out) : b64(out);
  if (out && typeof out === 'object') {
    const r = out.result || out, a = r.audio || r.url;
    if (a instanceof ReadableStream || a instanceof ArrayBuffer || ArrayBuffer.isView(a)) return a;
    if (typeof a === 'string') return /^https?:/.test(a) ? fetchAudio(a) : b64(a);
    if (out.errors || out.error) throw new Error(JSON.stringify(out.errors || out.error));
  }
  throw new Error('Unexpected response from the announcer');
}

async function eleven(env, text, voice, style) {
  const input = {
    text, voice_id: /^[A-Za-z0-9]{16,32}$/.test(voice || '') ? voice : 'nPczCjzI2devNBz1zQrb',
    output_format: 'mp3_44100_128',
    voice_settings: { stability: style === 'hype' ? 0 : 0.5, similarity_boost: 0.8 },
  };
  try { return await toAudio(await env.AI.run('elevenlabs/eleven-v3', input)); }
  catch (e1) {
    try { return await toAudio(await env.AI.run('elevenlabs/eleven-v3', input, { gateway: { id: env.AI_GATEWAY || 'default' } })); }
    catch (e2) { throw new Error(String(e2 && e2.message || e2 || e1)); }
  }
}
async function aura(env, text, voice) {
  return toAudio(await env.AI.run('@cf/deepgram/aura-2-en', { text: text.replace(/\[[^\]]*\]/g, '').trim(), speaker: AURA.has(voice) ? voice : 'zeus' }));
}

// Read-only copy of the coach's current game from the Dugout Lineup app (batting order, roster, who's up).
async function dugout(env, search) {
  try {
    const path = '/api/state' + (search || '');
    const r = env.DUGOUT ? await env.DUGOUT.fetch('https://dugoutlineup' + path) : await fetch('https://dugoutlineup.kollinmeubanks.workers.dev' + path);
    return new Response(r.body, { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) { return err('Dugout Lineup is not reachable', 502); }
}

// Sound-effect search (Myinstants). /api/sfx?q= returns { results: [{ title, mp3 }] };
// /api/sfx/clip?u= passes the mp3 through so the app can save it on the phone.
const SFX_APIS = ['https://myinstants-api.page.gd', 'https://myinstants-api.vercel.app'];
const UA = { 'User-Agent': 'Mozilla/5.0 (GS Baseball Walkout Songs)' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
function sfxList(j) {
  const arr = Array.isArray(j) ? j : Array.isArray(j && j.data) ? j.data : Array.isArray(j && j.results) ? j.results : [];
  const out = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    let m = [x.mp3, x.sound, x.audio, x.url].find(v => typeof v === 'string' && /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(v));
    if (!m) continue;
    try { m = new URL(m, 'https://www.myinstants.com').href; } catch { continue; }
    out.push({ title: String(x.title || x.name || 'Sound').trim().slice(0, 80), mp3: m });
    if (out.length >= 30) break;
  }
  return out;
}
const unent = t => t.replace(/&(#x?[0-9a-f]+|amp|quot|apos|lt|gt);/gi, (m, c) => c[0] === '#' ? String.fromCodePoint(/^#x/i.test(c) ? parseInt(c.slice(2), 16) : +c.slice(1)) : ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[c.toLowerCase()]);
// Reads the Myinstants search page itself, for when the API in front of it is down.
function sfxPage(html) {
  const out = [], seen = new Set(), re = /play\('([^']+\.mp3)'[^>]*>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 30) {
    const mp3 = new URL(m[1], 'https://www.myinstants.com').href; if (seen.has(mp3)) continue; seen.add(mp3);
    const near = m[0] + html.slice(re.lastIndex, re.lastIndex + 900);
    const t = /title="Play (.+?) sound"/i.exec(near) || /class="instant-link[^"]*"[^>]*>\s*([^<]+?)\s*</i.exec(near);
    const name = t ? unent(t[1]).trim() : decodeURIComponent(mp3.split('/').pop()).replace(/\.mp3$/i, '').replace(/[_-]+/g, ' ');
    out.push({ title: name.slice(0, 80) || 'Sound', mp3 });
  }
  return out;
}
async function sfxSearch(env, q) {
  const tried = [];
  for (const base of env.SFX_API ? [env.SFX_API] : SFX_APIS) {
    const tag = new URL(base).hostname.split('.').slice(-2, -1)[0];
    try {
      const r = await fetch(base.replace(/\/$/, '') + '/search?q=' + encodeURIComponent(q), { headers: { ...UA, Accept: 'application/json' } });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { tried.push(tag + ' ' + r.status + ' page'); continue; }
      const list = sfxList(j);
      if (!list.length && (!r.ok || (j && +j.status >= 400))) { tried.push(tag + ' ' + (r.ok ? j.status : r.status)); continue; }
      return json({ results: list });
    } catch (e) { tried.push(tag + ' down'); }
  }
  try {
    const r = await fetch('https://www.myinstants.com/en/search/?name=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } });
    const t = await r.text(), list = sfxPage(t);
    if (list.length || (r.ok && /instant|No results|myinstants/i.test(t))) return json({ results: list });
    tried.push('site ' + r.status);
  } catch (e) { tried.push('site down'); }
  return err('Sound search is not answering right now (' + tried.join(', ') + ')', 502);
}
async function sfxClip(u) {
  let t; try { t = new URL(u); } catch { return err('Bad link', 400); }
  if (t.protocol !== 'https:' || !/(^|\.)myinstants\.com$/i.test(t.hostname)) return err('Not allowed', 400);
  try {
    const r = await fetch(t.href, { headers: { ...UA, Referer: 'https://www.myinstants.com/' } });
    if (!r.ok) return err('Could not download that sound (' + r.status + ')', 502);
    if (+(r.headers.get('content-length') || 0) > 8e6) return err('That sound is too big', 413);
    return new Response(r.body, { headers: { ...CORS, 'Content-Type': r.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' } });
  } catch (e) { return err('Could not download that sound', 502); }
}

// Team sync: one saved copy of everything (players, sounds, settings + the audio files) per team code, in KV.
// The code never gets stored; its hash is the key, so only phones that know the code can read or change the team.
async function teamKey(request) {
  let code = ''; try { code = decodeURIComponent(request.headers.get('X-Team-Code') || '').trim().toLowerCase(); } catch { }
  if (code.length < 6 || code.length > 64) return null;
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gs-walkout:' + code));
  return 't:' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40) + ':';
}
async function teamSync(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!env.SYNC) return err('Team sync storage is not set up yet', 501);
  const k = await teamKey(request); if (!k) return err('The team code needs at least 6 characters', 401);
  const sub = url.pathname.slice('/api/sync'.length), m = request.method;
  if (sub === '') {
    const cur = await env.SYNC.getWithMetadata(k + 'data', 'text'), v = cur.value ? (cur.metadata && cur.metadata.v) || 1 : 0;
    if (m === 'GET') return v && +url.searchParams.get('v') !== v ? new Response('{"v":' + v + ',"data":' + cur.value + '}', { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) : json({ v });
    if (m !== 'PUT') return err('GET or PUT only', 405);
    const body = await request.text();
    if (body.length > 2e6) return err('Too much team data', 413);
    try { const d = JSON.parse(body); if (!d || !Array.isArray(d.teams)) throw 0; } catch { return err('Bad team data', 400); }
    if (v && +url.searchParams.get('base') !== v) return json({ v }, 409);
    await env.SYNC.put(k + 'data', body, { metadata: { v: v + 1, at: Date.now() } });
    return json({ v: v + 1 });
  }
  if (sub === '/audio' && m === 'GET') {
    const ids = []; let cursor;
    do { const l = await env.SYNC.list({ prefix: k + 'a:', cursor }); l.keys.forEach(x => ids.push(x.name.slice(k.length + 2))); cursor = l.list_complete ? null : l.cursor; } while (cursor);
    return json({ ids });
  }
  const a = /^\/audio\/([A-Za-z0-9_-]{4,40})$/.exec(sub); if (!a) return err('Not found', 404);
  if (m === 'GET') {
    const r = await env.SYNC.getWithMetadata(k + 'a:' + a[1], 'stream'); if (!r.value) return err('Not saved yet', 404);
    return new Response(r.value, { headers: { ...CORS, 'Content-Type': (r.metadata && r.metadata.type) || 'audio/mpeg', 'X-Audio-Name': encodeURIComponent((r.metadata && r.metadata.name) || ''), 'Cache-Control': 'no-store' } });
  }
  if (m !== 'PUT') return err('GET or PUT only', 405);
  if (+(request.headers.get('content-length') || 0) > 24e6) return err('That audio file is too big to sync (24 MB max)', 413);
  const buf = await request.arrayBuffer(); if (!buf.byteLength || buf.byteLength > 24e6) return err('That audio file is too big to sync (24 MB max)', 413);
  let name = ''; try { name = decodeURIComponent(request.headers.get('X-Audio-Name') || '').slice(0, 120); } catch { }
  await env.SYNC.put(k + 'a:' + a[1], buf, { metadata: { type: (request.headers.get('content-type') || 'audio/mpeg').slice(0, 60), name } });
  return json({ ok: true });
}

// Apple Music (test): signs the MusicKit developer token with the key saved as Worker secrets, and searches the catalog.
let appleTok = null;
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function appleToken(env) {
  if (!env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_MUSIC_KEY) throw new Error('The Apple Music key is not saved in Cloudflare yet (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_MUSIC_KEY)');
  const now = Math.floor(Date.now() / 1000);
  if (appleTok && appleTok.exp - now > 3600) return appleTok;
  const pem = String(env.APPLE_MUSIC_KEY).replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  let key;
  try { key = await crypto.subtle.importKey('pkcs8', b64(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); }
  catch (e) { throw new Error('APPLE_MUSIC_KEY in Cloudflare is not a valid .p8 key. Paste the whole file, including the BEGIN and END lines.'); }
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o))), exp = now + 12 * 3600;
  const head = enc({ alg: 'ES256', kid: String(env.APPLE_KEY_ID).trim() }) + '.' + enc({ iss: String(env.APPLE_TEAM_ID).trim(), iat: now, exp });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head));
  return appleTok = { token: head + '.' + b64url(sig), exp };
}
async function appleMusic(env, url) {
  try {
    const t = await appleToken(env);
    if (url.pathname === '/api/music/token') return json(t);
    const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (!q) return err('No search words', 400);
    const sf = /^[a-z]{2}$/.test(url.searchParams.get('sf') || '') ? url.searchParams.get('sf') : 'us';
    const r = await fetch('https://api.music.apple.com/v1/catalog/' + sf + '/search?types=songs&limit=20&term=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + t.token } });
    if (r.status === 401 || r.status === 403) return err('Apple did not accept the key (' + r.status + '). Check that the Team ID and Key ID in Cloudflare match the key.', 502);
    if (!r.ok) return err('Apple Music search failed (' + r.status + ')', 502);
    const j = await r.json(), list = (j.results && j.results.songs && j.results.songs.data) || [];
    return json({ results: list.map(x => ({ id: x.id, name: x.attributes.name, artist: x.attributes.artistName, dur: Math.round((x.attributes.durationInMillis || 0) / 1000), clean: x.attributes.contentRating !== 'explicit' })) });
  } catch (e) { return err(String(e && e.message || e).slice(0, 300), 500); }
}

// The Sports Hub link: sign in with a Sports Hub account and read that person's team roster and the
// batting order of the live (or most recent) game. Everything is read as the signed-in user, so
// Firestore's own rules decide what they may see. Nothing is stored here.
const HUB = { key: 'AIzaSyDth-zgyTD4F8kzCyXKgrYWX_0YvwEgGYg', project: 'the-sports-hub-57584', site: 'https://thesportshub.app/' };
const fsVal = v => !v ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(fsVal) : 'mapValue' in v ? fsObj(v.mapValue.fields) : 'timestampValue' in v ? v.timestampValue : null;
const fsObj = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fsVal(v)]));
class HubErr extends Error { constructor(m, status) { super(m); this.status = status; } }
async function hubAuth(url, body, form) {
  const r = await fetch(url + '?key=' + HUB.key, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Referer: HUB.site }, body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (r.ok && j) return j;
  const code = String((j && j.error && j.error.message) || '');
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL|MISSING_PASSWORD/.test(code)) throw new HubErr('That email or password is not right for The Sports Hub.', 401);
  if (/TOO_MANY_ATTEMPTS/.test(code)) throw new HubErr('Too many tries. Wait a few minutes and try again.', 429);
  if (/USER_DISABLED/.test(code)) throw new HubErr('That Sports Hub account is turned off.', 403);
  if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|INVALID_GRANT/.test(code)) throw new HubErr('signin', 401);
  throw new HubErr('The Sports Hub sign-in did not work (' + (code || r.status) + ')', 502);
}
async function hubFs(path, token) {
  const r = await fetch('https://firestore.googleapis.com/v1/projects/' + HUB.project + '/databases/(default)/documents/' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (r.status === 401) throw new HubErr('signin', 401);
  if (r.status === 403) throw new HubErr('Your Sports Hub account is not on that team.', 403);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new HubErr('The Sports Hub did not answer (' + r.status + ')', 502);
  return j;
}
// Batting order as it stands now: the saved lineup plus any players added or removed during the game.
function hubOrder(g) {
  let lu = (Array.isArray(g.lineup) ? g.lineup : []).slice();
  const us = g.home ? 'home' : 'away';
  for (const e of Array.isArray(g.events) ? g.events : []) if (e && e.t === 'lu' && e.side === us) {
    if (e.op === 'add') { if (!lu.includes(e.ref)) lu.push(e.ref); } else if (e.op === 'rm' && lu.length > 1) lu = lu.filter(x => x !== e.ref);
  }
  return lu.map(String);
}
function hubPickGame(games, today) {
  const has = games.filter(g => !g.practice && Array.isArray(g.lineup) && g.lineup.length);
  const stamp = g => String(g.date || '') + ' ' + String(g.time || '');
  const newest = (a, b) => stamp(b).localeCompare(stamp(a)) || (b.updatedAt || 0) - (a.updatedAt || 0);
  const live = has.filter(g => g.status === 'live').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (live.length) return live[0];
  const past = has.filter(g => !today || String(g.date || '') <= today).sort(newest);
  return past[0] || has.sort((a, b) => -newest(a, b))[0] || null;
}
async function sportsHub(request, url) {
  try {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const sub = url.pathname.slice('/api/hub/'.length);
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (sub === 'login') {
        if (!b.email || !b.password) return err('Enter your Sports Hub email and password', 400);
        const j = await hubAuth('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', { email: String(b.email).trim(), password: String(b.password), returnSecureToken: true });
        return json({ uid: j.localId, email: j.email, token: j.idToken, refresh: j.refreshToken, expires: +j.expiresIn || 3600 });
      }
      if (sub === 'refresh') {
        if (!b.refresh) return err('signin', 401);
        const j = await hubAuth('https://securetoken.googleapis.com/v1/token', { grant_type: 'refresh_token', refresh_token: String(b.refresh) }, true);
        return json({ uid: j.user_id, token: j.id_token, refresh: j.refresh_token, expires: +j.expires_in || 3600 });
      }
      return err('Not found', 404);
    }
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''); if (!token) return err('signin', 401);
    if (sub === 'teams') {
      const uid = url.searchParams.get('uid') || ''; if (!/^[A-Za-z0-9]{6,64}$/.test(uid)) return err('signin', 401);
      const j = await hubFs('users/' + uid + '/teams?pageSize=100', token);
      const teams = ((j && j.documents) || []).map(d => ({ id: d.name.split('/').pop(), ...fsObj(d.fields) })).filter(t => !t.hidden && t.status !== 'pending')
        .map(t => ({ id: String(t.teamId || t.id), name: String(t.name || t.teamId || t.id) }));
      return json({ teams });
    }
    if (sub === 'lineup') {
      const team = (url.searchParams.get('team') || '').toLowerCase().trim(); if (!/^[a-z0-9_-]{2,48}$/.test(team)) return err('Enter the team code from The Sports Hub', 400);
      const today = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('today') || '') ? url.searchParams.get('today') : '';
      const main = await hubFs('teams/' + team + '/team/main', token); if (!main) return err('No Sports Hub team has that code', 404);
      const t = fsObj(main.fields);
      const roster = (Array.isArray(t.players) ? t.players : []).filter(p => p && p.id && !p.sample).map(p => ({ id: String(p.id), name: String(p.name || '').trim(), num: String(p.num ?? '').trim() }));
      const mask = ['status', 'date', 'time', 'lineup', 'home', 'updatedAt', 'practice', 'opponent'].map(f => 'mask.fieldPaths=' + f).join('&');
      const games = []; let page = '';
      for (let i = 0; i < 6; i++) {
        const j = await hubFs('teams/' + team + '/games?pageSize=300&' + mask + (page ? '&pageToken=' + encodeURIComponent(page) : ''), token);
        ((j && j.documents) || []).forEach(d => games.push({ id: d.name.split('/').pop(), ...fsObj(d.fields) }));
        page = (j && j.nextPageToken) || ''; if (!page) break;
      }
      const pick = hubPickGame(games, today);
      let order = [], game = null;
      if (pick) {
        const full = await hubFs('teams/' + team + '/games/' + pick.id, token), g = full ? fsObj(full.fields) : pick;
        const ids = new Set(roster.map(p => p.id));
        order = hubOrder(g).filter(id => ids.has(id));
        game = { id: pick.id, opponent: String(g.opponent || 'Opponent'), date: String(g.date || ''), status: String(g.status || 'scheduled') };
      }
      return json({ team: String(t.name || team), roster, game, order });
    }
    return err('Not found', 404);
  } catch (e) { return e instanceof HubErr ? err(e.message, e.status) : err('The Sports Hub link had a problem: ' + String(e && e.message || e).slice(0, 200), 502); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/dugout') return dugout(env, url.search);
    if (url.pathname.startsWith('/api/hub/')) return sportsHub(request, url);
    if (url.pathname === '/api/music/token' || url.pathname === '/api/music/search') return request.method === 'OPTIONS' ? new Response(null, { headers: CORS }) : appleMusic(env, url);
    if (url.pathname === '/api/sync' || url.pathname.startsWith('/api/sync/')) { try { return await teamSync(request, env, url); } catch (e) { return err('Team sync had a problem: ' + String(e && e.message || e).slice(0, 200), 502); } }
    if (url.pathname === '/api/sfx' || url.pathname === '/api/sfx/clip') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
      if (request.method !== 'GET') return err('GET only', 405);
      if (url.pathname === '/api/sfx/clip') return sfxClip(url.searchParams.get('u') || '');
      const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return q ? sfxSearch(env, q) : err('No search words', 400);
    }
    if (url.pathname !== '/api/announce') return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return err('POST only', 405);
    let body;
    try { body = await request.json(); } catch { return err('Bad JSON', 400); }
    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return err('No text', 400);
    try {
      const audio = body.engine === 'basic' ? await aura(env, text, body.voice || body.speaker) : await eleven(env, text, body.voice, body.style);
      return new Response(audio, { headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
    } catch (e) {
      let m = String(e && e.message || e);
      if (/balance|credit|402|payment/i.test(m)) m = 'Add AI Gateway credits in Cloudflare to use the pro announcer. (' + m.slice(0, 160) + ')';
      return err(m.slice(0, 400), 502);
    }
  },
};
