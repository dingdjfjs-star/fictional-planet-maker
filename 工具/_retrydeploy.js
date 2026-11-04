'use strict';
// 后台重试部署: 网络到 github.com 恢复后自动完成推送(最多 8 轮 × 60 秒间隔)
const { execFileSync } = require('child_process');
const p = 'E:/zcode/玩/虚构行星/工具/deploy.js';
for (let i = 1; i <= 8; i++) {
  console.log(`[重试部署] 第 ${i}/8 轮 ${new Date().toLocaleTimeString('zh-CN')}`);
  try {
    execFileSync(process.execPath, [p], { stdio: 'ignore' });
    console.log('[重试部署] ✅ 成功! 线上版本已更新');
    process.exit(0);
  } catch (e) {
    console.log('[重试部署] 本轮失败' + (i < 8 ? ', 60 秒后重试…' : ', 已达上限'));
    if (i < 8) {
      const t = Date.now();
      while (Date.now() - t < 60000) { /* 忙等?不行 */ break; }
      require('child_process').spawnSync(process.execPath, ['-e', 'setTimeout(()=>0,60000)']);
    }
  }
}
console.log('[重试部署] ❌ 8 轮后仍未成功 —— 请稍后手动运行: node 工具\\deploy.js');
process.exit(1);
