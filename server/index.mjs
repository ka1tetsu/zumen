/**
 * クロスけいさん機のサーバー。やることは2つだけ。
 *   1. public/ をそのまま配る
 *   2. POST /api/read-drawing で、図面の写真を Claude に読ませて拾い出しを返す
 *
 * API キーはこのサーバーの中だけに置く。ブラウザには渡さない。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, SYSTEM, TAKEOFF_TOOL, USER_TEXT } from './prompt.mjs';
import { normalize, validateImages } from './takeoff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 24 * 1024 * 1024; // 写真は縮めて送られてくる想定
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  ? new Anthropic()
  : null;

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('しゃしんが 大きすぎます'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC, rel);
  // public/ の外には出さない
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('みつかりません');
  }
}

async function readDrawing(req, res) {
  if (!client) {
    sendJson(res, 503, {
      error: 'この サーバーには ANTHROPIC_API_KEY が せっていされていません。'
        + ' 「じぶんで いれる」を つかってください。',
    });
    return;
  }
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message || 'おくられた データが よめません' });
    return;
  }

  let imageBlocks;
  try {
    imageBlocks = validateImages(payload.images);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message });
    return;
  }

  try {
    // 画像は重い。ストリーミングで受けて、タイムアウトを避ける。
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      tools: [TAKEOFF_TOOL],
      messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: USER_TEXT }] }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      sendJson(res, 422, { error: 'この しゃしんは よみとれませんでした。' });
      return;
    }
    const call = message.content.find((b) => b.type === 'tool_use' && b.name === TAKEOFF_TOOL.name);
    if (!call) {
      const said = message.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 300);
      sendJson(res, 422, { error: said || '図面として よみとれませんでした。' });
      return;
    }
    const out = normalize(call.input);
    console.log(`[read-drawing] ${imageBlocks.length}枚 → ${out.items.length}か所 `
      + `(in ${message.usage?.input_tokens} / out ${message.usage?.output_tokens})`);
    sendJson(res, 200, out);
  } catch (err) {
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    console.error('[read-drawing] 失敗', err?.message || err);
    sendJson(res, status, { error: `よみとりに しっぱいしました: ${err?.message || err}` });
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.url.split('?')[0] === '/api/read-drawing') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST で おくってください' });
      return;
    }
    readDrawing(req, res).catch((err) => sendJson(res, 500, { error: String(err?.message || err) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`クロスけいさん機  http://localhost:${PORT}`);
  console.log(client ? `しゃしんの よみとり: つかえます (${MODEL})` : 'しゃしんの よみとり: ANTHROPIC_API_KEY が ないので つかえません');
});
