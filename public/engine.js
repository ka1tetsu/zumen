/**
 * クロス(壁紙)拾い出しエンジン
 *
 * ・長さの単位は、内部ではすべて mm。面積は m2 に直してから返す。
 * ・ブラウザでも Node でもそのまま動く純粋な ES モジュール(DOM を触らない)。
 * ・計算の根拠は docs/keisan.md に日本語で書いてある。数字を変えたいときは
 *   DEFAULTS と MATERIALS を触れば、他の場所を直さなくてよい。
 */

/** 材料(クロス)の規格。幅は mm、ロール長は mm。 */
export const MATERIALS = [
  { id: 'w920', name: '国産 幅92cm / 50m巻', widthMm: 920, rollLenMm: 50000 },
  { id: 'w950', name: '国産 幅95cm / 50m巻', widthMm: 950, rollLenMm: 50000 },
  { id: 'w920x30', name: '国産 幅92cm / 30m巻', widthMm: 920, rollLenMm: 30000 },
  { id: 'w1060', name: '輸入 幅106cm / 50m巻', widthMm: 1060, rollLenMm: 50000 },
  { id: 'w1370', name: '幅137cm / 50m巻', widthMm: 1370, rollLenMm: 50000 },
];

export const DEFAULTS = {
  /** ジョイントの重ねしろ。有効幅 = 材料幅 - これ。 */
  overlapMm: 20,
  /** 1枚あたりの上下の切りしろ(合計)。 */
  trimMm: 100,
  /** 予備(ロス)を何%みるか。 */
  sparePercent: 5,
  /** 飾り棚など小さい部材の、1辺あたりの切りしろ。 */
  smallTrimMm: 20,
  /** 間接照明の帯の、幅方向の切りしろ(巻き込み分を含む)。 */
  coveTrimMm: 30,
  /** これより短い切れ端は「張らない」とみなす(開口部の上下)。 */
  minPieceMm: 150,
  /** のりの使用量の目安 kg/m2(生のり無し材にでんぷん系のりを使う想定)。 */
  gluePerSqm: 0.25,
  /** ジョイントコーク1本で処理できるジョイント延長の目安 m。 */
  caulkMetersPerTube: 70,
  /** 窓・ドアを差し引くかどうか(既定は安全側で「引かない」)。 */
  deductOpenings: false,
};

const round = (v, digits = 2) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

export const mmToM = (mm) => round(mm / 1000, 2);
export const mm2ToSqm = (mm2) => round(mm2 / 1_000_000, 2);

export function findMaterial(id) {
  return MATERIALS.find((m) => m.id === id) || MATERIALS[0];
}

/** 有効幅(重ねしろを引いたあとの、1枚で張れる幅) */
export function effectiveWidth(material, overlapMm) {
  return Math.max(100, material.widthMm - overlapMm);
}

/**
 * 1枚(1ドロップ)の必要な長さ。
 * 柄のリピートがあるときは、リピートの倍数まで切り上げる(柄合わせ)。
 */
export function dropLength(heightMm, { trimMm, repeatMm }) {
  const raw = heightMm + trimMm;
  if (!repeatMm || repeatMm <= 0) return raw;
  return Math.ceil(raw / repeatMm) * repeatMm;
}

/** [from,to] から bands(開口の上下範囲)を引いた、残りの区間を返す。 */
function subtractBands(from, to, bands) {
  const sorted = [...bands].sort((a, b) => a[0] - b[0]);
  const segs = [];
  let cur = from;
  for (const [b0, b1] of sorted) {
    if (b1 <= cur) continue;
    if (b0 > cur) segs.push([cur, Math.min(b0, to)]);
    cur = Math.max(cur, b1);
    if (cur >= to) break;
  }
  if (cur < to) segs.push([cur, to]);
  return segs.filter(([a, b]) => b - a > 0);
}

/**
 * 壁1面の拾い出し。
 * openings は [{ name, x, y, w, h }]。x は壁の左端からの距離、y は床からの高さ(下端)。
 */
