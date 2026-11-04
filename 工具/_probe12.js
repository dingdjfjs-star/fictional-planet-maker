'use strict';
const fs = require('fs');
const http = require('http');
http.get({ host: '127.0.0.1', port: 8961, path: '/' + encodeURIComponent('轻量版.html') }, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    fs.writeFileSync('E:/zcode/玩/虚构行星/工具/_dg.txt', d);
    const i = d.indexOf('function drawGlobe');
    const j = d.indexOf('function drawLinesGlobe');
    console.log('drawGlobe 区间:', i, j, '长度:', j - i);
    const seg = d.slice(i, j);
    const lines = seg.split('\n');
    lines.forEach((l, k) => {
      if (/drawImage|clip\(\)|save\(\)|restore\(\)|fillRect/.test(l)) console.log('  L' + k, l.trim().slice(0, 90));
    });
    console.log('--- 总行数:', lines.length);
  });
});
