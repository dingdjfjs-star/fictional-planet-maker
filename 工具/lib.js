'use strict';
// ============================================================
// 虚构行星生成器 - 基础库(零依赖)
// 随机数 / 球面数学 / 3D值噪声 / 二叉堆 / PNG编码 / 栅格多边形化 / GeoJSON工具
// ============================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------- 随机数(可复现) ----------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngPick(rand, arr) { return arr[Math.floor(rand() * arr.length) % arr.length]; }
function rngRange(rand, a, b) { return a + (b - a) * rand(); }

// ---------------- 3D 值噪声 + fBm ----------------
function makeNoise3(rand) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  function h(ix, iy, iz) { return perm[(perm[(perm[ix & 255] + iy) & 255] + iz) & 255] / 255; }
  function noise3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const n000 = h(ix, iy, iz), n100 = h(ix + 1, iy, iz), n010 = h(ix, iy + 1, iz), n110 = h(ix + 1, iy + 1, iz);
    const n001 = h(ix, iy, iz + 1), n101 = h(ix + 1, iy, iz + 1), n011 = h(ix, iy + 1, iz + 1), n111 = h(ix + 1, iy + 1, iz + 1);
    const nx00 = n000 + (n100 - n000) * u, nx10 = n010 + (n110 - n010) * u;
    const nx01 = n001 + (n101 - n001) * u, nx11 = n011 + (n111 - n011) * u;
    const nxy0 = nx00 + (nx10 - nx00) * v, nxy1 = nx01 + (nx11 - nx01) * v;
    return nxy0 + (nxy1 - nxy0) * w; // 0..1
  }
  function fbm(x, y, z, oct, lac, gain) {
    oct = oct || 5; lac = lac || 2.0; gain = gain || 0.5;
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += a * noise3(x * f + o * 17.7, y * f + o * 9.1, z * f + o * 31.3);
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm; // 0..1
  }
  return { noise3, fbm };
}

// ---------------- 球面 ----------------
function latLonToVec(lat, lon) {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}
function vecToLatLon(v) {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.asin(v[2] / r) * 180 / Math.PI, Math.atan2(v[1], v[0]) * 180 / Math.PI];
}
function angDistRad(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}
function normVec(v) {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / r, v[1] / r, v[2] / r];
}
function crossVec(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dotVec(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
// 把单位向量 p 绕轴 axis 旋转 ang(弧度)
function rotateAround(p, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const cr = crossVec(axis, p), d = dotVec(axis, p);
  return [
    p[0] * c + cr[0] * s + axis[0] * d * (1 - c),
    p[1] * c + cr[1] * s + axis[1] * d * (1 - c),
    p[2] * c + cr[2] * s + axis[2] * d * (1 - c)
  ];
}

// ---------------- 数值 ----------------
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}
// 方向角(度) 差值, 返回 -180..180
function angDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360; if (d < -180) d += 360;
  return d;
}

// ---------------- 二叉最小堆 ----------------
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  }
}

// ---------------- PNG 编码(RGBA) ----------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
// rgba: Uint8Array (w*h*4)
function writePNG(filePath, w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(filePath, png);
}

// ---------------- 栅格工具 ----------------
// 3x3 盒滤波(不处理经度环绕, 纬度截断)
function boxBlur1(data, W, H) {
  const out = new Float32Array(data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = (x + dx + W) % W; // 经度环绕
          sum += data[yy * W + xx]; cnt++;
        }
      }
      out[y * W + x] = sum / cnt;
    }
  }
  return out;
}
// 8邻域连通域标记
function connectedComponents(mask, W, H) {
  // mask: Uint8Array; 返回 { compId: Int32Array, comps: [{id, cells:[idx], size}] }
  const compId = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || compId[i] >= 0) continue;
    const id = comps.length;
    const cells = [];
    compId[i] = id; stack.push(i);
    while (stack.length) {
      const c = stack.pop(); cells.push(c);
      const cx = c % W, cy = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = cy + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = (cx + dx + W) % W;
          const n = yy * W + xx;
          if (mask[n] && compId[n] < 0) { compId[n] = id; stack.push(n); }
        }
      }
    }
    comps.push({ id, cells, size: cells.length });
  }
  return { compId, comps };
}