export function calcWall(item, ctx) {
  const { effWidth, trimMm, repeatMm, minPieceMm, deductOpenings } = ctx;
  const widthMm = Math.max(0, item.widthMm || 0);
  const heightMm = Math.max(0, item.heightMm || 0);
  const count = Math.max(1, item.count || 1);
  const notes = [];
  if (widthMm <= 0 || heightMm <= 0) {
    return { lengthMm: 0, drops: 0, pieces: [], areaMm2: 0, jointMm: 0, notes: ['寸法が入っていません'] };
  }

  const openings = deductOpenings ? (item.openings || []) : [];
  const dropCount = Math.ceil(widthMm / effWidth);
  const pieces = [];

  for (let i = 0; i < dropCount; i++) {
    const x0 = i * effWidth;
    const x1 = Math.min(widthMm, (i + 1) * effWidth);
    // その1枚の幅を丸ごと覆っている開口だけが、上下に分けて取れる対象。
    const covering = openings.filter(
      (op) => (op.x || 0) <= x0 + 1 && (op.x || 0) + (op.w || 0) >= x1 - 1 && (op.w || 0) > 0 && (op.h || 0) > 0
    );
    if (repeatMm > 0 || covering.length === 0) {
      pieces.push({ heightMm, kind: '通し' });
      continue;
    }
    const bands = covering.map((op) => [op.y || 0, (op.y || 0) + op.h]);
    const segs = subtractBands(0, heightMm, bands);
    const keep = segs.filter(([a, b]) => b - a >= minPieceMm);
    if (keep.length === 0) {
      notes.push('開口ですっぽり抜ける部分があります');
      continue;
    }
    for (const [a, b] of keep) pieces.push({ heightMm: b - a, kind: '開口の上下' });
  }

  if (repeatMm > 0 && openings.length > 0) {
    notes.push('柄合わせがあるので、窓やドアの上下も通しで拾っています');
  }

  const perSet = pieces.reduce((sum, p) => sum + dropLength(p.heightMm, { trimMm, repeatMm }), 0);
  const openingArea = openings.reduce((s, op) => s + (op.w || 0) * (op.h || 0), 0);
  const areaMm2 = Math.max(0, widthMm * heightMm - openingArea) * count;
  // ジョイント延長の目安:縦のジョイント + 天井際と巾木際
  const jointMm = ((Math.max(0, dropCount - 1) * heightMm) + widthMm * 2) * count;

  return {
    lengthMm: perSet * count,
    drops: dropCount * count,
    pieces,
    areaMm2,
    jointMm,
    notes,
  };
}

/** 天井。長い方向に張るものとして、短い方を枚数、長い方を丈にする。 */
export function calcCeiling(item, ctx) {
  const a = Math.max(0, item.widthMm || 0);
  const b = Math.max(0, item.heightMm || 0);
  const long = Math.max(a, b);
  const short = Math.min(a, b);
  const res = calcWall({ ...item, widthMm: short, heightMm: long, openings: [] }, ctx);
  res.notes = [...res.notes, '天井は長い方向に張るものとして計算しています'];
  return res;
}

/**
 * 小さい部材を、材料の幅の中に並べて(棚詰め)、必要な材料長を出す。
 * 長いものから順に棚をつくる、いわゆる FFDH。実際の「取り都合」に近い。
 */
export function packPieces(pieces, effWidth) {
  const shelves = [];
  const oversize = [];
  const sorted = [...pieces].sort((p, q) => q.lenMm - p.lenMm);
  for (const p of sorted) {
    if (p.widthMm > effWidth) {
      oversize.push(p);
      // 幅が材料幅を超えるものは、1枚では取れないので単独で丈だけ確保する。
      shelves.push({ lenMm: p.lenMm, remainMm: 0, items: [p], over: true });
      continue;
    }
    let shelf = shelves.find((s) => !s.over && s.remainMm >= p.widthMm);
    if (!shelf) {
      shelf = { lenMm: p.lenMm, remainMm: effWidth, items: [] };
      shelves.push(shelf);
    }
    shelf.remainMm -= p.widthMm;
    shelf.items.push(p);
  }
  return {
    lengthMm: shelves.reduce((s, sh) => s + sh.lenMm, 0),
    shelves,
    oversize,
  };
}

/**
 * 飾り棚(ニッチ)。開口の内側を展開して、面ごとの切り板を拾う。
 * faces で、どの面を張るかを選べる。
 */
