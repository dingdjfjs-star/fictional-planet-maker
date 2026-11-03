'use strict';
// 重生成 + 验证 一体化(绕开 cmd 管道问题)
const { execFileSync } = require('child_process');
const fs = require('fs');
const node = process.execPath;

execFileSync(node, [__dirname + '\\run-all.js'], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1e8 });
console.log('--- run-all 完成 ---');

let total = 0;
for (const n of ['翡岚', '烬壤', '霜屿']) {
  const dir = 'E:/zcode/玩/虚构行星/数据/' + n;
  let bad = 0, verts = 0;
  const badFiles = {};
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.geojson'))) {
    const gj = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'));
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        verts++;
        if (Math.abs(c[1]) > 89.99 || Math.abs(c[0]) > 179.9999) { bad++; badFiles[f] = (badFiles[f] || 0) + 1; }
      } else c.forEach(walk);
    };
    for (const ft of gj.features) if (ft.geometry) walk(ft.geometry.coordinates);
  }
  total += bad;
  console.log(`${n} verts=${verts} bad=${bad} ${Object.keys(badFiles).join(',') || '-'}`);
}
console.log(total === 0 ? '** 病灶顶点清零 **' : `!! 仍有 ${total} 个病灶顶点 !!`);
