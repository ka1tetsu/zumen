/**
 * 画面まわり。むずかしい計算は engine.js にまかせて、ここは
 * 「大きく・すくなく・まよわせない」ことだけを考えて書いてある。
 */
import {
  DEFAULTS, KIND_LABELS, MATERIALS,
  calcProject, defaultProduct, emptyProject, findMaterial, formatOrderText, mmToM,
} from './engine.js';
import { readNumbers } from './ocr.js';

/* ------------------------------------------------------------------ 保存 */
const KEY = { project: 'kurosu.project', history: 'kurosu.history', pref: 'kurosu.pref' };

const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 容量オーバーは黙って無視 */ } };

let project = load(KEY.project, null) || emptyProject();
if (!project.options) project.options = { ...DEFAULTS };
project.options = { ...DEFAULTS, ...project.options };
if (!project.products || !project.products.length) project.products = [defaultProduct()];

let pref = load(KEY.pref, { fontsize: 'l', voice: true });
let photos = [];          // { dataUrl, mediaType, base64 }
let result = null;
let editingId = null;
let viewerPhoto = null;   // 写真を大きく見ているときは、その写真の番号

const persist = () => save(KEY.project, project);

/* ------------------------------------------------------------- 小道具 */
/** 一覧の札に出す、みじかい名前 */
const SHORT_LABELS = { wall: 'かべ', ceiling: '天井', niche: 'かざり棚', cove: '照明' };

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 9);
const nz = (v) => (Number.isFinite(+v) ? +v : 0);

let toastTimer = null;
/**
 * 画面の下に短い知らせを出す。action を渡すと大きなボタンが付く(「もとに もどす」など)。
 * ボタン付きのときは、押す間があるよう長めに出しておく。
 */
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = '';
  t.append(el('span', null, msg));
  if (action) {
    const b = el('button', 'toast-btn', action.label);
    b.addEventListener('click', () => {
      t.hidden = true;
      clearTimeout(toastTimer);
      action.onClick();
    });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 2600);
}

function speak(text) {
  if (!pref.voice || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch { /* 読み上げができない端末では黙って何もしない */ }
}

/* -------------------------------------------------------------- 画面 */
const SCREENS = {
  home:     { title: 'クロスけいさん機', back: false },
  photo:    { title: 'しゃしんで はかる', back: true },
  pick:     { title: 'すうじを えらぶ', back: true },
  items:    { title: 'はかる ところ', back: true },
  form:     { title: 'すうじを いれる', back: true },
  result:   { title: 'けっか', back: true },
  history:  { title: 'きろく', back: true },
  settings: { title: 'せってい', back: true },
};
let current = 'home';

function go(name) {
  if (viewerPhoto !== null) closeViewer();
  // 前の画面の知らせ(「もとに もどす」付きなど)を、別の画面に持ちこまない
  $('#toast').hidden = true;
  clearTimeout(toastTimer);
  current = name;
  for (const k of Object.keys(SCREENS)) {
    const s = document.getElementById('s-' + k);
    if (s) s.hidden = k !== name;
  }
  $('#barTitle').textContent = SCREENS[name].title;
  $('#backBtn').hidden = !SCREENS[name].back;
  window.scrollTo(0, 0);
  if (name === 'pick') renderPick();
  if (name === 'items') renderItems();
  if (name === 'result') renderResult();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
});
$('#backBtn').addEventListener('click', () => {
  if (current === 'form') go('items');
  else if (current === 'result') go('items');
  else if (current === 'pick') go('photo');
  else go('home');
});

/* ------------------------------------------------------- 文字の大きさ */
function applyPref() {
  document.body.dataset.fontsize = pref.fontsize || 'l';
  save(KEY.pref, pref);
}
$('#fontBtn').addEventListener('click', () => {
  const order = ['l', 'xl', 'xxl'];
  pref.fontsize = order[(order.indexOf(pref.fontsize || 'l') + 1) % order.length];
  applyPref();
  toast(pref.fontsize === 'l' ? 'ふつうの 大きさ' : pref.fontsize === 'xl' ? '大きい 文字' : 'とても 大きい 文字');
});

/* =================================================================== 写真 */
// 写真はここまで縮める。1600px だと A3 を丸ごと撮ったときの寸法の字が潰れて読めない。
// 拡大して読んでも、遅くなるわりに当たりはほとんど増えなかった(試験で確認)。
const MAX_PX = 2400;

