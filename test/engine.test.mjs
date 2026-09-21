import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  calcCeiling,
  calcCove,
  calcNiche,
  calcProject,
  calcWall,
  dropLength,
  effectiveWidth,
  emptyProject,
  findMaterial,
  formatOrderText,
  packPieces,
} from '../public/engine.js';

const ctxFor = (over = {}) => {
  const material = findMaterial(over.materialId || 'w920');
  return {
    ...DEFAULTS,
    repeatMm: 0,
    ...over,
    material,
    effWidth: effectiveWidth(material, over.overlapMm ?? DEFAULTS.overlapMm),
  };
};

test('有効幅は材料幅から重ねしろを引いた値', () => {
  assert.equal(effectiveWidth(findMaterial('w920'), 20), 900);
  assert.equal(effectiveWidth(findMaterial('w1060'), 20), 1040);
});

test('丈は高さ + 切りしろ、柄があればリピートの倍数に切り上げ', () => {
  assert.equal(dropLength(2400, { trimMm: 100, repeatMm: 0 }), 2500);
  assert.equal(dropLength(2400, { trimMm: 100, repeatMm: 500 }), 2500);
  assert.equal(dropLength(2450, { trimMm: 100, repeatMm: 500 }), 3000);
});

test('ふつうの壁: 3600 x 2400 は 4枚 x 2.5m = 10m', () => {
  const r = calcWall({ widthMm: 3600, heightMm: 2400 }, ctxFor());
  assert.equal(r.drops, 4);
  assert.equal(r.lengthMm, 10000);
  assert.equal(r.areaMm2, 3600 * 2400);
});

test('割り切れない幅は枚数を切り上げる', () => {
  const r = calcWall({ widthMm: 3601, heightMm: 2400 }, ctxFor());
  assert.equal(r.drops, 5);
});

test('同じ壁が複数あるときは枚数も長さも掛け算になる', () => {
  const r = calcWall({ widthMm: 3600, heightMm: 2400, count: 3 }, ctxFor());
  assert.equal(r.drops, 12);
  assert.equal(r.lengthMm, 30000);
});

test('窓を引くと、丸ごと覆われた枚だけ上下に分かれる', () => {
  const item = {
    widthMm: 3600,
    heightMm: 2400,
    openings: [{ name: '掃き出し窓', x: 900, y: 900, w: 1800, h: 1200 }],
  };
  const off = calcWall(item, ctxFor());
  assert.equal(off.lengthMm, 10000, '既定では引かない');

  const on = calcWall(item, ctxFor({ deductOpenings: true }));
  // 通し2枚(2500) + 上下に分かれた2枚 x (1000 + 400)
  assert.equal(on.lengthMm, 2 * 2500 + 2 * (1000 + 400));
  assert.equal(on.areaMm2, 3600 * 2400 - 1800 * 1200);
});

test('短すぎる切れ端は張らないものとして落とす', () => {
  const item = {
    widthMm: 1800,
    heightMm: 2400,
    openings: [{ x: 0, y: 100, w: 1800, h: 2200 }], // 下100mm・上100mm しか残らない
  };
  const r = calcWall(item, ctxFor({ deductOpenings: true }));
  assert.equal(r.lengthMm, 0);
  assert.ok(r.notes.some((n) => n.includes('すっぽり抜ける')));
});

test('柄があるときは窓の上下に分けず、通しで拾う', () => {
  const item = {
    widthMm: 3600,
    heightMm: 2400,
    openings: [{ x: 900, y: 900, w: 1800, h: 1200 }],
  };
  const r = calcWall(item, ctxFor({ deductOpenings: true, repeatMm: 500 }));
  assert.equal(r.lengthMm, 4 * 2500);
  assert.ok(r.notes.some((n) => n.includes('柄合わせ')));
});

test('天井は長い方向に張る', () => {
  const r = calcCeiling({ widthMm: 2700, heightMm: 3600 }, ctxFor());
  assert.equal(r.drops, 3); // 短手2700 / 900
  assert.equal(r.lengthMm, 3 * (3600 + 100));
});

test('棚詰め: 長いものから並べて、材料の幅に収める', () => {
  const p = packPieces(
    [
      { widthMm: 440, lenMm: 940 },
      { widthMm: 160, lenMm: 940 },
      { widthMm: 160, lenMm: 940 },
      { widthMm: 440, lenMm: 160 },
      { widthMm: 440, lenMm: 160 },
    ],
    900
  );
  assert.equal(p.lengthMm, 940 + 160);
  assert.equal(p.shelves.length, 2);
});

