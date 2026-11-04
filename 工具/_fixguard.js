'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const g3 = "function render(ts) {\n  if (mode === 'map') drawMap(); else drawGlobe(ts || 0);\n}";
const n3 = "function render(ts) {\n  if (W !== innerWidth || H !== innerHeight || !W) resize();\n  if (mode === 'map') drawMap(); else drawGlobe(ts || 0);\n}";
if (s.includes(g3)) { s = s.replace(g3, n3); console.log('③ render 自愈 已加'); }
else console.log('③ 仍未找到');
fs.writeFileSync(p, s);
const r = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(r.output.join('').trim().split('\n').pop());