export function calcNiche(item, ctx) {
  const { effWidth, smallTrimMm, repeatMm } = ctx;
  const W = Math.max(0, item.widthMm || 0);
  const H = Math.max(0, item.heightMm || 0);
  const D = Math.max(0, item.depthMm || 0);
  const count = Math.max(1, item.count || 1);
  const faces = { back: true, top: true, bottom: true, left: true, right: true, ...(item.faces || {}) };
  const notes = [];
  if (W <= 0 || H <= 0) {
    return { lengthMm: 0, drops: 0, pieces: [], areaMm2: 0, jointMm: 0, notes: ['寸法が入っていません'] };
  }
  if (D <= 0) notes.push('奥行きが 0 なので、奥の面だけで計算しています');

  const raw = [];
  if (faces.back) raw.push({ label: '奥板', widthMm: W, lenMm: H });
  if (D > 0 && faces.top) raw.push({ label: '上端(天板)', widthMm: W, lenMm: D });
  if (D > 0 && faces.bottom) raw.push({ label: '下端(地板)', widthMm: W, lenMm: D });
  if (D > 0 && faces.left) raw.push({ label: '左の側板', widthMm: D, lenMm: H });
  if (D > 0 && faces.right) raw.push({ label: '右の側板', widthMm: D, lenMm: H });

  const areaMm2 = raw.reduce((s, p) => s + p.widthMm * p.lenMm, 0) * count;

  // 切りしろを足し、柄があれば丈をリピートの倍数に切り上げる。
  const pieces = [];
  for (let i = 0; i < count; i++) {
    for (const p of raw) {
      let lenMm = p.lenMm + smallTrimMm * 2;
      if (repeatMm > 0) lenMm = Math.ceil(lenMm / repeatMm) * repeatMm;
      pieces.push({ label: p.label, widthMm: p.widthMm + smallTrimMm * 2, lenMm });
    }
  }
  const packed = packPieces(pieces, effWidth);
  if (packed.oversize.length > 0) {
    notes.push('材料の幅より大きい面があります。ジョイント(継ぎ目)が必要です');
  }
  notes.push(`入隅・出隅が ${countCorners(faces, D)} か所あります。手間を見てください`);

  // ジョイント(見切り)の延長は、開口まわりの周長で見る。
  const jointMm = (W * 2 + H * 2 + (D > 0 ? W * 2 + H * 2 : 0)) * count;

  return {
    lengthMm: packed.lengthMm,
    drops: packed.shelves.length,
    pieces,
    packed,
    areaMm2,
    jointMm,
    notes,
  };
}

function countCorners(faces, D) {
  if (D <= 0) return 0;
  let n = 0;
  for (const k of ['top', 'bottom', 'left', 'right']) if (faces[k]) n += 2; // 奥の入隅 + 手前の出隅
  return n;
}

/**
 * 間接照明(コーブ・コーニス)。
 * 展開幅(見付け + 内部の立ち上がり + 天井の見込み)の帯を、材料の幅から何本取れるかで計算する。
 */
export function calcCove(item, ctx) {
  const { effWidth, coveTrimMm, trimMm, repeatMm } = ctx;
  const L = Math.max(0, item.lengthMm || 0);
  const devMm = Math.max(0, item.developMm || 0);
  const count = Math.max(1, item.count || 1);
  const notes = [];
  if (L <= 0 || devMm <= 0) {
    return { lengthMm: 0, drops: 0, pieces: [], areaMm2: 0, jointMm: 0, notes: ['寸法が入っていません'] };
  }

  const stripWidth = devMm + coveTrimMm;
  const totalRunMm = L * count;
  const areaMm2 = devMm * totalRunMm;

  if (stripWidth > effWidth) {
    // 帯が材料の幅に入らない。ふつうの壁と同じように、丈を取って張る。
    const dropCount = Math.ceil(totalRunMm / effWidth);
    const lengthMm = dropCount * dropLength(devMm, { trimMm, repeatMm });
    notes.push('展開幅が材料の幅より大きいので、ふつうの壁と同じ取り方で計算しました');
    return { lengthMm, drops: dropCount, pieces: [], areaMm2, jointMm: totalRunMm * 2, notes, perRoll: 0 };
  }

  const perRoll = Math.floor(effWidth / stripWidth); // 材料1本の幅から取れる帯の本数
  const lengthMm = Math.ceil(totalRunMm / perRoll) + trimMm;
  notes.push(`材料の幅から、帯が ${perRoll} 本取れます`);
  notes.push('帯は継ぎ目が目立ちます。長手はなるべく1本で通してください');

  return {
    lengthMm,
    drops: perRoll,
    pieces: [{ label: '帯', widthMm: stripWidth, lenMm: totalRunMm }],
    areaMm2,
    jointMm: totalRunMm * 2 + devMm * count,
    perRoll,
    notes,
  };
}

const CALCULATORS = {
  wall: calcWall,
  ceiling: calcCeiling,
  niche: calcNiche,
  cove: calcCove,
};

export const KIND_LABELS = {
  wall: 'かべ',
  ceiling: 'てんじょう',
  niche: 'かざり棚',
  cove: '間接照明',
};

/** 品番(クロスの種類)の既定値 */
export function defaultProduct(id = 'p1', name = 'クロス ①') {
  return { id, name, materialId: 'w920', repeatMm: 0, code: '' };
}

export function emptyProject() {
  return {
    title: '',
    date: new Date().toISOString().slice(0, 10),
    products: [defaultProduct()],
    options: { ...DEFAULTS },
    items: [],
  };
}

/**
 * 案件まるごとの計算。これが最終的な答えを作る。
 */
