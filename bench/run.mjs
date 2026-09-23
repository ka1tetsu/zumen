/**
 * 写真の読み取り精度を測る。
 *
 *   npm run bench
 *
 * 1. 現場写真に近い図面(影・黄ばみ・傾き・縦書きの寸法・遠くから撮った小さい字)を 5 枚つくる
 * 2. アプリと同じ読み取り(public/ocr.js)を、ブラウザの中で実際に動かす
 * 3. 正解の寸法のうち、いくつ拾えたかを数える
 *
 * 読み取りの設定を変えたら、これで前後を比べること。
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from './playwright.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'kurosu-bench-'));
fs.cpSync(path.join(root, 'public'), site, { recursive: true });
fs.copyFileSync(path.join(here, 'bench.html'), path.join(site, 'bench.html'));
fs.mkdirSync(path.join(site, 'set'));
execFileSync(process.execPath, [path.join(here, 'make-drawings.mjs'), path.join(site, 'set')], { stdio: 'inherit' });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.gz': 'application/gzip' };
const server = http.createServer((req, res) => {
  const file = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => { server.listen(0, ok); });
const url = `http://localhost:${server.address().port}/bench.html`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.ready);
  const rows = await page.evaluate(() => window.bench(['clean', 'photo', 'far', 'tilt', 'dark'], 2400));
  let hit = 0; let of = 0; let vHit = 0; let vOf = 0;
  console.log('\n写真    寸法   縦書き  余計な数字        時間');
  for (const r of rows) {
    hit += r.hit; of += r.of; vHit += r.vHit; vOf += r.vOf;
    console.log(`${r.name.padEnd(7)} ${r.hit}/${r.of}    ${r.vHit}/${r.vOf}     ${JSON.stringify(r.extra).padEnd(16)}  ${(r.ms / 1000).toFixed(1)}秒`);
  }
  console.log(`合計    ${hit}/${of} (${Math.round((100 * hit) / of)}%)  縦書き ${vHit}/${vOf}`);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(site, { recursive: true, force: true });
}
