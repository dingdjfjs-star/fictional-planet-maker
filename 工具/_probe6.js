'use strict';
const http = require('http');
http.get({ host: '127.0.0.1', port: 8961, path: '/' + encodeURIComponent('轻量版.html') }, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    const lines = d.split('\n');
    console.log('HTTP', r.statusCode, '总行数', lines.length);
    for (let i = 200; i < 212; i++) console.log(i + 1, lines[i] ? lines[i].trim().slice(0, 90) : '');
    console.log('含 srcW:', d.includes('const srcW = ensureSrc()'));
    console.log('含 ensureSrc 返回 srcCache:', d.includes('return srcCache;'));
  });
});
