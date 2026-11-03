'use strict';
// ============================================================
// 行星地理逻辑自检
// 用法: node validate.js [planetId ...]
// 输出: 数据/<行星>/自检报告.md + 控制台汇总; 有 FAIL 时退出码 1
// ============================================================
const fs = require('fs');
const path = require('path');
const P = require('./params');

const ROOT = path.join(__dirname, '..', '数据');
const W = P.gridW, H = P.gridH, N = W * H;
const D2R = Math.PI / 180;

// ---------- 工具 ----------
function loadLandMask(pj) {
  const buf = Buffer.from(pj.landMaskB64, 'base64');
  let land = 0, area = 0;
  for (let i = 0; i < N; i++) if (buf[i >> 3] & (1 << (i & 7))) {
    land++;
    area += 0.25 * 111.32 * 111.32 * Math.cos((90 - (((i / W) | 0) + 0.5) * 180 / H) * D2R);
  }
  return { bits: buf, landCount: land, landAreaKm2: area };
}
function isLand(mask, lon, lat) {
  if (lat < -90 || lat > 90) return false;
  let x = Math.floor((lon + 180) / 360 * W); x = ((x % W) + W) % W;
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
  const i = y * W + x;
  return !!(mask.bits[i >> 3] & (1 << (i & 7)));
}
function isLandNearCoast(mask, lon, lat) {
  for (let dlat = -1; dlat <= 1; dlat++) for (let dlon = -1; dlon <= 1; dlon++) {
    if (isLand(mask, lon + dlon * 0.6, lat + dlat * 0.6)) return true;
  }
  return false;
}
function isOceanNearCoast(mask, lon, lat) {
  for (let dlat = -1; dlat <= 1; dlat++) for (let dlon = -1; dlon <= 1; dlon++) {
    if (!isLand(mask, lon + dlon * 0.6, lat + dlat * 0.6)) return true;
  }
  return false;
}
function eachCoord(geom, cb) {
  if (!geom) return;
  if (geom.type === 'Point') cb(geom.coordinates);
  else if (geom.type === 'LineString' || geom.type === 'MultiPoint') geom.coordinates.forEach(cb);
  else if (geom.type === 'Polygon') geom.coordinates.forEach(r => r.forEach(cb));
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(l => l.forEach(cb));
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(r => r.forEach(cb)));
}
function centroidLat(f) {
  let sy = 0, n = 0;
  eachCoord(f.geometry, c => { sy += c[1]; n++; });
  return n ? sy / n : 0;
}
function validCoords(f) {
  let ok = true;
  eachCoord(f.geometry, c => {
    if (!Array.isArray(c) || c.length < 2 || !isFinite(c[0]) || !isFinite(c[1]) || c[0] < -180.01 || c[0] > 180.01 || c[1] < -90.01 || c[1] > 90.01) ok = false;
  });
  return ok;
}
function pngSize(p) {
  const b = fs.readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---------- 检查器 ----------
function validatePlanet(cfg) {
  const dir = path.join(ROOT, cfg.name);
  const R = [];
  const add = (id, name, status, detail) => { R.push({ id, name, status, detail: detail || '' }); };
  const PASS = 'PASS', WARN = 'WARN', FAIL = 'FAIL';

  // 0. 文件齐全
  const files = ['planet.json', 'planet.md', '01_板块与边界.geojson', '02_山脉与火山.geojson', '03_河流.geojson', '04_流域.geojson', '05_湖泊.geojson', '06_洋流.geojson', '07_气候分区.geojson', '08_季风区.geojson', '09_城邦.geojson', '10_商路.geojson', 'cities.json', 'terrain.png', 'climate.png', 'tectonic.png'];
  const missing = files.filter(f => !fs.existsSync(path.join(dir, f)));
  add('F0', '16 个数据文件齐全', missing.length === 0 ? PASS : FAIL, missing.length ? `缺失: ${missing.join(', ')}` : '');

  // 1. planet.json + 陆栅
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'planet.json'), 'utf8'));
  const mask = loadLandMask(pj);
  const landPctMask = mask.landCount / N;
  add('G1', '陆地占比命中目标(±2pp)', Math.abs(landPctMask - cfg.landTarget) <= 0.02 ? PASS : FAIL,
    `实际 ${(landPctMask * 100).toFixed(1)}% vs 目标 ${(cfg.landTarget * 100).toFixed(0)}%`);

  // 2. GeoJSON 有效性
  const gj = {};
  let badCoord = 0, total = 0;
  for (const f of files.filter(x => x.endsWith('.geojson'))) {
    gj[f] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const ft of gj[f].features) {
      total++;
      if (!validCoords(ft)) badCoord++;
    }
  }
  add('G2', `GeoJSON 坐标全部合法 (${total} 要素)`, badCoord === 0 ? PASS : FAIL, `越界/非法坐标要素 ${badCoord} 个`);

  // 3. 板块与边界
  const plates = gj['01_板块与边界.geojson'].features.filter(f => f.geometry.type === 'Polygon');
  const bounds = gj['01_板块与边界.geojson'].features.filter(f => f.geometry.type === 'LineString');
  const bTypes = new Set(bounds.map(f => (f.properties.边界类型 || '').slice(0, 2)));
  add('P1', `板块数 ${plates.length} ≥ 设定 ${cfg.plates}`, plates.length >= cfg.plates ? PASS : WARN);
  add('P2', '边界类型覆盖(汇聚/离散/转换)', bTypes.size >= 2 ? PASS : FAIL, `检出: ${[...bTypes].join('/')}`);
  add('P3', '板块边界有速率标注', bounds.every(f => (f.properties.会聚速率 + f.properties.张裂速率) > 0) ? PASS : WARN);

  // 4. 山脉/热点
  const mts = gj['02_山脉与火山.geojson'].features.filter(f => f.geometry.type === 'Polygon');
  const peaks = gj['02_山脉与火山.geojson'].features.filter(f => f.properties.类型 === '山峰');
  const hs = gj['02_山脉与火山.geojson'].features.filter(f => f.properties.类型 === '热点火山');
  const maxPeak = peaks.reduce((m, f) => Math.max(m, f.properties.海拔m || 0), 0);
  add('M1', `山脉 ${mts.length} 条 ≥ 3`, mts.length >= 3 ? PASS : WARN);
  add('M2', cfg.forceCollision ? `碰撞造山: 最高峰 ${maxPeak}m ≥ 2800m` : `最高峰 ${maxPeak}m(非碰撞世界 ≥ 1800m)`, maxPeak >= (cfg.forceCollision ? 2800 : 1800) ? PASS : WARN);
  add('M3', `热点火山 ${hs.length}/${cfg.hotspots}`, Math.abs(hs.length - cfg.hotspots) <= 2 ? PASS : WARN);

  // 5. 河流: 数量/长度/贴陆
  const rivers = gj['03_河流.geojson'].features;
  let riverLandOk = 0, shortRivers = 0;
  for (const r of rivers) {
    let onLand = 0, n = 0;
    eachCoord(r.geometry, c => { n++; if (isLandNearCoast(mask, c[0], c[1])) onLand++; });
    if (onLand / Math.max(1, n) >= 0.85) riverLandOk++;
    if ((r.properties.长度km || 0) < 120) shortRivers++;
  }
  add('H1', `河流 ${rivers.length} 条 ≥ 15`, rivers.length >= 15 ? PASS : WARN);
  add('H2', `河流贴陆率 ${(riverLandOk / Math.max(1, rivers.length) * 100).toFixed(0)}% ≥ 90%`, riverLandOk / Math.max(1, rivers.length) >= 0.9 ? PASS : FAIL,
    `${rivers.length - riverLandOk} 条河流有 >15% 落点不在陆地`);
  add('H3', `短河(<120km)占比 ${(shortRivers / Math.max(1, rivers.length) * 100).toFixed(0)}% ≤ 25%`, shortRivers / Math.max(1, rivers.length) <= 0.25 ? PASS : WARN);
  const basins = gj['04_流域.geojson'].features.length;
  const lakes = gj['05_湖泊.geojson'].features.length;
  add('H4', `流域 ${basins} ≥ 5, 湖泊 ${lakes} ≥ 1`, basins >= 5 && lakes >= 1 ? PASS : WARN);

  // 6. 洋流: 落海/方向
  const cur = gj['06_洋流.geojson'].features;
  let curOceanOk = 0, westOk = 0, westN = 0;
  for (const f of cur) {
    let onOcean = 0, n = 0;
    eachCoord(f.geometry, c => { n++; if (isOceanNearCoast(mask, c[0], c[1])) onOcean++; });
    if (onOcean / Math.max(1, n) >= 0.95) curOceanOk++;
    if (f.properties.类型 === '西边界流') {
      westN++;
      const midLat = centroidLat(f);
      const dirN = f.properties.走向 ? f.properties.走向[1] : 0;
      if (midLat * dirN > 0) westOk++; // 北半球向北/南半球向南 = 向极
    }
  }
  add('C1', `洋流 ${cur.length} 段 ≥ 5, 落海率 ${(curOceanOk / Math.max(1, cur.length) * 100).toFixed(0)}% ≥ 88%`, cur.length >= 5 && curOceanOk / Math.max(1, cur.length) >= 0.88 ? PASS : FAIL);
  add('C2', `西边界流方向向极 (${westOk}/${westN})`, westN === 0 || westOk === westN ? PASS : FAIL, '暖流应从低纬流向高纬');
  const eqCur = cur.filter(f => f.properties.类型 === '赤道流');
  {
    // 赤道带陆地占比(>65% 视为赤道被陆地阻断, 不强制要求赤道流)
    let landEq = 0, totEq = 0;
    for (let y = Math.floor(H * 0.48); y < Math.ceil(H * 0.52); y++) for (let x = 0; x < W; x++) {
      totEq++;
      const i = y * W + x;
      if (mask.bits[i >> 3] & (1 << (i & 7))) landEq++;
    }
    const blocked = landEq / Math.max(1, totEq) > 0.65;
    add('C3', blocked ? '赤道被陆地阻断, 无全球赤道流(合理)' : `赤道流向西(${eqCur.length} 段)`,
      blocked ? PASS : (eqCur.length > 0 && eqCur.every(f => (f.properties.走向 ? f.properties.走向[0] : 0) < 0) ? PASS : WARN));
  }
  const circ = cur.filter(f => f.properties.类型 === '环极流');
  add('C4', `环极流 ${circ.length} 段(有全通海道时)`, circ.length <= 1 ? PASS : WARN);

  // 7. 气候分区: 面积与纬度合理性
  const clim = gj['07_气候分区.geojson'].features;
  const byClass = {};
  for (const f of clim) {
    const nm = f.properties.名称;
    if (!byClass[nm]) byClass[nm] = { area: 0, wLat: 0, feats: 0 };
    const a = f.properties.面积km2 || 0;
    byClass[nm].area += a;
    byClass[nm].wLat += Math.abs(centroidLat(f)) * a;
    byClass[nm].feats++;
  }
  const landAreaKm2 = mask.landAreaKm2;
  const pct = (nm) => (byClass[nm] ? byClass[nm].area : 0) / landAreaKm2 * 100;
  const meanLat = (nm) => byClass[nm] ? byClass[nm].wLat / byClass[nm].area : -1;
  const desertPct = pct('干旱沙漠');
  const rainLat = meanLat('热带雨林');
  const iceLat = meanLat('冰原');
  add('K1', `雨林仅在中低纬(均|纬度| ${rainLat < 0 ? '无雨林' : rainLat.toFixed(1) + '°'} < 32°)`, rainLat < 0 || rainLat < 32 ? PASS : FAIL);
  add('K2', `沙漠不在赤道(均|纬度| ${desertPct > 0 ? meanLat('干旱沙漠').toFixed(1) + '°' : '无沙漠'} ≥ 12°)`, desertPct <= 0 || meanLat('干旱沙漠') >= 12 ? PASS : FAIL);
  add('K3', `冰原仅在高纬(均|纬度| ${iceLat < 0 ? '无冰原' : iceLat.toFixed(1) + '°'} > 50°)`, iceLat < 0 || iceLat > 50 ? PASS : FAIL);
  add('K4', `气候分区要素 ${clim.length} ≥ 30`, clim.length >= 30 ? PASS : WARN);

  // 8. 季风
  const mon = gj['08_季风区.geojson'].features;
  const monLatOk = mon.every(f => Math.abs(centroidLat(f)) < 50);
  add('J1', `季风区 ${mon.length} 片且在中低纬`, monLatOk ? PASS : FAIL);
  if (cfg.id === 'jinrang') {
    add('J2', '慢自转弱季风设计: 季风占陆地 ≤ 8%', (pj.stats.monsoonAreaPct || 0) <= 8 ? PASS : WARN, `实际 ${pj.stats.monsoonAreaPct}%`);
  }
  if (cfg.id === 'feilan') {
    add('J2', '强季风设计: 季风区 ≥ 1 片', mon.length >= 1 ? PASS : FAIL);
  }

  // 9. 城邦
  const cityPts = gj['09_城邦.geojson'].features;
  const cityData = JSON.parse(fs.readFileSync(path.join(dir, 'cities.json'), 'utf8'));
  let cityOnLand = 0, cityBgOk = 0, cityIce = 0;
  for (const f of cityPts) {
    if (isLandNearCoast(mask, f.geometry.coordinates[0], f.geometry.coordinates[1])) cityOnLand++;
    const cd = cityData.find(c => c.name === f.properties.名称);
    if (cd && cd.background && cd.background.length >= 20) cityBgOk++;
    if (f.properties.气候 === '冰原') cityIce++;
  }
  let minDist = 1e9;
  for (let a = 0; a < cityPts.length; a++) for (let b = a + 1; b < cityPts.length; b++) {
    const pa = cityPts[a].geometry.coordinates, pb = cityPts[b].geometry.coordinates;
    let dLon = Math.abs(pa[0] - pb[0]); if (dLon > 180) dLon = 360 - dLon;
    minDist = Math.min(minDist, Math.hypot(dLon * Math.cos(pa[1] * D2R), pa[1] - pb[1]));
  }
  add('X1', `城邦 ${cityPts.length} 座全部在陆地`, cityOnLand === cityPts.length ? PASS : FAIL, `${cityPts.length - cityOnLand} 座落水`);
  add('X2', '城邦间距 ≥ 4°', minDist >= 4 ? PASS : WARN, `最小 ${minDist.toFixed(1)}°`);
  add('X3', '城邦档案背景完整', cityBgOk === cityPts.length ? PASS : FAIL);
  add('X4', '城邦不建在冰原', cityIce === 0 ? PASS : WARN, `${cityIce} 座在冰原`);

  // 10. 商路贴陆
  const trade = gj['10_商路.geojson'].features;
  let tradeOk = 0;
  for (const f of trade) {
    let onLand = 0, n = 0;
    eachCoord(f.geometry, c => { n++; if (isLand(mask, c[0], c[1]) || isLand(mask, c[0], c[1] + 0.6) || isLand(mask, c[0], c[1] - 0.6)) onLand++; });
    if (onLand / Math.max(1, n) >= 0.9) tradeOk++;
  }
  add('T1', `商路 ${trade.length} 条贴陆率 ${(tradeOk / Math.max(1, trade.length) * 100).toFixed(0)}% ≥ 85%`, tradeOk / Math.max(1, trade.length) >= 0.85 ? PASS : WARN);

  // 11. 纹理
  const texOk = ['terrain.png', 'climate.png', 'tectonic.png'].every(f => {
    const s = pngSize(path.join(dir, f));
    return s.w === 1440 && s.h === 720;
  });
  add('R1', '三张等距圆柱纹理 1440×720', texOk ? PASS : FAIL);

  // 12. 设定书
  const md = fs.readFileSync(path.join(dir, 'planet.md'), 'utf8');
  add('D1', `设定书 ${(md.length / 1024).toFixed(1)}KB 含气候分区+城邦文明`, md.length > 2500 && md.includes('气候分区设定') && md.includes('城邦文明背景') ? PASS : FAIL);

  // 13. 期望现象对照(设计意图)
  const e = cfg.expect || [];
  for (const item of e) {
    let ok = true, note = '';
    if (item.includes('季风')) { ok = cfg.id === 'jinrang' ? (pj.stats.monsoonAreaPct || 0) <= 8 : mon.length >= 1; note = cfg.id === 'jinrang' ? `季风占陆地 ${pj.stats.monsoonAreaPct}%` : `季风区 ${mon.length} 片`; }
    else if (item.includes('碰撞造山')) { ok = bTypes.has('汇聚') && mts.length >= 1 && maxPeak >= 2800; note = `最高峰 ${maxPeak}m`; }
    else if (item.includes('雨林')) { ok = pct('热带雨林') >= 0.5; note = `雨林占陆地 ${pct('热带雨林').toFixed(1)}%`; }
    else if (item.includes('沙漠总面积占比异常大')) { ok = desertPct >= 28; note = `沙漠占陆地 ${desertPct.toFixed(1)}%`; }
    else if (item.includes('沙漠面积很小')) { ok = desertPct <= 10; note = `沙漠占陆地 ${desertPct.toFixed(1)}%`; }
    else if (item.includes('裂谷')) { ok = bTypes.has('离散') && lakes >= 3; note = `离散边界 ${[...bTypes].includes('离散')} / 湖泊 ${lakes}`; }
    else if (item.includes('季风区面积极小')) { ok = (pj.stats.monsoonAreaPct || 0) <= 8; note = `季风占陆地 ${pj.stats.monsoonAreaPct}%`; }
    else if (item.includes('河流稀短')) { const dens = rivers.length / Math.max(1, mask.landAreaKm2 / 1e7); ok = dens <= 7; note = `河网密度 ${dens.toFixed(1)} 条/百万km²陆地`; }
    else if (item.includes('陆地集中于中高纬')) { let wLat = 0, a2 = 0; for (const f of clim) { const A = f.properties.areaKm2 || 1; wLat += Math.abs(centroidLat(f)) * A; a2 += A; } const m = wLat / Math.max(1, a2); ok = m >= 35; note = `陆地均|纬度| ${m.toFixed(1)}°`; }
    else if (item.includes('赤道为连续大洋')) { let landEq = 0, tot = 0; for (let y = Math.floor(H * 0.472); y < Math.ceil(H * 0.528); y++) for (let x = 0; x < W; x++) { tot++; const i = y * W + x; if (mask.bits[i >> 3] & (1 << (i & 7))) landEq++; } ok = landEq / tot < 0.08; note = `赤道带陆地占比 ${(landEq / tot * 100).toFixed(1)}%`; }
    else if (item.includes('冰原苔原占比高')) { ok = pct('冰原') + pct('苔原') >= 20; note = `冰原${pct('冰原').toFixed(1)}% + 苔原${pct('苔原').toFixed(1)}%`; }
    else if (item.includes('西风带强烈') || item.includes('风暴走廊')) { ok = cfg.rotFactor > 1.1; note = `rotFactor ${cfg.rotFactor}`; }
    add('E', `期望: ${item}`, ok ? PASS : FAIL, note);
  }

  // 汇总
  const nFail = R.filter(r => r.status === FAIL).length;
  const nWarn = R.filter(r => r.status === WARN).length;
  const lines = [];
  lines.push(`# ${cfg.name} 自检报告`);
  lines.push('');
  lines.push(`生成参数: seed=${cfg.seed} / plates=${cfg.plates} / landTarget=${cfg.landTarget} / rotFactor=${cfg.rotFactor} / tilt=${cfg.tiltDeg}°`);
  lines.push('');
  lines.push(`**结果: ${R.length - nFail - nWarn} PASS / ${nWarn} WARN / ${nFail} FAIL**`);
  lines.push('');
  lines.push(`| 编号 | 检查项 | 结果 | 说明 |`);
  lines.push(`|---|---|---|---|`);
  for (const r of R) lines.push(`| ${r.id} | ${r.name} | ${r.status} | ${r.detail} |`);
  lines.push('');
  lines.push(`> 判定时间: ${new Date().toLocaleString('zh-CN')} · 工具: validate.js`);
  fs.writeFileSync(path.join(dir, '自检报告.md'), lines.join('\n'), 'utf8');
  console.log(`  [${cfg.name}] 自检: ${R.length - nFail - nWarn} PASS / ${nWarn} WARN / ${nFail} FAIL`);
  for (const r of R) if (r.status !== PASS) console.log(`    - [${r.status}] ${r.id} ${r.name} ${r.detail}`);
  return nFail;
}

// ---------- 入口 ----------
const only = process.argv.slice(2);
let totalFail = 0;
for (const cfg of P.planets) {
  if (only.length && !only.includes(cfg.id) && !only.includes(cfg.name)) continue;
  totalFail += validatePlanet(cfg);
}
console.log(totalFail === 0 ? '全部通过(无 FAIL)' : `共 ${totalFail} 个 FAIL, 需要迭代修复`);
process.exitCode = totalFail === 0 ? 0 : 1;
