'use strict';
// 从 GCM 读取已存的 GitHub 凭据, 验证 API 可用性(绝不打印令牌)
const { spawn } = require('child_process');

function getCredential() {
  return new Promise((res, rej) => {
    const p = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', c => out += c);
    p.on('exit', () => {
      const rec = {};
      for (const line of out.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) rec[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      if (rec.username && rec.password) res(rec);
      else rej(new Error('无可用凭据'));
    });
    p.on('error', rej);
    p.stdin.write('protocol=https\nhost=github.com\n\n');
    p.stdin.end();
  });
}

(async () => {
  const cred = await getCredential();
  console.log('GitHub 用户名:', cred.username);
  console.log('令牌类型:', cred.password.slice(0, 4) + '*** (已隐藏)');
  // 用令牌调 API 验证身份与建仓权限
  const r = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': 'token ' + cred.password, 'User-Agent': 'planet-deploy', 'Accept': 'application/vnd.github+json' }
  });
  const u = await r.json();
  if (!r.ok) { console.log('API 验证失败:', r.status, u.message || ''); process.exit(1); }
  console.log('API 身份:', u.login, '| 公开仓库:', u.public_repos, '| 计划:', u.plan && u.plan.name);
  // 检查目标仓库名是否已存在
  const repoName = 'fictional-planet-maker';
  const rr = await fetch('https://api.github.com/repos/' + u.login + '/' + repoName, { headers: { 'Authorization': 'token ' + cred.password, 'User-Agent': 'planet-deploy' } });
  console.log('目标仓库', u.login + '/' + repoName, rr.status === 200 ? '已存在(将复用)' : '不存在(将创建)');
})().catch(e => { console.log('FAIL:', e.message); process.exit(1); });
