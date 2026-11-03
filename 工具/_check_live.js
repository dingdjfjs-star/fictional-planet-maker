'use strict';
const https = require('https');
function get(u) {
  return new Promise(res => {
    https.get(u, r => {
      let d = '';
      r.on('data', c => { if (d.length < 200) d += c; });
      r.on('end', () => res({ code: r.statusCode, head: d.slice(0, 60) }));
    }).on('error', e => res({ code: 0, err: e.message }));
  });
}
(async () => {
  const base = 'https://dingdjfjs-star.github.io/fictional-planet-maker/';
  const targets = [
    ['首页', base],
    ['Cesium库', base + 'vendor/cesium/Cesium.js'],
    ['行星数据', base + encodeURI('数据/翡岚/planet.json')],
    ['地形PNG', base + encodeURI('数据/翡岚/terrain.png')]
  ];
  for (const [n, u] of targets) {
    const r = await get(u);
    console.log(n + ': HTTP ' + r.code + (r.err ? ' (' + r.err + ')' : ''));
  }
})();
