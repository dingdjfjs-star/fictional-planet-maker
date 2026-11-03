'use strict';
// ============================================================
// 虚构行星生成管线
//   板块运动(欧拉极) → 地形(碰撞造山/洋中脊/裂谷/海沟/热点链)
//   → 大气环流(信风/西风/极风带+ITCZ) → 洋流(Sverdrup流函数等值线+边界流)
//   → 降水(信风路径/雨影/洋流调节) → 水文(优先淹没+D8汇流) → 气候分区
//   → 城邦文明 → GeoJSON/纹理PNG/设定书 输出
// 用法: node generate.js [planetId ...]
// 经验教训: 距离场必须 Float64(Float32 与 double 堆键比较会产生 ulp 级伪改进, Dijkstra 不收敛)
// ============================================================
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const P = require('./params');
const { makeNamer } = require('./names');

const W = P.gridW, H = P.gridH, N = W * H;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const DEG_KM = 111.32;

const ROOT = path.join(__dirname, '..', '数据');

// ---------------- 网格基础 ----------------
const LAT = new Float32Array(N), LON = new Float32Array(N);
const VEC = new Float32Array(N * 3);
const CELL_AREA = new Float32Array(N); // km²
for (let y = 0; y < H; y++) {
  const lat = 90 - (y + 0.5) * 180 / H;
  for (let x = 0; x < W; x++) {
    const lon = -180 + (x + 0.5) * 360 / W;
    const i = y * W + x;
    LAT[i] = lat; LON[i] = lon;
    const v = L.latLonToVec(lat, lon);
    VEC[i * 3] = v[0]; VEC[i * 3 + 1] = v[1]; VEC[i * 3 + 2] = v[2];
    CELL_AREA[i] = (180 / H) * DEG_KM * (360 / W) * DEG_KM * Math.cos(lat * D2R);
  }
}
const NB8 = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
  if (!dx && !dy) continue;
  NB8.push({ dx, dy, diag: (dx && dy) ? Math.SQRT2 : 1 });
}
function nbs(i) {
  const x = i % W, y = (i / W) | 0, out = [];
  for (const o of NB8) {
    const yy = y + o.dy; if (yy < 0 || yy >= H) continue;
    const xx = (x + o.dx + W) % W;
    out.push({ i: yy * W + xx, diag: o.diag });
  }
  return out;
}

