/**
 * OCR に渡す前の、写真の下ごしらえ(ブラウザの canvas で動く)。
 *
 * 現場の写真は、片側に影が落ちていたり、紙が黄ばんでいたり、インクが薄かったりする。
 * そのままだと数字と紙の区別がつかない場所ができるので、紙の明るさを場所ごとに
 * 見積もって割り算し、どこでも「白い紙に黒い字」に近づける。
 */

/** dataURL → canvas */
export async function toCanvas(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/**
 * 影・黄ばみをならして、白黒のはっきりした灰色画像にする。
 *
 * 1. 灰色にする
 * 2. 画像を升目に切り、升目ごとの「いちばん明るいところ」を紙の明るさとみなす
 *    (字の線は升目より細いので、升目の最大値はほぼ必ず紙)
 * 3. 紙の明るさをなめらかにつないで、各点をそれで割る → 影が消える
 * 4. いちばん濃い字が真っ黒、紙が真っ白になるように伸ばす
 */
export function normalizeIllumination(src) {
  const W = src.width;
  const H = src.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const p = img.data;
  const N = W * H;

  const g = new Float32Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) g[i] = 0.299 * p[j] + 0.587 * p[j + 1] + 0.114 * p[j + 2];

  // 2. 升目ごとの紙の明るさ
  const B = Math.max(16, Math.round(Math.max(W, H) / 40));
  const bw = Math.ceil(W / B);
  const bh = Math.ceil(H / B);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let m = 0;
      const yEnd = Math.min(H, (by + 1) * B);
      const xEnd = Math.min(W, (bx + 1) * B);
      for (let y = by * B; y < yEnd; y++) {
        const row = y * W;
        for (let x = bx * B; x < xEnd; x++) if (g[row + x] > m) m = g[row + x];
      }
      bg[by * bw + bx] = m;
    }
  }
  // 升目の境目が出ないよう、となり同士で軽くならす
  const sm = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = by + dy;
          const xx = bx + dx;
          if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += bg[yy * bw + xx]; n++; }
        }
      }
      sm[by * bw + bx] = s / n;
    }
  }

  // 3. 各点を、その場所の紙の明るさで割る(升目の中心どうしを直線でつなぐ)
  const r = new Float32Array(N);
  const hist = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / B - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const top = sm[y0 * bw + x0] * (1 - tx) + sm[y0 * bw + x1] * tx;
      const bot = sm[y1 * bw + x0] * (1 - tx) + sm[y1 * bw + x1] * tx;
      const paper = Math.max(8, top * (1 - ty) + bot * ty);
      const v = Math.min(1, g[y * W + x] / paper);
      r[y * W + x] = v;
      hist[Math.min(255, Math.round(v * 255))]++;
    }
  }

  // 4. いちばん濃いところ(下から 0.3%)を黒に、紙(0.92 以上)を白に
  let acc = 0;
  let lo = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > N * 0.003) break; }
  const low = lo / 255;
  const high = 0.92;
  const span = Math.max(0.05, high - low);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const v = Math.max(0, Math.min(255, ((r[i] - low) / span) * 255));
    p[j] = p[j + 1] = p[j + 2] = v;
    p[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** 時計回りに deg 度(90 か 270)回した canvas を返す */
export function rotateCanvas(src, deg) {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const x = c.getContext('2d');
  if (deg === 90) {
    x.translate(src.height, 0);
    x.rotate(Math.PI / 2);
  } else {
    x.translate(0, src.width);
    x.rotate(-Math.PI / 2);
  }
  x.drawImage(src, 0, 0);
  return c;
}
