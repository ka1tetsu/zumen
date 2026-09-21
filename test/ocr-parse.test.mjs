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