// ---------------- 栅格标签 → 多边形(边链缝合) ----------------
// labels: Int32Array, -1 表示不属于任何区域; 网格不跨反子午线(跨者被切分成两块)
// 返回 Map<label, [ {rings: [outer, hole...](corner坐标), area} ]>  corner坐标 x∈[0..W], y∈[0..H]
function polygonizeLabels(labels, W, H, minAreaCells) {
  minAreaCells = minAreaCells || 4;
  const key = (x, y) => x * (H + 1) + y;
  const segStart = new Map(); // key -> [{ex, ey, label}]
  function addSeg(x1, y1, x2, y2, label) {
    const k = key(x1, y1);
    let arr = segStart.get(k);
    if (!arr) { arr = []; segStart.set(k, arr); }
    arr.push({ ex: x2, ey: y2, label });
  }
  const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H) ? -1 : labels[y * W + x];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const L = labels[y * W + x];
      if (L < 0) continue;
      // 保持区域在行进方向右侧(统一方向, 便于洞判定)
      if (at(x, y - 1) !== L) addSeg(x + 1, y, x, y, L);        // 北边: 从东到西
      if (at(x, y + 1) !== L) addSeg(x, y + 1, x + 1, y + 1, L); // 南边
      if (at(x - 1, y) !== L) addSeg(x, y, x, y + 1, L);         // 西边
      if (at(x + 1, y) !== L) addSeg(x + 1, y + 1, x + 1, y, L); // 东边
    }
  }
  const used = new Set();
  const result = new Map(); // label -> [{rings:[...], area}]
  // 环后处理: 去连续重复点 + 在重复顶点处分裂自触环(单格宽半岛的尖刺/8字环会让 Cesium earcut 崩溃)
  function dedupePts(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = out[out.length - 1];
      if (p[0] !== q[0] || p[1] !== q[1]) out.push(p);
    }
    return out;
  }
  function splitRingAtRepeated(seg, depth) {
    if (seg.length < 4) return [];
    if ((depth || 0) > 60) return [seg]; // 保险丝
    const seen = new Map();
    for (let i = 0; i < seg.length - 1; i++) {
      const k = seg[i][0] + ',' + seg[i][1];
      if (seen.has(k)) {
        const j = seen.get(k);
        const lobe = seg.slice(j, i + 1);          // 已含 seg[i]==seg[j], 本身闭合
        if (lobe[lobe.length - 1] !== lobe[0]) lobe.push(lobe[0]);
        const rest = seg.slice(0, j + 1).concat(seg.slice(i + 1));
        return [...splitRingAtRepeated(lobe, (depth || 0) + 1), ...splitRingAtRepeated(rest, (depth || 0) + 1)];
      }
      seen.set(k, i);
    }
    return [seg];
  }
  for (const [k0, arr0] of segStart) {
    for (const first of arr0) {
      const fk = key(Math.floor(k0 / (H + 1)), k0 % (H + 1));
      const segKey = fk + ':' + first.ex + ',' + first.ey + ':' + first.label;
      if (used.has(segKey)) continue;
      const label = first.label;
      // 起链
      const pts = [[Math.floor(k0 / (H + 1)), k0 % (H + 1)]];
      let cx = Math.floor(k0 / (H + 1)), cy = k0 % (H + 1);
      let inDirX = Math.sign(first.ex - cx), inDirY = Math.sign(first.ey - cy);
      let ex = first.ex, ey = first.ey;
      used.add(segKey);
      let guard = 0;
      for (;;) {
        pts.push([ex, ey]);
        if (ex === pts[0][0] && ey === pts[0][1]) break; // 闭合
        if (++guard > W * H) break; // 防死循环
        const cands = segStart.get(key(ex, ey)) || [];
        let best = null, bestKey = null, bestScore = -Infinity;
        for (const cand of cands) {
          const ck = key(ex, ey) + ':' + cand.ex + ',' + cand.ey + ':' + cand.label;
          if (used.has(ck) || cand.label !== label) continue;
          const dx = Math.sign(cand.ex - ex), dy = Math.sign(cand.ey - ey);
          // 转向优先级: 保持区域在右侧 → 优先右转(相对行进方向顺时针, y向下坐标系)
          const cross = inDirX * dy - inDirY * dx; // >0 左转, <0 右转(y向下)
          const dot = inDirX * dx + inDirY * dy;
          const score = (cross < 0 ? 2 : (cross === 0 ? 1 : 0)) * 2 + (dot > 0 ? 1 : 0);
          if (score > bestScore) { bestScore = score; best = cand; bestKey = ck; }
        }
        if (!best) break; // 开放链(不应发生)
        used.add(bestKey);
        inDirX = Math.sign(best.ex - ex); inDirY = Math.sign(best.ey - ey);
        cx = ex; cy = ey;
        ex = best.ex; ey = best.ey;
      }
      if (pts.length < 4) continue;
      // 后处理: 去重 + 分裂自触环, 每个简单环单独记录
      const cleanPts = dedupePts(pts);
      if (cleanPts.length < 4) continue;
      for (const part of splitRingAtRepeated(cleanPts)) {
        if (part.length < 4) continue;
        let a2p = 0;
        for (let i = 0; i < part.length - 1; i++) {
          a2p += part[i][0] * part[i + 1][1] - part[i + 1][0] * part[i][1];
        }
        a2p /= 2;
        if (Math.abs(a2p) < minAreaCells) continue;
        if (!result.has(label)) result.set(label, []);
        result.get(label).push({ rings: [part], area: a2p });
      }
      continue;
    }
  }
  return result;
}
// 判断点是否在环内(射线法)
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// 折线在反子午线处切割(经度跳变 >180 时断开并补边界点), 返回若干段
// 切点内收: 避免顶点落在恰好 ±180(RhumbLine 对 ±180 经线边返回 NaN → Cesium 轮廓/细分崩溃)
const SEAM = 179.995;
function splitLineAtAntimeridian(coords) {
  if (!coords || coords.length < 2) return [coords || []];
  const parts = [];
  let cur = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    if (Math.abs(b[0] - a[0]) > 180) {
      const dir = a[0] > 0 ? 1 : -1;          // 行进方向: 向东(+1)/向西(-1)跨缝
      const bU = b[0] + 360 * dir;            // b 沿行进方向展开后的经度
      const edge = dir > 0 ? SEAM : -SEAM;    // 沿行进方向穿越的缝(内收)
      const t = (edge - a[0]) / (bU - a[0]);
      const lat = a[1] + (b[1] - a[1]) * t;
      cur.push([edge, +lat.toFixed(4)]);      // 第一段止于 a 侧边界
      if (cur.length >= 2) parts.push(cur);
      cur = [[-edge, +lat.toFixed(4)], b];    // 第二段起于 b 侧边界
    } else {
      cur.push(b);
    }
  }
  if (cur.length >= 2) parts.push(cur);
  return parts.length ? parts : [coords];
}

