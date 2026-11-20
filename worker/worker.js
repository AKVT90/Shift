// SHIFT — Cloudflare Worker
// GET  /cal/<token>.ics  -> devolve o calendário (URL permanente, token difícil de adivinhar)
// PUT  /cal/<token>.ics  -> publica/atualiza o calendário (exige Authorization: Bearer <SECRET>)
// Bindings: KV "CAL"; secret "SECRET"; variável opcional ALLOWED_ORIGIN.

const enc = new TextEncoder();

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

// Comparação em tempo constante (via hash) para não revelar a palavra-passe por tempo de resposta.
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export default {
  async fetch(req, env) {
    const C = cors(env);
    try {
      return await handle(req, env, C);
    } catch (e) {
      // Devolve sempre CORS, senão o navegador esconde o erro real atrás de «Failed to fetch».
      return new Response('Worker error: ' + (e && e.message ? e.message : e), { status: 500, headers: C });
    }
  }
};

async function handle(req, env, C) {
  {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: C });

    const m = /^\/cal\/([A-Za-z0-9_-]{32,128})\.ics$/.exec(new URL(req.url).pathname);
    if (!m) return new Response('Not found (caminho ou token inválido)', { status: 404, headers: C });
    const key = 'ics:' + m[1];

    if (req.method === 'PUT') {
      const auth = req.headers.get('Authorization') || '';
      if (!env.SECRET || !(await safeEqual(auth, 'Bearer ' + env.SECRET))) {
        return new Response('Unauthorized', { status: 401, headers: C });
      }
      const body = await req.text();
      if (!body.startsWith('BEGIN:VCALENDAR') || body.length > 1_000_000) {
        return new Response('Bad calendar', { status: 400, headers: C });
      }
      await env.CAL.put(key, body);
      return new Response('ok', { status: 200, headers: C });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const v = await env.CAL.get(key);
      if (v === null) return new Response('Not found', { status: 404, headers: C });
      return new Response(req.method === 'HEAD' ? null : v, {
        headers: Object.assign({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' }, C)
      });
    }
    return new Response('Method not allowed', { status: 405, headers: C });
  }
}
