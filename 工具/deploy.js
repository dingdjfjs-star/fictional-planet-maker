'use strict';
// ============================================================
// 一键部署到 GitHub: 建仓 → 推 main → 构建 gh-pages → 开启 Pages
// 用法: node deploy.js   (需要本机已存 GitHub 凭据, 见 Git Credential Manager)
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO_NAME = 'fictional-planet-maker';
const DESC = '虚构行星工坊 —— 中文描述造星 + 板块/大气/洋流驱动的行星生成器 + Cesium 三维预览';

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts));
}
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
      rec.username && rec.password ? res(rec) : rej(new Error('无 GitHub 凭据'));
    });
    p.on('error', rej);
    p.stdin.write('protocol=https\nhost=github.com\n\n');
    p.stdin.end();
  });
}
function api(token, method, path, body) {
  return fetch('https://api.github.com' + path, {
    method,
    headers: { 'Authorization': 'token ' + token, 'User-Agent': 'planet-deploy', 'Accept': 'application/vnd.github+json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}
function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
  console.log('  复制', path.basename(src), '→', dest);
}

(async () => {
  console.log('① 读取 GitHub 凭据…');
  const cred = await getCredential();
  const login = cred.username;
  console.log('   账号:', login);

  console.log('② 创建/复用仓库', login + '/' + REPO_NAME, '…');
  let rr = await api(cred.password, 'GET', `/repos/${login}/${REPO_NAME}`);
  if (rr.status === 404) {
    rr = await api(cred.password, 'POST', '/user/repos', {
      name: REPO_NAME, private: false, description: DESC, has_wiki: false, auto_init: false
    });
    if (rr.status >= 300) { console.log('建仓失败:', JSON.stringify(rr.body)); process.exit(1); }
    console.log('   仓库已创建');
  } else console.log('   仓库已存在, 复用');

  console.log('③ git 初始化与提交(main 分支)…');
  let hasGit = fs.existsSync(path.join(ROOT, '.git'));
  if (!hasGit) git(['init', '-b', 'main'], { cwd: ROOT });
  git(['config', 'user.name', login], { cwd: ROOT });
  git(['config', 'user.email', login + '@users.noreply.github.com'], { cwd: ROOT });
  fs.writeFileSync(path.join(ROOT, '.gitignore'), '*.log\nThumbs.db\n');
  git(['add', '-A'], { cwd: ROOT });
  const committed = git(['commit', '-m', '虚构行星工坊: 三颗内置行星(翡岚/烬壤/霜屿) + 中文描述造星工坊 + Cesium 三维预览', '--allow-empty'], { cwd: ROOT }).slice(0, 60);
  console.log('  ', committed.split('\n')[0]);
  const remoteArgs = ['remote'];
  try { git(['remote', 'add', 'origin', `https://github.com/${login}/${REPO_NAME}.git`], { cwd: ROOT }); }
  catch (e) { git(['remote', 'set-url', 'origin', `https://github.com/${login}/${REPO_NAME}.git`], { cwd: ROOT }); }
  console.log('④ 推送 main(可能需要 1-3 分钟)…');
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  console.log('   main 已推送');

  console.log('⑤ 构建 gh-pages(静态站: 页面+vendor+数据)…');
  const stage = path.join(os.tmpdir(), 'planet-pages-' + Date.now());
  fs.mkdirSync(stage, { recursive: true });
  fs.copyFileSync(path.join(ROOT, '预览', 'index.html'), path.join(stage, 'index.html'));
  copyDir(path.join(ROOT, '预览', 'vendor'), path.join(stage, 'vendor'));
  copyDir(path.join(ROOT, '数据'), path.join(stage, '数据'));
  fs.writeFileSync(path.join(stage, '.nojekyll'), '');
  fs.writeFileSync(path.join(stage, 'README.md'), `# 虚构行星工坊 · 静态预览版\n\n源码: https://github.com/${login}/${REPO_NAME}\n在线造星需本地运行: node 预览/server.js\n`);
  git(['init', '-b', 'gh-pages'], { cwd: stage });
  git(['config', 'user.name', login], { cwd: stage });
  git(['config', 'user.email', login + '@users.noreply.github.com'], { cwd: stage });
  git(['add', '-A'], { cwd: stage });
  git(['commit', '-m', 'pages: 静态预览站', '--allow-empty'], { cwd: stage });
  execFileSync('git', ['push', '--force', `https://github.com/${login}/${REPO_NAME}.git`, 'gh-pages'], { cwd: stage, stdio: ['ignore', 'ignore', 'pipe'] });
  console.log('   gh-pages 已推送');
  fs.rmSync(stage, { recursive: true, force: true });

  console.log('⑥ 开启 GitHub Pages(source=gh-pages)…');
  let pr = await api(cred.password, 'POST', `/repos/${login}/${REPO_NAME}/pages`, { source: { branch: 'gh-pages', path: '/' } });
  if (pr.status === 409) console.log('   Pages 已开启过');
  else if (pr.status >= 300) console.log('   Pages 开启返回', pr.status, JSON.stringify(pr.body).slice(0, 120));
  else console.log('   Pages 已开启');

  const url = `https://${login}.github.io/${REPO_NAME}/`;
  console.log('\n🎉 部署完成!');
  console.log('   仓库: https://github.com/' + login + '/' + REPO_NAME);
  console.log('   在线: ' + url + ' (首次构建约 1 分钟, 若 404 请稍后刷新)');
})().catch(e => { console.error('部署失败:', e.message); process.exit(1); });
