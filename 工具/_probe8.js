'use strict';
const fs = require('fs');
const s = fs.readFileSync('E:/zcode/玩/虚构行星/工具/build-lite.js', 'utf8');
const i = s.indexOf('const Y = nz, Z = -ny;');
console.log('公式块位置:', i);
console.log(s.slice(i - 60, i + 420));
