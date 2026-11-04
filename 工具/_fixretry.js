'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/deploy.js';
let s = fs.readFileSync(p, 'utf8');
// ① 加推送重试函数
if (!s.includes('function pushRetry')) {
  const anchor = 'function copyDir(src, dest) {';
  const helper = `function sleepMs(ms) { require('child_process').spawnSync(process.execPath, ['-e', 'setTimeout(()=>0,' + ms + ')']); }
function pushRetry(args, cwd) {
  for (let a = 1; a <= 4; a++) {
    try { execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] }); return; }
    catch (e) {
      console.log('   推送失败(第' + a + '次): ' + String(e.message).split('\\n')[0].slice(0, 80));
      if (a < 4) sleepMs(15000);
      else throw new Error('推送多次失败(网络到 github.com 不稳)');
    }
  }
}
function copyDir(src, dest) {`;
  s = s.replace(anchor, helper);
}
// ② main 推送走重试
s = s.replace("execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });",
  "pushRetry(['push', '-u', 'origin', 'main'], ROOT);");
// ③ gh-pages 推送走重试
s = s.replace("execFileSync('git', ['push', '--force', `https://github.com/${login}/${REPO_NAME}.git`, 'gh-pages'], { cwd: stage, stdio: ['ignore', 'ignore', 'pipe'] });",
  "pushRetry(['push', '--force', `https://github.com/${login}/${REPO_NAME}.git`, 'gh-pages'], stage);");
fs.writeFileSync(p, s);
console.log('deploy.js 已加推送重试(4 次尝试, 15 秒间隔)');
