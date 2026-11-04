'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const a = s.indexOf('function drawGlobe');
const b = s.indexOf('function drawLinesGlobe');
if (a < 0 || b < 0) { console.log('定位失败', a, b); process.exit(1); }
const newDrawGlobe = `function drawGlobe(ts) {
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
`;
s = s.slice(0, a) + newDrawGlobe + s.slice(b);
fs.writeFileSync(p, s);
console.log('drawGlobe 已替换为圆内裁剪方案(无 ImageData)');
const r = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(r.output.join('').trim().split('\n').pop());
