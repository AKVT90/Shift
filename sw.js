// SHIFT service worker.
// - App (HTML/JS/CSS): REDE PRIMEIRO (sempre a versão mais recente quando há ligação), cache só como fallback offline.
// - vendor/ (OCR, ficheiros grandes e imutáveis): cache primeiro.
// A versão vem de version.js; mudar esse ficheiro faz o iPhone instalar o novo service worker.
importScripts('version.js');
const V = 'shift-app-' + self.SHIFT_VERSION;
const VENDOR = 'shift-vendor-1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'version.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    // cache:'reload' ignora a cache HTTP do GitHub Pages (10 min) para nunca guardar ficheiros velhos.
    await Promise.all(SHELL.map(async u => { const r = await fetch(new Request(u, { cache: 'reload' })); if (!r.ok) throw new Error(u + ' ' + r.status); await c.put(u, r); }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V && k !== VENDOR) await caches.delete(k);
    await self.clients.claim();
  })());
});
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.includes('/vendor/')) {
    e.respondWith((async () => {
      const c = await caches.open(VENDOR), hit = await c.match(r.url);
      if (hit) return hit;
      const res = await fetch(r); if (res.ok) c.put(r.url, res.clone()); return res;
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(V);
    const net = fetch(r.url, { cache: 'no-cache' }).then(res => { if (res.ok) c.put(r.url, res.clone()); return res; });
    try { return await withTimeout(net, 5000); }
    catch (err) {
      net.catch(() => {});
      return (await c.match(r.url, { ignoreSearch: true })) || (r.mode === 'navigate' && (await c.match('index.html'))) || Response.error();
    }
  })());
});
