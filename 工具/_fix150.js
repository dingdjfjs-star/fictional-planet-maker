'use strict';
// 精确重写 build-lite.js 第 150 行: 页面代码里的模板字符串全部按字面转义
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
const lines = fs.readFileSync(p, 'utf8').split('\n');
// 页面代码应生成的文本(作为外层模板的字面内容):
//     `陆地 ${(st.landPct * 100).toFixed(0)}% · 板块 ${...} 个(汇聚${...}/离散${...}/转换${...}) · 洋流 ${...} 段 · 城邦 ${...} 座 · 主要气候: ${cli || '—'}`;
// 外层模板转义规则: 反引号 → \` , ${ → \${
const wanted = '    \\`陆地 \\${(st.landPct * 100).toFixed(0)}% · 板块 \\${st.boundaryCount.conv + st.boundaryCount.div + st.boundaryCount.transform} 个(汇聚\\${st.boundaryCount.conv}/离散\\${st.boundaryCount.div}/转换\\${st.boundaryCount.transform}) · 洋流 \\${p.currents.length} 段 · 城邦 \\${p.cities.length} 座 · 主要气候: \\${cli || \'—\'}\\`;';
console.log('原行:', JSON.stringify(lines[149]).slice(0, 120));
console.log('新行:', JSON.stringify(wanted).slice(0, 120));
lines[149] = wanted;
fs.writeFileSync(p, lines.join('\n'));
console.log('已重写');