export function calcProject(project) {
  const options = { ...DEFAULTS, ...(project.options || {}) };
  const products = project.products && project.products.length ? project.products : [defaultProduct()];
  const items = project.items || [];
  const warnings = [];

  const perItem = [];
  const byProductMap = new Map();

  for (const product of products) {
    const material = findMaterial(product.materialId);
    byProductMap.set(product.id, {
      productId: product.id,
      name: product.name,
      code: product.code || '',
      material,
      lengthMm: 0,
      areaMm2: 0,
      jointMm: 0,
      drops: 0,
    });
  }

  for (const item of items) {
    const productId = byProductMap.has(item.productId) ? item.productId : products[0].id;
    const product = products.find((p) => p.id === productId);
    const material = findMaterial(product.materialId);
    const ctx = {
      ...options,
      repeatMm: Math.max(0, product.repeatMm || 0),
      material,
      effWidth: effectiveWidth(material, options.overlapMm),
    };
    const calc = CALCULATORS[item.kind] || calcWall;
    const res = calc(item, ctx);
    const row = {
      id: item.id,
      name: item.name || KIND_LABELS[item.kind] || 'めん',
      kind: item.kind,
      productId,
      count: Math.max(1, item.count || 1),
      lengthMm: res.lengthMm,
      lengthM: mmToM(res.lengthMm),
      drops: res.drops,
      areaSqm: mm2ToSqm(res.areaMm2),
      jointM: mmToM(res.jointMm),
      notes: res.notes || [],
      detail: res,
    };
    perItem.push(row);

    const bucket = byProductMap.get(productId);
    bucket.lengthMm += res.lengthMm;
    bucket.areaMm2 += res.areaMm2;
    bucket.jointMm += res.jointMm;
    bucket.drops += res.drops;
    for (const n of res.notes || []) {
      if (n.includes('寸法が入っていません')) warnings.push(`「${row.name}」の寸法が入っていません`);
    }
  }

  const spare = Math.max(0, options.sparePercent || 0) / 100;
  const byProduct = [];
  for (const b of byProductMap.values()) {
    const withSpareMm = b.lengthMm * (1 + spare);
    const rolls = Math.ceil(withSpareMm / b.material.rollLenMm);
    byProduct.push({
      ...b,
      lengthM: mmToM(b.lengthMm),
      spareM: mmToM(withSpareMm - b.lengthMm),
      orderM: Math.ceil(withSpareMm / 1000),
      rolls: b.lengthMm > 0 ? rolls : 0,
      rollLenM: b.material.rollLenMm / 1000,
      areaSqm: mm2ToSqm(b.areaMm2),
      jointM: mmToM(b.jointMm),
    });
  }

  const totalLengthMm = byProduct.reduce((s, b) => s + b.lengthMm, 0);
  const totalAreaMm2 = byProduct.reduce((s, b) => s + b.areaMm2, 0);
  const totalJointMm = byProduct.reduce((s, b) => s + b.jointMm, 0);
  const areaSqm = mm2ToSqm(totalAreaMm2);

  const totals = {
    lengthM: mmToM(totalLengthMm),
    orderM: byProduct.reduce((s, b) => s + b.orderM, 0),
    rolls: byProduct.reduce((s, b) => s + b.rolls, 0),
    areaSqm,
    jointM: mmToM(totalJointMm),
    glueKg: round(areaSqm * options.gluePerSqm, 1),
    caulkTubes: areaSqm > 0 ? Math.ceil(mmToM(totalJointMm) / options.caulkMetersPerTube) : 0,
  };

  if (items.length === 0) warnings.push('まだ何も入っていません');
  const hard = perItem.filter((r) => r.kind === 'niche' || r.kind === 'cove');
  if (hard.length > 0) {
    warnings.push(`かざり棚・間接照明が ${hard.length} か所あります。手間と予備を多めに見てください`);
  }

  return { perItem, byProduct, totals, options, warnings };
}

/** 発注メモ・LINE 貼り付け用のテキスト */
export function formatOrderText(project, result) {
  const lines = [];
  lines.push(`【クロス ひろい出し】${project.title || '(名前なし)'}`);
  lines.push(`日付 ${project.date || ''}`);
  lines.push('');
  for (const b of result.byProduct) {
    if (b.rolls === 0 && b.lengthM === 0) continue;
    const code = b.code ? `(${b.code})` : '';
    lines.push(`${b.name}${code} ${b.material.name}`);
    lines.push(`  → ${b.rolls} ロール (${b.orderM} m)  ※予備${result.options.sparePercent}%こみ`);
  }
  lines.push('');
  lines.push(`施工面積の目安 ${result.totals.areaSqm} m2`);
  lines.push(`のり ${result.totals.glueKg} kg / ジョイントコーク ${result.totals.caulkTubes} 本`);
  lines.push('');
  lines.push('[内訳]');
  for (const r of result.perItem) {
    lines.push(`・${r.name} (${KIND_LABELS[r.kind]}) ${r.lengthM} m / ${r.drops} 枚`);
  }
  return lines.join('\n');
}
