'use strict';
const fs = require('fs');
const s = fs.readFileSync('E:/zcode/玩/虚构行星/轻量版.html', 'utf8');
const i = s.indexOf('const DATA');
console.log('DATA 位置:', i);
console.log(s.slice(i, i + 120));
const j = s.indexOf('</scr' + 'ipt>', i);
console.log('脚本闭合位置:', j, 'DATA 段长度:', j - i);
// 检查是否有 </script> 提前闭合
const firstClose = s.indexOf('</scr' + 'ipt>');
console.log('第一个</script>位置:', firstClose, '(应远在 DATA 段之后或为其闭合)');
