'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const oldS = 'function setMode(m) {\n  mode = m;';
if (s.includes(oldS)) {
  s = s.replace(oldS, 'function setMode(m) {\n  prep(cur); // 确保贴图已创建(未解码完成时 rAF 循环会自动重试)\n  mode = m;');
  fs.writeFileSync(p, s);
  console.log('setMode 已加 prep 防御');
} else console.log('未找到 setMode 标记(检查缩进)');
const r = require('child_process').spawnSync(process.execPath, [p]);
console.log('build-lite 语法:', r.status === 0 ? 'OK' : r.stderr.toString().split('\n')[0].slice(0, 100));
const b = require('child_process').spawnSync(process.execPath, [p], { encoding: 'utf8' });
console.log(b.output.join('').trim().split('\n').pop());