function shrink(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('しゃしんを よみこめませんでした'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('しゃしんを ひらけませんでした'));
      img.onload = () => {
        const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = c.toDataURL('image/jpeg', 0.85);
        resolve({ dataUrl, width: w, height: h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addFiles(list) {
  for (const f of list) {
    if (!f.type.startsWith('image/')) continue;
    try { photos.push(await shrink(f)); }
    catch (err) { toast(err.message); }
  }
  renderShots();
}
$('#camInput').addEventListener('change', (e) => addFiles([...e.target.files]).then(() => { e.target.value = ''; }));
$('#fileInput').addEventListener('change', (e) => addFiles([...e.target.files]).then(() => { e.target.value = ''; }));

function renderShots() {
  const box = $('#shots');
  box.innerHTML = '';
  photos.forEach((p, i) => {
    const d = el('div', 'shot');
    const img = el('img');
    img.src = p.dataUrl;
    img.alt = `ずめん ${i + 1}`;
    const rm = el('button', null, '✕');
    rm.title = 'けす';
    rm.addEventListener('click', () => { photos.splice(i, 1); renderShots(); });
    d.append(img, rm);
    box.append(d);
  });
  $('#readBtn').hidden = photos.length === 0;
}

$('#readBtn').addEventListener('click', runOcr);

/** 写真の中の数字を、この端末だけで読む */
async function runOcr() {
  const status = $('#readStatus');
  status.hidden = false;
  status.className = 'status';
  status.innerHTML = '<span class="spin"></span> よみとる したくを しています…';
  $('#readBtn').disabled = true;
  try {
    const numbers = await readNumbers(photos, (label, progress) => {
      const pct = Math.round((progress || 0) * 100);
      status.innerHTML = `<span class="spin"></span> ${label}… ${pct}%`;
    });
    if (numbers.length === 0) {
      status.className = 'status err';
      status.innerHTML = 'すうじが 見つかりませんでした。<br>'
        + 'もっと 近くで、まっすぐ、明るいところで とりなおすと よみやすくなります。<br><br>'
        + 'または「じぶんで いれる」で おねがいします。';
      return;
    }
    status.hidden = true;
    pick = { numbers, kind: 'wall', step: 0, values: [], added: 0 };
    speak(`${numbers.length}この すうじが 見つかりました。`);
    go('pick');
  } catch (err) {
    status.className = 'status err';
    status.innerHTML = `よみとれませんでした。<br>${String(err.message || err)}<br><br>`
      + 'おそれいりますが「じぶんで いれる」で おねがいします。';
  } finally {
    $('#readBtn').disabled = false;
  }
}

/* ====================================================== すうじを えらぶ */
let pick = { numbers: [], kind: 'wall', step: 0, values: [], added: 0 };

/** 種類ごとに、何をどの順番で聞くか */
const PICK_STEPS = {
  wall: [
    { key: 'widthMm', ask: 'かべの よこはば', hint: 'かべの 長い方向の ながさ' },
    { key: 'heightMm', ask: 'かべの たかさ', hint: '天井高。ふつうは 2400 ぐらい', height: true },
  ],
  ceiling: [
    { key: 'widthMm', ask: 'へやの よこはば', hint: '' },
    { key: 'heightMm', ask: 'へやの おくゆき', hint: '' },
  ],
  niche: [
    { key: 'widthMm', ask: 'かざり棚の よこはば', hint: '開口の よこ' },
    { key: 'heightMm', ask: 'かざり棚の たかさ', hint: '開口の たて' },
    { key: 'depthMm', ask: 'かざり棚の おくゆき', hint: 'ふところの ふかさ' },
  ],
  cove: [
    { key: 'lengthMm', ask: '間接照明の ながさ', hint: '照明が 通っている ながさ' },
  ],
};

const PICK_KINDS = [['wall', 'かべ'], ['ceiling', '天井'], ['niche', 'かざり棚'], ['cove', '照明']];
const QUICK_HEIGHTS = [2400, 2500];

/** いま聞いていること。一覧画面と、写真を大きく見る画面の両方で使う */
function pickQuestion() {
  const step = PICK_STEPS[pick.kind][pick.step];
  const maru = ['①', '②', '③'][pick.step] || '';
  return { step, main: `${maru} ${step.ask} は どれですか?` };
}

function renderPick() {
  // 何を足すか
  const kinds = $('#pickKinds');
  kinds.innerHTML = '';
  for (const [kind, label] of PICK_KINDS) {
    const b = el('button', pick.kind === kind ? 'on' : null, label);
    b.addEventListener('click', () => {
      pick.kind = kind;
      pick.step = 0;
      pick.values = [];
      renderPick();
    });
    kinds.append(b);
  }

  const { step, main } = pickQuestion();

  const ask = $('#pickAsk');
  ask.innerHTML = '';
  ask.append(document.createTextNode(main));
  ask.append(el('small', null, step.hint
    ? `${step.hint} / 下の 数字を タップ`
    : '下の 数字を えらんでください'));
  $('#pickBack').hidden = pick.step === 0;

  // 写真(読めた数字に わくを出す)
  const box = $('#pickPhotos');
  box.innerHTML = '';
  if (pick.added > 0) {
    box.append(el('div', 'pickcount', `いま ${pick.added} か所 たしました`));
  }
  photos.forEach((p, i) => {
    const nums = pick.numbers.filter((n) => n.photoIndex === i);
    if (!nums.length) return;
    // 小さい写真の枠は、指でねらうには小さすぎる。ここは「見る」だけにして、
    // 写真をタップしたら大きく見る画面を開く
    const wrap = el('div', 'pickphoto');
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', 'しゃしんを 大きく みる');
    const img = el('img');
    img.src = p.dataUrl;
    img.alt = `ずめん ${i + 1}`;
    wrap.append(img);
    for (const n of nums) wrap.append(numberBox(n, p, 'box'));
    wrap.addEventListener('click', () => openViewer(i));
    box.append(wrap);
  });

  // 数字のボタン
  const grid = $('#pickNums');
  grid.innerHTML = '';
  const addBtn = (label, mm, no, quick, hint) => {
    const b = el('button', 'numbtn' + (quick ? ' quick' : ''));
    b.append(el('span', 'no', no));
    b.append(document.createTextNode(label));
    b.append(el('span', 'u', 'mm'));
    if (hint) b.append(el('span', 'hint', hint));
    b.addEventListener('click', () => choosePick(mm));
    grid.append(b);
  };
  if (step.height) {
    for (const h of QUICK_HEIGHTS) addBtn(String(h), h, '✓', true, 'よくある たかさ');
  }
  for (const n of pick.numbers) {
    addBtn(String(n.mm), n.mm, String(n.no), false, n.isHeight ? '天井高(CH)' : '');
  }
}

function choosePick(mm) {
  const steps = PICK_STEPS[pick.kind];
  pick.values[pick.step] = mm;
  if (pick.step < steps.length - 1) {
    pick.step += 1;
    renderPick();
    if (viewerPhoto !== null) { renderViewer(); centerOnLikely(); }
    toast(`${mm} mm を えらびました`);
    speak(`${mm}。つぎは、${steps[pick.step].ask} です。`);
    return;
  }
  const it = newItem(pick.kind);
  steps.forEach((st, i) => { it[st.key] = pick.values[i]; });
  project.items.push(it);
  persist();
  pick.added += 1;
  pick.step = 0;
  pick.values = [];
  if (pick.kind === 'cove') {
    // 展開幅は図面に出ていないことが多いので、そのまま入力画面へ
    // 画面を移ってから知らせる(go() は前の画面の知らせを消すため)
    openForm(it.id);
    toast('ながさを 入れました。つぎは てんかいはば です');
    return;
  }
  renderPick();
  if (viewerPhoto !== null) { renderViewer(); centerOnLikely(); }
  toast(`「${it.name}」を たしました`, {
    label: 'もとに もどす',
    onClick: () => {
      project.items = project.items.filter((x) => x.id !== it.id);
      pick.added = Math.max(0, pick.added - 1);
      persist();
      renderPick();
      if (viewerPhoto !== null) renderViewer();
    },
  });
}

$('#pickBack').addEventListener('click', () => {
  if (pick.step === 0) return;
  pick.step -= 1;
  pick.values.length = pick.step;
  renderPick();
  if (viewerPhoto !== null) renderViewer();
  speak(`${PICK_STEPS[pick.kind][pick.step].ask} に もどりました。`);
});
$('#pickManual').addEventListener('click', () => go('items'));
$('#pickDone').addEventListener('click', () => go('items'));
$('#pickZoom').addEventListener('click', () => {
  const first = pick.numbers.length ? pick.numbers[0].photoIndex : 0;
  openViewer(first);
});

/** 読めた数字の枠。写真の大きさが変わっても位置がずれないよう % で置く */
function numberBox(n, p, cls) {
  const b = el('div', cls);
  b.style.left = `${(n.bbox.x0 / p.width) * 100}%`;
  b.style.top = `${(n.bbox.y0 / p.height) * 100}%`;
  b.style.width = `${((n.bbox.x1 - n.bbox.x0) / p.width) * 100}%`;
  b.style.height = `${((n.bbox.y1 - n.bbox.y0) / p.height) * 100}%`;
  b.append(el('b', null, String(n.no)));
  return b;
}

/* ------------------------------------------ 写真を大きく見て、数字を直接えらぶ */

function openViewer(photoIndex) {
  if (!photos[photoIndex]) return;
  viewerPhoto = photoIndex;
  $('#viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  renderViewer();
  centerOnLikely();
}

/**
 * いま聞いていることの、いちばん有力な候補を画面の真ん中に出す。
 * 図面の寸法は外まわりに並ぶので、ただ真ん中を出すと何もない壁しか映らない。
 * ・幅、長さ …… 横書きのうち一番大きい数字(全体の幅であることが多い)
 * ・高さ、奥行き … 縦書きのうち一番大きい数字。無ければ CH=… 、それも無ければ一番大きい数字
 * 場所を見せるだけで、選ぶのは人。
 */
function centerOnLikely() {
  if (viewerPhoto === null) return;
  const p = photos[viewerPhoto];
  const nums = pick.numbers.filter((n) => n.photoIndex === viewerPhoto);
  if (!nums.length) return;
  const { step } = pickQuestion();
  const biggest = (list) => list.reduce((a, b) => (b.mm > a.mm ? b : a), list[0]);
  let target;
  if (step.key === 'widthMm' || step.key === 'lengthMm') {
    const flat = nums.filter((n) => !n.rotated && !n.isHeight);
    target = biggest(flat.length ? flat : nums);
  } else {
    const tall = nums.filter((n) => n.rotated);
    const ch = nums.filter((n) => n.isHeight);
    target = biggest(tall.length ? tall : ch.length ? ch : nums);
  }
  const body = $('#viewerBody');
  const k = viewerWidth(p) / p.width;
  body.scrollLeft = ((target.bbox.x0 + target.bbox.x1) / 2) * k - body.clientWidth / 2;
  body.scrollTop = ((target.bbox.y0 + target.bbox.y1) / 2) * k - body.clientHeight / 2;
}

function closeViewer() {
  viewerPhoto = null;
  $('#viewer').hidden = true;
  document.body.style.overflow = '';
}

function renderViewer() {
  const p = photos[viewerPhoto];
  const { step, main } = pickQuestion();
  const ask = $('#viewerAsk');
  ask.innerHTML = '';
  ask.append(document.createTextNode(main));
  ask.append(el('small', null, step.hint ? `${step.hint} / 赤い 数字を タップ` : '赤い 数字を タップ'));

  const body = $('#viewerBody');
  const keepX = body.scrollLeft;
  const keepY = body.scrollTop;
  body.innerHTML = '';
  // 画面の何倍の幅で出すか。3.5 倍で、図面の寸法の字が老眼でも読める大きさになる
  const wrap = el('div', 'viewer-img');
  wrap.style.width = `${viewerWidth(p)}px`;
  $('#zoomIn').disabled = viewerZoom >= ZOOMS.length - 1 || viewerWidth(p) >= p.width;
  $('#zoomOut').disabled = viewerZoom <= 0;
  const img = el('img');
  img.src = p.dataUrl;
  img.alt = 'ずめん';
  wrap.append(img);
  const chosen = new Set(pick.values);
  for (const n of pick.numbers.filter((x) => x.photoIndex === viewerPhoto)) {
    const b = numberBox(n, p, 'vbox' + (chosen.has(n.mm) ? ' chosen' : ''));
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', `${n.mm} ミリ`);
    b.addEventListener('click', (e) => { e.stopPropagation(); choosePick(n.mm); });
    wrap.append(b);
  }
  body.append(wrap);
  body.scrollLeft = keepX;
  body.scrollTop = keepY;
}

const ZOOMS = [1.5, 2.5, 3.5, 5];
let viewerZoom = 2; // 3.5 倍から始める

function viewerWidth(p) {
  return Math.min(p.width, Math.round(window.innerWidth * ZOOMS[viewerZoom]));
}

/** 大きさを変えても、いま見ているところが画面の真ん中に残るようにする */
function zoomViewer(delta) {
  const next = Math.max(0, Math.min(ZOOMS.length - 1, viewerZoom + delta));
  if (next === viewerZoom) return;
  const body = $('#viewerBody');
  const before = body.scrollWidth || 1;
  const cx = (body.scrollLeft + body.clientWidth / 2) / before;
  const cy = (body.scrollTop + body.clientHeight / 2) / (body.scrollHeight || 1);
  viewerZoom = next;
  renderViewer();
  body.scrollLeft = cx * body.scrollWidth - body.clientWidth / 2;
  body.scrollTop = cy * body.scrollHeight - body.clientHeight / 2;
}

$('#zoomIn').addEventListener('click', () => zoomViewer(+1));
$('#zoomOut').addEventListener('click', () => zoomViewer(-1));
$('#viewerClose').addEventListener('click', closeViewer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && viewerPhoto !== null) closeViewer(); });

/* ============================================================ 面の一覧 */
$('#projTitle').addEventListener('input', (e) => { project.title = e.target.value; persist(); });

function dimText(it) {
  const m = (v) => `${Math.round(nz(v))}`;
  if (it.kind === 'cove') return `ながさ ${m(it.lengthMm)} × てんかいはば ${m(it.developMm)} mm`;
  if (it.kind === 'niche') return `${m(it.widthMm)} × ${m(it.heightMm)} × おくゆき ${m(it.depthMm)} mm`;
  return `よこ ${m(it.widthMm)} × たて ${m(it.heightMm)} mm`;
}

function renderItems() {
  $('#projTitle').value = project.title || '';
  const box = $('#itemList');
  box.innerHTML = '';
  if (project.items.length === 0) {
    box.append(el('div', 'empty', 'したの ＋ボタンで、はかる ところを ふやしてください'));
  }
  for (const it of project.items) {
    const b = el('button', 'item');
    const hard = it.kind === 'niche' || it.kind === 'cove';
    b.append(el('span', 'tag' + (hard ? ' hard' : ''), SHORT_LABELS[it.kind] || KIND_LABELS[it.kind]));
    const body = el('div', 'body');
    const nm = el('div', 'nm', (it.name || KIND_LABELS[it.kind]) + (it.count > 1 ? `  ×${it.count}` : ''));
    if (it.conf) {
      const c = el('span', 'conf ' + it.conf, it.conf === 'low' ? ' 要かくにん ' : it.conf === 'medium' ? ' たぶん ' : ' よめた ');
      nm.append(' ', c);
    }
    body.append(nm, el('div', 'dim', dimText(it)));
    b.append(body, el('span', 'go', '✎'));
    b.addEventListener('click', () => openForm(it.id));
    box.append(b);
  }
}

document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.add;
    const it = newItem(kind);
    project.items.push(it);
    persist();
    openForm(it.id);
  });
});

