'use strict';
const fs = require('fs');
const lines = fs.readFileSync('E:/zcode/玩/虚构行星/工具/build-lite.js', 'utf8').split('\n');
// 模板从 43 行(index 42)开始, 测到 N 行截止(补一个收尾反引号)
for (const end of [149, 145, 120, 90, 60]) {
  const seg = lines.slice(42, end).join('\n') + '\n`;';
  fs.writeFileSync('E:/zcode/玩/虚构行星/工具/_seg.js', 'const html = `' + seg);
  const r = require('child_process').spawnSync('node', ['--check', 'E:/zcode/玩/虚构行星/工具/_seg.js']);
  console.log('截止到行', end + 1, r.status === 0 ? 'OK' : 'FAIL: ' + r.stderr.toString().split('\n')[1] ? r.stderr.toString().split('\n').slice(1, 3).join(' | ').slice(0, 120) : '');
}
