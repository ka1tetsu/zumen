/**
 * 写真から数字を読む(ブラウザの中だけで完結)。
 *
 * Tesseract の一式は public/vendor/tesseract/ に置いてあるので、
 * どこのサーバーにも問い合わせないし、お金もかからない。
 * 一度使えば Service Worker がキャッシュするので、次からは電波が無くても動く。
 */
import { mergeNumbers, parseNumbers, toMm, unrotateBox } from './ocr-parse.js';
import { normalizeIllumination, rotateCanvas, toCanvas } from './ocr-image.js';

const BASE = new URL('vendor/tesseract/', document.baseURI).href;

/** WebAssembly の SIMD が使えるか。使えれば速いほうの中身を読む。 */
function hasSimd() {
  try {
    return WebAssembly.validate(Uint8Array.of(
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ));
  } catch {
    return false;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('よみとりの しくみを よみこめませんでした'));
    document.head.append(s);
  });
}

let workerPromise = null;

function getWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    await loadScript(`${BASE}tesseract.min.js`);
    const core = hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
    const worker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: `${BASE}worker.min.js`,
      corePath: `${BASE}${core}`,
      langPath: `${BASE}lang`,
      gzip: true,
      logger: (m) => {
        if (!onProgress) return;
        if (m.status === 'recognizing text') onProgress('よんでいます', m.progress);
        else onProgress('したく しています', m.progress);
      },
    });
    // 図面は文字が散らばっているので、ふつうの文章あつかいでは拾えない。
    // SPARSE_TEXT(11) にすると、紙のあちこちにある数字を見つけてくれる。
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

function flattenWords(blocks) {
  const words = [];
  for (const b of blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        for (const w of l.words || []) words.push(w);
      }
    }
  }
  return words;
}

/**
 * 頭の欠けた数字(「,640」)を、まわりを広めに切り出して 1 行として読み直す。
 * 寸法線に字がくっついていると、ページ全体を読むときには先頭の字が落ちるが、
 * 1 行だけを読ませると拾えることが多い(3,640 / 縦書きの 2,400 で確認済み)。
 * 取り戻せなければ null(= 捨てる。「640」を出すと 3,640 の図面を見ている人が迷う)。
 */
async function rereadTruncated(worker, canvas, n) {
  const b = n.bbox;
  const h = Math.max(8, b.y1 - b.y0);
  const left = Math.max(0, Math.round(b.x0 - h * 2.5));
  const top = Math.max(0, Math.round(b.y0 - h * 0.6));
  const rect = {
    left,
    top,
    width: Math.min(canvas.width - left, Math.round(b.x1 - left + h * 1.0)),
    height: Math.min(canvas.height - top, Math.round(h * 2.2)),
  };
  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789,.' });
  try {
    const { data } = await worker.recognize(canvas, { rectangle: rect }, { blocks: true });
    const text = String(data.text || '').trim();
    const mm = toMm(text);
    const tail = String(n.mm);
    // 読み直した数字が「欠けていた数字で終わる、もっと長い数字」なら正解とみなす
    if (mm === null || !String(mm).endsWith(tail) || String(mm).length <= tail.length) return null;
    const words = flattenWords(data.blocks).filter((w) => /\d/.test(w.text));
    const box = words.length
      ? {
        x0: Math.min(...words.map((w) => w.bbox.x0)),
        y0: Math.min(...words.map((w) => w.bbox.y0)),
        x1: Math.max(...words.map((w) => w.bbox.x1)),
        y1: Math.max(...words.map((w) => w.bbox.y1)),
      }
      : { ...b, x0: Math.max(0, b.x0 - h * 1.2) };
    return { ...n, mm, text, conf: Math.round(data.confidence ?? n.conf), bbox: box, truncated: false };
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
  }
}

/**
 * 写真を順番に読んで、寸法の候補を返す。
 * photos: [{ dataUrl, width, height }]
 * 返り値: [{ photoIndex, no, mm, text, bbox, isHeight, conf, rotated }]
 *
 * options (ふだんは既定のままでよい。精度の測定のために切り替えられるようにしてある)
 *   normalize  影・黄ばみをならす            既定 true
 *   rotations  何度回して読むか               既定 [0, 90]
 *              0 = そのまま(横書き)、90 = JIS の縦書き(下から上へ読む)。
 *              270 を足すと上から下へ読む縦書きも拾うが、時間が 1.5 倍になる
 */
export async function readNumbers(photos, onProgress, options = {}) {
  const normalize = options.normalize ?? true;
  const rotations = options.rotations ?? [0, 90];

  const worker = await getWorker(onProgress);
  const all = [];
  const passes = photos.length * rotations.length;
  let done = 0;
  for (let i = 0; i < photos.length; i++) {
    let base = await toCanvas(photos[i].dataUrl);
    if (normalize) base = normalizeIllumination(base);

    const found = [];
    for (const deg of rotations) {
      if (onProgress) {
        const what = deg === 0 ? 'よこの 数字' : 'たての 数字';
        onProgress(`${photos.length > 1 ? `${i + 1}まいめ の ` : ''}${what}を よんでいます`, done / passes);
      }
      const canvas = deg === 0 ? base : rotateCanvas(base, deg);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words = flattenWords(data.blocks);
      for (let n of parseNumbers(words, { rowHeight: 1 })) {
        if (n.truncated) {
          n = await rereadTruncated(worker, canvas, n);
          if (!n) continue;
        }
        found.push({
          ...n,
          bbox: unrotateBox(n.bbox, canvas.width, canvas.height, deg),
          rotated: deg !== 0,
        });
      }
      done++;
    }
    // 行の高さは写真の大きさに合わせる(小さい写真で行がまとまりすぎないように)
    const rowHeight = Math.max(20, Math.round((photos[i].height || 1200) / 30));
    for (const n of mergeNumbers(found, { rowHeight })) {
      all.push({ ...n, photoIndex: i, no: all.length + 1 });
    }
  }
  if (onProgress) onProgress('できました', 1);
  return all;
}

/** 使い終わったら片づける(メモリの少ない端末のため) */
export async function release() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  if (w) await w.terminate().catch(() => {});
}
