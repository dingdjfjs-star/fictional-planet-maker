'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const oldS = 'DPR = Math.min(2, window.devicePixelRatio || 1)';
if (!s.includes(oldS)) { console.log('未找到'); process.exit(1); }
s = s.replace(oldS, 'DPR = 1');
fs.writeFileSync(p, s);
console.log('DPR 已固定为 1');
const r = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(r.output.join('').trim().split('\n').pop());
