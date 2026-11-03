'use strict';
// 扫描对跖线段(|dot|≈1 且 dot<0): EllipsoidRhumbLine 对对跖点返回 NaN → new Array(NaN) 崩溃
const fs = require('fs');
const path = require('path');

function unit([lon, lat]) {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

const ROOT = path.join(__dirname, '..', '数据');
for (const planet of ['翡岚', '烬壤', '霜屿']) {
  const dir = path.join(ROOT, planet);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.geojson'))) {
    const gj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    gj.features.forEach((ft, fi) => {
      const g = ft.geometry;
      if (!g) return;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      lines.forEach((line, li) => {
        for (let i = 0; i < line.length - 1; i++) {
          const a = unit(line[i]), b = unit(line[i + 1]);
          const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
          if (dot < -0.999999) {
            console.log(`${planet}/${f}#${fi} seg${i}: 对跖段 dot=${dot.toFixed(9)}  ${JSON.stringify(line[i])} → ${JSON.stringify(line[i + 1])}  (${ft.properties.名称 || ft.properties.类型 || ''})`);
          }
          // 同时查恰好 180 的经差(潜在对跖)
          if (Math.abs(Math.abs(line[i][0] - line[i + 1][0]) - 180) < 1e-9) {
            console.log(`${planet}/${f}#${fi} seg${i}: 经差恰180  ${JSON.stringify(line[i])} → ${JSON.stringify(line[i + 1])}`);
          }
        }
      });
    });
  }
}
console.log('扫描完成');
