'use strict';
// ============================================================
// 中文行星描述解析器: "一颗自转很慢的沙漠星球,一整块超级大陆,四季几乎不存在,名叫烬阳"
// → 完整的 generate.js 参数对象 + 人话版设定摘要
// 纯关键词规则, 零依赖, 服务端与展示两端共用
// ============================================================

const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnToInt(s) {
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s.length === 1) return CN_NUM[s] ?? NaN;
  if (s[0] === '十') return 10 + (CN_NUM[s[1]] || 0);
  if (s[s.length - 1] === '十') return (CN_NUM[s[0]] || 1) * 10;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    return (CN_NUM[a] || 1) * 10 + (CN_NUM[b] || 0);
  }
  return NaN;
}
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 默认文化(命名音节池), 描述里没提文明风格时用通用池
const DEFAULT_CULTURE = {
  civName: '新拓文化圈',
  civIntro: '这个世界的城邦刚刚学会仰望星空。河谷与海岸孕育了第一批政权,商队与季风决定着它们的兴衰。',
  syllA: ['诺', '岚', '汐', '岩', '绯', '墨', '渊', '辉', '澜', '珀', '霜', '炎'],
  syllB: ['塔', '原', '港', '城', '谷', '环', '穹', '洲', '屿', '墟', '台', '原'],
  govt: ['执政官议会', '星图祭司团', '拓荒联席会', '商港伯国', '元老院', '环议制'],
  goods: ['谷物', '金属', '织物', '香料', '晶石', '海产', '木材', '陶器'],
  taboos: ['远洋夜航', '弑信使', '掘祖山'],
  suffixPools: {
    river: ['河', '江', '水'], mount: ['山', '岭', '峰'], desert: ['漠', '沙海', '碛'],
    sea: ['洋', '海'], basin: ['原', '盆']
  }
};

