import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const versions = JSON.parse(fs.readFileSync(new URL('../public/vendor/tesseract/VERSIONS.json', import.meta.url), 'utf8'));

test('OCR 一式のキャッシュ名に、同梱しているバージョンが入っている', () => {
  // vendor/ はキャッシュ優先なので、中身を入れ替えたのに名前を変え忘れると、
  // スマホには古い一式が残り続ける。npm run vendor のあとはここが落ちる。
  const m = sw.match(/const VENDOR_CACHE = '([^']+)'/);
  assert.ok(m, 'VENDOR_CACHE が見つからない');
  assert.ok(m[1].endsWith(versions['tesseract.js']),
    `VENDOR_CACHE (${m[1]}) を tesseract.js ${versions['tesseract.js']} に合わせてください`);
});

test('最初に入れておく画面のファイルが、ぜんぶ実在する', () => {
  // 1つでも欠けていると addAll が失敗して、Service Worker ごと入らない
  const list = sw.match(/const SHELL = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  for (const f of list) {
    if (f === './') continue;
    assert.ok(fs.existsSync(new URL(`../public/${f}`, import.meta.url)), `public/${f} がない`);
  }
});

test('画面まわりはネット優先、OCR 一式だけキャッシュ優先', () => {
  assert.match(sw, /rel\.startsWith\('vendor\/'\) \? cacheFirst\(e\.request\) : networkFirst\(e\.request\)/);
});
