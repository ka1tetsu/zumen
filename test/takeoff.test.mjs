import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMAGES, normalize, validateImages } from '../server/takeoff.mjs';

const img = (over = {}) => ({ media_type: 'image/jpeg', data: 'QUJD', ...over });

test('写真がないときは 400 で断る', () => {
  assert.throws(() => validateImages([]), (e) => e.status === 400);
  assert.throws(() => validateImages(null), (e) => e.status === 400);
});

test('枚数が多すぎるときは断る', () => {
  assert.throws(() => validateImages(Array.from({ length: MAX_IMAGES + 1 }, () => img())), (e) => e.status === 400);
});

test('あつかえない しゅるいは断る', () => {
  assert.throws(() => validateImages([img({ media_type: 'application/pdf' })]), (e) => e.status === 400);
  assert.throws(() => validateImages([img({ data: '<script>' })]), (e) => e.status === 400);
});

test('まともな写真は Claude に渡せる形になる', () => {
  const blocks = validateImages([img({ data: 'QU\nJD' })]);
  assert.deepEqual(blocks, [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }]);
});

test('AI の答えは そのまま信じずに整える', () => {
  const out = normalize({
    title: 'テスト邸',
    unit_guess: 'mm',
    items: [
      { name: '南面', kind: 'wall', width_mm: 3640.4, height_mm: 2400, count: 2, confidence: 'high', source_text: 'x' },
      { name: 'へんな面', kind: 'ドア', width_mm: -5, height_mm: 1e9, count: 0 },
    ],
  });
  assert.equal(out.title, 'テスト邸');
  assert.equal(out.items[0].width_mm, 3640);
  assert.equal(out.items[0].count, 2);
  assert.equal(out.items[1].kind, 'wall', '知らない種類は かべ にする');
  assert.equal(out.items[1].width_mm, 0, 'ありえない数字は 0');
  assert.equal(out.items[1].height_mm, 0, '桁あふれも 0');
  assert.equal(out.items[1].count, 1);
  assert.equal(out.items[1].confidence, 'low', '信頼度が無いものは low あつかい');
});

test('空っぽの答えでも落ちない', () => {
  const out = normalize(undefined);
  assert.deepEqual(out.items, []);
  assert.equal(out.unit_guess, 'unknown');
});

test('長すぎる文字は切る', () => {
  const out = normalize({ note: 'あ'.repeat(900), items: [{ name: 'い'.repeat(200), kind: 'niche' }] });
  assert.equal(out.note.length, 500);
  assert.equal(out.items[0].name.length, 60);
});