function parseDescription(desc) {
  const text = (desc || '').replace(/\s+/g, '');
  const notes = [];
  const hit = (re) => re.test(text);

  // ---------- 名字 ----------
  let name = null;
  const nameM = text.match(/(?:名叫|叫|名为|名字是|称为)([\u4e00-\u9fa5]{1,4})(?![a-zA-Z])/);
  if (nameM) name = nameM[1];

  // ---------- 自转 / 昼夜 ----------
  let dayHours = null;
  const dh = text.match(/(?:昼夜|自转|一天|公转一周?)(?:约|大约)?(\d{1,3})(?:个)?小时/);
  if (dh) dayHours = clamp(parseInt(dh[1], 10), 2, 480);
  let rotFactor = dayHours ? clamp(24 / dayHours, 0.12, 2.2) : null;
  if (/潮汐锁定|一面永远/.test(text)) { dayHours = 240; rotFactor = 0.1; notes.push('潮汐锁定: 昼半球星烤夜半球星封'); }
  else if (/自转很?慢|昼夜漫长/.test(text) && !dayHours) { dayHours = 60; rotFactor = 0.4; }
  else if (/自转很?快|昼夜短暂/.test(text) && !dayHours) { dayHours = 12; rotFactor = 2.0; }

  // ---------- 倾角 / 季节 ----------
  let tiltDeg = null;
  const tl = text.match(/(?:倾角|黄赤交角|夹角)(约)?(\d{1,2})(?:度|°)/);
  if (tl) tiltDeg = clamp(parseInt(tl[2], 10), 0, 60);
  if (tiltDeg == null) {
    if (/极端季节|季节极端|季节是暴政/.test(text)) tiltDeg = 38;
    else if (/四季分明/.test(text)) tiltDeg = 27;
    else if (/无四季|四季如春|没有季节/.test(text)) tiltDeg = 4;
    else if (/季风(澎湃|汹涌|强劲)/.test(text)) tiltDeg = 26;
  }

  // ---------- 陆地占比 / 海陆 ----------
  let landTarget = null;
  const lc = text.match(/陆地(?:占|约|只占)?(一|二|两|三|四|五|六|七|八|九|十|\d{1,2})成/);
  if (lc) { const n = cnToInt(lc[1]); if (!isNaN(n)) landTarget = clamp(n / 10, 0.05, 0.8); }
  const oc = text.match(/海洋(?:占|约)?(一|二|两|三|四|五|六|七|八|九|十|\d{1,2})成/);
  if (landTarget == null && oc) { const n = cnToInt(oc[1]); if (!isNaN(n)) landTarget = clamp(1 - n / 10, 0.05, 0.8); }
  if (landTarget == null) {
    if (/海洋世界|水世界|汪洋|海洋星球/.test(text)) landTarget = 0.12;
    else if (/群岛世界|破碎群岛|万岛/.test(text)) landTarget = 0.15;
    else if (/陆地广|大陆广袤|陆地很多|干旱星球/.test(text)) landTarget = 0.46;
    else if (/超级大陆|盘古大陆|一整块大陆|整块大陆/.test(text)) landTarget = 0.44;
  }

  // ---------- 板块 ----------
  let plates = null, continentalPlates = null;
  const pc = text.match(/(\d{1,2})个板块/) || text.match(/板块多达(\d{1,2})/);
  if (pc) plates = clamp(parseInt(pc[1], 10), 4, 18);
  const pcc = text.match(/([一二两三四五六七八九十]{1,2}|\d{1,2})块?大陆板块/);
  if (pcc) { const n = cnToInt(pcc[1]); if (!isNaN(n)) continentalPlates = clamp(n, 1, 10); }
  let continentBias = 'none', forceRift = false, forceCollision = false;
  if (/超级大陆|盘古大陆|一整块大陆|整块大陆/.test(text)) { continentBias = 'equator'; forceRift = true; if (plates == null) plates = 6; if (continentalPlates == null) continentalPlates = 2; notes.push('超级大陆: 陆壳板块压向赤道并强制张裂'); }
  else if (/破碎|群岛世界|万岛/.test(text)) { if (plates == null) plates = 15; notes.push('破碎陆圈: 板块数上调'); }
  else if (/双陆|两块大陆|两大大陆/.test(text)) { if (plates == null) plates = 9; if (continentalPlates == null) continentalPlates = 3; forceCollision = true; notes.push('双陆格局: 少陆壳+碰撞造山'); }
  if (/碰撞|造山|山脉高耸|喜马拉雅/.test(text)) forceCollision = true;
  if (/裂谷|大裂缝|大陆被撕/.test(text)) forceRift = true;

  // ---------- 气候 ----------
  let tEq = 27, tPole = -30, greenhouse = 0, moistureDecayDeg = 11;
  let hot = /沙漠星球|沙漠世界|炎热|炙热|星烤/.test(text);
  let cold = /冰封|冰冻|冰川|极寒|雪球|冰世界/.test(text);
  if (hot) { tEq = 34; tPole = -14; greenhouse = 4; moistureDecayDeg = 8; if (landTarget == null) landTarget = 0.42; notes.push('炎热干旱: 干化尺度收紧'); }
  if (cold) { tEq = 20; tPole = -42; greenhouse = -6; if (landTarget == null) landTarget = 0.3; notes.push('冰封世界: 极地大冰盖'); }
  if (/温和|宜人|类地|像地球|宜居/.test(text)) { tEq = 25; tPole = -20; }
  if (/雨林|湿润|多雨|水汽充沛/.test(text)) { moistureDecayDeg = 14; notes.push('湿润: 水汽深入内陆'); }
  if (/干旱|少雨|水汽难抵/.test(text)) { moistureDecayDeg = 7; }

  // ---------- 热点火山 ----------
  let hotspots = 9;
  if (/火山(密布|活跃|极多|遍地)/.test(text)) hotspots = 18;
  else if (/火山罕见|地质平静/.test(text)) hotspots = 4;

  // ---------- 偏置 ----------
  if (/大陆(集中在|聚于)南?极|高纬大陆|极地大陆/.test(text)) continentBias = 'poles';

  // ---------- 卫星 / 恒星(设定文本) ----------
  let moon = '一颗普通卫星';
  let moons = 1;
  if (/双卫星|两个卫星/.test(text)) { moon = '双卫星,潮汐温和'; moons = 2; }
  else if (/三卫星|三个卫星/.test(text)) { moon = '三颗卫星轮流值夜'; moons = 3; }
  else if (/巨大.{0,4}卫星|大卫星/.test(text)) moon = '巨大卫星,强潮汐';
  else if (/环系|星环|有环/.test(text)) moon = '细长环系,极区常见极光';
  else if (/没有卫星|无卫星/.test(text)) { moon = '没有卫星,潮汐微弱'; moons = 0; }
  let binaryStar = false;
  if (/双恒星|双日|两个太阳/.test(text)) { binaryStar = true; moon = '双日凌空,影子常有两道;'; notes.push('双恒星系统: 天空常年两道日影'); }

  // ---------- 海洋颜色 ----------
  let palette = null;
  if (/紫色海洋|紫海/.test(text)) palette = { ocean: [106, 74, 158] };
  else if (/碧绿.{0,2}海洋|绿色海洋|绿海/.test(text)) palette = { ocean: [42, 122, 90] };
  else if (/黑色海洋|墨海/.test(text)) palette = { ocean: [12, 14, 26] };
  else if (/金色海洋|金海/.test(text)) palette = { ocean: [176, 138, 64] };

  // ---------- 文明时代 / 生命形式 ----------
  const culture = JSON.parse(JSON.stringify(DEFAULT_CULTURE));
  if (/原始|部落|石器|渔猎时代/.test(text)) {
    culture.govt = ['猎团长老会', '火塘议事', '氏族盟约', '图腾祭团'];
    culture.goods = ['燧石', '兽皮', '熏鱼', '岩画颜料'];
    culture.civName = '初火诸族';
  } else if (/星际|太空时代|航天/.test(text)) {
    culture.govt = ['轨道理事会', '星港执政团', '深空拓殖局', '天梯管委会'];
    culture.goods = ['聚变燃料', '轨道合金', '零毒作物', '星图数据'];
    culture.civName = '升空文明联合体';
  }
  const life = /硅基/.test(text) ? '硅基生命(以晶体代谢, 靠火山热泉繁衍)'
    : /深海起源|海底文明/.test(text) ? '深海起源生命(文明从热泉口走上陆地, 仍保留发光器官)'
    : /机械|造物/.test(text) ? '造物文明(先民留下的机械仍在维护运河)'
    : '碳基生命(与地球生物相似的生化基础)';

  // ---------- 汇总 ----------
  const finalName = (name || '未名星').slice(0, 6);
  const seed = hash32(finalName + '|' + text);
  const land = landTarget != null ? landTarget : 0.3;
  const platesN = plates != null ? clamp(plates, 4, 18) : 11;
  const contN = continentalPlates != null ? clamp(continentalPlates, 1, Math.max(1, platesN - 1)) : Math.max(2, Math.round(platesN * 0.45));
  const day = dayHours != null ? dayHours : 24;
  const rot = rotFactor != null ? rotFactor : 1.0;
  const tilt = tiltDeg != null ? tiltDeg : 23.4;

  const params = {
    id: finalName, name: finalName, en: '',
    seed,
    tagline: (desc || '').slice(0, 46),
    dayHours: day, rotFactor: +rot.toFixed(2), tiltDeg: tilt,
    greenhouse, tEq, tPole,
    moon, moons, binaryStar, palette,
    plates: platesN, continentalPlates: contN,
    landTarget: +land.toFixed(3),
    hotspots,
    continentBias,
    forceRift, forceCollision,
    moistureDecayDeg,
    rivers: {
      dischargeThreshold: Math.round((0.55 + land) * 0.9e8),
      maxCount: Math.round(60 + land * 380)
    },
    citiesTarget: clamp(Math.round(8 + land * 22), 8, 20),
    culture,
    life,
    expect: [],
    custom: true,
    description: (desc || '').slice(0, 300)
  };

  // ---------- 摘要 ----------
  const summary = [
    `名字: ${finalName}${name ? '' : '(描述中未指定, 可修改)'}`,
    `昼夜: ${params.dayHours} 小时(自转速度 ${params.rotFactor}×地球) → 哈德里环 ${Math.round(clamp(30 / params.rotFactor, 16, 46))}°`,
    `倾角: ${params.tiltDeg}°(季节${params.tiltDeg > 30 ? '极端' : params.tiltDeg < 8 ? '微弱' : '适中'})`,
    `陆地占比: ${(params.landTarget * 100).toFixed(0)}% · 板块 ${params.plates} 个(陆壳 ${params.continentalPlates})`,
    `温度: 赤道 ${tEq}℃ / 极地 ${tPole}℃ · 干化尺度 ${moistureDecayDeg}°`,
    `热点火山: ${hotspots} · 大陆偏置: ${continentBias === 'equator' ? '赤道超级大陆' : continentBias === 'poles' ? '高纬' : '无'}${params.forceRift ? ' · 强制裂谷' : ''}${params.forceCollision ? ' · 强制碰撞' : ''}`,
    `生命形式: ${life}`,
    notes.length ? `特别设定: ${notes.join(';')}` : '特别设定: 无'
  ].join('\n');

  return { params, summary, notes };
}

module.exports = { parseDescription, DEFAULT_CULTURE };
