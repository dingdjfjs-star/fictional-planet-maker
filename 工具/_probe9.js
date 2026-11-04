'use strict';
const http = require('http');
http.get({ host: '127.0.0.1', port: 8961, path: '/' + encodeURIComponent('轻量版.html') }, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    const lines = d.split('\n');
    for (let i = 202; i < 210; i++) console.log(i + 1, lines[i] ? lines[i].trim().slice(0, 100) : '');
    const i = lines.findIndex(l => l.includes('function ensureSrc'));
    console.log('--- ensureSrc ---');
    for (let k = i; k < i + 8; k++) console.log(lines[k] ? lines[k].trim().slice(0, 100) : '');
  });
});