function newItem(kind) {
  const base = { id: uid(), kind, productId: project.products[0].id, count: 1, openings: [] };
  const sameKind = project.items.filter((i) => i.kind === kind).length + 1;
  base.name = `${KIND_LABELS[kind]} ${sameKind}`;
  if (kind === 'wall') return { ...base, widthMm: 3600, heightMm: 2400 };
  if (kind === 'ceiling') return { ...base, widthMm: 3600, heightMm: 2700 };
  if (kind === 'niche') return { ...base, widthMm: 400, heightMm: 900, depthMm: 120, faces: { back: true, top: true, bottom: true, left: true, right: true } };
  return { ...base, lengthMm: 3600, developMm: 450, parts: { inner: 150, depth: 200, face: 100 } };
}

$('#calcBtn').addEventListener('click', () => {
  result = calcProject(project);
  go('result');
});

/* ========================================================= 1面の入力 */
function openForm(id) {
  editingId = id;
  const it = project.items.find((i) => i.id === id);
  if (!it) return go('items');
  $('#formTitle').textContent = (it.kind === 'niche' ? 'かざり棚(ニッチ)' : KIND_LABELS[it.kind]) + ' の すんぽう';
  const body = $('#formBody');
  body.innerHTML = '';

  body.append(textField('なまえ (へやや、かべの ばしょ)', it.name || '', (v) => { it.name = v; persist(); }));

  if (it.kind === 'wall' || it.kind === 'ceiling') {
    const isCeil = it.kind === 'ceiling';
    body.append(numField(isCeil ? 'へやの よこはば' : 'かべの よこはば', it.widthMm, 100, (v) => { it.widthMm = v; persist(); }));
    body.append(numField(isCeil ? 'へやの おくゆき' : 'かべの たかさ (天井高)', it.heightMm, 100, (v) => { it.heightMm = v; persist(); },
      isCeil ? '' : '天井高 2400 が いちばん おおいです'));
    body.append(countField(it));
    if (it.kind === 'wall') body.append(openingBlock(it));
  }

  if (it.kind === 'niche') {
    body.append(figureNiche());
    body.append(numField('① 開口の よこはば', it.widthMm, 50, (v) => { it.widthMm = v; persist(); }));
    body.append(numField('② 開口の たかさ', it.heightMm, 50, (v) => { it.heightMm = v; persist(); }));
    body.append(numField('③ おくゆき (ふところ)', it.depthMm, 10, (v) => { it.depthMm = v; persist(); }, '棚板の あつみは ふくめません'));
    body.append(facesBlock(it));
    body.append(countField(it));
  }

  if (it.kind === 'cove') {
    body.append(figureCove());
    body.append(numField('① ながさ (照明の 通り)', it.lengthMm, 100, (v) => { it.lengthMm = v; persist(); }));
    body.append(coveDevelopBlock(it));
    body.append(countField(it));
  }

  body.append(productPicker(it));
  go('form');
}

