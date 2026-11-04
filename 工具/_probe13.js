'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const i = s.indexOf('DPR');
console.log('DPR 首现位置:', i);
console.log(JSON.stringify(s.slice(i - 40, i + 120)));
