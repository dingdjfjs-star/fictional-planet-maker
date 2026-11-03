'use strict';
const fs = require('fs');
for (const n of ['翡岚', '烬壤', '霜屿', '赤漠', '雾环']) {
  const p = 'E:/zcode/玩/虚构行星/数据/' + n + '/06_洋流.geojson';
  if (!fs.existsSync(p)) { console.log(n, '(无)'); continue; }
  const gj = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = {};
  for (const f of gj.features) t[f.properties.类型] = (t[f.properties.类型] || 0) + 1;
  console.log(n, JSON.stringify(t));
}
