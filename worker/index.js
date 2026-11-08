// GS Baseball Walkout Songs — serves the app and makes announcer clips.
// Pro: ElevenLabs v3 (through Cloudflare AI Gateway, paid with AI Gateway credits).
// Basic: Deepgram Aura-2 on Workers AI.
const AURA = new Set(['zeus', 'orion', 'atlas', 'apollo', 'arcas', 'aries', 'draco', 'hermes', 'hyperion', 'janus', 'jupiter', 'mars', 'neptune', 'odysseus', 'orpheus', 'pluto', 'saturn',
  'athena', 'hera', 'luna', 'thalia', 'andromeda', 'asteria', 'aurora', 'helena', 'iris', 'juno', 'minerva', 'phoebe', 'vesta']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
