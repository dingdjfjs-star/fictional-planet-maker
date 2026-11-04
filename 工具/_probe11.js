'use strict';
const fs = require('fs');
// 在轻量版.html 里临时加一个诊断按钮? 不改文件 —— 用 evaluate 直接测
const fs2 = null;
const http = require('http');
// 需要页面 URL —— 输出一段可直接 evaluate 的代码供下一步使用
console.log(`
(() => {
  const out = {};
  try {
    const c = document.createElement('canvas'); c.width = 10; c.height = 10;
    const x = c.getContext('2d');
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, 10, 10);
    const id = x.getImageData(0, 0, 10, 10);
    out.control = { len: id.data.length, r0: id.data[0], g0: id.data[1] };
  } catch (e) { out.control = 'throw: ' + e.message.slice(0, 60); }
  try {
    const w = ensureSrc();
    out.src = { hasD: !!w.d, isArr: w.d ? w.d.data instanceof Uint8ClampedArray : false, len: w.d ? w.d.data.length : -1, w: w.d ? w.d.width : -1, sample: w.d && w.d.data.length ? [w.d.data[500000], w.d.data[500001], w.d.data[500002]] : null };
  } catch (e) { out.src = 'throw: ' + e.message.slice(0, 60); }
  return out;
})()
`);
