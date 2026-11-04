'use strict';
const http = require('http');
function get(u) {
  return new Promise(res => {
    http.get({ host: '127.0.0.1', port: 8961, path: encodeURI(u) }, r => {
      let d = '';
      r.on('data', c => { if (d.length < 300) d += c; });
      r.on('end', () => res({ code: r.statusCode, head: d.slice(0, 200) }));
    }).on('error', e => res({ code: 0, err: e.message }));
  });
}
(async () => {
  const r1 = await get('/轻量版.html');
  console.log('轻量版.html:', r1.code, JSON.stringify(r1.head.slice(0, 120)));
  const r2 = await get('/');
  console.log('首页:', r2.code, JSON.stringify(r2.head.slice(0, 80)));
})();
