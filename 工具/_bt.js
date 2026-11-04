'use strict';
const fs = require('fs');
const lines = fs.readFileSync('E:/zcode/玩/虚构行星/工具/build-lite.js', 'utf8').split('\n');
for (let i = 43; i < 151; i++) {
  const dd = (lines[i].match(/\$\{/g) || []).length;
  if (dd) console.log('line', i + 1, '${x' + dd, '|', lines[i].trim().slice(0, 100));
}
