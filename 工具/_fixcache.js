'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const oldS = `  const d = c.getContext('2d').getImageData(0, 0, 1440, 720);
  srcCache = { i: img, d };
  return srcCache;`;
const newS = `  const d = c.getContext('2d').getImageData(0, 0, 1440, 720);
  // 空捕获(图片尚在解码)不缓存 → rAF 下一帧自动重试, 避免黑球永久卡死
  let nz = 0;
  for (let i = 0; i < d.data.length; i += 40000) { if (d.data[i] || d.data[i + 1] || d.data[i + 2]) nz++; }
  if (nz === 0) return null;
  srcCache = { i: img, d };
  return srcCache;`;
if (!s.includes(oldS)) { console.log('未找到目标块'); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(p, s);
console.log('已加空捕获防缓存守卫');
const r = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(r.output.join('').trim().split('\n').pop());
