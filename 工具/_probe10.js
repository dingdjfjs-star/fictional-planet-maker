'use strict';
const fs = require('fs');
const s = fs.readFileSync('E:/zcode/玩/虚构行星/轻量版.html', 'utf8');
console.log('磁盘文件 207 行附近:');
const lines = s.split('\n');
for (let i = 203; i < 210; i++) console.log(i + 1, lines[i] ? lines[i].trim().slice(0, 90) : '');
console.log('含 src.d[:', (s.match(/src\.d\[/g) || []).length, '处');
console.log('含 srcW:', (s.match(/srcW/g) || []).length, '处');
console.log('含 ensureSrc 缓存 return srcCache:', s.includes('if (srcCache && srcCache.i === img) return srcCache;'));
console.log('文件 mtime:', fs.statSync('E:/zcode/玩/虚构行星/轻量版.html').mtime.toISOString());
// 同时查 build-lite.js 模板
const b = fs.readFileSync('E:/zcode/玩/虚构行星/工具/build-lite.js', 'utf8');
console.log('模板含 src.d[:', (b.match(/src\.d\[/g) || []).length, '处');
console.log('模板 ensureSrc 块:');
const i = b.indexOf('function ensureSrc');
console.log(b.slice(i, i + 520));
