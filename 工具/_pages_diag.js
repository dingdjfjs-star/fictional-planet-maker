'use strict';
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
function getCredential() {
  return new Promise((res, rej) => {
    const p = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', c => out += c);
    p.on('exit', () => {
      const rec = {};
      for (const line of out.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) rec[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      rec.username && rec.password ? res(rec) : rej(new Error('无凭据'));
    });
    p.on('error', rej);
    p.stdin.write('protocol=https\nhost=github.com\n\n');
    p.stdin.end();
  });
}
function api(token, method, path) {
  return fetch('https://api.github.com' + path, {
    method,
    headers: { 'Authorization': 'token ' + token, 'User-Agent': 'planet-deploy' }
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}
function head(url) {
  return new Promise(res => {
    https.get(url, r => { r.resume(); res({ code: r.statusCode }); }).on('error', e => res({ code: 0, err: e.message }));
  });
}
(async () => {
  const cred = await getCredential();
  const repo = 'dingdjfjs-star/fictional-planet-maker';
  const tree = await api(cred.password, 'GET', `/repos/${repo}/git/trees/gh-pages?recursive=1`);
  if (tree.status !== 200) { console.log('tree 查询失败', tree.status); process.exit(1); }
  const items = tree.body.tree || [];
  console.log('gh-pages 文件总数:', items.length);
  const want = ['vendor/cesium/Cesium.js', '.nojekyll', 'index.html', '数据/翡岚/planet.json'];
  for (const w of want) {
    const hit = items.find(x => x.path === w);
    console.log(`  ${w}: ${hit ? hit.type + ' ' + (hit.size || 0) + 'B' : '缺失!'}`);
  }
  const vendorCount = items.filter(x => x.path.startsWith('vendor/')).length;
  console.log('vendor/ 下文件数:', vendorCount);
  // 线上 HEAD 验证
  for (const u of ['https://dingdjfjs-star.github.io/fictional-planet-maker/vendor/cesium/Cesium.js',
                   'https://dingdjfjs-star.github.io/fictional-planet-maker/index.html',
                   'https://dingdjfjs-star.github.io/fictional-planet-maker/.nojekyll']) {
    const r = await head(u);
    console.log('HTTP', r.code, u.slice(50));
  }
})();
