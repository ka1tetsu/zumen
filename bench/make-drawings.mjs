// 現場で撮った図面写真に近いテスト画像を作る。正解の寸法も一緒に書き出す。
// 使いかた: node bench/make-drawings.mjs <出力先>   (ふつうは bench/run.mjs から呼ばれる)
import fs from 'node:fs';
import { chromium } from './playwright.mjs';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();

const VARIANTS = {
  clean: { font: 34, skew: 0, rot: 0, shadow: 0, ink: '#000', paper: '#fff', blur: 0, noise: 0, q: 0.92 },
  photo: { font: 34, skew: 0.04, rot: 0, shadow: 0.35, ink: '#333', paper: '#f3eddc', blur: 0.8, noise: 18, q: 0.7 },
  far:   { font: 22, skew: 0.04, rot: 0, shadow: 0.35, ink: '#333', paper: '#f3eddc', blur: 0.8, noise: 18, q: 0.7 },
  tilt:  { font: 34, skew: 0.03, rot: 4, shadow: 0.3, ink: '#333', paper: '#f3eddc', blur: 0.8, noise: 18, q: 0.7 },
  dark:  { font: 34, skew: 0.02, rot: 0, shadow: 0.7, ink: '#555', paper: '#e8e2d0', blur: 1.0, noise: 24, q: 0.65 },
};

for (const [name, v] of Object.entries(VARIANTS)) {
  const b64 = await page.evaluate((v) => {
    const W = 2400, H = 1700;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = v.paper; x.fillRect(0, 0, W, H);
    x.save();
    x.translate(W / 2, H / 2); x.rotate((v.rot * Math.PI) / 180); x.transform(1, v.skew, -v.skew, 1, 0, 0);
    x.translate(-W / 2, -H / 2);
    if (v.blur) x.filter = `blur(${v.blur}px)`;
    x.strokeStyle = v.ink; x.fillStyle = v.ink; x.lineWidth = 3;
    const f = v.font, S = f / 34;               // 文字が小さいときは図面全体も小さく(遠くから撮った)
    const ox = W / 2 - 1100 * S, oy = H / 2 - 700 * S;
    const X = (n) => ox + n * S, Y = (n) => oy + n * S;
    const hText = (t, cx, cy) => { x.font = `${f}px sans-serif`; x.textAlign = 'center'; x.fillText(t, X(cx), Y(cy)); };
    const vText = (t, cx, cy) => {               // JIS: 縦の寸法は右から読めるように(反時計回りに90°)
      x.save(); x.translate(X(cx), Y(cy)); x.rotate(-Math.PI / 2);
      x.font = `${f}px sans-serif`; x.textAlign = 'center'; x.fillText(t, 0, 0); x.restore();
    };
    const line = (a, b, c2, d) => { x.beginPath(); x.moveTo(X(a), Y(b)); x.lineTo(X(c2), Y(d)); x.stroke(); };
    // 壁と窓とニッチ
    x.strokeRect(X(300), Y(250), 1640 * S, 1080 * S);
    x.strokeRect(X(710), Y(610), 820 * S, 540 * S);
    x.strokeRect(X(1700), Y(560), 200 * S, 270 * S);
    // 横の寸法線(下)
    line(300, 1420, 1940, 1420); line(300, 1500, 1940, 1500);
    hText('910', 505, 1405); hText('1,820', 1120, 1405); hText('910', 1735, 1405);
    hText('3,640', 1120, 1485);
    hText('450', 1800, 540);
    // 縦の寸法線(左・窓の右)
    line(200, 250, 200, 1330); vText('2,400', 185, 790);
    line(1600, 610, 1600, 1150); vText('1,200', 1585, 880);
    line(1600, 1150, 1600, 1330); vText('900', 1585, 1240);
    // 寸法でない文字
    x.font = `${f}px sans-serif`; x.textAlign = 'left';
    x.fillText('CH=2,400', X(300), Y(200));
    x.fillText('展開図 A面  1/50', X(1450), Y(200));
    x.restore();
    x.filter = 'none';
    // 影(片側が暗い)
    if (v.shadow) {
      const g = x.createLinearGradient(0, 0, W, H * 0.6);
      g.addColorStop(0, `rgba(0,0,0,${v.shadow})`); g.addColorStop(0.55, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    // ざらつき。毎回同じ画像になるよう、乱数の種を固定する(測定の前後比較のため)
    if (v.noise) {
      let seed = 12345;
      const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const d = x.getImageData(0, 0, W, H); const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const n = (rand() - 0.5) * v.noise;
        p[i] += n; p[i + 1] += n; p[i + 2] += n;
      }
      x.putImageData(d, 0, 0);
    }
    return c.toDataURL('image/jpeg', v.q).split(',')[1];
  }, v);
  fs.writeFileSync(`${out}/${name}.jpg`, Buffer.from(b64, 'base64'));
}
// 正解: 横 910, 1820, 910, 3640, 450, CH 2400 / 縦 2400, 1200, 900
fs.writeFileSync(`${out}/truth.json`, JSON.stringify({
  all: [910, 1820, 910, 3640, 450, 2400, 2400, 1200, 900],
  vertical: [2400, 1200, 900],
}));
await browser.close();
console.log('作った:', Object.keys(VARIANTS).join(', '));