test('かざり棚(ニッチ): 5面ぶんを展開して取り都合で拾う', () => {
  const r = calcNiche({ widthMm: 400, heightMm: 900, depthMm: 120 }, ctxFor());
  assert.equal(r.pieces.length, 5);
  assert.equal(r.lengthMm, 1100);
  assert.equal(r.areaMm2, 400 * 900 + 2 * 400 * 120 + 2 * 900 * 120);
  assert.ok(r.notes.some((n) => n.includes('入隅')));
});

test('かざり棚: 張らない面を外せる', () => {
  const r = calcNiche(
    { widthMm: 400, heightMm: 900, depthMm: 120, faces: { top: false, bottom: false } },
    ctxFor()
  );
  assert.equal(r.pieces.length, 3);
});

test('かざり棚: 材料幅を超える面はジョイントの注意を出す', () => {
  const r = calcNiche({ widthMm: 1200, heightMm: 600, depthMm: 100 }, ctxFor());
  assert.ok(r.notes.some((n) => n.includes('ジョイント')));
});

test('間接照明: 帯を何本取れるかで計算する', () => {
  const r = calcCove({ lengthMm: 5000, developMm: 250 }, ctxFor());
  assert.equal(r.perRoll, 3); // 900 / (250+30)
  assert.equal(r.lengthMm, Math.ceil(5000 / 3) + 100);
});

test('間接照明: 展開幅が材料幅を超えたら、ふつうの壁として拾う', () => {
  const r = calcCove({ lengthMm: 5000, developMm: 1000 }, ctxFor());
  assert.equal(r.drops, Math.ceil(5000 / 900));
  assert.ok(r.notes.some((n) => n.includes('ふつうの壁')));
});

test('案件まるごと: ロール数は予備をのせて切り上げる', () => {
  const project = emptyProject();
  project.items = [
    { id: '1', kind: 'wall', name: '東面', widthMm: 3600, heightMm: 2400 },
    { id: '2', kind: 'wall', name: '西面', widthMm: 3600, heightMm: 2400 },
  ];
  const res = calcProject(project);
  assert.equal(res.byProduct[0].lengthM, 20);
  assert.equal(res.byProduct[0].orderM, 21); // 20m + 5%
  assert.equal(res.byProduct[0].rolls, 1);
  assert.equal(res.totals.rolls, 1);
  assert.ok(res.totals.glueKg > 0);
});

test('案件まるごと: 50m を超えたら 2 ロール', () => {
  const project = emptyProject();
  project.items = [{ id: '1', kind: 'wall', name: '長い壁', widthMm: 18000, heightMm: 2400, count: 1 }];
  const res = calcProject(project);
  assert.equal(res.byProduct[0].lengthM, 50);
  assert.equal(res.byProduct[0].rolls, 2); // 50m + 予備 = 52.5m
});

test('案件まるごと: 品番ごとに分けて集計する', () => {
  const project = emptyProject();
  project.products = [
    { id: 'p1', name: 'クロス ①', materialId: 'w920', repeatMm: 0, code: 'SP-1000' },
    { id: 'p2', name: 'クロス ②', materialId: 'w1060', repeatMm: 640, code: 'FE-2000' },
  ];
  project.items = [
    { id: '1', kind: 'wall', productId: 'p1', widthMm: 3600, heightMm: 2400 },
    { id: '2', kind: 'wall', productId: 'p2', widthMm: 3600, heightMm: 2400 },
  ];
  const res = calcProject(project);
  assert.equal(res.byProduct.length, 2);
  assert.equal(res.byProduct[0].lengthM, 10);
  // 幅106cm・リピート640 → 枚数4、丈は 2500 を 640 の倍数へ切り上げ = 2560
  assert.equal(res.byProduct[1].lengthM, 4 * 2.56);
  assert.equal(res.totals.rolls, 2);
});

test('寸法なしは警告になる', () => {
  const project = emptyProject();
  project.items = [{ id: '1', kind: 'wall', name: 'なぞの壁', widthMm: 0, heightMm: 2400 }];
  const res = calcProject(project);
  assert.ok(res.warnings.some((w) => w.includes('寸法が入っていません')));
});

test('発注メモにロール数と内訳が入る', () => {
  const project = emptyProject();
  project.title = '山田様邸';
  project.items = [
    { id: '1', kind: 'wall', name: '東面', widthMm: 3600, heightMm: 2400 },
    { id: '2', kind: 'niche', name: '飾り棚', widthMm: 400, heightMm: 900, depthMm: 120 },
  ];
  const text = formatOrderText(project, calcProject(project));
  assert.ok(text.includes('山田様邸'));
  assert.ok(text.includes('ロール'));
  assert.ok(text.includes('飾り棚'));
});
