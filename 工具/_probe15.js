'use strict';
const fs = require('fs');
const s = fs.readFileSync('E:/zcode/玩/虚构行星/工具/deploy.js', 'utf8');
const i = s.indexOf('function json');
console.log('json 位置:', i);
if (i < 0) { console.log('前 3 行:'); console.log(s.split('\n').slice(0, 20).join('\n')); }
else console.log(JSON.stringify(s.slice(i - 20, i + 130)));
