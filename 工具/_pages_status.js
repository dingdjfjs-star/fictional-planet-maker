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
(async () => {
  const cred = await getCredential();
  const repo = 'dingdjfjs-star/fictional-planet-maker';
  const branches = await api(cred.password, 'GET', `/repos/${repo}/branches`);
  console.log('分支:', (branches.body || []).map(b => b.name).join(', ') || JSON.stringify(branches.body).slice(0, 80));
  const pages = await api(cred.password, 'GET', `/repos/${repo}/pages`);
  console.log('Pages 配置:', pages.status, JSON.stringify(pages.body).slice(0, 300));
  const build = await api(cred.password, 'GET', `/repos/${repo}/pages/builds/latest`);
  console.log('最新构建:', build.status, JSON.stringify(build.body).slice(0, 300));
})();
