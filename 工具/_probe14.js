'use strict';
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/工具/deploy.js';
const s = fs.readFileSync(p, 'utf8');
const lines = s.split('\n');
lines.forEach((l, i) => { if (l.includes('push')) console.log(i + 1, JSON.stringify(l.trim().slice(0, 110))); });
console.log('含 pushRetry:', s.includes('function pushRetry'));
