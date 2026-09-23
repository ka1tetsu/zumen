import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumbers, toMm, uniqueValues } from '../public/ocr-parse.js';

const w = (text, x0 = 0, y0 = 0, confidence = 96) =>
  ({ text, confidence, bbox: { x0, y0, x1: x0 + 60, y1: y0 + 30 } });

test('カンマ入りの寸法を mm として読む', () => {
  assert.equal(toMm('3,640'), 3640);
  assert.equal(toMm('2,400'), 2400);
  assert.equal(toMm('910'), 910);
});

test('単位がついていれば、それに従う', () => {
  assert.equal(toMm('910mm'), 910);
  assert.equal(toMm('45cm'), 450);
  assert.equal(toMm('2.4m'), 2400);
  assert.equal(toMm('3.6 M'), 3600);
});

test('単位なしの小数は m とみなす', () => {
  assert.equal(toMm('3.64'), 3640, '図面の 3.64 は 3.64m のこと');
  assert.equal(toMm('2.4'), 2400);
});

test('寸法としてありえない値は捨てる', () => {
  assert.equal(toMm('12'), null, '小さすぎる');
  assert.equal(toMm('999999'), null, '大きすぎる');
  assert.equal(toMm('0'), null);
  assert.equal(toMm('いろは'), null);
  assert.equal(toMm(''), null);
  assert.equal(toMm(null), null);
});

test('CH=2400 は天井高の候補として印をつける', () => {
  const [n] = parseNumbers([w('CH=2400')]);
  assert.equal(n.mm, 2400);
  assert.equal(n.isHeight, true);
});

test('ふつうの数字には天井高の印をつけない', () => {
  const [n] = parseNumbers([w('2400')]);
  assert.equal(n.isHeight, false);
});

test('自信のない読み取りは捨てる', () => {
  const got = parseNumbers([w('3640', 0, 0, 96), w('1200', 0, 0, 10)]);
  assert.deepEqual(got.map((g) => g.mm), [3640]);
});

test('読む順(上から下、左から右)に番号をふる', () => {
  const got = parseNumbers([
    w('910', 900, 880),
    w('3,640', 580, 800),
    w('2,400', 60, 460),
    w('1,200', 300, 460),
  ]);
  assert.deepEqual(got.map((g) => `${g.no}:${g.mm}`), ['1:2400', '2:1200', '3:3640', '4:910']);
});

test('実際の図面から読めた語をそのまま流しても通る', () => {
  // scripts の OCR 試験でとれた実データ
  const words = [
    w('CH=2400', 200, 110, 92), w('450', 1151, 250), w('1,650', 522, 280),
    w('2,400', 60, 460), w('1,200', 300, 460), w('3,640', 582, 803), w('910', 901, 880),
  ];
  const got = parseNumbers(words);
  assert.equal(got.length, 7);
  assert.deepEqual(got.map((g) => g.mm).sort((a, b) => a - b), [450, 910, 1200, 1650, 2400, 2400, 3640]);
  assert.equal(got.find((g) => g.isHeight).mm, 2400);
});

test('同じ値はまとめて、どの番号だったかを覚えておく', () => {
  const nums = parseNumbers([w('2,400', 0, 0), w('2400', 0, 100), w('910', 0, 200)]);
  const u = uniqueValues(nums);
  assert.equal(u.length, 2);
  assert.deepEqual(u[0], { mm: 2400, nos: [1, 2], isHeight: false });
});

import { mergeNumbers, unrotateBox } from '../public/ocr-parse.js';

test('90°回して読んだ枠を、元の写真の座標に戻す', () => {
  // 元 W=200, H=100 の写真。左の縦書き (x 10..30, y 20..80) は、
  // 時計回りに 90° 回した画像 (幅 100, 高さ 200) では (x 20..80, y 10..30) にある
  const back = unrotateBox({ x0: 20, y0: 10, x1: 80, y1: 30 }, 100, 200, 90);
  assert.deepEqual(back, { x0: 10, y0: 20, x1: 30, y1: 80 });
});

test('270°回して読んだ枠も、元の座標に戻せる', () => {
  // 元 W=200, H=100。(x 10..30, y 20..80) は反時計回りに 90° 回すと (x 20..80, y 170..190)
  const back = unrotateBox({ x0: 20, y0: 170, x1: 80, y1: 190 }, 100, 200, 270);
  assert.deepEqual(back, { x0: 10, y0: 20, x1: 30, y1: 80 });
});

test('回さずに読んだ枠は、そのまま', () => {
  const b = { x0: 1, y0: 2, x1: 3, y1: 4 };
  assert.deepEqual(unrotateBox(b, 9, 9, 0), b);
});

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

test('同じ場所で2回見つかった数字は、1つにまとめる', () => {
  const got = mergeNumbers([
    { mm: 2400, conf: 90, bbox: box(10, 10, 70, 30) },
    { mm: 2400, conf: 80, bbox: box(12, 11, 71, 31) },
  ]);
  assert.equal(got.length, 1);
  assert.equal(got[0].conf, 90);
});

test('向きを間違えて読んだ低い自信の数字は、正しいほうに負ける', () => {
  const got = mergeNumbers([
    { mm: 1820, conf: 95, bbox: box(100, 100, 180, 130) },
    { mm: 281, conf: 45, bbox: box(110, 95, 175, 135) }, // 同じ場所のでたらめ
  ]);
  assert.deepEqual(got.map((g) => g.mm), [1820]);
});

test('離れた場所の同じ値は、別の寸法として両方残す', () => {
  const got = mergeNumbers([
    { mm: 910, conf: 90, bbox: box(0, 500, 60, 530) },
    { mm: 910, conf: 90, bbox: box(900, 500, 960, 530) },
  ]);
  assert.equal(got.length, 2);
  assert.deepEqual(got.map((g) => g.no), [1, 2]);
});

import { looksTruncated } from '../public/ocr-parse.js';

test('カンマで始まる数字は、頭が欠けたものと見分ける', () => {
  assert.equal(looksTruncated(',640'), true, '本当は 3,640');
  assert.equal(looksTruncated(', 400'), true);
  assert.equal(looksTruncated('3,640'), false);
  assert.equal(looksTruncated('CH=2,400'), false);
  assert.equal(looksTruncated('910'), false);
  assert.equal(looksTruncated('2.4m'), false);
});

test('頭が欠けた数字は、読み直し候補として印をつけて残す', () => {
  const [n] = parseNumbers([w(',640')]);
  assert.equal(n.truncated, true);
  assert.equal(n.mm, 640, '読み直しで「640 で終わる数字」を探す手がかりになる');
});

test('頭が欠けて 100mm 未満になったものも、読み直し候補として残す', () => {
  // 2,040 の「2」が落ちると「,040」= 40。ふつうなら捨てる値だが、読み直せば 2040 に戻る
  const [n] = parseNumbers([w(',040')]);
  assert.equal(n.truncated, true);
  assert.equal(n.mm, 40);
});

test('ふつうの数字には読み直しの印をつけない', () => {
  const [n] = parseNumbers([w('3,640')]);
  assert.equal(n.truncated, false);
});
