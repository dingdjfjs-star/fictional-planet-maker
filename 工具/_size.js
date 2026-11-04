'use strict';
const fs = require('fs');
const dir = 'E:/zcode/玩/虚构行星/数据';
let total = 0;
for (const p of fs.readdirSync(dir)) {
  const files = fs.readdirSync(dir + '/' + p);
  let sum = 0;
  for (const f of files) sum += fs.statSync(dir + '/' + p + '/' + f).size;
  total += sum;
  const key = {};
  for (const f of files) key[f] = +(fs.statSync(dir + '/' + p + '/' + f).size / 1024).toFixed(0);
  console.log(p, (sum / 1024 / 1024).toFixed(1) + 'MB', JSON.stringify(key));
}
console.log('数据总计:', (total / 1024 / 1024).toFixed(1) + 'MB');
const vend = fs.statSync('E:/zcode/玩/虚构行星/预览/vendor/cesium/Cesium.js').size;
console.log('Cesium.js:', (vend / 1024 / 1024).toFixed(1) + 'MB');
