'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const oldS = 'srcCache = { i: img, d };\n  return d;\n}';
if (!s.includes(oldS)) { console.log('未找到目标'); process.exit(1); }
s = s.replace(oldS, 'srcCache = { i: img, d };\n  return srcCache;\n}');
fs.writeFileSync(p, s);
console.log('已修复: ensureSrc 首次路径返回包装对象');
const r = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(r.output.join('').trim().split('\n').pop());
