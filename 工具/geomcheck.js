'use strict';
// 几何体检: 找出可能让 Cesium earcut 崩溃的环(重复点/自触/跨反子午线/退化)
const fs = require('fs');
const path = require('path');

function checkRing(ring, label) {
  const issues = [];
  if (ring.length < 4) issues.push('ring<4');
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (a[0] === b[0] && a[1] === b[1]) { issues.push(`dup@${i}`); break; }
    if (Math.abs(a[0] - b[0]) > 180) { issues.push(`antimeridian@${i}`); break; }
    if (!isFinite(a[0]) || !isFinite(a[1])) { issues.push(`nan@${i}`); break; }
  }
  // 自触: 同一顶点多次出现(除首尾)
  const seen = new Map();
  for (let i = 0; i < ring.length - 1; i++) {
    const k = ring[i][0].toFixed(6) + ',' + ring[i][1].toFixed(6);
    if (seen.has(k)) { issues.push(`selftouch@${i}(first@${seen.get(k)})`); break; }
    seen.set(k, i);
  }
  if (issues.length) return { label, issues: issues.join(','), len: ring.length };
  return null;
}

const ROOT = path.join(__dirname, '..', '数据');
for (const planet of ['翡岚', '烬壤', '霜屿']) {
  const dir = path.join(ROOT, planet);
  console.log(`\n=== ${planet} ===`);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.geojson'))) {
    const gj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bad = [];
    gj.features.forEach((ft, fi) => {
      const g = ft.geometry;
      if (!g) return;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      polys.forEach((poly, pi) => poly.forEach((ring, ri) => {
        const r = checkRing(ring, `${f}#${fi}(${ft.properties.名称 || ft.properties.类型 || ''})/poly${pi}/ring${ri}`);
        if (r) bad.push(r);
      }));
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      lines.forEach((line, li) => {
        for (let i = 0; i < line.length - 1; i++) {
          if (Math.abs(line[i][0] - line[i + 1][0]) > 180) { bad.push({ label: `${f}#${fi} LINE antimeridian@${i}`, issues: 'jump>180', len: line.length }); break; }
        }
      });
    });
    if (bad.length) {
      console.log(`  ${f}: ${bad.length} 个可疑几何`);
      bad.slice(0, 6).forEach(b => console.log(`    - ${b.label} [${b.issues}] len=${b.len}`));
    }
  }
}
console.log('\n完成');
