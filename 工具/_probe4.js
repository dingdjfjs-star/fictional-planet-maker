'use strict';
const fs = require('fs');
const m = fs.readFileSync('E:/zcode/玩/虚构行星/预览/main.js', 'utf8');
const h = fs.readFileSync('E:/zcode/玩/虚构行星/预览/index.html', 'utf8');
console.log('main.js:', m.includes('数据/') ? '含数据相对路径' : '缺!',
  m.includes('api/') ? '含api相对路径' : '缺!',
  m.includes("'use strict'") ? '含use strict' : '缺!',
  (m.match(/<script/g) || []).length === 0 ? '无残留script标签' : '有残留!');
console.log('index.html:', h.includes('__cesiumBase') ? '含竞速加载器' : '缺!',
  h.includes('main.js') ? '含main.js引用' : '缺!',
  (h.match(/<script/g) || []).length, '个script块');
console.log('main.js 尾部:', JSON.stringify(m.slice(-120)));
// 本地服务器快速验证 main.js 可达 + /数据/ 路由
const http = require('http');
function get(u) {
  return new Promise(res => {
    http.get({ host: '127.0.0.1', port: 8961, path: encodeURI(u) }, r => {
      let d = ''; r.on('data', c => { if (d.length < 80) d += c; });
      r.on('end', () => res(r.statusCode + ' ' + d.slice(0, 50)));
    }).on('error', e => res('ERR ' + e.message));
  });
}
(async () => {
  console.log('main.js:', await get('/预览/main.js'));
  console.log('数据路由:', await get('/数据/翡岚/planet.json'));
})();
