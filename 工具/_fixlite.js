'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const before = (s.match(/src\.d\[/g) || []).length;
s = s.replace(/src\.d\[/g, 'src[');
fs.writeFileSync(p, s);
console.log('替换 src.d[ 前出现次数:', before, '→ 现剩余:', (s.match(/src\.d\[/g) || []).length);
