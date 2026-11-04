'use strict';
const http = require('http');
http.get({ host: '127.0.0.1', port: 8961, path: '/' + encodeURIComponent('轻量版.html') }, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    const lines = d.split('\n');
    for (let i = 192; i < 201; i++) console.log(i + 1, lines[i] ? lines[i].trim().slice(0, 100) : '');
  });
});
