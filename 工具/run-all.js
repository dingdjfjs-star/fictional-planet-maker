'use strict';
// 生成+自检 一键运行器
const { execFileSync } = require('child_process');
const node = process.execPath;
const base = __dirname;
function run(script) {
  try {
    execFileSync(node, [base + '\\' + script], { stdio: 'inherit' });
  } catch (e) {
    const out = ((e.stdout || '') + '').split('\n');
    // 自检有 FAIL 时打印摘要(输出已含在 stdio inherit, 这里只兜底)
    if (!out.length) console.error('运行失败:', script);
  }
}
run('generate.js');
run('validate.js');
