'use strict';
// ============================================================
// 命名器: 用行星文化的音节池生成不重复的地名/城名
// ============================================================
const { mulberry32 } = require('./lib');

function makeNamer(culture, seed) {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const used = new Set();
  const A = culture.syllA, B = culture.syllB;

  function base() {
    for (let t = 0; t < 200; t++) {
      const r = rand();
      let name;
      if (r < 0.62) name = A[(rand() * A.length) | 0] + B[(rand() * B.length) | 0];
      else if (r < 0.82) name = A[(rand() * A.length) | 0] + A[(rand() * A.length) | 0] + B[(rand() * B.length) | 0];
      else name = B[(rand() * B.length) | 0] + A[(rand() * A.length) | 0];
      if (!used.has(name)) { used.add(name); return name; }
    }
    return '无名之地' + ((rand() * 90 + 10) | 0);
  }

  function named(kind) {
    const suffix = (culture.suffixPools[kind] || ['之地'])[(rand() * culture.suffixPools[kind].length) | 0];
    return base() + suffix;
  }

  function city() {
    const r = rand();
    if (r < 0.4) return base();
    if (r < 0.7) return base() + (rand() < 0.5 ? '城' : '港');
    return base();
  }

  return {
    base, named, city,
    govt: () => culture.govt[(rand() * culture.govt.length) | 0],
    goods: () => culture.goods[(rand() * culture.goods.length) | 0],
    pick: (arr) => arr[(rand() * arr.length) | 0],
    range: (a, b) => Math.round(a + (b - a) * rand())
  };
}

module.exports = { makeNamer };