// 把折线拆成多个独立 Feature(GeoJsonDataSource 会把 MultiLineString 各段拼成一条折线,
// 在反子午线处产生 [180,lat]→[-180,lat] 段导致 subdivideRhumbLine 崩溃)
// 出口统一钳制: 任何顶点不得落在极点(±90)或 ±180 经线(RhumbLine 在此发散 → new Array(NaN))
function splitLineFeatures(props, coords) {
  const clv = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
  const parts = splitLineAtAntimeridian(coords);
  return parts.map((p, i) => {
    const pr = Object.assign({}, props);
    if (parts.length > 1) pr.分段 = i + 1;
    const safe = p.map(([lo, la]) => [clv(lo, -179.999, 179.999), clv(la, -89.9, 89.9)]);
    return { type: 'Feature', properties: pr, geometry: { type: 'LineString', coordinates: safe } };
  });
}

// 线段预细分: 相邻顶点间隔超过 maxSegDeg 度时线性插入中间点
// (配合 Cesium ArcType.NONE 直线段渲染, 消除 RHUMB 细分崩溃路径; 需配合抬高线高抵消弦沉降)
function subdivideLine(coords, maxSegDeg) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    let dLon = b[0] - a[0], dLat = b[1] - a[1];
    const deg = Math.hypot(dLon * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), dLat);
    const n = Math.ceil(deg / maxSegDeg);
    if (n > 1 && isFinite(n)) {
      for (let k = 1; k < n; k++) {
        out.push([+(a[0] + dLon * k / n).toFixed(3), +(a[1] + dLat * k / n).toFixed(3)]);
      }
    }
    out.push(b);
  }
  return out;
}

