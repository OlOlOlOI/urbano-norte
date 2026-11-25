// Service worker: guarda o aplicativo para abrir sem internet, mas SEMPRE tenta buscar a versão mais nova primeiro.
const VERSAO = 'sorteio-un-web-1.0.6';
const ARQUIVOS = [
  './', 'index.html', 'style.css', 'mobile.css', 'manifest.webmanifest',
  'api-web.js', 'mobile.js', 'renderer.js', 'historico.js', 'fundo.js', 'vertical.js', 'logo.js', 'video.js', 'tema.js',
  'vendor/xlsx.full.min.js', 'vendor/mp4-muxer.js', 'vendor/omggif.js',
  'assets/emblema.png', 'assets/abertura.webp', 'assets/abertura-quadros.png', 'assets/abertura-quadros.json',
  'fonts/outfit-latin-400-normal.woff2', 'fonts/outfit-latin-500-normal.woff2', 'fonts/outfit-latin-600-normal.woff2',
  'fonts/outfit-latin-700-normal.woff2', 'fonts/outfit-latin-800-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' ignora cópias antigas guardadas pelo navegador/CDN
  e.waitUntil(caches.open(VERSAO).then((c) => Promise.all(ARQUIVOS.map((a) => fetch(new Request(a, { cache: 'reload' })).then((r) => { if (r.ok) return c.put(a, r); })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // páginas já abertas (inclusive de versões antigas do app) recarregam para mostrar a versão nova
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((cs) => cs.forEach((c) => { try { c.navigate(c.url); } catch (e) { /* ignora */ } })),
  );
});

// Rede primeiro (sempre a versão mais nova); sem internet, usa o que está guardado.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((r) => {
      if (r && r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
