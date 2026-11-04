'use strict';
// 虚构行星 Cesium 预览 + 行星工坊 服务器(零依赖)
// 端口 8961; / → 预览页, /vendor/cesium → 本地 Cesium 1.144, /data/<行星> → 生成数据
// 工坊 API: POST /api/parse (中文描述→参数) · POST /api/generate (参数→生成行星)
//           GET /api/customs · POST /api/customs/delete · GET /api/job (生成进度)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');

const PORT = 8961;
const ROOT = __dirname;
const DATA = path.join(ROOT, '..', '数据');
const TOOL = path.join(ROOT, '..', '工具');
const VENDOR = path.join(ROOT, 'vendor');
const NODE = process.execPath;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8'); }

function readBody(req) {
  return new Promise((res, rej) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) { rej(new Error('body too large')); req.destroy(); } });
    req.on('end', () => res(d));
    req.on('error', rej);
  });
}

// ---------- 名字与参数净化 ----------
function sanitizeName(n) {
  const s = String(n || '').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 6);
  return /^[\u4e00-\u9fa5a-zA-Z0-9]+$/.test(s) ? s : '';
}
const clampN = (v, a, b, d) => { const x = Number(v); return isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
function sanitizeParams(p) {
  if (!p || typeof p !== 'object') return null;
  const name = sanitizeName(p.name);
  if (!name) return { error: '名字非法(1-6个汉字/字母/数字)' };
  const plates = clampN(p.plates, 4, 18, 11);
  return {
    id: name, name, en: '', custom: true,
    seed: clampN(p.seed, 1, 4294967295, 1) >>> 0,
    tagline: String(p.tagline || '').slice(0, 60),
    dayHours: clampN(p.dayHours, 2, 480, 24),
    rotFactor: clampN(p.rotFactor, 0.1, 2.5, 1),
    tiltDeg: clampN(p.tiltDeg, 0, 60, 23.4),
    greenhouse: clampN(p.greenhouse, -20, 20, 0),
    tEq: clampN(p.tEq, -20, 60, 27),
    tPole: clampN(p.tPole, -80, 20, -30),
    moon: String(p.moon || '一颗普通卫星').slice(0, 40),
    plates,
    continentalPlates: clampN(p.continentalPlates, 1, plates - 1, Math.max(2, Math.round(plates * 0.45))),
    landTarget: clampN(p.landTarget, 0.05, 0.8, 0.3),
    hotspots: Math.round(clampN(p.hotspots, 0, 30, 9)),
    continentBias: ['none', 'equator', 'poles'].includes(p.continentBias) ? p.continentBias : 'none',
    forceRift: !!p.forceRift,
    forceCollision: !!p.forceCollision,
    moistureDecayDeg: clampN(p.moistureDecayDeg, 3, 30, 11),
    rivers: {
      dischargeThreshold: clampN(p.rivers && p.rivers.dischargeThreshold, 2e7, 5e8, 1e8),
      maxCount: Math.round(clampN(p.rivers && p.rivers.maxCount, 20, 400, 160))
    },
    citiesTarget: Math.round(clampN(p.citiesTarget, 4, 30, 14)),
    culture: p.culture && typeof p.culture === 'object' ? p.culture : undefined,
    expect: [],
    description: String(p.description || '').slice(0, 300)
  };
}

// ---------- 生成任务(单槽) ----------
const GEN = path.join(TOOL, 'generate.js');
let genJob = { running: false, name: null, error: null, done: false, startedAt: 0 };

function runGenerate(params) {
  const dir = path.join(DATA, params.name);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const paramsFile = path.join(TOOL, '_custom_' + params.name + '.json');
  fs.writeFileSync(paramsFile, JSON.stringify(params, null, 1), 'utf8');
  genJob = { running: true, name: params.name, error: null, done: false, startedAt: Date.now() };
  const child = spawn(NODE, [GEN, '--params', paramsFile], { stdio: 'ignore' });
  child.on('exit', code => {
    genJob.running = false;
    genJob.done = true;
    if (code !== 0) genJob.error = '生成器退出码 ' + code;
  });
  child.on('error', e => { genJob.running = false; genJob.error = String(e.message || e); });
}

// ---------- 自定义行星列表 ----------
function listCustoms() {
  const out = [];
  try {
    for (const d of fs.readdirSync(DATA)) {
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(DATA, d, 'planet.json'), 'utf8'));
        if (pj.custom) out.push({ name: pj.name, tagline: pj.tagline || '', seed: pj.params && pj.params.seed });
      } catch (e) { /* 跳过非自定义/损坏目录 */ }
    }
  } catch (e) {}
  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);

    // ---- 工坊 API ----
    if (url === '/api/parse' && req.method === 'POST') {
      const { desc } = JSON.parse(await readBody(req) || '{}');
      const { parseDescription } = require(path.join(TOOL, 'nlParse.js'));
      const parsed = parseDescription(String(desc || '').slice(0, 500));
      return json(res, 200, parsed);
    }
    if (url === '/api/generate' && req.method === 'POST') {
      if (genJob.running) return json(res, 409, { error: '已有生成任务在进行中' });
      const body = JSON.parse(await readBody(req) || '{}');
      const params = sanitizeParams(body.params || body);
      if (!params) return json(res, 400, { error: '参数非法' });
      if (params.error) return json(res, 400, params);
      delete require.cache[require.resolve(path.join(TOOL, 'nlParse.js'))]; // 允许热改解析器
      runGenerate(params);
      return json(res, 200, { ok: true, name: params.name });
    }
    if (url === '/api/job') {
      return json(res, 200, genJob);
    }
    if (url === '/api/customs') {
      return json(res, 200, listCustoms());
    }
    if (url === '/api/customs/delete' && req.method === 'POST') {
      const { name } = JSON.parse(await readBody(req) || '{}');
      const safe = sanitizeName(name);
      const dir = path.join(DATA, safe);
      if (!safe || !fs.existsSync(dir)) return json(res, 404, { error: '未找到该自定义行星' });
      let isCustom = false;
      try { isCustom = !!JSON.parse(fs.readFileSync(path.join(dir, 'planet.json'), 'utf8')).custom; } catch (e) {}
      if (!isCustom) return json(res, 403, { error: '内置行星不可删除' });
      fs.rmSync(dir, { recursive: true, force: true });
      const pf = path.join(TOOL, '_custom_' + safe + '.json');
      if (fs.existsSync(pf)) fs.unlinkSync(pf);
      return json(res, 200, { ok: true });
    }

    // ---- 静态文件 ----
    let base, rel;
    if (url.startsWith('/vendor/')) { base = VENDOR; rel = url.slice('/vendor/'.length); }
    else if (url.startsWith('/data/') || url.startsWith('/数据/')) { base = DATA; rel = url.slice(url.indexOf('/', 1) + 1); }
    else if (url === '/轻量版.html') { base = path.join(ROOT, '..'); rel = '轻量版.html'; }
    else { base = ROOT; rel = url === '/' ? 'index.html' : url.slice(1); }
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(path.normalize(base))) return send(res, 403, 'forbidden');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found: ' + rel);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, 'error: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`虚构行星预览+工坊: http://127.0.0.1:${PORT}  (Ctrl+C 退出)`);
});
