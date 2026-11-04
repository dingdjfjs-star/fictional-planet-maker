'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/build-lite.js';
let s = fs.readFileSync(p, 'utf8');
const oldBlock = `      const Y = nz, Z = -ny;
      const y2 = Y * sinLat0 + Z * cosLat0;
      const lat = Math.asin(Math.max(-1, Math.min(1, y2)));
      let lonD = Math.atan2(nx, Y * cosLat0 - Z * sinLat0) * 180 / Math.PI + 180;
      if (lonD > 360) lonD -= 360;`;
const newBlock = `      const y2 = ny * cosLat0 + nz * sinLat0;
      const lat = Math.asin(Math.max(-1, Math.min(1, y2)));
      let lonD = globe.lon0 + Math.atan2(nx, nz * cosLat0 - ny * sinLat0) * 180 / Math.PI;
      lonD = ((lonD % 360) + 360) % 360;`;
if (!s.includes(oldBlock)) { console.log('未找到公式块'); process.exit(1); }
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(p, s);
console.log('公式已修正(南北/经度符号)');
