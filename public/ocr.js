/**
 * 写真から数字を読む(ブラウザの中だけで完結)。
 *
 * Tesseract の一式は public/vendor/tesseract/ に置いてあるので、
 * どこのサーバーにも問い合わせないし、お金もかからない。
 * 一度使えば Service Worker がキャッシュするので、次からは電波が無くても動く。
 */
import { parseNumbers } from './ocr-parse.js';

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
 * 写真を順番に読んで、寸法の候補を返す。
 * photos: [{ dataUrl, width, height }]
 * 返り値: [{ photoIndex, no, mm, text, bbox, isHeight, conf }]
 */
export async function readNumbers(photos, onProgress) {
  const worker = await getWorker(onProgress);
  const all = [];
  for (let i = 0; i < photos.length; i++) {
    if (onProgress) onProgress(`${i + 1}まいめ を よんでいます`, 0);
    const { data } = await worker.recognize(photos[i].dataUrl, {}, { blocks: true });
    const words = flattenWords(data.blocks);
    // 行の高さは写真の大きさに合わせる(小さい写真で行がまとまりすぎないように)
    const rowHeight = Math.max(20, Math.round((photos[i].height || 1200) / 30));
    for (const n of parseNumbers(words, { rowHeight })) {
      all.push({ ...n, photoIndex: i, no: all.length + 1 });
    }
  }
  return all;
}

/** 使い終わったら片づける(メモリの少ない端末のため) */
export async function release() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  if (w) await w.terminate().catch(() => {});
}
