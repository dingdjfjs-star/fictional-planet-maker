'use strict';
const fs = require('fs');
const s = fs.readFileSync('E:/zcode/玩/虚构行星/预览/index.html', 'utf8');
const lines = s.split('\n');
let found = 0;
lines.forEach((l, i) => {
  if (/['"`>]\/(data|vendor|api)\//.test(l)) { found++; console.log(i + 1, l.trim().slice(0, 120)); }
});
console.log('--- 残留绝对路径:', found, '处 ---');
// 同时确认关键的相对路径已就位
const checks = [
  ['CESIUM_BASE_URL 相对', s.includes("CESIUM_BASE_URL = './vendor/cesium/'")],
  ['Cesium.js 相对', s.includes('src="./vendor/cesium/Cesium.js"')],
  ['数据相对', s.includes('`数据/${encodeURIComponent')],
  ['api 相对', s.includes("fetch('api/")]
];
for (const [n, ok] of checks) console.log(ok ? '✓' : '✗', n);
