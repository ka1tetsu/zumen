/**
 * OCR に使う Tesseract.js の一式を public/vendor/ に取り込む。
 *
 * ネットにつながらない現場でも動くよう、CDN からではなく
 * アプリと同じ場所から配る。中身を新しくしたいときは:
 *   npm install && npm run vendor
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dest = path.join(root, 'public', 'vendor', 'tesseract');

const FILES = [
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // SIMD が使える端末用と、使えない古い端末用。実際に落ちてくるのはどちらか一方だけ。
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  // 数字しか読まないので、英語の学習データだけでよい(日本語は 3 倍以上重い)
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];

fs.mkdirSync(path.join(dest, 'lang'), { recursive: true });
let total = 0;
for (const [from, to] of FILES) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.error(`みつかりません: ${from}\n  先に npm install を実行してください。`);
    process.exit(1);
  }
  const out = path.join(dest, to);
  fs.copyFileSync(src, out);
  const size = fs.statSync(out).size;
  total += size;
  console.log(`${to.padEnd(36)} ${(size / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`ごうけい ${(total / 1024 / 1024).toFixed(2)} MB → public/vendor/tesseract/`);

const versions = {
  'tesseract.js': JSON.parse(fs.readFileSync(path.join(root, 'node_modules/tesseract.js/package.json'))).version,
  'tesseract.js-core': JSON.parse(fs.readFileSync(path.join(root, 'node_modules/tesseract.js-core/package.json'))).version,
  '@tesseract.js-data/eng': JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@tesseract.js-data/eng/package.json'))).version,
};
fs.writeFileSync(path.join(dest, 'VERSIONS.json'), `${JSON.stringify(versions, null, 2)}\n`);
console.log('VERSIONS.json:', JSON.stringify(versions));
