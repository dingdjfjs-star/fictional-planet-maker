'use strict';
// 把 index.html 的主脚本抽成 main.js, 并替换为"双源竞速加载器"
const fs = require('fs');
const p = 'E:/zcode/玩/虚构行星/预览/index.html';
let s = fs.readFileSync(p, 'utf8');

const startTag = `<script>\n'use strict';`;
const a = s.indexOf(startTag);
if (a < 0) { console.log('主脚本标记未找到'); process.exit(1); }
const bodyStart = a + startTag.length;
const b = s.indexOf('</script>', bodyStart);
const js = s.slice(bodyStart, b).trim() + '\n';
fs.writeFileSync('E:/zcode/玩/虚构行星/预览/main.js', js);
console.log('main.js 提取完成,', (js.length / 1024).toFixed(1) + 'KB');

const loader = `<script>
  // 大文件双源竞速: 本地 vendor 先试, 6 秒未就绪自动切 jsdelivr CDN(国内可达性兜底)
  window.CESIUM_BASE_URL = './vendor/cesium/';
  window.__cesiumBase = new Promise(function (resolve) {
    var done = false;
    function use(url) { if (done) return; done = true; window.CESIUM_BASE_URL = url; resolve(url); }
    var s = document.createElement('script');
    s.src = './vendor/cesium/Cesium.js';
    s.onload = function () { use('./vendor/cesium/'); };
    s.onerror = function () { use('https://cdn.jsdelivr.net/npm/cesium@1.144.0/Build/Cesium/'); };
    document.head.appendChild(s);
    setTimeout(function () {
      if (!done && typeof Cesium === 'undefined') {
        var cdn = 'https://cdn.jsdelivr.net/npm/cesium@1.144.0/Build/Cesium/';
        var c = document.createElement('script');
        c.src = cdn + 'Cesium.js';
        c.onload = function () { use(cdn); };
        c.onerror = function () { use('./vendor/cesium/'); };
        document.head.appendChild(c);
      }
    }, 6000);
  });
  window.__cesiumBase.then(function (base) {
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = base + 'Widgets/widgets.css';
    document.head.appendChild(link);
    var main = document.createElement('script');
    main.src = 'main.js';
    document.head.appendChild(main);
  });
</script>`;

// 替换主脚本块
s = s.slice(0, a) + loader + s.slice(b + '</script>'.length);
// 旧的头两行(BASE_URL 常量 + vendor script + CDN 兜底)全部移除, 由加载器接管
s = s.replace(/<script>window\.CESIUM_BASE_URL[^<]*<\/script>\s*<script src="\.\/vendor\/cesium\/Cesium\.js"><\/script>\s*<script>\s*\/\/ CDN 兜底[^<]*<\/script>\s*/s, '');
s = s.replace(/<script>window\.CESIUM_BASE_URL = '\.\/vendor\/cesium\/';<\/script>\s*/s, '');
s = s.replace(/<script src="\.\/vendor\/cesium\/Cesium\.js"><\/script>\s*/s, '');
s = s.replace(/<script>\s*\/\/ CDN 兜底[\s\S]*?<\/script>\s*/s, '');
fs.writeFileSync(p, s);
console.log('index.html 已改造为竞速加载器');
