'use strict';
// 工坊 API 端到端测试: 解析 → 生成 → 轮询 → 校验产物
const http = require('http');
const fs = require('fs');

function post(path, body) {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: 8961, path, method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('bad json: ' + d.slice(0, 100))); } });
    });
    req.on('error', rej);
    req.end(JSON.stringify(body));
  });
}
function get(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 8961, path }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('bad json: ' + d.slice(0, 100))); } }); }).on('error', rej);
  });
}

(async () => {
  const desc = '一颗自转很慢的沙漠星球,一整块超级大陆被大裂谷劈开,四季几乎不存在,昼夜60小时,火山密布,名叫赤漠';
  const parsed = await post('/api/parse', { desc });
  console.log('--- 解析摘要 ---');
  console.log(parsed.summary);
  console.log('--- 生成 ---');
  const gen = await post('/api/generate', { params: parsed.params });
  console.log('generate:', JSON.stringify(gen));
  if (gen.error) process.exit(1);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 700));
    const j = await get('/api/job');
    if (!j.running) {
      console.log('job:', JSON.stringify(j));
      if (j.error) process.exit(1);
      break;
    }
  }
  const customs = await get('/api/customs');
  console.log('customs:', JSON.stringify(customs));
  const dir = 'E:/zcode/玩/虚构行星/数据/赤漠';
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  console.log('产物文件数:', files.length, files.includes('planet.md') && files.includes('07_气候分区.geojson') ? '(含设定书与气候GeoJSON ✓)' : '(缺文件!)');
  const pj = JSON.parse(fs.readFileSync(dir + '/planet.json', 'utf8'));
  console.log('陆地占比:', (pj.stats.landPct * 100).toFixed(1) + '%', '昼夜:', pj.params.dayHours + 'h', 'custom:', pj.custom);
  process.exit(0);
})().catch(e => { console.error('E2E FAIL:', e.message); process.exit(1); });