// ============================================================
// 生成主流程
// ============================================================
function generatePlanet(cfg) {
  const t0 = Date.now();
  const log = (s) => console.log(`  [${cfg.name}] ${s}`);
  log(`开始生成 (seed=${cfg.seed})`);
  const rand = L.mulberry32(cfg.seed);
  const noise = L.makeNoise3(rand);
  const fbm = (v, oct) => noise.fbm(v[0], v[1], v[2], oct || 5);

  const outDir = path.join(ROOT, cfg.name);
  L.ensureDir(outDir);

  // ---------------- 1. 板块 ----------------
  const K = cfg.plates;
  const seeds = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < K; k++) {
    const z = 1 - (k + 0.5) * 2 / K;
    const r = Math.sqrt(1 - z * z);
    const th = ga * k;
    seeds.push(L.normVec([r * Math.cos(th), r * Math.sin(th), z]));
  }
  const idxs = seeds.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t; }
  const contSet = new Set(idxs.slice(0, cfg.continentalPlates));
  const isCont = (k) => contSet.has(k);

  // 大陆板块偏置: equator(超级大陆) / poles(高纬群岛); 大洋板块相应反向偏置
  if (cfg.continentBias === 'equator') {
    const contIdx = [...contSet];
    let lon0 = rand() * 360;
    contIdx.forEach((k, n) => {
      const la = (rand() - 0.5) * 12;
      const lo = lon0 + n * (360 / Math.max(1, cfg.continentalPlates)) + (rand() - 0.5) * 30;
      seeds[k] = L.latLonToVec(la, lo);
    });
    for (let k = 0; k < K; k++) {
      if (contSet.has(k)) continue;
      const [la, lo] = L.vecToLatLon(seeds[k]);
      const sg = la >= 0 ? 1 : -1;
      seeds[k] = L.latLonToVec(sg * (30 + Math.abs(la) * 0.35), lo);
    }
  } else if (cfg.continentBias === 'poles') {
    for (const k of contSet) {
      const [la, lo] = L.vecToLatLon(seeds[k]);
      const sign = la >= 0 ? 1 : -1;
      const la2 = sign * (46 + Math.min(36, Math.abs(la) * 0.45));
      seeds[k] = L.latLonToVec(la2, lo + (rand() - 0.5) * 24);
    }
    for (let k = 0; k < K; k++) {
      if (contSet.has(k)) continue;
      const [la, lo] = L.vecToLatLon(seeds[k]);
      seeds[k] = L.latLonToVec(la * 0.35, lo); // 大洋板块压向赤道带 → 赤道全球大洋
    }
  }

  // 欧拉极(角速度矢量, rad/Myr; 0.01 rad/Myr ≈ 6.4 cm/yr 板速, 接近地球量级)
  const omega = [];
  for (let k = 0; k < K; k++) {
    const axis = L.normVec([(rand() * 2 - 1), (rand() * 2 - 1), (rand() * 2 - 1)]);
    const w = L.rngRange(rand, 0.006, 0.016);
    omega.push(axis.map(c => c * w));
  }

  // 最近板块归属(含第二近, 用于边界距离)
  function assignPlates() {
    const plateId = new Int16Array(N);
    const gapDeg = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const vx = VEC[i * 3], vy = VEC[i * 3 + 1], vz = VEC[i * 3 + 2];
      let b1 = -2, d1 = -2, d2 = -2;
      for (let k = 0; k < K; k++) {
        const s = seeds[k];
        const d = vx * s[0] + vy * s[1] + vz * s[2];
        if (d > d1) { d2 = d1; b1 = k; d1 = d; } else if (d > d2) { d2 = d; }
      }
      plateId[i] = b1;
      const a1 = Math.acos(L.clamp(d1, -1, 1)) * R2D, a2 = Math.acos(L.clamp(d2, -1, 1)) * R2D;
      gapDeg[i] = (a2 - a1) / 2;
    }
    return { plateId, gapDeg };
  }
  let grid = assignPlates();

  function adjacency(plateId) {
    const adj = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = plateId[y * W + x];
      const xe = (x + 1) % W;
      if (y + 1 < H) { const b = plateId[(y + 1) * W + x]; if (a !== b) adj.add(Math.min(a, b) * 100 + Math.max(a, b)); }
      const c = plateId[y * W + xe]; if (a !== c) adj.add(Math.min(a, c) * 100 + Math.max(a, c));
    }
    return adj;
  }
  function contContPairs(adj) {
    const out = [];
    for (const key of adj) {
      const a = (key / 100) | 0, b = key % 100;
      if (isCont(a) && isCont(b)) out.push([a, b]);
    }
    return out;
  }

  // 超级大陆保障: 两大陆板块必须相邻
  if (cfg.continentBias === 'equator' && cfg.continentalPlates >= 2) {
    let tries = 0;
    while (tries++ < 8) {
      const adj = adjacency(grid.plateId);
      if (contContPairs(adj).length) break;
      const ci = [...contSet];
      const [a, b] = [ci[0], ci[1]];
      seeds[a] = L.normVec([seeds[a][0] + seeds[b][0], seeds[a][1] + seeds[b][1], seeds[a][2] + seeds[b][2] * 0.3]);
      grid = assignPlates();
    }
    log(`超级大陆邻接调整 ${tries} 次`);
  }
  // 碰撞造山保障: 至少一对相邻大陆板块
  if (cfg.forceCollision) {
    let tries = 0;
    while (tries++ < 8) {
      const adj = adjacency(grid.plateId);
      if (contContPairs(adj).length) break;
      const ci = [...contSet];
      const [a, b] = [ci[0], ci[1]];
      seeds[a] = L.normVec([seeds[a][0] + seeds[b][0] * 0.5, seeds[a][1] + seeds[b][1] * 0.5, seeds[a][2] + seeds[b][2] * 0.5]);
      grid = assignPlates();
    }
    log(`碰撞对保障调整 ${tries} 次`);
  }

  const pairKey = (a, b) => Math.min(a, b) * 100 + Math.max(a, b);
  function classifyPairs() {
    const pairs = new Map();
    for (let k1 = 0; k1 < K; k1++) for (let k2 = k1 + 1; k2 < K; k2++) {
      const m = L.normVec([seeds[k1][0] + seeds[k2][0], seeds[k1][1] + seeds[k2][1], seeds[k1][2] + seeds[k2][2]]);
      const ta = [seeds[k1][0] - m[0] * L.dotVec(seeds[k1], m), seeds[k1][1] - m[1] * L.dotVec(seeds[k1], m), seeds[k1][2] - m[2] * L.dotVec(seeds[k1], m)];
      const tb = [seeds[k2][0] - m[0] * L.dotVec(seeds[k2], m), seeds[k2][1] - m[1] * L.dotVec(seeds[k2], m), seeds[k2][2] - m[2] * L.dotVec(seeds[k2], m)];
      const nh = L.normVec([tb[0] - ta[0], tb[1] - ta[1], tb[2] - ta[2]]); // k1侧 → k2侧
      const vA = L.crossVec(omega[k1], m), vB = L.crossVec(omega[k2], m);
      const rel = [vB[0] - vA[0], vB[1] - vA[1], vB[2] - vA[2]];
      const mag = Math.hypot(...rel);
      const c = L.dotVec(rel, nh); // >0 张裂, <0 汇聚
      let type = 'transform';
      if (mag < 0.002) type = 'stalled';
      else if (c > 0.55 * mag) type = 'div';
      else if (c < -0.55 * mag) type = 'conv';
      pairs.set(pairKey(k1, k2), { a: k1, b: k2, type, conv: Math.max(0, -c), div: Math.max(0, c), mag, n: nh, mid: m });
    }
    return pairs;
  }

  // 强制裂谷 / 强制碰撞: 调整欧拉极
  const tectonicNotes = [];
  {
    const adj = adjacency(grid.plateId);
    const ccp = contContPairs(adj);
    if (cfg.forceRift && ccp.length) {
      const [a, b] = ccp[0];
      const m = L.normVec([seeds[a][0] + seeds[b][0], seeds[a][1] + seeds[b][1], seeds[a][2] + seeds[b][2]]);
      const nRaw = [seeds[b][0] - seeds[a][0], seeds[b][1] - seeds[a][1], seeds[b][2] - seeds[a][2]];
      const nh = L.normVec([nRaw[0] - m[0] * L.dotVec(nRaw, m), nRaw[1] - m[1] * L.dotVec(nRaw, m), nRaw[2] - m[2] * L.dotVec(nRaw, m)]);
      const t = L.normVec(L.crossVec(nh, m));
      const wr = 0.011;
      // rel=(Ωb−Ωa)×m = −wr·(t̂×m) = +wr·n̂ (因 (n̂×m)×m=−n̂) → rel·n̂>0 张裂
      omega[b] = [omega[a][0] - t[0] * wr, omega[a][1] - t[1] * wr, omega[a][2] - t[2] * wr];
      tectonicNotes.push(`强制张裂: 板块${a}/${b}欧拉极重设, 中央裂谷贯穿大陆`);
    } else if (cfg.forceRift) {
      tectonicNotes.push('希望强制张裂但无相邻大陆板块对, 未生效');
    }
    if (cfg.forceCollision && ccp.length) {
      const [a, b] = ccp[0];
      const m = L.normVec([seeds[a][0] + seeds[b][0], seeds[a][1] + seeds[b][1], seeds[a][2] + seeds[b][2]]);
      const nRaw = [seeds[b][0] - seeds[a][0], seeds[b][1] - seeds[a][1], seeds[b][2] - seeds[a][2]];
      const nh = L.normVec([nRaw[0] - m[0] * L.dotVec(nRaw, m), nRaw[1] - m[1] * L.dotVec(nRaw, m), nRaw[2] - m[2] * L.dotVec(nRaw, m)]);
      const t = L.normVec(L.crossVec(nh, m));
      const wc = 0.010;
      // rel=+wc·(t̂×m) = −wc·n̂ → rel·n̂<0 汇聚(碰撞)
      omega[b] = [omega[a][0] + t[0] * wc, omega[a][1] + t[1] * wc, omega[a][2] + t[2] * wc];
      tectonicNotes.push(`强制碰撞: 板块${a}/${b}欧拉极重设, 大陆碰撞造山带就位`);
    }
  }
  const pairs = classifyPairs();

  // 板块命名与信息
  const namer = makeNamer(cfg.culture, cfg.seed);
  const plateInfo = [];
  for (let k = 0; k < K; k++) {
    plateInfo.push({
      id: k, name: namer.named(isCont(k) ? 'basin' : 'sea').replace(/[泽原湾岬]$/, isCont(k) ? '陆' : '洋板块'),
      continental: isCont(k),
      speedCmYr: +(Math.hypot(...omega[k]) * 637).toFixed(1), // rad/Myr × R(km) × 0.1 = cm/yr
      axis: L.vecToLatLon(L.normVec(omega[k])).map(v => +v.toFixed(1))
    });
  }

  // ---------------- 2. 地形 ----------------
  const phiH = L.clamp(30 / cfg.rotFactor, 16, 46); // 哈德里环宽度(度)
  const itczAmp = L.clamp(cfg.tiltDeg * 0.42, 0, 22); // ITCZ 季节摆幅(度)

  // 相邻大陆板块对的球面弧段(用于陆桥)与点到弧的角距
  const contArcs = [];
  {
    const adj0 = adjacency(grid.plateId);
    for (const key of adj0) {
      const a = (key / 100) | 0, b = key % 100;
      if (isCont(a) && isCont(b)) contArcs.push({ a: seeds[a], b: seeds[b], pole: L.normVec(L.crossVec(seeds[a], seeds[b])) });
    }
  }
  function arcDist(arc, px, py, pz) {
    const pv = [px, py, pz];
    const dPole = Math.abs(L.dotVec(pv, arc.pole)); // sin(到该大圆的角距)
    const toCircle = Math.asin(L.clamp(dPole, 0, 1)) * R2D;
    // 足点是否落在弧段内(a→b 的短弧): 足点与 a、b 的内积应 ≥ dot(a,b)
    const comp = [pv[0] - arc.pole[0] * L.dotVec(pv, arc.pole), pv[1] - arc.pole[1] * L.dotVec(pv, arc.pole), pv[2] - arc.pole[2] * L.dotVec(pv, arc.pole)];
    const cl = Math.hypot(...comp);
    if (cl < 1e-9) return 0;
    const foot = [comp[0] / cl, comp[1] / cl, comp[2] / cl];
    const ab = L.dotVec(arc.a, arc.b);
    if (L.dotVec(foot, arc.a) >= ab - 1e-9 && L.dotVec(foot, arc.b) >= ab - 1e-9) return toCircle;
    // 弧外: 取到两端点的较小角距
    return Math.min(Math.acos(L.clamp(L.dotVec(pv, arc.a), -1, 1)), Math.acos(L.clamp(L.dotVec(pv, arc.b), -1, 1))) * R2D;
  }

  const s = new Float32Array(N);
  {
    const contSeeds = [], oceanSeeds = [];
    for (let k = 0; k < K; k++) (isCont(k) ? contSeeds : oceanSeeds).push(seeds[k]);
    for (let i = 0; i < N; i++) {
      const vx = VEC[i * 3], vy = VEC[i * 3 + 1], vz = VEC[i * 3 + 2];
      let dc = 180, dO = 180;
      for (const sv of contSeeds) { const d = vx * sv[0] + vy * sv[1] + vz * sv[2]; if (d > Math.cos(dc * D2R)) dc = Math.acos(L.clamp(d, -1, 1)) * R2D; }
      for (const sv of oceanSeeds) { const d = vx * sv[0] + vy * sv[1] + vz * sv[2]; if (d > Math.cos(dO * D2R)) dO = Math.acos(L.clamp(d, -1, 1)) * R2D; }
      const t = (dO - dc) / (dO + dc + 1e-6);
      const p = [VEC[i * 3], VEC[i * 3 + 1], VEC[i * 3 + 2]];
      const n1 = fbm([p[0] * 2.1, p[1] * 2.1, p[2] * 2.1], 4);
      const n2 = fbm([p[0] * 6.3, p[1] * 6.3, p[2] * 6.3], 4);
      // 关键: 0.10+0.74 压缩动态范围, 防止大陆内部 s 饱和到 1.0
      // (饱和会让分位数阈值 thr→1, 使 u/landFac 的 smoothstep 窗口失效, 造山被压扁)
      s[i] = 0.10 + 0.74 * (t + 1) / 2 + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.24;
      // 陆-陆焊接走廊: 相邻大陆板块对之间保证为陆(否则碰撞造山带会沉入两陆之间的海域)
      for (const arc of contArcs) {
        const d = arcDist(arc, VEC[i * 3], VEC[i * 3 + 1], VEC[i * 3 + 2]);
        if (d < 16) s[i] += 0.22 * Math.exp(-(d * d) / 49);
      }
      s[i] = L.clamp(s[i], 0, 1);
    }
    const sb = L.boxBlur1(s, W, H); sb.forEach((v, i) => s[i] = v);
  }
  const sSorted = Float32Array.from(s).sort();
  const thr = sSorted[Math.min(N - 1, Math.floor((1 - cfg.landTarget) * N))];

  const elev = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = [VEC[i * 3] * 7, VEC[i * 3 + 1] * 7, VEC[i * 3 + 2] * 7];
    const detail = (fbm(p, 5) - 0.5) * 2;
    if (s[i] > thr) {
      const u = L.smoothstep(thr, thr + 0.20, s[i]);
      elev[i] = 25 + 950 * Math.pow(u, 1.9) + 240 * detail * (0.4 + u);
    } else {
      const v = L.smoothstep(thr - 0.16, thr, s[i]);
      elev[i] = -60 - 3700 * Math.pow(1 - v, 1.25) + 200 * detail;
    }
  }
  {
    const eb = L.boxBlur1(elev, W, H); eb.forEach((v, i) => elev[i] = v);
  }
  // 构造抬升/沉降
  {
    for (let i = 0; i < N; i++) {
      const p1 = grid.plateId[i], gap0 = grid.gapDeg[i];
      const vx = VEC[i * 3], vy = VEC[i * 3 + 1], vz = VEC[i * 3 + 2];
      let b2 = -1, d2v = -2;
      const s1 = seeds[p1];
      for (let k = 0; k < K; k++) {
        if (k === p1) continue;
        const sk = seeds[k];
        const d = vx * sk[0] + vy * sk[1] + vz * sk[2];
        if (d > d2v) { d2v = d; b2 = k; }
      }
      const pair = pairs.get(pairKey(p1, b2));
      if (!pair) continue;
      // 边界摆动: 双尺度(板块级大弯曲 ±6° + 局部破碎 ±2°), 消除 Voronoi 直线感
      const wob = (fbm([VEC[i * 3] * 2.0, VEC[i * 3 + 1] * 2.0, VEC[i * 3 + 2] * 2.0], 3) - 0.5) * 12
        + (fbm([VEC[i * 3] * 5.0, VEC[i * 3 + 1] * 5.0, VEC[i * 3 + 2] * 5.0], 4) - 0.5) * 4;
      const g = Math.max(0.05, gap0 + wob);
      const g2 = g * g;
      const bothCont = isCont(pair.a) && isCont(pair.b);
      const iAmCont = isCont(p1);
      // 关键: 构造效应按实际海陆调制, 防止"海沟刻进大陆"这类逻辑漏洞
      const landFac = L.smoothstep(thr - 0.06, thr + 0.12, s[i]);
      const oceanFac = 1 - landFac;
      // 走向衰减: 让弧/脊/沟沿边界时隐时现(消除全边界均匀的"瓷砖感")
      const fade = 0.35 + 0.65 * fbm([VEC[i * 3] * 1.5, VEC[i * 3 + 1] * 1.5, VEC[i * 3 + 2] * 1.5], 3);
      const iAmB = (p1 === pair.b);
      let dE = 0;
      if (pair.type === 'conv') {
        const C = pair.conv;
        if (bothCont) {
          dE += C * 6.0e5 * Math.exp(-g2 / (3.4 * 3.4)) * (0.8 + 0.5 * fbm([VEC[i * 3] * 9, VEC[i * 3 + 1] * 9, VEC[i * 3 + 2] * 9], 4)) * landFac;
        } else if (iAmCont) { // 大陆侧: 造山 + 岩浆弧
          dE += C * 2.0e5 * Math.exp(-g2 / (1.9 * 1.9)) * landFac;
          const gd = (g - 1.15) / 0.8;
          dE += C * 1.0e5 * Math.exp(-gd * gd) * landFac;
        } else if (!iAmCont && (isCont(pair.a) || isCont(pair.b))) { // 大洋侧俯冲: 海沟
          dE -= 3400 * Math.exp(-g2 / (0.9 * 0.9)) * oceanFac * fade;
        } else { // 洋-洋汇聚: 一侧海沟一侧岛弧
          const gd = (g - 0.95) / 0.7;
          dE += (iAmB ? 1600 : 0) * Math.exp(-gd * gd) * oceanFac * fade;
          dE -= (iAmB ? 0 : 2800) * Math.exp(-g2 / (0.6 * 0.6)) * oceanFac * fade;
        }
      } else if (pair.type === 'div') {
        if (bothCont) { // 裂谷
          dE -= 2000 * Math.exp(-g2 / (1.25 * 1.25)) * landFac;
          const gd = (g - 1.9) / 1.2;
          dE += 1600 * Math.exp(-gd * gd) * landFac;
        } else if (!iAmCont) { // 洋中脊(带起伏+走向衰减)
          dE += (1700 + 1400 * fbm([VEC[i * 3] * 2.8, VEC[i * 3 + 1] * 2.8, VEC[i * 3 + 2] * 2.8], 4)) * Math.exp(-g2 / (1.7 * 1.7)) * oceanFac * fade;
        } else {
          dE += 400 * Math.exp(-g2 / (1.3 * 1.3)) * landFac;
        }
      } else if (pair.type === 'transform') {
        dE += 300 * Math.exp(-g2 / (0.9 * 0.9));
      }
      // 岩石圈年龄效应: 远离洋中脊的洋壳热沉降(宽缓梯度, 消除板内均匀"瓷砖"感)
      if (pair.type !== 'div') dE -= 550 * Math.exp(-g2 / 81) * oceanFac;
      elev[i] += dE;
    }
  }
  // 热点链
  const hotspots = [];
  for (let hIdx = 0; hIdx < cfg.hotspots; hIdx++) {
    let hv = null, plate = 0, tries = 0;
    while (tries++ < 24) {
      hv = L.normVec([(rand() * 2 - 1), (rand() * 2 - 1), (rand() * 2 - 1)]);
      let bd = -2;
      for (let k = 0; k < K; k++) { const d = L.dotVec(hv, seeds[k]); if (d > bd) { bd = d; plate = k; } }
      if (!isCont(plate)) break; // 优先大洋热点
    }
    const v = L.crossVec(omega[plate], hv);
    const vm = Math.hypot(...v);
    const dir = vm > 1e-6 ? [v[0] / vm, v[1] / vm, v[2] / vm] : L.normVec(L.crossVec(hv, [0, 0, 1]));
    const nNodes = 4 + (rand() * 6 | 0);
    const onLand = (() => {
      const [la, lo] = L.vecToLatLon(hv);
      const x = L.clamp(Math.floor((lo + 180) / 360 * W), 0, W - 1), y = L.clamp(Math.floor((90 - la) / 180 * H), 0, H - 1);
      return elev[y * W + x] > 0;
    })();
    const amp0 = onLand ? L.rngRange(rand, 700, 1300) : L.rngRange(rand, 4200, 5600);
    const nodes = [];
    for (let j = 0; j < nNodes; j++) {
      const ang = -1.65 * j * D2R; // 沿运动反方向(板块过去轨迹)
      const nodeV = L.rotateAround(hv, dir, ang);
      nodes.push({ v: nodeV, amp: amp0 * Math.exp(-j * 0.35) });
      const [nla, nlo] = L.vecToLatLon(nodeV);
      for (let y = 0; y < H; y++) {
        const dLat = Math.abs(90 - (y + 0.5) * 180 / H - nla);
        if (dLat > 4) continue;
        for (let x = 0; x < W; x++) {
          let dLon = Math.abs(-180 + (x + 0.5) * 360 / W - nlo);
          if (dLon > 180) dLon = 360 - dLon;
          if (dLon > 4 / Math.max(0.2, Math.cos(nla * D2R))) continue;
          const dDeg = Math.hypot(dLat, dLon * Math.cos(nla * D2R));
          const i = y * W + x;
          elev[i] += nodes[j].amp * Math.exp(-(dDeg * dDeg) / (0.55 * 0.55));
        }
      }
    }
    hotspots.push({ v: hv, nodes, onLand, plate });
  }
  for (let i = 0; i < N; i++) elev[i] = L.clamp(elev[i], -8800, 7900);

  // 海平面重定基准: 构造/热点效应会整体改变高度分布, 平移使陆地占比精确命中目标(等价于海平面升降)
  {
    const elevSorted = Float32Array.from(elev).sort();
    const seaShift = elevSorted[Math.min(N - 1, Math.floor((1 - cfg.landTarget) * N))];
    for (let i = 0; i < N; i++) elev[i] -= seaShift;
  }

  // [DEBUG] 每板块大洋平均深度 + 最高陆峰 + 陆-陆板块对类型(检查造山是否生效)
  {
    const acc2 = new Float64Array(K), cnt2 = new Float64Array(K);
    let maxE = 0;
    for (let i = 0; i < N; i++) {
      if (elev[i] > 0) { if (elev[i] > maxE) maxE = elev[i]; }
      else if (s[i] < thr - 0.10) { acc2[grid.plateId[i]] += elev[i]; cnt2[grid.plateId[i]]++; }
    }
    const means = [];
    for (let k = 0; k < K; k++) if (cnt2[k] > 500) means.push((acc2[k] / cnt2[k]).toFixed(0));
    const ccInfo = [];
    for (const [k1, pair] of pairs) {
      if (isCont(pair.a) && isCont(pair.b)) ccInfo.push(`${pair.a}-${pair.b}:${pair.type}/${(pair.conv * 637).toFixed(1)}`);
    }
    log(`[debug] 深海均值: ${means.join(', ')} | 最高陆峰: ${maxE.toFixed(0)}m | 陆陆对: ${ccInfo.join(' ') || '无'}`);
  }

  const ocean = new Uint8Array(N);
  let landCount = 0;
  for (let i = 0; i < N; i++) { ocean[i] = elev[i] < 0 ? 1 : 0; if (!ocean[i]) landCount++; }
  const landPct = landCount / N;
  log(`陆地占比 ${(landPct * 100).toFixed(1)}% (目标 ${(cfg.landTarget * 100).toFixed(0)}%), φ_H=${phiH.toFixed(0)}°`);
  const stats = { name: cfg.name, landPct: +landPct.toFixed(4), phiH: +phiH.toFixed(1), itczAmp: +itczAmp.toFixed(1), tectonicNotes };

  // ---------------- 3. 大气环流(风带) ----------------
  const windU = new Float32Array(N), windV = new Float32Array(N); // u向东 v向北 m/s
  function beltWind(lat) {
    const la = Math.abs(lat), sg = Math.sign(lat) || 1;
    if (la < phiH) {
      const f = la / phiH;
      return [-6.0 * (1 - f * f) - 1.0, -sg * 1.8 * (1 - f)];
    } else if (la < 64) {
      const f = (la - phiH) / (64 - phiH), sn = Math.sin(Math.PI * f);
      return [7.5 * sn + 1.0, sg * 1.3 * sn];
    } else {
      const f = (la - 64) / 26;
      return [-2.2 * (1 - f * 0.5), 0];
    }
  }
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * 180 / H;
    const [u, v] = beltWind(lat);
    for (let x = 0; x < W; x++) { windU[y * W + x] = u; windV[y * W + x] = v; }
  }

  // ---------------- 4. 洋流 ----------------
  const { comps: oceanComps } = L.connectedComponents(ocean, W, H);
  // 4.1 Sverdrup 流函数
  const psi = new Float32Array(N);
  const LAND_PSI = -1e9;
  psi.fill(LAND_PSI);
  {
    const curl = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!ocean[i]) continue;
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const dtx = (windV[y * W + xp] - windV[y * W + xm]) / 2;
      const dty = (windU[(y + 1) * W + x] - windU[(y - 1) * W + x]) / 2;
      curl[i] = dtx - dty;
    }
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (!ocean[y * W + x]) { x++; continue; }
        let xe = x;
        while (xe + 1 < W && ocean[y * W + xe + 1]) xe++;
        const cosl = Math.max(0.15, Math.cos((90 - (y + 0.5) * 180 / H) * D2R));
        let acc = 0;
        for (let xi = x; xi <= xe; xi++) {
          acc += curl[y * W + xi] * 1.2 / cosl;
          psi[y * W + xi] = acc;
        }
        x = xe + 1;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const outp = Float32Array.from(psi);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!ocean[i]) continue;
        let sum = 0, cnt = 0;
        for (const nb of nbs(i)) if (ocean[nb.i]) { sum += psi[nb.i]; cnt++; }
        if (cnt) outp[i] = sum / cnt;
      }
      outp.forEach((v, i) => { if (ocean[i]) psi[i] = v; });
    }
  }
  // 4.2 marching squares 提取 ψ 等值线 → 流线
  function marchingSquares(field, level) {
    const segs = [];
    const F = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return LAND_PSI;
      return field[y * W + x];
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v00 = F(x, y), v10 = F(x + 1, y), v01 = F(x, y + 1), v11 = F(x + 1, y + 1);
        if (v00 === LAND_PSI || v10 === LAND_PSI || v01 === LAND_PSI || v11 === LAND_PSI) continue;
        const b00 = v00 > level, b10 = v10 > level, b11 = v11 > level, b01 = v01 > level;
        const cross = [];
        if (b00 !== b10) cross.push([x + (level - v00) / (v10 - v00), y]);
        if (b10 !== b11) cross.push([x + 1, y + (level - v10) / (v11 - v10)]);
        if (b01 !== b11) cross.push([x + (level - v01) / (v11 - v01), y + 1]);
        if (b00 !== b01) cross.push([x, y + (level - v00) / (v01 - v00)]);
        if (cross.length === 2) segs.push([cross[0], cross[1]]);
        else if (cross.length === 4) { segs.push([cross[0], cross[1]]); segs.push([cross[2], cross[3]]); }
      }
    }
    const key = (p) => p[0].toFixed(5) + '|' + p[1].toFixed(5);
    const adjMap = new Map();
    segs.forEach((sg, si) => {
      for (const p of sg) {
        const k = key(p);
        if (!adjMap.has(k)) adjMap.set(k, []);
        adjMap.get(k).push(si);
      }
    });
    const used = new Uint8Array(segs.length);
    const lines = [];
    for (let si = 0; si < segs.length; si++) {
      if (used[si]) continue;
      used[si] = 1;
      const line = [segs[si][0], segs[si][1]];
      for (;;) {
        const k = key(line[line.length - 1]);
        const cands = adjMap.get(k) || [];
        let nextSeg = -1;
        for (const c of cands) if (!used[c]) { nextSeg = c; break; }
        if (nextSeg < 0) break;
        used[nextSeg] = 1;
        const [a, b] = segs[nextSeg];
        line.push(key(a) === k ? b : a);
        if (key(line[0]) === key(line[line.length - 1])) break;
      }
      if (line.length >= 6) lines.push(line);
    }
    return lines;
  }
  const oceanPsi = [];
  for (let i = 0; i < N; i++) if (ocean[i]) oceanPsi.push(psi[i]);
  oceanPsi.sort((a, b) => a - b);
  const q = (f) => oceanPsi[Math.floor(f * oceanPsi.length)] || 0;
  const levels = [];
  for (let f = 0.14; f <= 0.86; f += 0.72 / 7) levels.push(q(f)); // 8 条等值线: 流线只作背景细节, 避免满屏杂线

  function psiGrad(i) {
    const x = i % W, y = (i / W) | 0;
    const xm = (x - 1 + W) % W, xp = (x + 1) % W;
    const pxm = psi[y * W + xm], pxp = psi[y * W + xp];
    const pym = y > 0 ? psi[(y - 1) * W + x] : LAND_PSI;
    const pyp = y < H - 1 ? psi[(y + 1) * W + x] : LAND_PSI;
    if (pxm === LAND_PSI || pxp === LAND_PSI || pym === LAND_PSI || pyp === LAND_PSI) return null;
    return [(pxp - pxm) / 2, (pyp - pym) / 2];
  }
  const currentFeatures = [];
  function addCurrentLine(line, kind, speed, note, forceDir) {
    // line: [[x,y](网格角坐标)] → lon/lat; 同样钳制极点/±180(RhumbLine 在极点发散 → NaN)
    // 注意: toFixed(2) 会把 179.999 舍入回 ±180, 因此钳制必须在舍入之后
    const cl = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
    const lls = line.map(([x, y]) => {
      let lo = +(-180 + 360 * x / W).toFixed(2);
      let la = +(90 - 180 * y / H).toFixed(2);
      return [cl(lo, -179.999, 179.999), cl(la, -89.9, 89.9)];
    });
    if (lls.length < 4) return null;
    const mid = lls[(lls.length / 2) | 0];
    const sg = mid[1] >= 0 ? 1 : -1;
    let flowLonLat = null;
    if (forceDir) {
      flowLonLat = forceDir;
    } else {
      const xs = L.clamp(Math.round((mid[0] + 180) / 360 * W - 0.5), 0, W - 1);
      const ys = L.clamp(Math.round((90 - mid[1]) / 180 * H - 0.5), 0, H - 1);
      const si = ys * W + xs;
      if (ocean[si] && psi[si] !== LAND_PSI) {
        const g = psiGrad(si);
        if (g) {
          const [gpx, gpy] = g;
          const c1 = [-gpy, gpx], c2 = [gpy, -gpx];
          const toMap = (c) => [c[0], -c[1]];
          const m1 = toMap(c1), m2 = toMap(c2);
          const wantPole = sg;
          const choose = (m) => (m[0] * 0.2 + m[1] * 1.0 * wantPole);
          if (Math.abs(mid[1]) < phiH + 18) flowLonLat = choose(m1) > choose(m2) ? m1 : m2;
          else flowLonLat = sg > 0 ? (m1[0] > 0 ? m1 : m2) : (m1[0] > 0 ? m2 : m1);
          const fl = Math.hypot(flowLonLat[0], flowLonLat[1]) || 1;
          flowLonLat = [flowLonLat[0] / fl, flowLonLat[1] / fl];
        }
      }
    }
    if (flowLonLat) {
      const dotFlow = (a, b) => a[0] * b[0] + a[1] * b[1];
      const startDir = [lls[1][0] - lls[0][0], lls[1][1] - lls[0][1]];
      if (dotFlow(startDir, flowLonLat) < 0) lls.reverse();
    }
    // lls 已舍入+钳制, 直接用 —— 二次 toFixed(2) 会把 179.999 又舍回 ±180(崩溃顶点)
    let coords = L.simplifyDP(lls, 0.6);
    coords.forEach((c, ci) => {
      if (Math.abs(c[0]) > 179.9999 || Math.abs(c[1]) > 89.99) {
        console.warn(`[钳制失效] kind=${kind} idx=${ci} v=${JSON.stringify(c)} lls邻居=${JSON.stringify(lls[Math.max(0, ci - 1)])}|${JSON.stringify(lls[Math.min(lls.length - 1, ci + 1)])}`);
      }
    });
    if (coords.length < 3) {
      // 直线型洋流(赤道流/环极流)会被 DP 坍缩成 2 点 → 等距回退采样
      const step = Math.max(1, Math.floor(lls.length / 80));
      coords = [];
      for (let i = 0; i < lls.length; i += step) coords.push([+lls[i][0].toFixed(2), +lls[i][1].toFixed(2)]);
      const lastLL = lls[lls.length - 1];
      const lastC = coords[coords.length - 1];
      if (!lastC || lastC[0] !== +lastLL[0].toFixed(2) || lastC[1] !== +lastLL[1].toFixed(2)) coords.push([+lastLL[0].toFixed(2), +lastLL[1].toFixed(2)]);
    }
    if (coords.length < 3) return null;
    // 每段独立 Feature + 预细分: 避免 MultiLineString 拼接与长直线段在 Cesium 中崩溃
    const props = {
      类型: kind, 流速: +speed.toFixed(1), 性质: note || '', 走向: flowLonLat ? [+flowLonLat[0].toFixed(2), +flowLonLat[1].toFixed(2)] : [0, 0]
    };
    let f = null;
    for (const part of L.splitLineAtAntimeridian(coords)) {
      for (const ft of L.splitLineFeatures(props, L.subdivideLine(part, 1.5))) {
        currentFeatures.push(ft);
        if (!f) f = ft;
      }
    }
    return f;
  }
  for (const lv of levels) {
    for (const line of marchingSquares(psi, lv)) {
      if (line.length < 12) continue; // 过滤碎线
      const mid = line[(line.length / 2) | 0];
      const lat = 90 - 180 * mid[1] / H;
      let speed = 1.6 + rand() * 0.8;
      if (Math.abs(lat) < phiH + 6 && lat !== 0) speed = 2.2;
      addCurrentLine(line, '环流段', speed, '');
    }
  }
  // 环流段数量上限(保长去短)
  {
    const loops = currentFeatures.filter(f => f.properties.类型 === '环流段');
    if (loops.length > 60) {
      const keep = new Set(loops.sort((a, b) => b.geometry.coordinates.length - a.geometry.coordinates.length).slice(0, 60).map(f => f));
      for (let i = currentFeatures.length - 1; i >= 0; i--) {
        if (currentFeatures[i].properties.类型 === '环流段' && !keep.has(currentFeatures[i])) currentFeatures.splice(i, 1);
      }
    }
  }
  // 4.4 西边界流 / 东边界流(沿海岸)
  function coastCurrents(hemisphere) {
    const rowOf = (lat) => Math.floor((90 - lat) / 180 * H);
    const rowFrom = Math.min(rowOf(6 * hemisphere), rowOf((phiH + 12) * hemisphere));
    const rowTo = Math.max(rowOf(6 * hemisphere), rowOf((phiH + 12) * hemisphere));
    const westCells = [], eastCells = [];
    for (let y = rowFrom; y <= rowTo; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!ocean[i]) continue;
        const xw = (x - 1 + W) % W, xe = (x + 1) % W;
        if (!ocean[y * W + xw]) westCells.push({ x, y });
        if (!ocean[y * W + xe]) eastCells.push({ x, y });
      }
    }
    function chain(cells) {
      if (!cells.length) return [];
      const pts = [cells[0]];
      const usedC = new Set([cells[0].y * W + cells[0].x]);
      for (;;) {
        const last = pts[pts.length - 1];
        let best = null, bd = 3;
        for (const c of cells) {
          const k = c.y * W + c.x;
          if (usedC.has(k)) continue;
          let dLon = Math.abs(c.x - last.x); dLon = Math.min(dLon, W - dLon);
          const d = Math.hypot(dLon, c.y - last.y);
          if (d < bd) { bd = d; best = c; }
        }
        if (!best) break;
        usedC.add(best.y * W + best.x);
        pts.push(best);
      }
      return pts;
    }
    const westLine = chain(westCells).map(c => [c.x + 0.5, c.y + 0.5]);
    const eastLine = chain(eastCells).map(c => [c.x + 0.5, c.y + 0.5]);
    if (westLine.length > 10) addCurrentLine(westLine, '西边界流', 4.8, '暖流·向极', [0, hemisphere]);
    if (eastLine.length > 10) addCurrentLine(eastLine, '东边界流', 1.9, '寒流·向赤道', [0, -hemisphere]);
  }
  coastCurrents(1); coastCurrents(-1);
  // 4.5 赤道流系
  {
    for (const [latT, kind, speed, note, fdir] of [[3.5, '赤道流', 3.2, '西向信风驱动', [-1, 0]], [8, '赤道逆流', 2.2, '东向补偿流', [1, 0]], [-3.5, '赤道流', 3.2, '西向信风驱动', [-1, 0]]]) {
      const y = Math.floor((90 - latT) * H / 180);
      if (y <= 0 || y >= H - 1) continue;
      const cells = [];
      for (let x = 0; x < W; x++) if (ocean[y * W + x]) cells.push(x);
      if (cells.length < W * 0.35) continue;
      const line = cells.map(x => [x + 0.5, y + 0.5]);
      addCurrentLine(line, kind, speed, note, fdir);
    }
  }
  // 4.6 环极流(高纬全通海道)
  {
    let bestRow = -1, bestFrac = 0.85;
    for (let y = Math.floor(H * 0.06); y < Math.floor(H * 0.40); y++) {
      let cnt = 0; for (let x = 0; x < W; x++) if (ocean[y * W + x]) cnt++;
      if (cnt / W > bestFrac) { bestFrac = cnt / W; bestRow = y; }
    }
    for (let y = Math.floor(H * 0.60); y < Math.floor(H * 0.94); y++) {
      let cnt = 0; for (let x = 0; x < W; x++) if (ocean[y * W + x]) cnt++;
      if (cnt / W > bestFrac) { bestFrac = cnt / W; bestRow = y; }
    }
    if (bestRow >= 0) {
      const line = [];
      let x = 0, y = bestRow;
      for (let step = 0; step < W * 2; step++) {
        line.push([x + 0.5, y + 0.5]);
        let moved = false;
        for (const [dy, dxd] of [[0, 1], [-1, 1], [1, 1]]) {
          const yy = y + dy, xx = (x + dxd + W) % W;
          if (yy < 0 || yy >= H || !ocean[yy * W + xx]) continue;
          x = xx; y = yy; moved = true; break;
        }
        if (!moved) break;
        if (x === 0 && step > W * 0.8) break;
      }
      if (line.length > W * 0.8) addCurrentLine(line, '环极流', 4.4, '寒流·东向环绕', [1, 0]);
    }
  }
  // 4.65 洋流命名
  {
    const usedNames = new Set();
    for (const f of currentFeatures) {
      const t = f.properties.类型;
      let nm;
      if (t === '西边界流') nm = namer.named('sea').replace(/海|湾|洋$/, '') + '暖流';
      else if (t === '东边界流') nm = namer.named('sea').replace(/海|湾|洋$/, '') + '寒流';
      else if (t === '赤道流') nm = '赤道暖流';
      else if (t === '赤道逆流') nm = '赤道逆流';
      else if (t === '环极流') nm = '环极寒流';
      else nm = namer.named('sea').replace(/海|湾|洋$/, '') + '洋流';
      let final = nm, n = 2;
      while (usedNames.has(final)) final = nm + (n++);
      usedNames.add(final);
      f.properties.名称 = final;
    }
  }
  // 4.7 洋流沿岸影响栅格(暖/寒)
  const currentWarm = new Uint8Array(N), currentCold = new Uint8Array(N);
  for (const f of currentFeatures) {
    const warm = /暖/.test(f.properties.性质);
    const cold = /寒/.test(f.properties.性质);
    if (!warm && !cold) continue;
    for (const [lo, la] of f.geometry.coordinates) {
      const cx = Math.floor((lo + 180) / 360 * W), cy = Math.floor((90 - la) / 180 * H);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const yy = cy + dy; if (yy < 0 || yy >= H) continue;
        const xx = (cx + dx + W) % W;
        if (Math.hypot(dy, dx) > 3) continue;
        const j = yy * W + xx;
        if (warm) currentWarm[j] = 1;
        if (cold) currentCold[j] = 1;
      }
    }
  }
  log(`洋流: ${currentFeatures.length} 段流线`);

  // ---------------- 5. 海陆距离 / 降水 / 季风 ----------------
  const _t5 = Date.now();
  // 注意: 必须用 Float64 —— Float32 存储与 double 堆键比较会产生 ulp 级伪改进, Dijkstra 不收敛
  const coastDist = new Float64Array(N).fill(1e9);   // 陆地格到海洋(度)
  const landDistO = new Float64Array(N).fill(1e9);   // 海洋格到陆地(度)
  {
    const heap = new L.MinHeap();
    for (let i = 0; i < N; i++) if (ocean[i]) { coastDist[i] = 0; heap.push(0, i); }
    while (heap.size) {
      const { k: d, v: i } = heap.pop();
      if (d > coastDist[i] + 1e-9) continue;
      for (const nb of nbs(i)) {
        const nd = d + nb.diag * 0.5;
        if (nd < coastDist[nb.i]) { coastDist[nb.i] = nd; heap.push(nd, nb.i); }
      }
    }
    for (let i = 0; i < N; i++) if (!ocean[i]) { landDistO[i] = 0; heap.push(0, i); }
    while (heap.size) {
      const { k: d, v: i } = heap.pop();
      if (d > landDistO[i] + 1e-9) continue;
      for (const nb of nbs(i)) {
        const nd = d + nb.diag * 0.5;
        if (nd < landDistO[nb.i]) { landDistO[nb.i] = nd; heap.push(nd, nb.i); }
      }
    }
  }

  const precip = new Float32Array(N), precipS = new Float32Array(N), precipW = new Float32Array(N);
  const monsoonIdx = new Float32Array(N);
  const monsoonSumV = new Float32Array(N * 2), monsoonWinV = new Float32Array(N * 2);
  {
    for (let y = 0; y < H; y++) {
      const lat = 90 - (y + 0.5) * 180 / H, la = Math.abs(lat);
      const pBase = L.clamp(
        2050 * Math.exp(-((lat / 12.5) ** 2)) + 150 + 850 * Math.exp(-(((la - 50) / 14) ** 2)) +
        60 - 380 * Math.exp(-(((la - phiH) / (0.22 * phiH)) ** 2)), 35, 3600); // 副热带干带宽度随哈德里环缩放
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let P = pBase;
        if (!ocean[i]) {
          const m = Math.exp(-coastDist[i] / cfg.moistureDecayDeg);
          P *= 0.30 + 0.70 * m;
          // 雨影: 逆风方向搜索山障
          const u = windU[i], v = windV[i];
          const um = Math.hypot(u, v) || 1;
          let maxE = 0, steps = 0;
          let px = x, py = y;
          while (steps++ < 24) {
            px -= (u / um) * 2 / Math.max(0.25, Math.cos(lat * D2R)); // 逆风(西向分量)
            py += (v / um) * 2;                                       // 逆风(南向分量)
            const yy = Math.round(py);
            if (yy < 0 || yy >= H) break;
            let xx = Math.round(px); xx = ((xx % W) + W) % W;
            const j = yy * W + xx;
            if (ocean[j]) break;
            if (elev[j] > maxE) maxE = elev[j];
          }
          if (maxE > 1300 && steps > 3) P *= 0.30 + 0.70 * Math.exp(-maxE / 2600);
          // 洋流调节
          if (coastDist[i] < 2.5) {
            if (currentWarm[i]) P *= 1.35;
            else if (currentCold[i]) P *= 0.42;
          }
        } else {
          P *= 1.15;
        }
        precip[i] = P;
      }
    }
    // 季风指数(需要陆地连通规模)
    const landMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) landMask[i] = ocean[i] ? 0 : 1;
    const lc = L.connectedComponents(landMask, W, H);
    const heating = L.clamp(cfg.tiltDeg / 23.4, 0, 1.4);
    for (let y = 0; y < H; y++) {
      const lat = 90 - (y + 0.5) * 180 / H;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (ocean[i] || coastDist[i] > 26) continue;
        const comp = lc.compId[i];
        if (comp < 0 || lc.comps[comp].size < 2500) continue;
        // 指向最近海洋的方向( coastDist 梯度下降, 经度环绕感知)
        let bx = 0, by = 0, bd = coastDist[i];
        for (const nb of nbs(i)) {
          if (coastDist[nb.i] < bd) {
            bd = coastDist[nb.i];
            let ddx = (nb.i % W) - x;
            if (ddx > W / 2) ddx -= W; if (ddx < -W / 2) ddx += W;
            bx = ddx; by = (((nb.i / W) | 0) - y);
          }
        }
        const bl = Math.hypot(bx, by) || 1;
        const dirE = bx / bl, dirN = -by / bl;
        const latS = lat - Math.sign(lat) * itczAmp * 0.6;
        const latW = lat + Math.sign(lat) * itczAmp * 0.6;
        const [uS, vS] = beltWind(latS), [uW, vW] = beltWind(latW);
        const vsE = uS + dirE * 5.0 * heating, vsN = vS + dirN * 5.0 * heating;
        const vwE = uW - dirE * 2.6 * heating, vwN = vW - dirN * 2.6 * heating;
        const dv = Math.hypot(vsE - vwE, vsN - vwN);
        const mi = L.clamp(dv / 8.5, 0, 1) * Math.exp(-coastDist[i] / 18) * L.clamp(1.1 - Math.abs(lat) / 55, 0, 1);
        monsoonIdx[i] = mi;
        monsoonSumV[i * 2] = vsE; monsoonSumV[i * 2 + 1] = vsN;
        monsoonWinV[i * 2] = vwE; monsoonWinV[i * 2 + 1] = vwN;
      }
    }
    // 季节降水
    for (let y = 0; y < H; y++) {
      const lat = 90 - (y + 0.5) * 180 / H;
      const sg = Math.sign(lat) || 1;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const itczSummer = Math.max(0, Math.exp(-(((lat - sg * itczAmp) / 9) ** 2)) - 0.3 * Math.exp(-((lat / 9) ** 2)));
        const mi = monsoonIdx[i];
        const Ps = precip[i] * (0.60 + 0.9 * mi + 0.5 * itczSummer);
        precipS[i] = Math.max(0, Ps);
        precipW[i] = Math.max(10, 2 * precip[i] - Ps);
      }
    }
  }
  log(`海陆距离/降水/季风 ${((Date.now() - _t5) / 1000).toFixed(1)}s`);

  // ---------------- 6. 水文 ----------------
  const _t6 = Date.now();
  const filled = Float32Array.from(elev);
  const next = new Int32Array(N).fill(-1);
  {
    const heap = new L.MinHeap();
    const visited = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (ocean[i]) { visited[i] = 1; heap.push(filled[i], i); }
    while (heap.size) {
      const { v: i } = heap.pop();
      for (const nb of nbs(i)) {
        if (visited[nb.i]) continue;
        visited[nb.i] = 1;
        filled[nb.i] = Math.max(elev[nb.i], filled[i] + 0.02);
        heap.push(filled[nb.i], nb.i);
      }
    }
    for (let i = 0; i < N; i++) {
      if (ocean[i]) continue;
      let best = -1, bk = Infinity;
      for (const nb of nbs(i)) {
        const k = filled[nb.i] + (nb.diag - 1) * 0.001;
        if (k < bk) { bk = k; best = nb.i; }
      }
      next[i] = best;
    }
  }
  const acc = new Float64Array(N);
  {
    const order = [];
    for (let i = 0; i < N; i++) if (!ocean[i]) order.push(i);
    order.sort((a, b) => filled[b] - filled[a]);
    for (let i = 0; i < N; i++) acc[i] = ocean[i] ? 0 : precip[i] * CELL_AREA[i];
    for (const i of order) if (next[i] >= 0) acc[next[i]] += acc[i];
  }
  // 河流
  const riverMask = new Uint8Array(N);
  const rivers = [];
  {
    const cand = [];
    for (let i = 0; i < N; i++) if (!ocean[i] && acc[i] > cfg.rivers.dischargeThreshold) cand.push(i);
    cand.sort((a, b) => acc[b] - acc[a]);
    const visited = new Uint8Array(N);
    for (const c of cand) {
      if (visited[c]) continue;
      const path = [c];
      let cur = c, reached = false, guard = 0;
      visited[c] = 1;
      while (guard++ < N) {
        const nx = next[cur];
        if (nx < 0) break;
        path.push(nx);
        if (ocean[nx]) { reached = true; break; }
        if (visited[nx] && riverMask[nx]) { reached = true; break; }
        if (visited[nx]) break;
        visited[nx] = 1;
        cur = nx;
      }
      if (!reached || path.length < 5) { for (const p of path) if (!ocean[p]) visited[p] = 0; continue; }
      rivers.push({ cells: path, discharge: acc[path[path.length - 1]], mouth: path[path.length - 1] });
    }
    rivers.sort((a, b) => b.discharge - a.discharge);
    const kept = rivers.slice(0, cfg.rivers.maxCount);
    rivers.length = 0;
    rivers.push(...kept);
    for (const r of rivers) for (const c of r.cells) riverMask[c] = 1;
    log(`河流 ${rivers.length} 条 (淹没+汇流+trace ${((Date.now() - _t6) / 1000).toFixed(1)}s)`);
  }
  // 湖泊
  const lakeMask = new Uint8Array(N);
  const lakes = [];
  {
    for (let i = 0; i < N; i++) if (!ocean[i] && filled[i] - elev[i] > 20 && acc[i] > 8e6) lakeMask[i] = 1;
    const lc = L.connectedComponents(lakeMask, W, H);
    lakes.push(...lc.comps.filter(c => c.size >= 6).sort((a, b) => b.size - a.size).slice(0, 40));
  }

  // ---------------- 7. 气候分区 ----------------
  const CLIM = {
    ICE: 0, TUNDRA: 1, ALPINE: 2, TAIGA: 3, RAINFOREST: 4, MONSOON_T: 5, SAVANNA: 6,
    DESERT: 7, STEPPE: 8, MEDIT: 9, SUBHUMID: 10, OCEANIC: 11, CONTINENTAL: 12, MONSOON_M: 13,
    OCEAN: 100, SEAICE: 101
  };
  const CLIM_NAME = {
    0: '冰原', 1: '苔原', 2: '高山山地', 3: '亚寒带针叶林', 4: '热带雨林', 5: '热带季风林', 6: '热带草原',
    7: '干旱沙漠', 8: '半干旱草原', 9: '地中海气候', 10: '副热带湿润', 11: '温带海洋性', 12: '温带大陆性', 13: '温带季风',
    100: '海洋', 101: '海冰'
  };
  const climate = new Uint8Array(N);
  const tAnn = new Float32Array(N), tWarm = new Float32Array(N), tCold = new Float32Array(N);
  {
    const tEq = cfg.tEq + cfg.greenhouse, tPole = cfg.tPole + cfg.greenhouse;
    for (let y = 0; y < H; y++) {
      const lat = 90 - (y + 0.5) * 180 / H;
      const latAbs = Math.abs(lat);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let T = tEq - (tEq - tPole) * Math.pow(Math.sin(latAbs * D2R), 1.7);
        if (!ocean[i]) T -= Math.max(0, elev[i]) * 0.0062;
        else T += 8 * Math.max(0, 1 - latAbs / 60); // 海洋热惯性
        const cont = ocean[i] ? 0 : Math.min(coastDist[i], 30) / 30;
        const range = (3 + cont * 24) * (0.55 + 0.45 * L.clamp(cfg.tiltDeg / 23.4, 0.2, 1.6)) + cfg.tiltDeg * 0.42 * Math.max(0, latAbs - 22) / 60;
        tAnn[i] = T;
        tWarm[i] = T + range * 0.62 + cfg.tiltDeg * 0.30 * latAbs / 90;
        tCold[i] = T - range * 0.62 - cfg.tiltDeg * 0.30 * latAbs / 90;
        const P = precip[i], Pdry = Math.min(precipS[i], precipW[i]);
        let c;
        if (ocean[i]) {
          c = tWarm[i] < -3 ? CLIM.SEAICE : CLIM.OCEAN;
        } else if (tWarm[i] < -2) c = CLIM.ICE;
        else if (tWarm[i] < 9) c = CLIM.TUNDRA;
        else if (elev[i] > 3300) c = CLIM.ALPINE;
        else if (tCold[i] < -3 && tWarm[i] > 9.5) c = CLIM.TAIGA;
        else if (P < 260 || (P < 430 && Pdry < 35)) c = CLIM.DESERT;
        else if (P < 540) c = CLIM.STEPPE;
        else if (tAnn[i] > 19) {
          if (Pdry > 55 && P > 1700) c = CLIM.RAINFOREST;
          else if (monsoonIdx[i] > 0.5 && precipS[i] > precipW[i] * 1.7 && P > 1050) c = CLIM.MONSOON_T;
          else c = CLIM.SAVANNA;
        } else {
          if (monsoonIdx[i] > 0.55 && precipS[i] > precipW[i] * 1.6 && tCold[i] > -3) c = CLIM.MONSOON_M;
          else if (tCold[i] > 1 && precipS[i] < precipW[i] * 0.75 && P > 380) c = CLIM.MEDIT;
          else if (tCold[i] > -1 && tAnn[i] > 14 && P > 750) c = CLIM.SUBHUMID;
          else if (range < 16 && P > 480) c = CLIM.OCEANIC;
          else c = CLIM.CONTINENTAL;
        }
        climate[i] = c;
      }
    }
  }

  // ---------------- 8. 命名 ----------------
  const names = { oceans: [], rivers: [], ranges: [], deserts: [], lakes: [], monsoons: [] };
  const oceanNamed = oceanComps.filter(c => c.size > 6000).sort((a, b) => b.size - a.size);
  oceanNamed.forEach((c, idx) => {
    names.oceans.push({ id: c.id, name: idx < 3 ? namer.named('sea').replace(/海$/, '洋') : namer.named('sea'), size: c.size, big: idx < 3 });
  });
  rivers.slice(0, 12).forEach(r => names.rivers.push(namer.named('river')));
  const rangeMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!ocean[i] && elev[i] > 2400) rangeMask[i] = 1;
  const rangeComps = L.connectedComponents(rangeMask, W, H).comps.filter(c => c.size >= 25).sort((a, b) => b.size - a.size).slice(0, 10);
  rangeComps.forEach(() => names.ranges.push(namer.named('mount')));
  const desertMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!ocean[i] && climate[i] === CLIM.DESERT) desertMask[i] = 1;
  const desertComps = L.connectedComponents(desertMask, W, H).comps.filter(c => c.size >= 30).sort((a, b) => b.size - a.size).slice(0, 8);
  desertComps.forEach(() => names.deserts.push(namer.named('desert')));
  lakes.forEach(() => names.lakes.push(namer.named('river')));

  // ---------------- 9. 城邦 ----------------
  const cities = [];
  const riverIdGrid = new Int16Array(N).fill(-1);
  for (let ri = 0; ri < rivers.length; ri++) for (const c of rivers[ri].cells) if (riverIdGrid[c] < 0) riverIdGrid[c] = ri;
  {
    const HAB = { [CLIM.SUBHUMID]: 1.0, [CLIM.MONSOON_M]: 0.95, [CLIM.OCEANIC]: 0.9, [CLIM.MONSOON_T]: 0.92, [CLIM.MEDIT]: 0.85, [CLIM.RAINFOREST]: 0.5, [CLIM.SAVANNA]: 0.6, [CLIM.STEPPE]: 0.35, [CLIM.CONTINENTAL]: 0.45, [CLIM.TAIGA]: 0.28, [CLIM.TUNDRA]: 0.1, [CLIM.ALPINE]: 0.22, [CLIM.DESERT]: 0.05 };
    const riverNear = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!riverMask[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        riverNear[yy * W + ((x + dx + W) % W)] = 1;
      }
    }
    const scored = [];
    for (let i = 0; i < N; i++) {
      if (ocean[i]) continue;
      let sc = HAB[climate[i]] || 0.3;
      if (riverNear[i]) sc += 0.35;
      if (coastDist[i] < 2.5) sc += 0.25;
      if (coastDist[i] < 2.5 && riverNear[i]) sc += 0.2;
      if (climate[i] === CLIM.DESERT && riverNear[i]) sc += 0.5;
      if (elev[i] > 2500) sc -= 0.25;
      if (sc > 0.55) scored.push({ i, sc });
    }
    scored.sort((a, b) => b.sc - a.sc);
    const picked = [];
    for (const sc0 of scored) {
      if (picked.length >= cfg.citiesTarget) break;
      const la = LAT[sc0.i], lo = LON[sc0.i];
      let ok = true;
      for (const p of picked) {
        let dLon = Math.abs(lo - p.lon); if (dLon > 180) dLon = 360 - dLon;
        if (Math.hypot(dLon * Math.cos(la * D2R), la - p.lat) < 5.5) { ok = false; break; }
      }
      if (ok) picked.push({ i: sc0.i, sc: sc0.sc, lat: la, lon: lo });
    }
    for (const pk of picked) {
      const i = pk.i;
      let nearRiverId = -1;
      {
        const cx = i % W, cy = (i / W) | 0;
        let bd = 9;
        for (let dy = -5; dy <= 5; dy++) {
          const yy = cy + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -5; dx <= 5; dx++) {
            const xx = (cx + dx + W) % W;
            const j = yy * W + xx;
            if (riverIdGrid[j] >= 0) {
              const d = Math.hypot(dx, dy);
              if (d < bd) { bd = d; nearRiverId = riverIdGrid[j]; }
            }
          }
        }
      }
      const climateName = CLIM_NAME[climate[i]];
      const isCoast = coastDist[i] < 2.5;
      const isDesert = climate[i] === CLIM.DESERT;
      const mi = monsoonIdx[i];
      let type;
      if (isDesert && nearRiverId >= 0) type = '河谷绿洲城邦';
      else if (isCoast && currentWarm[i]) type = '暖流渔汛港城';
      else if (isCoast && currentCold[i]) type = '寒流雾港城邦';
      else if (isCoast && pk.sc > 1.1) type = '海洋商港城邦';
      else if (mi > 0.5) type = '季风稻作城邦';
      else if (climate[i] === CLIM.STEPPE || climate[i] === CLIM.SAVANNA) type = '草原互市城邦';
      else if (elev[i] > 1800) type = '高地矿冶城邦';
      else if (climate[i] === CLIM.TUNDRA || climate[i] === CLIM.TAIGA) type = '极地渔猎城邦';
      else type = '河谷农耕城邦';
      const pop = Math.round(L.lerp(4, 120, L.clamp((pk.sc - 0.5) / 1.2, 0, 1)) * (0.7 + rand() * 0.8));
      cities.push({
        name: namer.city(), lat: +LAT[i].toFixed(2), lon: +LON[i].toFixed(2),
        cell: i, type, popWan: pop, govt: namer.govt(),
        climate: climateName, monsoon: +(mi).toFixed(2),
        nearCurrent: currentWarm[i] ? '暖流' : (currentCold[i] ? '寒流' : ''),
        riverName: nearRiverId >= 0 ? (names.rivers[nearRiverId] || '') : '',
        coast: isCoast, elevM: Math.round(elev[i]),
        goods: [namer.goods(), namer.goods()].filter((v, ix, a) => a.indexOf(v) === ix),
        background: ''
      });
    }
    for (let a = 0; a < cities.length; a++) {
      const ca = cities[a];
      const others = cities.map((cb, bi) => ({ bi, d: Math.hypot(Math.min(Math.abs(cb.lon - ca.lon), 360 - Math.abs(cb.lon - ca.lon)) * Math.cos(ca.lat * D2R), cb.lat - ca.lat) }))
        .filter(o => o.bi !== a).sort((p, qq) => p.d - qq.d);
      const near = others[0];
      if (!near) continue;
      ca.nearest = cities[near.bi].name;
      ca.nearestDistDeg = +near.d.toFixed(1);
      ca.relation = near.d < 12 ? (rand() < 0.5 ? `与${cities[near.bi].name}隔水相望,既竞争商路也互通婚姻` : `${cities[near.bi].name}是它在商路上的老对手,两市船队每季竞速`) : `与最近的${cities[near.bi].name}相距${Math.round(near.d * DEG_KM)}公里,靠驿队维持联系`;
      const seaName = names.oceans.length ? names.oceans[0].name : '大洋';
      const geo = [];
      if (ca.riverName) geo.push(`傍${ca.riverName}而建`);
      if (ca.coast) geo.push(`坐落${seaName}之滨`);
      if (ca.nearCurrent === '暖流') geo.push('暖流在此拐弯,渔汛终年不歇');
      if (ca.nearCurrent === '寒流') geo.push('寒流上涌,清晨的海雾是全城的水源之一');
      if (ca.monsoon > 0.5) geo.push('夏半年季风从海上涌入,冬半年风声倒转');
      if (ca.type.includes('绿洲')) geo.push('全城依赖一条穿沙而过的河流与三百年凿成的暗渠');
      if (ca.elevM > 1800) geo.push(`海拔${ca.elevM}米,靠山口垭市控制矿脉与盐道`);
      ca.background = `${ca.type},约${ca.popWan}万人。${geo.length ? geo.join(';') + '。' : ''}${ca.relation}。政体: ${ca.govt}。特产: ${ca.goods.join('、')}。`;
    }
    log(`城邦 ${cities.length} 座`);
  }
  // 商路(A*)
  const tradeRoutes = [];
  {
    const cost = new Float32Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      if (ocean[i]) continue;
      let c = 1 + Math.max(0, elev[i]) / 900;
      if (climate[i] === CLIM.DESERT) c += 1.8;
      if (climate[i] === CLIM.ALPINE) c += 2;
      if (climate[i] === CLIM.ICE || climate[i] === CLIM.TUNDRA) c += 1.2;
      cost[i] = c;
    }
    function astar(sI, tI) {
      const heap = new L.MinHeap();
      const g = new Map(), came = new Map();
      const tLat = LAT[tI], tLon = LON[tI];
      const h = (i) => {
        let dLon = Math.abs(LON[i] - tLon); if (dLon > 180) dLon = 360 - dLon;
        return Math.hypot(dLon * Math.cos(LAT[i] * D2R), LAT[i] - tLat);
      };
      g.set(sI, 0); heap.push(h(sI), sI);
      let pops = 0;
      while (heap.size && pops++ < 300000) {
        const { v: cur } = heap.pop();
        if (cur === tI) {
          const p = [cur];
          while (came.has(p[0])) p.unshift(came.get(p[0]));
          return p;
        }
        const gc = g.get(cur);
        for (const nb of nbs(cur)) {
          const c = cost[nb.i];
          if (c < 0) continue;
          const ng = gc + c * nb.diag * 0.5 * 2;
          if (!g.has(nb.i) || ng < g.get(nb.i)) {
            g.set(nb.i, ng); came.set(nb.i, cur); heap.push(ng + h(nb.i), nb.i);
          }
        }
      }
      return null;
    }
    for (let a = 0; a < cities.length; a++) {
      const ca = cities[a];
      const others = cities.map((cb, bi) => ({ bi, d: Math.hypot(Math.min(Math.abs(cb.lon - ca.lon), 360 - Math.abs(cb.lon - ca.lon)) * Math.cos(ca.lat * D2R), cb.lat - ca.lat) }))
        .filter(o => o.bi !== a).sort((p, qq) => p.d - qq.d);
      for (const o of others.slice(0, 1)) {
        if (o.d > 40) continue;
        const cb = cities[o.bi];
        if (tradeRoutes.some(r => (r.a === cb.name && r.b === ca.name))) continue;
        const path = astar(ca.cell, cb.cell);
        if (!path) continue;
        const coords = path.map(i => [+LON[i].toFixed(2), +LAT[i].toFixed(2)]);
        tradeRoutes.push({ a: ca.name, b: cb.name, coords: L.simplifyDP(coords, 1.0) });
      }
    }
    log(`商路 ${tradeRoutes.length} 条`);
  }

  // ---------------- 10. 输出 GeoJSON ----------------
  // 关键避坑: 多边形环顶点不得落在极点(lat ±90)或 ±180 经线上 ——
  // EllipsoidRhumbLine 的墨卡托函数在极点发散 → 距离 NaN → Cesium 轮廓几何 new Array(NaN) 崩溃
  const toLL = (x, y) => {
    let lon = -180 + 360 * x / W;
    let lat = 90 - 180 * y / H;
    if (lon > 179.999) lon = 179.999; else if (lon < -179.999) lon = -179.999;
    if (lat > 89.9) lat = 89.9; else if (lat < -89.9) lat = -89.9;
    return [lon, lat];
  };
  const toLLc = toLL;
  // 真实面积km²: 格数 × 赤道格面积 × cos(质心纬度)
  const areaKm2Of = (outerLL, cells) => {
    let latC = 0;
    for (const c of outerLL) latC += c[1];
    latC /= Math.max(1, outerLL.length);
    return Math.round(cells * 0.25 * DEG_KM * DEG_KM * Math.max(0.05, Math.cos(latC * D2R)));
  };

  // 10.1 板块多边形 + 边界线
  {
    const plateLabels = new Int32Array(N);
    for (let i = 0; i < N; i++) plateLabels[i] = grid.plateId[i];
    const plateFc = L.labelsToGeoJSON(plateLabels, W, H, {
      minAreaCells: 12, keepTopPerLabel: 4, toLonLat: toLLc, areaPerCell: 0,
      propFn: (label) => {
        const pi = plateInfo[label];
        return { 名称: pi.name, 类型: pi.continental ? '大陆板块' : '大洋板块', 板速: `${pi.speedCmYr} cm/yr`, 欧拉极: pi.axis };
      }
    });
    const pairSegs = new Map();
    function addPairSeg(a, b, x1, y1, x2, y2) {
      const k = pairKey(a, b);
      if (!pairSegs.has(k)) pairSegs.set(k, []);
      pairSegs.get(k).push([x1, y1, x2, y2]);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = grid.plateId[y * W + x];
      const xe = (x + 1) % W;
      if (y + 1 < H && grid.plateId[(y + 1) * W + x] !== a) {
        const b = grid.plateId[(y + 1) * W + x];
        addPairSeg(a, b, x + 1, y + 1, x, y + 1);
      }
      if (grid.plateId[y * W + xe] !== a) {
        const b = grid.plateId[y * W + xe];
        addPairSeg(a, b, x + 1, y, x + 1, y + 1);
      }
    }
    const boundaryFeats = [];
    for (const [k, segs] of pairSegs) {
      const a = (k / 100) | 0, b = k % 100;
      const pair = pairs.get(k);
      const type = pair ? pair.type : 'transform';
      const startMap = new Map();
      segs.forEach((sg, si) => {
        const kk = sg[0] * 10000 + sg[1];
        if (!startMap.has(kk)) startMap.set(kk, []);
        startMap.get(kk).push(si);
      });
      const used = new Uint8Array(segs.length);
      const lines = [];
      for (let si = 0; si < segs.length; si++) {
        if (used[si]) continue;
        used[si] = 1;
        const line = [[segs[si][0], segs[si][1]], [segs[si][2], segs[si][3]]];
        for (;;) {
          const last = line[line.length - 1];
          const kk = last[0] * 10000 + last[1];
          const cands = startMap.get(kk) || [];
          let nx = -1;
          for (const c of cands) if (!used[c]) { nx = c; break; }
          if (nx < 0) break;
          used[nx] = 1;
          line.push([segs[nx][2], segs[nx][3]]);
        }
        if (line.length >= 8) lines.push(line);
      }
      for (const line of lines) {
        const coords = L.simplifyDP(line.map(([x, y]) => toLLc(x, y)), 0.7);
        if (coords.length < 3) continue;
        boundaryFeats.push(L.feat({
          板块A: plateInfo[a].name, 板块B: plateInfo[b].name,
          边界类型: type === 'conv' ? '汇聚边界(造山/海沟)' : type === 'div' ? '离散边界(洋脊/裂谷)' : '转换断层',
          会聚速率: pair ? +(pair.conv * 637).toFixed(2) : 0,
          张裂速率: pair ? +(pair.div * 637).toFixed(2) : 0
        }, { type: 'LineString', coordinates: coords }));
      }
    }
    L.writeJSON(path.join(outDir, '01_板块与边界.geojson'), L.fc([...plateFc.features, ...boundaryFeats]));
    stats.boundaryCount = {
      conv: boundaryFeats.filter(f => /汇聚/.test(f.properties.边界类型)).length,
      div: boundaryFeats.filter(f => /离散/.test(f.properties.边界类型)).length,
      transform: boundaryFeats.filter(f => /转换/.test(f.properties.边界类型)).length
    };
  }

  // 10.2 山脉
  {
    const feats = [];
    rangeComps.forEach((c, idx) => {
      const labels = new Int32Array(N).fill(-1);
      for (const cell of c.cells) labels[cell] = idx;
      const gj = L.labelsToGeoJSON(labels, W, H, {
        minAreaCells: 25, toLonLat: toLLc, areaPerCell: 1,
        propFn: (label, cells, outerLL) => ({ 名称: names.ranges[idx], 面积km2: areaKm2Of(outerLL, cells) })
      });
      let peak = 0, peakI = -1;
      for (const cell of c.cells) if (elev[cell] > peak) { peak = elev[cell]; peakI = cell; }
      gj.features.forEach(f => feats.push(f));
      feats.push(L.feat({ 名称: names.ranges[idx] + '主峰', 类型: '山峰', 海拔m: Math.round(peak) }, { type: 'Point', coordinates: [LON[peakI], LAT[peakI]] }));
    });
    for (const hs of hotspots) {
      const [la, lo] = L.vecToLatLon(hs.v);
      feats.push(L.feat({ 类型: '热点火山', 板块: plateInfo[hs.plate].name, 环境: hs.onLand ? '陆内火山' : '洋岛链' }, { type: 'Point', coordinates: [+lo.toFixed(2), +la.toFixed(2)] }));
    }
    L.writeJSON(path.join(outDir, '02_山脉与火山.geojson'), L.fc(feats));
  }

  // 10.3 河流
  {
    const feats = [];
    rivers.forEach((r, idx) => {
      const coords = L.simplifyDP(r.cells.map(i => [+LON[i].toFixed(2), +LAT[i].toFixed(2)]), 0.25);
      const props = {
        名称: names.rivers[idx] || `无名河${idx}`, 流量指数: Math.round(r.discharge / 1e6),
        长度km: Math.round(r.cells.length * 0.5 * DEG_KM)
      };
      for (const part of L.splitLineAtAntimeridian(coords)) {
        for (const ft of L.splitLineFeatures(props, L.subdivideLine(part, 1.5))) feats.push(ft);
      }
    });
    L.writeJSON(path.join(outDir, '03_河流.geojson'), L.fc(feats));
  }

  // 10.4 流域(取互不重叠的主要河流域)
  {
    const rev = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) if (next[i] >= 0 && !ocean[i]) rev[next[i]].push(i);
    const labels = new Int32Array(N).fill(-1);
    let idx = 0;
    for (const r of rivers) {
      if (idx >= 14) break;
      let startLand = -1;
      for (let j = r.cells.length - 1; j >= 0; j--) if (!ocean[r.cells[j]]) { startLand = r.cells[j]; break; }
      if (startLand < 0) continue;
      // 与已有流域重叠(下游 30 格内已标注)则跳过 → 每个水系只保留最大河流
      let overlap = false;
      for (let j = Math.max(0, r.cells.length - 30); j < r.cells.length; j++) if (labels[r.cells[j]] >= 0) { overlap = true; break; }
      if (overlap) continue;
      const stack = [startLand];
      while (stack.length) {
        const c = stack.pop();
        if (labels[c] >= 0) continue;
        labels[c] = idx;
        for (const up of rev[c]) if (labels[up] < 0) stack.push(up);
      }
      idx++;
    }
    const gj = L.labelsToGeoJSON(labels, W, H, {
      minAreaCells: 60, keepTopPerLabel: 1, toLonLat: toLLc, areaPerCell: 1,
      propFn: (label, cells, outerLL) => ({ 名称: (names.rivers[label] || '无名') + '流域', 面积km2: areaKm2Of(outerLL, cells) })
    });
    L.writeJSON(path.join(outDir, '04_流域.geojson'), gj);
    stats.basins = gj.features.length;
  }

  // 10.5 湖泊
  {
    const labels = new Int32Array(N).fill(-1);
    lakes.forEach((c, idx) => { for (const cell of c.cells) labels[cell] = idx; });
    const gj = L.labelsToGeoJSON(labels, W, H, {
      minAreaCells: 6, keepTopPerLabel: 40, toLonLat: toLLc, areaPerCell: 1,
      propFn: (label, cells, outerLL) => ({ 名称: names.lakes[label] || '无名湖', 面积km2: areaKm2Of(outerLL, cells) })
    });
    L.writeJSON(path.join(outDir, '05_湖泊.geojson'), gj);
    stats.lakes = lakes.length;
  }

  // 10.6 洋流
  L.writeJSON(path.join(outDir, '06_洋流.geojson'), L.fc(currentFeatures));

  // 10.7 气候分区
  {
    const labels = new Int32Array(N);
    for (let i = 0; i < N; i++) labels[i] = ocean[i] ? -1 : climate[i];
    const classStats = {};
    for (let i = 0; i < N; i++) if (!ocean[i]) {
      const c = climate[i];
      if (!classStats[c]) classStats[c] = { n: 0, p: 0, t: 0 };
      classStats[c].n++; classStats[c].p += precip[i]; classStats[c].t += tAnn[i];
    }
    const gj = L.labelsToGeoJSON(labels, W, H, {
      minAreaCells: 3, keepTopPerLabel: 90, toLonLat: toLLc, areaPerCell: 1,
      propFn: (label, cells, outerLL) => {
        const st = classStats[label];
        return { 名称: CLIM_NAME[label], 面积km2: areaKm2Of(outerLL, cells), 年均降水mm: st ? Math.round(st.p / st.n) : 0, 年均温C: st ? +(st.t / st.n).toFixed(1) : 0 };
      }
    });
    L.writeJSON(path.join(outDir, '07_气候分区.geojson'), gj);
    stats.climateStats = {};
    let landTotal = 0;
    for (const c in classStats) landTotal += classStats[c].n;
    for (const c in classStats) {
      const st = classStats[c];
      stats.climateStats[CLIM_NAME[c]] = { 面积百分比: +(st.n / landTotal * 100).toFixed(1), 年均降水mm: Math.round(st.p / st.n), 年均温C: +(st.t / st.n).toFixed(1) };
    }
  }

  // 10.8 季风区
  {
    const labels = new Int32Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (!ocean[i] && monsoonIdx[i] > 0.5) labels[i] = 1;
    const mc = L.connectedComponents(labels.map((v) => v > 0 ? 1 : 0), W, H);
    const lab2 = new Int32Array(N).fill(-1);
    const bigComps = mc.comps.filter(c => c.size > 80).sort((a, b) => b.size - a.size).slice(0, 8);
    bigComps.forEach((c, idx) => { for (const cell of c.cells) lab2[cell] = idx; });
    const gj = L.labelsToGeoJSON(lab2, W, H, {
      minAreaCells: 80, toLonLat: toLLc, areaPerCell: 1,
      propFn: (label, cells, outerLL) => {
        let sE = 0, sNn = 0, wE = 0, wNn = 0, n = 0;
        for (const cell of bigComps[label].cells) { sE += monsoonSumV[cell * 2]; sNn += monsoonSumV[cell * 2 + 1]; wE += monsoonWinV[cell * 2]; wNn += monsoonWinV[cell * 2 + 1]; n++; }
        const dir = (E, Nn) => {
          const a = (Math.atan2(Nn, -E) * R2D + 360) % 360; // 来向方位角: 0=从东来
          const names8 = ['东风', '东南风', '南风', '西南风', '西风', '西北风', '北风', '东北风'];
          return names8[Math.round(a / 45) % 8];
        };
        return { 名称: (namer.named('basin').slice(0, 2)) + '季风区', 夏季盛行: dir(sE / n, sNn / n), 冬季盛行: dir(wE / n, wNn / n), 面积km2: areaKm2Of(outerLL, cells) };
      }
    });
    L.writeJSON(path.join(outDir, '08_季风区.geojson'), gj);
    stats.monsoonRegions = gj.features.length;
    stats.monsoonAreaPct = +((bigComps.reduce((sm, c) => sm + c.size, 0) / Math.max(1, landCount) * 100)).toFixed(1);
    names.monsoons = gj.features.map(f => f.properties.名称);
  }

  // 10.9 城邦 + 商路
  {
    L.writeJSON(path.join(outDir, '09_城邦.geojson'), L.fc(cities.map(c => L.feat({
      名称: c.name, 类型: c.type, 人口万: c.popWan, 政体: c.govt, 气候: c.climate
    }, { type: 'Point', coordinates: [c.lon, c.lat] }))));
    {
      const tf = [];
      for (const r of tradeRoutes) {
        for (const part of L.splitLineAtAntimeridian(r.coords)) {
          for (const ft of L.splitLineFeatures({ 起点: r.a, 终点: r.b }, L.subdivideLine(part, 1.5))) tf.push(ft);
        }
      }
      L.writeJSON(path.join(outDir, '10_商路.geojson'), L.fc(tf));
    }
    L.writeJSON(path.join(outDir, 'cities.json'), cities);
  }

  // ---------------- 11. 纹理 PNG ----------------
  function renderTexture(mode) {
    const TW = 1440, TH = 720;
    const rgba = new Uint8Array(TW * TH * 4);
    const shade = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = (x - 1 + W) % W, xr = (x + 1) % W;
      const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
      const dzdx = (elev[y * W + xr] - elev[y * W + xl]) / 2;
      const dzdy = (elev[yd * W + x] - elev[yu * W + x]) / 2;
      const lx = -0.62, ly = -0.62, lz = 0.48;
      const nl = Math.hypot(dzdx, dzdy, 1);
      shade[i] = L.clamp(0.75 + 0.85 * ((-dzdx * lx - dzdy * ly + lz) / nl), 0.45, 1.3);
    }
    const plateTint = [[210, 180, 140], [170, 200, 170], [190, 170, 200], [200, 200, 160], [160, 190, 210], [210, 160, 150], [180, 210, 190], [200, 180, 210], [190, 190, 150], [170, 200, 200], [205, 175, 165], [185, 185, 205], [200, 160, 180]];
    const climColor = {
      0: [240, 244, 248], 1: [196, 208, 200], 2: [176, 158, 144], 3: [120, 158, 122], 4: [44, 122, 68], 5: [70, 150, 90],
      6: [168, 196, 88], 7: [214, 188, 128], 8: [206, 186, 116], 9: [198, 178, 106], 10: [128, 176, 112], 11: [96, 170, 120], 12: [130, 160, 108], 13: [110, 170, 110]
    };
    for (let py = 0; py < TH; py++) {
      const gy = Math.min(H - 1, Math.floor(py / TH * H));
      for (let px = 0; px < TW; px++) {
        const gx = Math.floor(px / TW * W);
        const i = gy * W + gx;
        let r, g, b;
        if (mode === 'terrain') {
          if (ocean[i]) {
            const d = L.clamp(-elev[i] / 6000, 0, 1);
            r = 14 + 24 * (1 - d); g = 46 + 70 * (1 - d); b = 92 + 90 * (1 - d);
            // 海洋调色(工坊描述: 紫色海洋/碧绿海洋...)
            if (cfg.palette && cfg.palette.ocean) {
              const pc = cfg.palette.ocean;
              r = r * 0.35 + pc[0] * 0.65; g = g * 0.35 + pc[1] * 0.65; b = b * 0.35 + pc[2] * 0.65;
              r = L.lerp(r, 30 + 40 * (1 - d), 0.3); g = L.lerp(g, 60 + 60 * (1 - d), 0.3); b = L.lerp(b, 90 + 90 * (1 - d), 0.3);
            }
            if (climate[i] === CLIM.SEAICE) { r = 226; g = 234; b = 240; }
          } else {
            const cc = climColor[climate[i]] || [150, 150, 150];
            const hFac = L.clamp((elev[i] - 400) / 3200, 0, 1);
            const snow = elev[i] > (Math.abs(LAT[i]) > 55 ? 1800 : 3400);
            r = L.lerp(cc[0], 232, snow ? 1 : hFac * 0.75);
            g = L.lerp(cc[1], 236, snow ? 1 : hFac * 0.75);
            b = L.lerp(cc[2], 242, snow ? 1 : hFac * 0.75);
            const sh = shade[i];
            r *= sh; g *= sh; b *= sh;
            if (riverMask[i]) { r = 40; g = 84; b = 150; }
            if (lakeMask[i]) { r = 52; g = 98; b = 160; }
          }
        } else if (mode === 'climate') {
          if (ocean[i]) {
            r = climate[i] === CLIM.SEAICE ? 222 : 158; g = climate[i] === CLIM.SEAICE ? 232 : 200; b = climate[i] === CLIM.SEAICE ? 242 : 224;
          } else {
            const cc = climColor[climate[i]] || [160, 160, 160];
            r = cc[0]; g = cc[1]; b = cc[2];
            if (monsoonIdx[i] > 0.5) { r = r * 0.7 + 255 * 0.3; g = g * 0.7 + 120 * 0.3; b = b * 0.7 + 40 * 0.3; }
          }
        } else { // tectonic
          const t = plateTint[grid.plateId[i] % plateTint.length];
          if (ocean[i]) {
            const d = L.clamp(-elev[i] / 6000, 0, 1);
            r = (18 + 20 * (1 - d)) * 0.55 + t[0] * 0.45 * 0.4;
            g = (42 + 56 * (1 - d)) * 0.55 + t[1] * 0.45 * 0.4;
            b = (86 + 80 * (1 - d)) * 0.55 + t[2] * 0.45 * 0.4;
          } else {
            r = t[0] * 0.75; g = t[1] * 0.75; b = t[2] * 0.75;
            const sh = shade[i]; r *= sh; g *= sh; b *= sh;
          }
        }
        const o = (py * TW + px) * 4;
        rgba[o] = L.clamp(r, 0, 255); rgba[o + 1] = L.clamp(g, 0, 255); rgba[o + 2] = L.clamp(b, 0, 255); rgba[o + 3] = 255;
      }
    }
    if (mode === 'tectonic') {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const a = grid.plateId[i];
        const xe = (x + 1) % W;
        let c = null;
        if ((y + 1 < H && grid.plateId[(y + 1) * W + x] !== a) || grid.plateId[y * W + xe] !== a) {
          const b2 = (y + 1 < H && grid.plateId[(y + 1) * W + x] !== a) ? grid.plateId[(y + 1) * W + x] : grid.plateId[y * W + xe];
          const pair = pairs.get(pairKey(a, b2));
          c = pair && pair.type === 'conv' ? [255, 60, 40] : pair && pair.type === 'div' ? [40, 220, 255] : [255, 220, 60];
        }
        if (c) {
          for (const [px, py] of [[x * 2, y * 2], [x * 2 + 1, y * 2], [x * 2, y * 2 + 1], [x * 2 + 1, y * 2 + 1]]) {
            const o = (py * TW + px) * 4;
            rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
          }
        }
      }
    }
    L.writePNG(path.join(outDir, mode + '.png'), TW, TH, rgba);
  }
  renderTexture('terrain'); renderTexture('climate'); renderTexture('tectonic');
  log('纹理 x3 完成');

  // ---------------- 11.5 内容包: 编年史 / 神话 / 生态图鉴 ----------------
  const contentPack = { chronicle: [], myth: [], eco: [] };
  {
    const rngC = L.mulberry32(cfg.seed ^ 0xC4A7);
    const pick = (arr) => arr.length ? arr[(rngC() * arr.length) | 0] : null;
    const cityNames = cities.map(c => c.name);
    const yearJitter = () => Math.round(L.rngRange(rngC, -30, 30));
    let y = -Math.round(L.rngRange(rngC, 850, 1100));
    const push = (text) => { contentPack.chronicle.push({ year: y, text }); y += Math.round(L.rngRange(rngC, 70, 150)); };
    // 1 创世纪元
    push(`城邦纪年开始:${names.rivers[0] || '第一大河'}河谷的定居点开始筑城,编年以此为准。`);
    // 2 大旱/大水
    if (names.deserts.length) {
      const victim = pick(cityNames);
      if (victim) push(`${names.deserts[0]}南侵:大旱之年吞没半数绿洲,${victim}凿暗渠三年方得水。`);
    } else if (names.rivers[1]) {
      const victim = pick(cityNames);
      if (victim) push(`${names.rivers[1]}百年大水改道,${victim}由河港一夜变为海港,因祸得福。`);
    }
    // 3 商路战争(有商路的两城)
    if (tradeRoutes.length) {
      const r0 = pick(tradeRoutes);
      if (r0) push(`商路战争:${r0.a}与${r0.b}为${r0.a.length % 2 ? '香料' : '盐'}道开战,历时两季,以互设关卡告和。`);
    }
    // 4 神震(有碰撞造山)
    if (stats.boundaryCount && stats.boundaryCount.conv > 0 && names.ranges[0]) {
      const victim = pick(cityNames);
      push(`神震之年:${names.ranges[0]}大山崩,地震撕开河谷;${victim || '沿岸城邦'}视之为山神翻身的预兆。`);
    }
    // 5 火山纪
    const oceanVolcano = hotspots.find(h => !h.onLand);
    if (oceanVolcano) push(`火海纪:${pick(cityNames) || '渔村'}渔民目击新生火山岛破海而出,祭司团以此重修历法。`);
    // 6 革命
    if (cities.length) {
      const big = cities.reduce((m, c) => c.popWan > m.popWan ? c : m, cities[0]);
      push(`${big.name}政变:盐仓议会垮台,${namer.govt()}上台,商税减半,人口十年翻倍。`);
    }
    // 7 环航/穿墙
    if (currentFeatures.some(f => f.properties.类型 === '环极流')) {
      push(`首次环航:船队借${'环极寒流'}用两年绕行星一周,带回的星图让所有旧海图作废。`);
    } else if (currentFeatures.some(f => f.properties.类型 === '赤道逆流')) {
      push(`穿墙远征:船队借赤道逆流首次渡过风暴带,两个半球的文明第一次互派使节。`);
    }
    // 8 季风灾
    if (stats.monsoonRegions > 0) {
      const victim = pick(cityNames);
      if (victim) push(`季风失约:雨季整整迟到一百天,${victim}粮仓见底,被迫开仓并改行抢购北方旱稻。`);
    }
    // 9 大发现
    if (names.oceans[1]) push(`新海图志:探险队绘制${names.oceans[1].name}全图,标注十二处暗礁与三条新航线。`);
    // 10 当代
    push(`当代:城邦同盟维持着脆弱的和平,星象学家预言下一个百年将有大旱——各城开始囤积粮食。`);
    contentPack.chronicle.sort((a, b) => a.year - b.year);

    // ---- 神话(引用真实山海) ----
    const sea = names.oceans[0] ? names.oceans[0].name : '无垠大洋';
    const mnt = names.ranges[0] || '世界之脊';
    const des = names.deserts[0] || '无尽荒原';
    const river0 = names.rivers[0] || '第一河';
    contentPack.myth = [
      `创世:太初只有${sea}。巨神把陆地一块块掷入水中,掷到${mnt}时用了全力,于是它成了世界的最高处;掷剩的碎屑散成群岛。`,
      `秩序:巨神怕大地干渴,让${river0}做世间的血脉;又立下誓约——${des}是被诅咒之地,凡人不得在其中称王。${cfg.tiltDeg > 30 ? '天空每年剧烈倾侧一次,那是巨神在翻身。' : '天空安稳,那是巨神睡得沉。'}`,
      `终末:${cfg.moon}被称作"天上之眼"。祭司说,当${sea}倒灌进${des}的那一天,眼将闭上,一切重归太初——所以城邦之间宁可战争,也不敢惊动水脉。`
    ];

    // ---- 生态图鉴(按实际出现的气候分区) ----
    const ecoTemplates = {
      '热带雨林': ['层冠巨木(树冠分七层,层层是不同族群的地盘)', '攀蔓兽(用尾巴在第三层滑翔)', '腐光菌(夜里照亮整条雨林步道)'],
      '热带季风林': ['落雨阔叶树(旱季整树脱叶报信)', '掘稻鼠(季风前囤粮,被视作丰歉预兆)'],
      '热带草原': ['伞刺乔木(树冠储水,旅人敲干树皮取水)', '长跑草食兽(迁徙队形绵延数十里)'],
      '干旱沙漠': ['聚雾草(靠叶尖凝露,一夜一滴)', '沙脊虫(雨后一夜拱出千米沙脊)', '岩蜜蜥(尾储脂肪,为绿洲城邦驯养)'],
      '半干旱草原': ['针穗草(根系深达十二米)', '掘洞穴居群(洞穴网络被商队当作地下路标)'],
      '地中海气候': ['软木硬叶树(火灾后最先发芽)', '暮果藤(果实在黄昏爆裂播撒)'],
      '副热带湿润': ['樟坂林(木材造船不裂)', '稻田共生的游泳雀'],
      '温带海洋性': ['雾杉(全年靠雾水生活)', '苔原兔的近亲(不会挖洞,住岩缝)'],
      '温带季风': ['报雨柳(风转向时叶背翻银)', '候粮雁(迁徙路线与商路重合)'],
      '温带大陆性': ['孤杨(防风林带的主力)', '穴仓狐(囤粮习性被农户效仿)'],
      '亚寒带针叶林': ['万年针叶林(单株寿命逾千岁)', '雪松鸡(羽色随季转换)'],
      '苔原': ['极地地衣(生长一毫米需十年)', '迁日鹿(随极昼极夜南北迁徙)'],
      '冰原': ['冰川藻(把冰染成西瓜色)', '冰隙潜鸟(在冰缝里筑巢)'],
      '高山山地': ['岩塔花(只在背风岩缝开花)', '崖居鹫(借上升气流一日横越山脉)']
    };
    for (const [cname, list] of Object.entries(ecoTemplates)) {
      if (!stats.climateStats || !stats.climateStats[cname]) continue;
      contentPack.eco.push({ climate: cname, entries: list.map(t => `${namer.base()}·${t}`) });
    }
  }

  // ---------------- 12. 设定书 planet.md ----------------
  {
    const st = stats;
    const cs = st.climateStats || {};
    const topCur = currentFeatures.slice().sort((a, b) => b.properties.流速 - a.properties.流速).slice(0, 6);
    const longest = rivers.length ? rivers.reduce((m, r) => r.cells.length > m.cells.length ? r : m) : null;
    let pk = -1, pi = -1;
    for (let i = 0; i < N; i++) if (!ocean[i] && elev[i] > pk) { pk = elev[i]; pi = i; }
    const highest = { e: Math.round(pk) };
    const md = [];
    md.push(`# ${cfg.name}(${cfg.en})—— 行星设定书`);
    md.push('');
    md.push(`> ${cfg.tagline}`);
    md.push('');
    md.push(`## 一、行星档案`);
    md.push(`| 项目 | 设定 |`);
    md.push(`|---|---|`);
    md.push(`| 自转周期 | ${cfg.dayHours} 小时(rotFactor ${cfg.rotFactor}) |`);
    md.push(`| 黄赤交角 | ${cfg.tiltDeg}°(季节${cfg.tiltDeg > 30 ? '极端' : cfg.tiltDeg < 8 ? '微弱' : '适中'}) |`);
    md.push(`| 哈德里环宽度 | φ_H ≈ ${phiH.toFixed(0)}°(信风带 0–${phiH.toFixed(0)}°,西风带 ${phiH.toFixed(0)}–64°) |`);
    md.push(`| ITCZ 季节摆幅 | ±${itczAmp.toFixed(0)}° |`);
    md.push(`| 海平面均温 | 赤道 ${cfg.tEq + cfg.greenhouse}℃ / 极地 ${cfg.tPole + cfg.greenhouse}℃ |`);
    md.push(`| 陆地占比 | ${(landPct * 100).toFixed(1)}% |`);
    md.push(`| 卫星 | ${cfg.moon} |`);
    md.push(`| 最高峰 | ${highest.e} m |`);
    md.push(`| 最长河 | ${longest ? (names.rivers[rivers.indexOf(longest)] || '?') + `(${Math.round(longest.cells.length * 0.5 * DEG_KM)} km)` : '无'} |`);
    md.push('');
    md.push(`## 二、板块运动设定`);
    md.push(`| 板块 | 类型 | 板速(cm/yr) | 欧拉极(纬,经) |`);
    md.push(`|---|---|---|---|`);
    for (const p of plateInfo) md.push(`| ${p.name} | ${p.continental ? '陆壳' : '洋壳'} | ${p.speedCmYr} | ${p.axis[0]}, ${p.axis[1]} |`);
    md.push('');
    md.push(`边界统计: 汇聚 ${st.boundaryCount.conv} 段 / 离散 ${st.boundaryCount.div} 段 / 转换 ${st.boundaryCount.transform} 段。`);
    md.push(tectonicNotes.map(n => `- ${n}`).join('\n'));
    md.push('');
    md.push(`## 三、大气环流设定`);
    md.push(`- 信风带(0–${phiH.toFixed(0)}°): 偏东风,驱动赤道洋流西行;`);
    md.push(`- 西风带(${phiH.toFixed(0)}–64°): 偏西风,${cfg.rotFactor > 1.1 ? '因自转较快而异常强劲,风暴走廊频发' : '温带气旋的主跑道'};`);
    md.push(`- 副热带高压带(φ_H 附近): 干燥下沉气流,大陆西岸-内陆沙漠的主要成因;`);
    md.push(`- ITCZ 随季节摆动 ±${itczAmp.toFixed(0)}°,倾角 ${cfg.tiltDeg}° ${cfg.tiltDeg > 30 ? '造成极端干湿季节对比' : '带来规律的雨季'}。`);
    md.push('');
    md.push(`## 四、洋流设定(主要洋流)`);
    md.push(`| 洋流 | 类型 | 流速 | 性质 |`);
    md.push(`|---|---|---|---|`);
    for (const f of topCur) md.push(`| ${f.properties.名称} | ${f.properties.类型} | ${f.properties.流速} | ${f.properties.性质 || '—'} |`);
    md.push('');
    md.push(`## 五、气候分区设定`);
    md.push(`| 分区 | 判据 | 占陆地% | 均降水mm | 均温℃ |`);
    md.push(`|---|---|---|---|---|`);
    const crit = {
      '冰原': '最暖月<-2℃', '苔原': '最暖月<9℃', '高山山地': '海拔>3300m', '亚寒带针叶林': '最冷月<-3℃且最暖月>9.5℃',
      '热带雨林': '年降水>1700且旱季>55mm', '热带季风林': '季风指数>0.5,夏雨集中', '热带草原': '热带,干湿分明',
      '干旱沙漠': '年降水<260mm(或<430且旱季极干)', '半干旱草原': '年降水<540mm', '地中海气候': '冬雨夏干',
      '副热带湿润': '最冷月>-1℃,年降水>750', '温带海洋性': '年较差<16℃,湿润', '温带大陆性': '深居内陆,年较差大', '温带季风': '季风指数>0.55,夏雨冬干'
    };
    for (const k of Object.keys(cs)) md.push(`| ${k} | ${crit[k] || '—'} | ${cs[k]['面积百分比']} | ${cs[k]['年均降水mm']} | ${cs[k]['年均温C']} |`);
    md.push('');
    if (names.deserts.length) md.push(`主要沙漠: ${names.deserts.join('、')}。`);
    if (names.ranges.length) md.push(`主要山脉: ${names.ranges.join('、')}。`);
    if (names.oceans.length) md.push(`大洋与海: ${names.oceans.map(o => o.name).join('、')}。`);
    md.push('');
    md.push(`季风区 ${st.monsoonRegions} 片,占陆地 ${st.monsoonAreaPct}%(${names.monsoons.slice(0, 4).join('、')}等)。`);
    md.push('');
    md.push(`## 六、水文`);
    md.push(`- 主要河流: ${names.rivers.slice(0, 8).join('、')}${names.rivers.length > 8 ? ' 等' + rivers.length + '条' : ''};`);
    md.push(`- 主要湖泊 ${lakes.length} 个(含裂谷湖链与构造湖);`);
    md.push(`- 大流域 ${st.basins} 个,内流盆地以湖泊/季节河形式记录在湖泊图层。`);
    md.push('');
    md.push(`## 七、城邦文明背景`);
    md.push(`**${cfg.culture.civName}**`);
    md.push('');
    md.push(cfg.culture.civIntro);
    md.push('');
    md.push(`| 城邦 | 类型 | 人口(万) | 政体 | 气候 | 特产 |`);
    md.push(`|---|---|---|---|---|---|`);
    for (const c of cities) md.push(`| ${c.name} | ${c.type} | ${c.popWan} | ${c.govt} | ${c.climate} | ${c.goods.join('、')} |`);
    md.push('');
    for (const c of cities) md.push(`**${c.name}** — ${c.background}`);
    md.push('');
    md.push(`## 八、编年史(自动推演, 负数为纪元前)`);
    md.push(`| 纪年 | 大事 |`);
    md.push(`|---|---|`);
    for (const ev of contentPack.chronicle) md.push(`| ${ev.year < 0 ? '前' + (-ev.year) : ev.year} | ${ev.text} |`);
    md.push('');
    md.push(`## 九、神话与生态图鉴`);
    for (const p of contentPack.myth) md.push(`- ${p}`);
    md.push('');
    md.push(`| 气候分区 | 代表物种(自动命名) |`);
    md.push(`|---|---|`);
    for (const e of contentPack.eco) md.push(`| ${e.climate} | ${e.entries.join('；')} |`);
    md.push('');
    md.push(`## 十、生成参数`);
    md.push('```json');
    md.push(JSON.stringify({ seed: cfg.seed, plates: cfg.plates, continentalPlates: cfg.continentalPlates, landTarget: cfg.landTarget, hotspots: cfg.hotspots, rotFactor: cfg.rotFactor, tiltDeg: cfg.tiltDeg, greenhouse: cfg.greenhouse, moistureDecayDeg: cfg.moistureDecayDeg, continentBias: cfg.continentBias, forceRift: cfg.forceRift, forceCollision: cfg.forceCollision }, null, 1));
    md.push('```');
    fs.writeFileSync(path.join(outDir, 'planet.md'), md.join('\n'), 'utf8');
  }

  // planet.json(预览用; 附带位打包陆栅 + Int16 高度场[3D地形/夜灯/贴城邦用])
  {
    const landBits = Buffer.alloc(Math.ceil(N / 8));
    for (let i = 0; i < N; i++) if (!ocean[i]) landBits[i >> 3] |= (1 << (i & 7));
    const elev16 = new Int16Array(N);
    for (let i = 0; i < N; i++) elev16[i] = Math.round(L.clamp(elev[i], -8800, 8800));
    L.writeJSON(path.join(outDir, 'planet.json'), {
      id: cfg.id, name: cfg.name, en: cfg.en, tagline: cfg.tagline,
      custom: !!cfg.custom, description: cfg.description || '',
      gridW: W, gridH: H, elevB64: Buffer.from(elev16.buffer).toString('base64'),
      moons: cfg.moons || 1, palette: cfg.palette || null,
      chronicle: contentPack.chronicle, myth: contentPack.myth, eco: contentPack.eco,
      params: { dayHours: cfg.dayHours, tiltDeg: cfg.tiltDeg, landPct: +landPct.toFixed(3), plates: cfg.plates, phiH: +phiH.toFixed(1), seed: cfg.seed, landTarget: cfg.landTarget, continentBias: cfg.continentBias, forceRift: cfg.forceRift, forceCollision: cfg.forceCollision },
      gridW: W, gridH: H, landMaskB64: landBits.toString('base64'),
      stats, cities: cities.map(c => ({ name: c.name, lat: c.lat, lon: c.lon, type: c.type, popWan: c.popWan, govt: c.govt, goods: c.goods, background: c.background, climate: c.climate, monsoon: c.monsoon, elevM: c.elevM, nearCurrent: c.nearCurrent, coast: c.coast })),
      names, culture: { civName: cfg.culture.civName, civIntro: cfg.culture.civIntro },
      expect: cfg.expect
    });
  }

  log(`完成,耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outDir}`);
  return { landPct, stats };
}

// ---------------- 入口 ----------------
const argv = process.argv.slice(2);
if (argv[0] === '--params') {
  // 自定义参数模式: node generate.js --params <path.json> (行星工坊用)
  const cfg = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  console.log(`=== ${cfg.name} (自定义 seed=${cfg.seed}) ===`);
  generatePlanet(cfg);
  process.exit(0);
}
const only = argv;
for (const cfg of P.planets) {
  if (only.length && !only.includes(cfg.id) && !only.includes(cfg.name)) continue;
  console.log(`=== ${cfg.name} (${cfg.en}) ===`);
  generatePlanet(cfg);
}
console.log('全部完成');
