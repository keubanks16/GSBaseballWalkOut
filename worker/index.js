// GS Baseball Walkout Songs — serves the app and makes pro announcer clips with Workers AI (Deepgram Aura-2).
const VOICES = new Set(['zeus', 'orion', 'atlas', 'apollo', 'arcas', 'aries', 'draco', 'hermes', 'hyperion', 'janus', 'jupiter', 'mars', 'neptune', 'odysseus', 'orpheus', 'pluto', 'saturn',
  'athena', 'hera', 'luna', 'thalia', 'andromeda', 'asteria', 'aurora', 'helena', 'iris', 'juno', 'minerva', 'phoebe', 'vesta']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const err = (msg, status) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/announce') return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return err('POST only', 405);
    let body;
    try { body = await request.json(); } catch { return err('Bad JSON', 400); }
    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!text) return err('No text', 400);
    const speaker = VOICES.has(body.speaker) ? body.speaker : 'zeus';
    try {
      const out = await env.AI.run('@cf/deepgram/aura-2-en', { text, speaker });
      let audio = out;
      if (out instanceof Response) audio = out.body;
      else if (out && typeof out === 'object' && !(out instanceof ReadableStream) && !(out instanceof ArrayBuffer) && !ArrayBuffer.isView(out) && out.audio)
        audio = Uint8Array.from(atob(out.audio), c => c.charCodeAt(0));
      return new Response(audio, { headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
    } catch (e) {
      return err('Announcer failed: ' + (e && e.message || e), 502);
    }
  },
};
