/**
 * 送られてきた写真の検査と、返ってきた拾い出しの整形。
 * サーバーを立ち上げずに試せるよう、通信から切り離してある。
 */

export const MAX_IMAGES = 8;
export const OK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const KINDS = ['wall', 'ceiling', 'niche', 'cove'];

/** ブラウザから来た画像を、Claude に渡せる形に直す。おかしければ例外。 */
export function validateImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw Object.assign(new Error('しゃしんが ありません'), { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    throw Object.assign(new Error(`しゃしんは ${MAX_IMAGES} まいまでです`), { status: 400 });
  }
  return images.map((img) => {
    const mediaType = String(img?.media_type || 'image/jpeg');
    if (!OK_TYPES.has(mediaType)) {
      throw Object.assign(new Error(`あつかえない しゃしんの しゅるいです (${mediaType})`), { status: 400 });
    }
    const data = String(img?.data || '');
    if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 200))) {
      throw Object.assign(new Error('しゃしんの なかみが こわれています'), { status: 400 });
    }
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: data.replace(/\s+/g, '') } };
  });
}

/**
 * AI の答えを、そのまま信用せずに整える。
 * ・ありえない数字(負・桁あふれ)は 0 にする
 * ・知らない種類は wall にする
 * ・長い文字列は切る
 */
export function normalize(input) {
  const src = input && typeof input === 'object' ? input : {};
  const num = (v) => (Number.isFinite(+v) && +v >= 0 && +v < 100000 ? Math.round(+v) : 0);
  const items = (Array.isArray(src.items) ? src.items : []).map((it) => ({
    name: String(it?.name || '').slice(0, 60),
    kind: KINDS.includes(it?.kind) ? it.kind : 'wall',
    width_mm: num(it?.width_mm),
    height_mm: num(it?.height_mm),
    depth_mm: num(it?.depth_mm),
    length_mm: num(it?.length_mm),
    develop_mm: num(it?.develop_mm),
    count: Math.min(99, Math.max(1, Math.round(+it?.count) || 1)),
    confidence: ['high', 'medium', 'low'].includes(it?.confidence) ? it.confidence : 'low',
    source_text: String(it?.source_text || '').slice(0, 200),
  }));
  return {
    title: String(src.title || '').slice(0, 80),
    unit_guess: String(src.unit_guess || 'unknown'),
    note: String(src.note || '').slice(0, 500),
    items,
  };
}
