'use strict';
// ============================================================
// 轻量单文件版打包器: 读取 数据/<行星>/ 全部产物 → 内嵌 → 轻量版.html
// 零依赖零网络: 双击即开(含 file://), 也可直接分享这一个文件
// 用法: node build-lite.js
// ============================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, '数据');

const planets = [];
for (const d of fs.readdirSync(DATA)) {
  const dir = path.join(DATA, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  const pjPath = path.join(dir, 'planet.json');
  if (!fs.existsSync(pjPath)) continue;
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  // 压缩洋流/边界(只留绘制所需)
  const slim = (gj) => gj.features.map(f => ({
    t: f.properties.类型 || '', n: f.properties.名称 || '',
    w: /暖/.test(f.properties.性质 || '') ? 1 : (/寒/.test(f.properties.性质 || '') ? -1 : 0),
    b: f.properties.边界类型 || '',
    c: f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [],
    k: f.geometry.type === 'Point' ? f.geometry.coordinates : null
  })).filter(f => f.c.length || f.k);
  planets.push({
    name: pj.name,
    tagline: pj.tagline,
    stats: pj.stats,
    phiH: pj.params.phiH,
    moons: pj.moons == null ? 1 : pj.moons,
    cities: (pj.cities || []).map(c => ({ n: c.name, t: c.type, p: c.popWan, g: c.govt, bg: c.background, goods: c.goods, lon: c.lon, lat: c.lat, elev: c.elevM, cli: c.climate, mon: c.monsoon })),
    currents: slim(JSON.parse(fs.readFileSync(path.join(dir, '06_洋流.geojson'), 'utf8'))),
    boundaries: slim(JSON.parse(fs.readFileSync(path.join(dir, '01_板块与边界.geojson'), 'utf8'))).filter(f => f.c.length),
    terrainB64: fs.readFileSync(path.join(dir, 'terrain.png')).toString('base64'),
    climateB64: fs.readFileSync(path.join(dir, 'climate.png')).toString('base64')
  });
  console.log('打包', pj.name, `(洋流 ${planets[planets.length - 1].currents.length} / 边界 ${planets[planets.length - 1].boundaries.length} / 城邦 ${planets[planets.length - 1].cities.length})`);
}

const payload = JSON.stringify(planets);
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>虚构行星 · 轻量版</title>
<style>
  html, body { margin: 0; height: 100%; background: #05080f; color: #dce8f2; overflow: hidden; font: 14px/1.6 "Microsoft YaHei", sans-serif; }
  #topbar { position: fixed; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: linear-gradient(#0b1220f2, #0b1220c8); border-bottom: 1px solid #22303f; z-index: 10; }
  #topbar b { color: #8fd0ff; font-size: 15px; letter-spacing: 1px; }
  select, button { background: #16222f; color: #dce8f2; border: 1px solid #33506b; border-radius: 6px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .modes { display: flex; gap: 4px; }
  .modes button.on { background: #2563a8; color: #fff; border-color: #3a6ea8; }
  .tgl { display: flex; gap: 8px; margin-left: auto; }
  .tgl label { display: flex; align-items: center; gap: 3px; font-size: 12px; color: #9db4ca; cursor: pointer; }
  .tgl input { accent-color: #3aa0ff; }
  #tagline { position: fixed; top: 58px; left: 14px; z-index: 9; font-size: 12px; color: #7e94ab; max-width: 70vw; text-shadow: 0 1px 3px #000; }
  #stats { position: fixed; bottom: 12px; left: 14px; z-index: 9; font-size: 11.5px; color: #8aa4bd; background: #0b1220d9; border: 1px solid #22303f; border-radius: 8px; padding: 6px 12px; max-width: 46vw; }
  #card { position: fixed; right: 14px; top: 66px; z-index: 12; width: 300px; display: none; background: #0b1220f0; border: 1px solid #2a3a4e; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; }
  #card h3 { margin: 0 0 2px; color: #ffd479; font-size: 14.5px; }
  #card .m { color: #8aa4bd; margin-bottom: 4px; }
  #card .x { float: right; cursor: pointer; color: #7e94ab; }
  canvas { position: fixed; inset: 0; display: block; cursor: grab; }
  canvas.drag { cursor: grabbing; }
  #help { position: fixed; bottom: 12px; right: 14px; z-index: 9; font-size: 11px; color: #5d7488; }
</style>
</head>
<body>
<div id="topbar">
  <b>虚构行星 · 轻量版</b>
  <select id="sel"></select>
  <div class="modes">
    <button id="mMap" class="on">平面地图</button>
    <button id="mGlobe">自转星球</button>
  </div>
  <div class="tgl">
    <label><input type="checkbox" id="lyCur" checked>洋流</label>
    <label><input type="checkbox" id="lyCit" checked>城邦</label>
    <label><input type="checkbox" id="lyBnd">板块边界</label>
    <label><input type="checkbox" id="texCli">气候贴图</label>
  </div>
</div>
<div id="tagline"></div>
<div id="stats"></div>
<div id="card"><span class="x" onclick="this.parentNode.style.display='none'">✕</span><div id="cardBody"></div></div>
<div id="help">拖拽移动 / 滚轮缩放 / 点城邦看文明卡</div>
<canvas id="cv"></canvas>
<script>
const DATA = __DATA__;
</script>
<script>
'use strict';
// ================= 数据与状态 =================
const cv = document.getElementById('cv'), cx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
let cur = 0;                    // 当前行星索引
let mode = 'map';               // map | globe
let imgs = DATA.map(() => ({ terrain: null, climate: null, src: null })); // src=当前贴图 ImageData 缓存
let view = { lon: 0, lat: 15, scale: 3.2 };  // 平面: 视口左上经度/纬度, px/度
let globe = { lon0: 30, lat0: 18, spin: true };
let drag = null;
let globeCv = null, gx = null, outImg = null; // 离屏球面渲染
let show = { cur: true, cit: true, bnd: false };
let texCli = false;

function resize() {
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener('resize', resize);

// ================= 初始化 =================
const sel = document.getElementById('sel');
DATA.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; sel.appendChild(o); });
sel.onchange = () => { cur = +sel.value; prep(cur); render(); showStats(); };
document.getElementById('mMap').onclick = () => setMode('map');
document.getElementById('mGlobe').onclick = () => setMode('globe');
function setMode(m) {
  prep(cur); // 确保贴图已创建(未解码完成时 rAF 循环会自动重试)
  mode = m;
  document.getElementById('mMap').className = m === 'map' ? 'on' : '';
  document.getElementById('mGlobe').className = m === 'globe' ? 'on' : '';
  render();
}
document.getElementById('lyCur').onchange = e => { show.cur = e.target.checked; render(); };
document.getElementById('lyCit').onchange = e => { show.cit = e.target.checked; render(); };
document.getElementById('lyBnd').onchange = e => { show.bnd = e.target.checked; render(); };
document.getElementById('texCli').onchange = e => { texCli = e.target.checked; prep(cur); render(); };

function prep(i) {
  const p = DATA[i];
  if (!imgs[i].terrain) {
    imgs[i].terrain = mkImg('data:image/png;base64,' + p.terrainB64, () => render());
    imgs[i].climate = mkImg('data:image/png;base64,' + p.climateB64);
  }
}
function mkImg(src, onload) {
  const im = new Image();
  const ready = () => { cacheSrc(im); if (onload) onload(); };
  im.onload = ready; // 兜底
  im.src = src;
  if (im.decode) im.decode().then(ready).catch(() => {});
  return im;
}
function cacheSrc(im) {
  const c = document.createElement('canvas'); c.width = 1440; c.height = 720;
  c.getContext('2d').drawImage(im, 0, 0);
  imgs[cur].src = c.getContext('2d').getImageData(0, 0, 1440, 720);
}
function showStats() {
  const p = DATA[cur], st = p.stats;
  const cli = Object.entries(st.climateStats || {}).sort((a, b) => b[1]['面积百分比'] - a[1]['面积百分比']).slice(0, 3).map(x => x[0] + x[1]['面积百分比'] + '%').join(' · ');
  document.getElementById('stats').textContent =
    \`陆地 \${(st.landPct * 100).toFixed(0)}% · 板块 \${st.boundaryCount.conv + st.boundaryCount.div + st.boundaryCount.transform} 个(汇聚\${st.boundaryCount.conv}/离散\${st.boundaryCount.div}/转换\${st.boundaryCount.transform}) · 洋流 \${p.currents.length} 段 · 城邦 \${p.cities.length} 座 · 主要气候: \${cli || '—'}\`;
}
function showTag() { document.getElementById('tagline').textContent = DATA[cur].tagline; }

// ================= 绘制: 平面地图 =================
function sx(lon) { let x = (lon - view.lon) * view.scale; while (x < -180 * view.scale) x += 360 * view.scale; while (x > W + 180 * view.scale) x -= 360 * view.scale; return x; }
function sy(lat) { return (90 - lat) * view.scale + view.yShift; }

function drawMap() {
  cx.fillStyle = '#04070d'; cx.fillRect(0, 0, W, H);
  const img = imgs[cur];
  const im = texCli ? img.climate : img.terrain;
  if (!im || !im.complete || !im.naturalWidth) return;
  const wDeg = 360, hDeg = 180;
  // 贴图三连画(无缝环绕)
  const x0 = sx(-180), y0 = sy(90);
  cx.drawImage(im, x0, y0, wDeg * view.scale, hDeg * view.scale);
  cx.drawImage(im, x0 - wDeg * view.scale, y0, wDeg * view.scale, hDeg * view.scale);
  cx.drawImage(im, x0 + wDeg * view.scale, y0, wDeg * view.scale, hDeg * view.scale);
  cx.strokeStyle = '#1c2a3a'; cx.lineWidth = 1;
  // ---- 板块边界 ----
  if (show.bnd) drawLines(DATA[cur].boundaries, f => f.b.includes('汇聚') ? '#ff5040' : f.b.includes('离散') ? '#40dcff' : '#ffdc40', 1.4, 0.75);
  // ---- 洋流 ----
  if (show.cur) drawLines(DATA[cur].currents, f => f.w > 0 ? '#ffb060' : f.w < 0 ? '#78c8ff' : '#a8cfe6', 2.2, 0.9);
  // ---- 城邦 ----
  if (show.cit) {
    for (const c of DATA[cur].cities) {
      const x = sx(c.lon), y = sy(c.lat);
      cx.fillStyle = '#ffd479'; cx.beginPath(); cx.arc(x, y, 4, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = '#5a3c00'; cx.lineWidth = 1.5; cx.stroke();
      cx.font = '11px "Microsoft YaHei"'; cx.fillStyle = '#ffe9b8';
      cx.fillText(c.n, x + 6, y - 6);
    }
  }
}
function drawLines(list, colorFn, width, alpha) {
  cx.lineWidth = width; cx.globalAlpha = alpha;
  for (const f of list) {
    cx.strokeStyle = colorFn(f);
    for (const part of f.c) {
      cx.beginPath();
      let prev = null;
      for (const [lon, lat] of part) {
        const x = sx(lon), y = sy(lat);
        if (prev === null || Math.abs(x - prev) > 180 * view.scale) cx.moveTo(x, y);
        else cx.lineTo(x, y);
        prev = x;
      }
      cx.stroke();
    }
  }
  cx.globalAlpha = 1;
}

// ================= 绘制: 自转星球(正交投影) =================
let srcCache = null;
function ensureSrc() {
  const img = texCli ? imgs[cur].climate : imgs[cur].terrain;
  if (!img || !img.complete || !img.naturalWidth) return null;
  if (srcCache && srcCache.i === img) return srcCache;
  const c = document.createElement('canvas'); c.width = 1440; c.height = 720;
  c.getContext('2d').drawImage(img, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, 1440, 720);
  // 空捕获(图片尚在解码)不缓存 → rAF 下一帧自动重试, 避免黑球永久卡死
  let nz = 0, tot = 0;
  for (let i = 0; i < d.data.length; i += 40000) { tot++; if (d.data[i] || d.data[i + 1] || d.data[i + 2]) nz++; }
  if (nz / Math.max(1, tot) < 0.3) return null; // 大部分黑 = 解码未完成
  srcCache = { i: img, d };
  return srcCache;
}
function drawGlobe(ts) {
  drawStars(ts);
  const img = texCli ? imgs[cur].climate : imgs[cur].terrain;
  if (!img || !img.complete || !img.naturalWidth) return;
  const R = Math.min(W, H) * 0.42;
  const cxs = W / 2, cys = H / 2;
  const pxDeg = R / 90;
  // 覆盖层投影: 与贴图同一平面映射(经度差归一 -180..180)
  const proj = (lon, lat) => {
    const dl = ((lon - globe.lon0 + 540) % 360) - 180;
    return [cxs + dl * pxDeg, cys - (90 - lat) * pxDeg];
  };
  cx.save();
  cx.beginPath(); cx.arc(cxs, cys, R, 0, Math.PI * 2); cx.clip();
  cx.fillStyle = '#06121f'; cx.fillRect(cxs - R, cys - R, R * 2, R * 2);
  // 贴图三连画(无缝环绕): globe.lon0 对准圆心
  const drawW = 360 * pxDeg;
  const x0 = cxs - (globe.lon0 + 180) * pxDeg;
  for (const k of [-1, 0, 1]) cx.drawImage(img, x0 + k * drawW, cys - 90 * pxDeg, drawW, 180 * pxDeg);
  if (show.cur) drawLinesGlobe(DATA[cur].currents, f => f.w > 0 ? '#ffcf96' : f.w < 0 ? '#a8dcff' : '#cfe6f2', proj, 1.6, 0.8);
  if (show.bnd) drawLinesGlobe(DATA[cur].boundaries, f => f.b.includes('汇聚') ? '#ff6a55' : f.b.includes('离散') ? '#54e2ff' : '#ffe066', proj, 1.2, 0.75);
  if (show.cit) {
    cx.font = '11px "Microsoft YaHei"';
    for (const c of DATA[cur].cities) {
      const q = proj(c.lon, c.lat);
      cx.fillStyle = '#ffd479'; cx.beginPath(); cx.arc(q[0], q[1], 3.6, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#ffe9b8'; cx.fillText(c.n, q[0] + 5, q[1] - 5);
    }
  }
  // 球面明暗: 左上受光 + 边缘暗角
  const grad = cx.createRadialGradient(cxs - R * 0.35, cys - R * 0.4, R * 0.12, cxs, cys, R * 1.02);
  grad.addColorStop(0, 'rgba(255,255,255,0.16)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.52)');
  cx.fillStyle = grad; cx.fillRect(cxs - R, cys - R, R * 2, R * 2);
  cx.restore();
  cx.strokeStyle = '#2a4a6a'; cx.lineWidth = 1.5;
  cx.beginPath(); cx.arc(cxs, cys, R, 0, Math.PI * 2); cx.stroke();
}
function drawLinesGlobe(list, colorFn, proj, width, alpha) {
  cx.lineWidth = width; cx.globalAlpha = alpha;
  for (const f of list) {
    cx.strokeStyle = colorFn(f);
    for (const part of f.c) {
      cx.beginPath();
      let pen = false, plon = null;
      for (const [lon, lat] of part) {
        if (plon !== null && Math.abs(lon - plon) > 180) { pen = false; }
        plon = lon;
        const q = proj(lon, lat);
        if (!q) { pen = false; continue; }
        if (!pen) { cx.moveTo(q[0], q[1]); pen = true; } else cx.lineTo(q[0], q[1]);
      }
      cx.stroke();
    }
  }
  cx.globalAlpha = 1;
}
// ---- 星空 ----
let stars = null;
function drawStars(ts) {
  if (!stars) {
    stars = [];
    const r = (function (s) { let a = s; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(20261104);
    for (let i = 0; i < 160; i++) stars.push([r(), r(), r() * 1.4 + 0.3]);
  }
  cx.fillStyle = '#04070d'; cx.fillRect(0, 0, W, H);
  for (const [x, y, s] of stars) { cx.fillStyle = 'rgba(220,230,255,' + (0.3 + s * 0.35) + ')'; cx.fillRect(x * W, y * H, s, s); }
}

// ================= 渲染循环 =================
function render(ts) {
  if (W !== innerWidth || H !== innerHeight || !W) resize();
  if (mode === 'map') drawMap(); else drawGlobe(ts || 0);
}
let spinLast = 0;
function loop(ts) {
  if (mode === 'globe' && globe.spin && !drag) { globe.lon0 = (globe.lon0 + (ts - spinLast) * 0.004) % 360; }
  spinLast = ts;
  render(ts);
  requestAnimationFrame(loop);
}

// ================= 交互 =================
function fit() {
  if (mode === 'map') { view.scale = Math.max(2.2, Math.min(W, H) / 160); view.lon = 0; view.lat = 30; view.yShift = -(90 - view.lat) * view.scale + H / 2 - 0; }
}
addEventListener('resize', () => { fit(); render(); });
cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY }; cv.className = 'drag'; });
addEventListener('mouseup', () => { drag = null; cv.className = ''; });
addEventListener('mousemove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (mode === 'map') {
    view.lon -= dx / view.scale; view.lon = ((view.lon + 180) % 360 + 360) % 360 - 180;
    view.yShift += dy; view.yShift = Math.max(-(180 * view.scale - H), Math.min(0, view.yShift));
  } else {
    globe.lon0 -= dx * 0.35; globe.lat0 = Math.max(-85, Math.min(85, globe.lat0 + dy * 0.35));
  }
  render();
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.18 : 1 / 1.18;
  if (mode === 'map') {
    const old = view.scale;
    view.scale = Math.max(1.2, Math.min(40, old * f));
    view.yShift *= view.scale / old;
  }
  render();
}, { passive: false });
// 触摸(移动端)
cv.addEventListener('touchstart', e => { const t = e.touches[0]; drag = { x: t.clientX, y: t.clientY }; }, { passive: true });
cv.addEventListener('touchmove', e => {
  if (!drag) return;
  const t = e.touches[0];
  const dx = t.clientX - drag.x, dy = t.clientY - drag.y;
  drag.x = t.clientX; drag.y = t.clientY;
  if (mode === 'map') { view.lon -= dx / view.scale; view.yShift += dy; }
  else { globe.lon0 -= dx * 0.35; globe.lat0 = Math.max(-85, Math.min(85, globe.lat0 + dy * 0.35)); }
  render();
}, { passive: true });
cv.addEventListener('touchend', () => { drag = null; });
// 点城邦
cv.addEventListener('click', e => {
  const card = document.getElementById('card');
  for (const c of DATA[cur].cities) {
    let hit = null;
    if (mode === 'map') { const x = sx(c.lon), y = sy(c.lat); if (Math.hypot(x - e.clientX, y - e.clientY) < 10) hit = [x, y]; }
    else {
      const la = c.lat * Math.PI / 180, lo = (c.lon - globe.lon0) * Math.PI / 180;
      const R = Math.min(W, H) * 0.42;
      const z = Math.sin(globe.lat0 * Math.PI / 180) * Math.sin(la) + Math.cos(globe.lat0 * Math.PI / 180) * Math.cos(la) * Math.cos(lo);
      if (z < 0.02) continue;
      const x = Math.cos(la) * Math.sin(lo), y = Math.cos(globe.lat0 * Math.PI / 180) * Math.sin(la) - Math.sin(globe.lat0 * Math.PI / 180) * Math.cos(la) * Math.cos(lo);
      const px = W / 2 + x * R, py = H / 2 - y * R;
      if (Math.hypot(px - e.clientX, py - e.clientY) < 10) hit = [px, py];
    }
    if (hit) {
      document.getElementById('cardBody').innerHTML = '<h3>' + c.n + '</h3><div class="m">' + c.t + ' · ' + c.p + '万 · ' + c.g + ' · ' + c.cli + '</div><div>' + c.bg + '</div><div style="margin-top:4px;color:#8aa4bd">特产: ' + (c.goods || []).join('、') + '</div>';
      card.style.display = 'block';
      return;
    }
  }
  card.style.display = 'none';
});

// ================= 启动 =================
resize(); fit();
prep(0); showStats(); showTag();
requestAnimationFrame(loop);
</script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, '轻量版.html'), html.replace('__DATA__', payload), 'utf8');
console.log('轻量版.html 生成完毕:', (fs.statSync(path.join(ROOT, '轻量版.html')).size / 1024 / 1024).toFixed(2) + 'MB, 含', planets.length, '颗行星');
