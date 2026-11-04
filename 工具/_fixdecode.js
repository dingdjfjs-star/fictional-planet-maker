'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
// ① mkImg 改用 decode() —— dataURL 渐进解码时 onload 早于像素就绪
const oldMk = `function mkImg(src, onload) { const im = new Image(); im.onload = () => { cacheSrc(im); if (onload) onload(); }; im.src = src; return im; }`;
const newMk = `function mkImg(src, onload) {
  const im = new Image();
  const ready = () => { cacheSrc(im); if (onload) onload(); };
  im.onload = ready; // 兜底
  im.src = src;
  if (im.decode) im.decode().then(ready).catch(() => {});
  return im;
}`;
if (s.includes(oldMk)) { s = s.replace(oldMk, newMk); console.log('① mkImg 已改 decode()'); }
else console.log('① mkImg 未匹配(检查)');
// ② ensureSrc 拒绝大部分为黑的捕获
const oldG = `  let nz = 0;
  for (let i = 0; i < d.data.length; i += 40000) { if (d.data[i] || d.data[i + 1] || d.data[i + 2]) nz++; }
  if (nz === 0) return null;`;
const newG = `  let nz = 0, tot = 0;
  for (let i = 0; i < d.data.length; i += 40000) { tot++; if (d.data[i] || d.data[i + 1] || d.data[i + 2]) nz++; }
  if (nz / Math.max(1, tot) < 0.3) return null; // 大部分黑 = 解码未完成`;
if (s.includes(oldG)) { s = s.replace(oldG, newG); console.log('② 空捕获守卫 已强化为比例守卫'); }
else console.log('② 空捕获守卫 未匹配(检查)');
fs.writeFileSync(p, s);
const r = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(r.output.join('').trim().split('\n').pop());
