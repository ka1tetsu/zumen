/*
 * オフライン対応と、更新の配り方。
 *
 * ・画面(HTML / JS / CSS)は「ネット優先」。電波があれば毎回最新版を取りにいき、
 *   3秒で返事がなければキャッシュで開く。こうしないと、一度開いたスマホに
 *   新しい版が永久に届かない(以前の版はキャッシュ優先で、実際そうなっていた)。
 * ・OCR の一式(vendor/、約10MB)は中身が変わらないので「キャッシュ優先」。
 *   入れ替えたときは VENDOR_CACHE の名前を変える(テストで VERSIONS.json と突き合わせている)。
 */
const SHELL_CACHE = 'kurosu-shell-v3';
const VENDOR_CACHE = 'kurosu-vendor-tesseract-7.0.0';
const NETWORK_TIMEOUT_MS = 3000;

const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'engine.js', 'ocr.js', 'ocr-parse.js',
  'ocr-image.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  const keep = new Set([SHELL_CACHE, VENDOR_CACHE]);
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** 画面まわり: ネット優先。遅い・圏外ならキャッシュ。 */
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  // HTTP キャッシュも素通りさせて、サーバーに「変わった?」と必ず聞く(変わっていなければ 304 で軽い)
  const net = fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
    .then((res) => {
      if (res.ok) cache.put(req.url, res.clone());
      return res;
    });
  net.catch(() => {}); // 時間切れのあとで失敗しても、未処理のエラーにしない

  const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS); });
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch {
    // 圏外。下でキャッシュを探す
  }
  const hit = (await cache.match(req.url))
    || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
  if (hit) return hit;
  return net; // キャッシュにも無ければ、遅くてもネットを待つ
}

/** OCR の一式: キャッシュ優先。一度取れば二度と取りにいかない。 */
async function cacheFirst(req) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.slice(scope.pathname.length);
  e.respondWith(rel.startsWith('vendor/') ? cacheFirst(e.request) : networkFirst(e.request));
});
