'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const oldS = 'const srcW = ensureSrc();\n  if (!srcW) return;\n  const src = srcW.d;';
const newS = 'const srcW = ensureSrc();\n  if (!srcW) return;\n  const src = srcW.d.data; // 像素数组(此前误用 ImageData 对象本身 → 数字索引全 undefined → 画面全黑)';
if (!s.includes(oldS)) { console.log('未找到目标'); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(p, s);
console.log('已修复: src = 像素数组');
const r = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(r.output.join('').trim().split('\n').pop());