$('#formOk').addEventListener('click', () => go('items'));
$('#formDelete').addEventListener('click', () => {
  const at = project.items.findIndex((i) => i.id === editingId);
  if (at < 0) return go('items');
  const [gone] = project.items.splice(at, 1);
  persist();
  go('items');
  toast(`「${gone.name || KIND_LABELS[gone.kind]}」を けしました`, {
    label: 'もとに もどす',
    onClick: () => {
      project.items.splice(Math.min(at, project.items.length), 0, gone);
      persist();
      renderItems();
    },
  });
});

function textField(label, value, onChange) {
  const f = el('div', 'field');
  const l = el('label', null, label);
  const i = el('input');
  i.className = 'titleinput';
  i.value = value;
  i.addEventListener('input', () => onChange(i.value));
  f.append(l, i);
  return f;
}

/** mm で入れる数字。大きな ± ボタンと、m への読みかえを付ける。 */
function numField(label, value, step, onChange, hint) {
  const f = el('div', 'field');
  const l = el('label', null, label);
  if (hint) l.append(el('span', 'hint', '  ' + hint));
  const row = el('div', 'numrow');
  const input = el('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.value = String(Math.round(nz(value)));
  row.append(input, el('span', 'unit', 'mm'));
  const conv = el('div', 'conv');
  const show = () => { conv.textContent = `= ${mmToM(nz(input.value))} m`; };
  const fire = () => { show(); onChange(Math.max(0, Math.round(nz(input.value)))); };
  input.addEventListener('input', fire);
  const st = el('div', 'stepper');
  for (const d of [-step * 10, -step, +step, +step * 10]) {
    const b = el('button', null, (d > 0 ? '＋' : '−') + Math.abs(d));
    b.type = 'button';
    b.addEventListener('click', () => {
      input.value = String(Math.max(0, Math.round(nz(input.value) + d)));
      fire();
    });
    st.append(b);
  }
  show();
  f.append(l, row, conv, st);
  return f;
}

function countField(it) {
  const f = el('div', 'field');
  f.append(el('label', null, 'おなじ ところが いくつ ありますか'));
  const row = el('div', 'stepper');
  const disp = el('div', 'numrow');
  const input = el('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.value = String(it.count || 1);
  input.addEventListener('input', () => { it.count = Math.max(1, Math.round(nz(input.value)) || 1); persist(); });
  disp.append(input, el('span', 'unit', 'か所'));
  for (const d of [-1, +1]) {
    const b = el('button', null, d > 0 ? '＋1' : '−1');
    b.type = 'button';
    b.addEventListener('click', () => {
      it.count = Math.max(1, (it.count || 1) + d);
      input.value = String(it.count);
      persist();
    });
    row.append(b);
  }
  f.append(disp, row);
  return f;
}

function productPicker(it) {
  if (project.products.length < 2) return el('div');
  const f = el('div', 'field');
  f.append(el('label', null, 'つかう クロス'));
  const s = el('select');
  for (const p of project.products) {
    const o = el('option', null, p.name + (p.code ? ` (${p.code})` : ''));
    o.value = p.id;
    if (p.id === it.productId) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => { it.productId = s.value; persist(); });
  f.append(s);
  return f;
}

/* 窓・ドア */
function openingBlock(it) {
  const f = el('div', 'field');
  f.append(el('label', null, 'まど・ドア'));

  // 引く/引かないは設定と同じもの。ここでも切りかえられるようにしておく
  const t = el('label', 'toggle' + (project.options.deductOpenings ? ' on' : ''));
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!project.options.deductOpenings;
  cb.addEventListener('change', () => {
    project.options.deductOpenings = cb.checked;
    t.classList.toggle('on', cb.checked);
    persist();
  });
  t.append(cb, document.createTextNode('まど・ドアの ぶんを ひく'));
  f.append(t);
  f.append(el('div', 'hint', 'ふつうは ひきません。小さい まどは 切りしろで なくなるためです。'
    + ' 大きな はきだし窓などが あるときだけ ひいてください'));

  const list = el('div', 'openings');
  const draw = () => {
    list.innerHTML = '';
    const ops = it.openings || [];
    if (ops.length) list.append(figureOpening());
    ops.forEach((op, i) => {
      const card = el('div', 'opening');
      const head = el('div', 'ophead');
      head.append(el('b', null, op.name || `まど ${i + 1}`));
      const del = el('button', 'flat danger small', 'けす');
      del.type = 'button';
      del.addEventListener('click', () => {
        const [gone] = it.openings.splice(i, 1);
        persist();
        draw();
        toast(`「${gone.name}」を けしました`, {
          label: 'もとに もどす',
          onClick: () => { it.openings.splice(i, 0, gone); persist(); draw(); },
        });
      });
      head.append(del);
      card.append(head);
      card.append(numField('① まどの よこはば', op.w, 50, (v) => { op.w = v; persist(); }));
      card.append(numField('② まどの たかさ', op.h, 50, (v) => { op.h = v; persist(); }));
      card.append(numField('③ かべの ひだりはし から', op.x, 50, (v) => { op.x = v; persist(); }));
      card.append(numField('④ ゆか から まどの した まで', op.y, 50, (v) => { op.y = v; persist(); },
        'ドアなら 0'));
      list.append(card);
    });
  };
  draw();
  const add = el('button', 'add', '＋ まど・ドアを たす');
  add.type = 'button';
  add.addEventListener('click', () => {
    it.openings = it.openings || [];
    it.openings.push({ name: `まど ${it.openings.length + 1}`, w: 1800, h: 1200, x: 900, y: 900 });
    persist();
    draw();
    list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  f.append(list, add);
  return f;
}

function figureOpening() {
  const f = el('div', 'figure');
  f.innerHTML = `
  <svg viewBox="0 0 340 170" role="img" aria-label="まど・ドアの 寸法のとりかた">
    <rect x="20" y="10" width="300" height="140" fill="none" stroke="currentColor" stroke-width="2"/>
    <rect x="120" y="40" width="130" height="70" fill="none" stroke="currentColor" stroke-width="5"/>
    <path d="M120 30 H250 M120 24 v12 M250 24 v12" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="150" y="22" font-size="15" font-weight="700" fill="currentColor">①よこはば</text>
    <path d="M262 40 V110 M256 40 h12 M256 110 h12" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="272" y="80" font-size="15" font-weight="700" fill="currentColor">②たかさ</text>
    <path d="M20 125 H120 M20 119 v12 M120 119 v12" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="26" y="118" font-size="14" font-weight="700" fill="currentColor">③ひだりから</text>
    <path d="M185 110 V150 M179 110 h12 M179 150 h12" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="196" y="138" font-size="14" font-weight="700" fill="currentColor">④ゆかから</text>
    <text x="20" y="166" font-size="12" fill="currentColor">かべを 正面から みたところ</text>
  </svg>`;
  return f;
}

/* かざり棚の面えらび */
function facesBlock(it) {
  const f = el('div', 'field');
  f.append(el('label', null, 'クロスを まく めん'));
  f.append(el('div', 'hint', 'はらない めんは はずしてください'));
  const grid = el('div', 'toggles');
  const labels = { back: 'おく', top: 'うえ', bottom: 'した', left: 'ひだり', right: 'みぎ' };
  it.faces = { back: true, top: true, bottom: true, left: true, right: true, ...(it.faces || {}) };
  for (const [k, label] of Object.entries(labels)) {
    const t = el('label', 'toggle' + (it.faces[k] ? ' on' : ''));
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!it.faces[k];
    cb.addEventListener('change', () => {
      it.faces[k] = cb.checked;
      t.classList.toggle('on', cb.checked);
      persist();
    });
    t.append(cb, document.createTextNode(label));
    grid.append(t);
  }
  f.append(grid);
  return f;
}

/* 間接照明の展開幅 */
function coveDevelopBlock(it) {
  const wrap = el('div');
  it.parts = it.parts || { inner: 150, depth: 200, face: 100 };
  const total = el('div', 'field');
  const totalLabel = el('label', null, '＝ てんかいはば (のばした ときの はば)');
  const totalVal = el('div', 'conv');
  const sync = () => {
    it.developMm = Math.max(0, nz(it.parts.inner) + nz(it.parts.depth) + nz(it.parts.face));
    totalVal.textContent = `② + ③ + ④ = ${it.developMm} mm (${mmToM(it.developMm)} m)`;
    persist();
  };
  const mk = (label, key, hint) => numField(label, it.parts[key], 10, (v) => { it.parts[key] = v; sync(); }, hint);
  total.append(totalLabel, totalVal);
  wrap.append(
    mk('② たちあがり (照明の ふところの たかさ)', 'inner', ''),
    mk('③ そこ (ふところの おくゆき)', 'depth', ''),
    mk('④ みつけ (下がりかべの せい)', 'face', ''),
    total
  );
  sync();
  return wrap;
}

function figureNiche() {
  const f = el('div', 'figure');
  f.innerHTML = `
  <svg viewBox="0 0 340 180" role="img" aria-label="かざり棚の 寸法のとりかた">
    <g fill="none" stroke="currentColor" stroke-width="2">
      <rect x="50" y="14" width="130" height="130"/>
      <rect x="74" y="40" width="86" height="78" stroke-width="5"/>
      <path d="M74 156 H160 M74 150 v12 M160 150 v12"/>
      <path d="M38 40 V118 M32 40 h12 M32 118 h12"/>
    </g>
    <text x="78" y="176" font-size="15" font-weight="700" fill="currentColor">①よこはば</text>
    <text x="26" y="84" font-size="15" font-weight="700" fill="currentColor"
          transform="rotate(-90 26 84)" text-anchor="middle">②たかさ</text>
    <g transform="translate(196,24)">
      <path d="M0 26 L44 4 L44 92 L0 114 Z" fill="none" stroke="currentColor" stroke-width="5"/>
      <path d="M52 4 V92 M46 4 h12 M46 92 h12" fill="none" stroke="currentColor" stroke-width="2"/>
      <text x="62" y="54" font-size="15" font-weight="700" fill="currentColor">③おくゆき</text>
      <text x="-10" y="132" font-size="13" fill="currentColor">よこから みたところ</text>
    </g>
  </svg>
  <div class="cap">開口の うちがわ(おく・うえ・した・ひだり・みぎ)を 展開して ひろいます。</div>`;
  return f;
}

function figureCove() {
  const f = el('div', 'figure');
  f.innerHTML = `
  <svg viewBox="0 0 340 168" role="img" aria-label="間接照明の 展開のしかた">
    <path d="M14 40 H326" stroke="currentColor" stroke-width="3"/>
    <text x="250" y="32" font-size="14" fill="currentColor">てんじょう</text>
    <path d="M14 40 V160" stroke="currentColor" stroke-width="3"/>
    <path d="M120 40 V100 H250 V150" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/>
    <circle cx="140" cy="88" r="7" fill="currentColor" opacity=".45"/>
    <path d="M104 40 V100 M98 40 h12 M98 100 h12" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="22" y="76" font-size="15" font-weight="700" fill="currentColor">②たちあがり</text>
    <path d="M120 116 H250 M120 110 v12 M250 110 v12" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="150" y="136" font-size="15" font-weight="700" fill="currentColor">③そこ</text>
    <path d="M266 100 V150 M260 100 h12 M260 150 h12" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="276" y="130" font-size="15" font-weight="700" fill="currentColor">④みつけ</text>
  </svg>
  <div class="cap">ふとい線の ところに クロスを 巻きます。②+③+④ の はばの「帯」で 取ります。</div>`;
  return f;
}

/* ============================================================== けっか */
function renderResult() {
  if (!result) result = calcProject(project);
  const main = $('#resultMain');
  main.innerHTML = '';
  main.append(el('div', 'k', 'かべがみは'));
  const v = el('div', 'v');
  v.append(document.createTextNode(String(result.totals.rolls)));
  v.append(el('span', 'u', 'ロール'));
  main.append(v);
  main.append(el('div', 'm', `ぜんぶで やく ${result.totals.orderM} m (予備 ${result.options.sparePercent}% こみ)`));

  const warnBox = $('#resultWarn');
  warnBox.innerHTML = '';
  if (result.warnings.length) {
    const w = el('div', 'warn');
    w.append(el('div', null, '⚠ かくにん してください'));
    const ul = el('ul');
    for (const t of result.warnings) ul.append(el('li', null, t));
    w.append(ul);
    warnBox.append(w);
  }

  const pbox = $('#resultProducts');
  pbox.innerHTML = '';
  const card = el('div', 'card');
  card.append(el('h3', null, 'クロスの ちゅうもん'));
  for (const b of result.byProduct) {
    const row = el('div', 'prod');
    const nm = el('div', 'nm');
    nm.append(el('div', null, b.name + (b.code ? ` (${b.code})` : '')));
    nm.append(el('div', 'dim', b.material.name));
    row.append(nm);
    row.append(el('div', 'v', `${b.rolls} ロール`));
    row.append(el('div', null, `${b.orderM} m`));
    card.append(row);
  }
  pbox.append(card);

  const sub = $('#resultSub');
  sub.innerHTML = '';
  sub.append(el('h3', null, 'そのほか (めやす)'));
  const kv = (k, val) => {
    const d = el('div', 'kv');
    d.append(el('span', null, k));
    d.append(el('b', null, val));
    sub.append(d);
  };
  kv('しこう めんせき', `${result.totals.areaSqm} m²`);
  kv('のり', `${result.totals.glueKg} kg`);
  kv('ジョイントコーク', `${result.totals.caulkTubes} 本`);
  kv('ジョイント えんちょう', `${result.totals.jointM} m`);

  const rows = $('#resultRows');
  rows.innerHTML = '';
  const t = el('table', 'rows');
  t.innerHTML = '<tr><th>ところ</th><th>まい数</th><th>ながさ</th><th>めんせき</th></tr>';
  for (const r of result.perItem) {
    const tr = el('tr');
    tr.append(el('td', null, `${r.name}`));
    tr.append(el('td', null, `${r.drops} 枚`));
    tr.append(el('td', null, `${r.lengthM} m`));
    tr.append(el('td', null, `${r.areaSqm} m²`));
    t.append(tr);
    for (const n of r.notes) {
      const tn = el('tr');
      const td = el('td', null, '　※ ' + n);
      td.colSpan = 4;
      td.style.textAlign = 'left';
      tn.append(td);
      t.append(tn);
    }
  }
  rows.append(t);

  speak(`かべがみは、${result.totals.rolls}ロール、およそ${result.totals.orderM}メートルです。`);
}

$('#speakBtn').addEventListener('click', () => {
  pref.voice = true; save(KEY.pref, pref);
  if (!result) return;
  const lines = [`かべがみは、${result.totals.rolls}ロール、およそ${result.totals.orderM}メートルです。`];
  for (const b of result.byProduct) lines.push(`${b.name}は、${b.rolls}ロール。`);
  speak(lines.join(''));
});

$('#copyBtn').addEventListener('click', async () => {
  const text = formatOrderText(project, result || calcProject(project));
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました。LINEなどに はりつけて ください');
  } catch {
    prompt('ながおしして コピーしてください', text);
  }
});

$('#printBtn').addEventListener('click', () => {
  buildPrint();
  window.print();
});

$('#saveBtn').addEventListener('click', () => {
  const hist = load(KEY.history, []);
  hist.unshift({
    id: uid(),
    savedAt: new Date().toISOString(),
    title: project.title || '(名前なし)',
    rolls: result ? result.totals.rolls : 0,
    orderM: result ? result.totals.orderM : 0,
    project: JSON.parse(JSON.stringify(project)),
  });
  save(KEY.history, hist.slice(0, 50));
  toast('ほぞん しました');
});

function buildPrint() {
  const r = result || calcProject(project);
  const box = $('#printArea');
  const rows = r.perItem.map((x) =>
    `<tr><td>${esc(x.name)}</td><td>${KIND_LABELS[x.kind]}</td><td>${x.drops} 枚</td><td>${x.lengthM} m</td></tr>`).join('');
  const prods = r.byProduct.map((b) =>
    `<tr><td>${esc(b.name)} ${esc(b.code || '')}</td><td>${esc(b.material.name)}</td><td class="big">${b.rolls} ロール</td><td>${b.orderM} m</td></tr>`).join('');
  box.innerHTML = `
    <h1>クロス 発注メモ</h1>
    <p>げんば: <b>${esc(project.title || '(名前なし)')}</b>　日付: ${esc(project.date || '')}</p>
    <h2>ちゅうもん</h2>
    <table>${prods}</table>
    <p>施工面積 ${r.totals.areaSqm} m² / のり ${r.totals.glueKg} kg / ジョイントコーク ${r.totals.caulkTubes} 本</p>
    <p>予備 ${r.options.sparePercent}% こみ。切りしろ 上下あわせて ${r.options.trimMm} mm、ジョイント重ね ${r.options.overlapMm} mm で計算。</p>
    <h2>うちわけ</h2>
    <table><tr><th>ところ</th><th>しゅるい</th><th>まい数</th><th>ながさ</th></tr>${rows}</table>
  `;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============================================================== きろく */
function renderHistory() {
  const box = $('#historyList');
  box.innerHTML = '';
  const hist = load(KEY.history, []);
  if (!hist.length) box.append(el('div', 'empty', 'まだ ほぞんした けいさんは ありません'));
  for (const h of hist) {
    const b = el('button', 'item');
    b.append(el('span', 'tag', h.savedAt.slice(5, 10)));
    const body = el('div', 'body');
    body.append(el('div', 'nm', h.title));
    body.append(el('div', 'dim', `${h.rolls} ロール / ${h.orderM} m`));
    b.append(body, el('span', 'go', '↩'));
    b.addEventListener('click', () => {
      if (!confirm('この けいさんを よびだしますか?\n(いまの にゅうりょくは きえます)')) return;
      project = h.project;
      project.options = { ...DEFAULTS, ...(project.options || {}) };
      persist();
      result = null;
      go('items');
    });
    box.append(b);
  }
}

/* ============================================================== せってい */
function renderSettings() {
  const box = $('#settingsBody');
  box.innerHTML = '';
  const o = project.options;

  // クロスの品番
  const pc = el('div', 'card');
  pc.append(el('h3', null, 'クロスの しゅるい'));
  project.products.forEach((p, i) => {
    const f = el('div', 'field');
    const nameI = el('input');
    nameI.className = 'titleinput';
    nameI.value = p.name;
    nameI.addEventListener('input', () => { p.name = nameI.value; persist(); });
    const codeI = el('input');
    codeI.className = 'titleinput';
    codeI.placeholder = '品番 (例: SP-9501)';
    codeI.value = p.code || '';
    codeI.addEventListener('input', () => { p.code = codeI.value; persist(); });
    const sel = el('select');
    for (const m of MATERIALS) {
      const opt = el('option', null, m.name);
      opt.value = m.id;
      if (m.id === p.materialId) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener('change', () => { p.materialId = sel.value; persist(); });
    f.append(el('label', null, `クロス ${i + 1}`), nameI, codeI, sel);
    f.append(numField('柄の リピート (無地は 0)', p.repeatMm || 0, 10, (v) => { p.repeatMm = v; persist(); },
      '柄あわせの ぶん 丈を のばします'));
    if (project.products.length > 1) {
      const del = el('button', 'flat danger', 'この クロスを けす');
      del.addEventListener('click', () => {
        project.products = project.products.filter((x) => x.id !== p.id);
        for (const it of project.items) if (it.productId === p.id) it.productId = project.products[0].id;
        persist(); renderSettings();
      });
      f.append(del);
    }
    pc.append(f);
  });
  const addP = el('button', 'add', '＋ クロスを ふやす');
  addP.addEventListener('click', () => {
    project.products.push(defaultProduct('p' + uid(), `クロス ${project.products.length + 1}`));
    persist(); renderSettings();
  });
  pc.append(addP);
  box.append(pc);

  // 計算のきまり
  const c = el('div', 'card');
  c.append(el('h3', null, 'けいさんの きまり'));
  c.append(numField('上下の 切りしろ (合計)', o.trimMm, 10, (v) => { o.trimMm = v; persist(); }, 'ふつう 100 mm'));
  c.append(numField('ジョイントの 重ねしろ', o.overlapMm, 5, (v) => { o.overlapMm = v; persist(); }, '有効幅 = 材料幅 − これ'));
  c.append(numField('よび (%)', o.sparePercent, 1, (v) => { o.sparePercent = v; persist(); }, 'ふつう 5%'));
  c.append(numField('小もの部材の 切りしろ (1辺)', o.smallTrimMm, 5, (v) => { o.smallTrimMm = v; persist(); }, 'かざり棚など'));
  c.append(numField('間接照明の 帯の 切りしろ', o.coveTrimMm, 5, (v) => { o.coveTrimMm = v; persist(); }));
  const t = el('label', 'toggle' + (o.deductOpenings ? ' on' : ''));
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!o.deductOpenings;
  cb.addEventListener('change', () => { o.deductOpenings = cb.checked; t.classList.toggle('on', cb.checked); persist(); });
  t.append(cb, document.createTextNode('まど・ドアを ひく'));
  c.append(t);
  box.append(c);

  // 読み上げ・サーバー
  const m = el('div', 'card');
  m.append(el('h3', null, 'そのほか'));
  const vt = el('label', 'toggle' + (pref.voice ? ' on' : ''));
  const vcb = el('input');
  vcb.type = 'checkbox';
  vcb.checked = !!pref.voice;
  vcb.addEventListener('change', () => { pref.voice = vcb.checked; vt.classList.toggle('on', vcb.checked); save(KEY.pref, pref); });
  vt.append(vcb, document.createTextNode('こえで よみあげる'));
  m.append(vt);
  m.append(el('div', 'note', 'しゃしんの よみとりは、この スマホの 中だけで します。'
    + 'どこにも おくりません。お金も かかりません。'));
  box.append(m);
}

$('#resetBtn').addEventListener('click', () => {
  if (!confirm('せっていを さいしょに もどしますか?')) return;
  project.options = { ...DEFAULTS };
  persist();
  renderSettings();
  toast('もどしました');
});

/* ============================================================== はじめ */
applyPref();
renderShots();
go('home');

if (project.items.length) {
  $('#offlineNote').textContent = `まえの にゅうりょくが ${project.items.length} か所 のこっています。`;
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン化は無くても動く */ });
}
