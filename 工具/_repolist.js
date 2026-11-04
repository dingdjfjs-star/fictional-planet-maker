'use strict';
const fs = require('fs');
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
(async () => {
  const cred = await getCredential();
  const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: { 'Authorization': 'token ' + cred.password, 'User-Agent': 'planet-check' }
  });
  const repos = await r.json();
  console.log('你的全部仓库(按最近更新排序):');
  for (const x of repos) {
    console.log(`  - ${x.name} | ${x.private ? '私有' : '公开'} | 最近推送 ${x.pushed_at.slice(0, 10)} | ${x.description ? String(x.description).slice(0, 40) : ''}`);
  }
})();
