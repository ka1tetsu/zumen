/**
 * OCR が読んだ文字のかたまりから、寸法として使えそうな数字だけを拾う。
 *
 * 画像も OCR も関係ない、ただの文字列処理なので、ここだけ切り離してテストできる。
 * 図面の寸法は原則 mm なので、内部では mm に直して持つ。
 */

/** 寸法として、ありえない値は捨てる(mm) */
export const MIN_MM = 100;
export const MAX_MM = 30000;

/** 数字 + 単位。3,640 / 2400 / 2.4m / 910mm / 45cm を拾う */
const NUM_RE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(mm|cm|m|ミリ|ｍｍ)?/i;

/** 天井高の書き方。CH=2400、CH 2400、天井高2400 */
const CH_RE = /(ch|천|天井高|てんじょう)\s*[=:]?\s*$/i;

/**
 * 数字の頭が欠けて読めたか。「,640」は、実際には「3,640」の「3」が
 * 寸法線などにくっついて読めなかったもの。寸法がカンマで始まることはない。
 */
export function looksTruncated(raw) {
  return /^[^\d]*[,.]\s*\d/.test(String(raw || '').trim()) && !/\d\s*[,.]\s*\d/.test(String(raw || '').trim());
}

/** 範囲チェックをしない mm 換算(頭の欠けた数字を読み直すときに使う) */
function rawMm(raw) {
  const text = String(raw || '').trim();
  const m = NUM_RE.exec(text);
  if (!m) return null;
  const value = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = (m[2] || '').toLowerCase();
  let mm;
  if (unit === 'mm' || unit === 'ミリ' || unit === 'ｍｍ') mm = value;
  else if (unit === 'cm') mm = value * 10;
  else if (unit === 'm') mm = value * 1000;
  else if (m[1].includes('.') && value < 100) mm = value * 1000; // 「3.6」は 3.6m のこと
  else mm = value;

  return Math.round(mm);
}

/**
 * 1つの文字列を mm に直す。寸法として使えなければ null。
 */
export function toMm(raw) {
  const mm = rawMm(raw);
  if (mm === null || mm < MIN_MM || mm > MAX_MM) return null;
  return mm;
}

/**
 * OCR の単語リストから、寸法の候補を読む順(上から下、左から右)に並べて返す。
 *
 * words: [{ text, confidence, bbox: { x0, y0, x1, y1 } }]
 */
export function parseNumbers(words, options = {}) {
  const minConf = options.minConf ?? 40;
  const rowHeight = options.rowHeight ?? 40;

  const found = [];
  for (const w of words || []) {
    const text = String(w?.text || '').trim();
    if (!text) continue;
    if ((w.confidence ?? 100) < minConf) continue;
    const truncated = looksTruncated(text);
    const mm = truncated ? rawMm(text) : toMm(text);
    if (mm === null) continue;
    const bbox = w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
    found.push({
      text,
      mm,
      // 頭が欠けている。このままでは使えないので、呼び出し側で読み直すか捨てる
      truncated,
      // 「CH=2400」のように天井高だと分かるものは、高さの候補として上に出す
      isHeight: CH_RE.test(text.slice(0, text.search(/\d/))),
      conf: Math.round(w.confidence ?? 0),
      bbox,
    });
  }

  found.sort((a, b) => {
    const ra = Math.floor(a.bbox.y0 / rowHeight);
    const rb = Math.floor(b.bbox.y0 / rowHeight);
    return ra !== rb ? ra - rb : a.bbox.x0 - b.bbox.x0;
  });

  return found.map((f, i) => ({ ...f, no: i + 1 }));
}

/** 同じ値が何度も出たときに、一覧を短くするためのまとめ */
export function uniqueValues(numbers) {
  const seen = new Map();
  for (const n of numbers) {
    if (!seen.has(n.mm)) seen.set(n.mm, { mm: n.mm, nos: [], isHeight: false });
    const e = seen.get(n.mm);
    e.nos.push(n.no);
    e.isHeight = e.isHeight || n.isHeight;
  }
  return [...seen.values()];
}

/**
 * 回した画像の上で見つけた枠を、元の写真の座標に戻す。
 *
 * deg は「元の写真を時計回りに何度回して読んだか」。
 * rotW / rotH は、回したあとの画像の幅と高さ。
 *   90°  : 元 (x, y) → 回転後 (H - y, x)。 縦書き(下から上へ読む JIS の書き方)が横になる
 *   270° : 元 (x, y) → 回転後 (y, W - x)。 上から下へ読む縦書き用
 */
export function unrotateBox(bbox, rotW, rotH, deg) {
  const { x0, y0, x1, y1 } = bbox;
  if (deg === 90) return { x0: y0, y0: rotW - x1, x1: y1, y1: rotW - x0 };
  if (deg === 270) return { x0: rotH - y1, y0: x0, x1: rotH - y0, y1: x1 };
  return { x0, y0, x1, y1 };
}

function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  if (inter === 0) return 0;
  const area = (r) => Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
  // 小さいほうの枠に対して、どれだけ重なっているか
  return inter / Math.min(area(a), area(b));
}

/**
 * 向きを変えて何回か読んだ結果をまとめる。
 * 同じ場所で見つかったものは、自信の高いほうだけ残す(値が違っても)。
 * 向きを間違えて読むと、でたらめな数字が低い自信で出てくるので、それを落とすため。
 */
export function mergeNumbers(found, options = {}) {
  const rowHeight = options.rowHeight ?? 40;
  const minOverlap = options.minOverlap ?? 0.3;
  const kept = [];
  for (const f of [...found].sort((a, b) => b.conf - a.conf)) {
    if (kept.some((k) => overlap(k.bbox, f.bbox) >= minOverlap)) continue;
    kept.push(f);
  }
  kept.sort((a, b) => {
    const ra = Math.floor(a.bbox.y0 / rowHeight);
    const rb = Math.floor(b.bbox.y0 / rowHeight);
    return ra !== rb ? ra - rb : a.bbox.x0 - b.bbox.x0;
  });
  return kept.map((k, i) => ({ ...k, no: i + 1 }));
}