// 栅格标签 → GeoJSON FeatureCollection
// toLonLat: (x,y) => [lon, lat];  areaPerCell: 单格面积(km²)
function labelsToGeoJSON(labels, W, H, opts) {
  const { minAreaCells, keepTopPerLabel, toLonLat, areaPerCell, propFn } = opts;
  const poly = polygonizeLabels(labels, W, H, minAreaCells);
  const feats = [];
  for (const [label, shapes] of poly) {
    const rings = shapes.map(s => ({ pts: s.rings[0], a2: s.area, abs: Math.abs(s.area) }));
    const outers = rings.filter(r => r.a2 < 0);   // 区域在右侧行进 → 外环鞋带面积为负(y向下坐标)
    const holes = rings.filter(r => r.a2 >= 0);
    for (const o of outers) {
      o.holes = holes.filter(h => pointInRing(h.pts[0][0] + 0.5, h.pts[0][1] + 0.5, o.pts));
    }
    outers.sort((a, b) => b.abs - a.abs);
    let list = outers;
    if (keepTopPerLabel && outers.length > keepTopPerLabel) {
      list = outers.slice(0, keepTopPerLabel); // 被丢弃的外环连同其洞一起消失
    }
    for (const o of list) {
      // 环顶点去重(去尾零长边), 防 Cesium 三角化退化
      const dpts = (pts) => {
        const out = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i], q = out[out.length - 1];
          if (p[0] !== q[0] || p[1] !== q[1]) out.push(p);
        }
        if (out.length > 2 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) return out;
        return out;
      };
      const outerLL = dpts(o.pts).map(([x, y]) => toLonLat(x, y));
      const holesLL = o.holes.map(h => dpts(h.pts).map(([x, y]) => toLonLat(x, y)));
      const props = propFn ? propFn(label, o.abs * (areaPerCell || 1), outerLL) : {};
      feats.push({
        type: 'Feature',
        properties: Object.assign({ label, areaKm2: Math.round(o.abs * (areaPerCell || 1)) }, props),
        geometry: { type: 'Polygon', coordinates: [outerLL, ...holesLL] }
      });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

// ---------------- GeoJSON / 线工具 ----------------
function fc(feats) { return { type: 'FeatureCollection', features: feats }; }
function feat(props, geometry) { return { type: 'Feature', properties: props, geometry }; }
function lineFeat(props, coords) {
  return feat(props, { type: 'LineString', coordinates: coords });
}

// Douglas-Peucker 简化(经纬度平面近似, 粗容差足够)
function simplifyDP(pts, tol) {
  if (pts.length <= 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const t = clamp(((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / L2, 0, 1);
      const px = ax + t * dx, py = ay + t * dy;
      const dd = Math.hypot(pts[i][0] - px, pts[i][1] - py);
      if (dd > maxD) { maxD = dd; maxI = i; }
    }
    if (maxD > tol && maxI > 0) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj)); }
function writeJSONPretty(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 1)); }

module.exports = {
  mulberry32, rngPick, rngRange,
  makeNoise3, latLonToVec, vecToLatLon, angDistRad, normVec, crossVec, dotVec, rotateAround,
  clamp, lerp, smoothstep, angDiff, MinHeap,
  writePNG, boxBlur1, connectedComponents,
  polygonizeLabels, pointInRing, labelsToGeoJSON, splitLineAtAntimeridian, splitLineFeatures, subdivideLine,
  fc, feat, lineFeat, simplifyDP,
  ensureDir, writeJSON, writeJSONPretty
};
