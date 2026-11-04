'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/deploy.js';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('function pushRetry')) { console.log('pushRetry 已存在'); process.exit(0); }
const anchor = [
  "function git(args, opts) {",
  "  return execFileSync('git', args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts));",
  "}"
].join('\n');
if (!s.includes(anchor)) { console.log('git 函数锚点未找到'); process.exit(1); }
const helper = [
  '',
  'function sleepMs(ms) {',
  '  spawn(process.execPath, [\'-e\', \'setTimeout(() => 0, \' + ms + \')\']);',
  '}',
  'function pushRetry(args, cwd) {',
  '  for (let a = 1; a <= 4; a++) {',
  '    try {',
  '      execFileSync(\'git\', args, { cwd, stdio: [\'ignore\', \'ignore\', \'pipe\'] });',
  '      return;',
  '    } catch (e) {',
  '      console.log(\'   推送失败(第\' + a + \'次), 15 秒后重试…\');',
  '      if (a < 4) sleepMs(15000); else throw new Error(\'推送多次失败\');',
  '    }',
  '  }',
  '}'
].join('\n');
s = s.replace(anchor, anchor + '\n' + helper);
fs.writeFileSync(p, s);
console.log('pushRetry 助手已插入');
