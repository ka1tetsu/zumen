/**
 * public/ を配るだけの、小さなサーバー。外部のライブラリは使っていない。
 *
 * ブラウザで OCR を動かすには、ファイルを http で配る必要がある
 * (file:// のままだと Worker と WebAssembly が読めない)。それだけのためのもの。
 * 置き場所が GitHub Pages などの静的ホスティングなら、これは要らない。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC, rel);
  // public/ の外には出さない
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden');
    return;
  }
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache',
    };
    // .traineddata.gz は中身が gzip のファイルそのもの。
    // Content-Encoding を付けるとブラウザが勝手にほどいてしまうので、付けない。
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('みつかりません');
  }
});

server.listen(PORT, () => {
  console.log(`クロスけいさん機  http://localhost:${PORT}`);
  console.log('すうじの よみとりは、ブラウザの中だけで動きます(通信なし・費用なし)');
});
