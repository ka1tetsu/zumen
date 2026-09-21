/* 現場は電波が悪い。計算だけはオフラインでも動くようにしておく。 */
const CACHE = 'kurosu-v2';
// 最初に入れておくのは軽いものだけ。OCR の一式(10MB ほど)は
// 一度使ったときに、下の fetch でキャッシュに入る。
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'engine.js', 'ocr.js', 'ocr-parse.js',
  'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
