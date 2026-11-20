// Cloudflare Worker: guarda o .ics publicado pela app SHIFT e serve-o num URL permanente.
// Variáveis: SECRET (palavra-passe de publicação), KV namespace "CAL".
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' };
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const m = /^\/cal\/([A-Za-z0-9_-]{32,})\.ics$/.exec(new URL(req.url).pathname);
    if (!m) return new Response('Not found', { status: 404 });
    const key = 'ics:' + m[1];
    if (req.method === 'PUT') {
      if (!env.SECRET || req.headers.get('Authorization') !== 'Bearer ' + env.SECRET) return new Response('Unauthorized', { status: 401, headers: CORS });
      const body = await req.text();
      if (!body.startsWith('BEGIN:VCALENDAR') || body.length > 1_000_000) return new Response('Bad calendar', { status: 400, headers: CORS });
      await env.CAL.put(key, body);
      return new Response('ok', { headers: CORS });
    }
    if (req.method === 'GET') {
      const v = await env.CAL.get(key);
      if (!v) return new Response('Not found', { status: 404 });
      return new Response(v, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return new Response('Method not allowed', { status: 405 });
  }
};
