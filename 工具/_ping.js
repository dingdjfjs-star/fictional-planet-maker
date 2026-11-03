'use strict';
const http = require('http');
http.get({ host: '127.0.0.1', port: 8961, path: '/api/customs' }, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => console.log('服务器存活:', r.statusCode, d.slice(0, 160)));
}).on('error', e => console.log('服务器挂了:', e.message));
