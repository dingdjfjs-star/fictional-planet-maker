'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/预览/index.html';
let s = fs.readFileSync(p, 'utf8');
const anchor = 'id="openWs"';
if (!s.includes(anchor)) { console.log('未找到 openWs'); process.exit(1); }
// 在工坊按钮后面插入轻量版入口按钮
const i = s.indexOf('<button id="openWs"');
const lineEnd = s.indexOf('\n', i);
const btn = '\n  <button onclick="location.href=\'轻量版.html\'" style="margin-top:6px;width:100%;background:#123a2e;color:#a8e6c8;border:1px solid #2a6b4a;border-radius:8px;padding:6px 0;font:inherit;cursor:pointer">📱 轻量版 · 双击即开 · 低配流畅</button>';
if (s.includes('轻量版.html')) { console.log('已有轻量版入口'); process.exit(0); }
s = s.slice(0, lineEnd) + btn + s.slice(lineEnd);
fs.writeFileSync(p, s);
console.log('轻量版入口已加入 Cesium 页');
