/* 深色色票的兩份宣告必須一模一樣。
 *
 * site.css 裡每一組深色變數都寫兩次：一次在 @media (prefers-color-scheme: dark)
 * 底下（跟著系統，沒有 JS 也要生效），一次在 :root[data-theme="dark"] 底下
 * （使用者自己按了「深」）。CSS 沒辦法讓媒體查詢與屬性選擇器共用同一組宣告，
 * 所以只能重複 —— 重複就會走偏，走偏的症狀是「跟著系統的深色」跟「手動選的深色」
 * 長得不一樣，而且只有同時看過兩種的人才會發現。這支就是那道防線。
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'site.css'), 'utf8');

function decls(body) {
  const out = new Map();
  body.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (_, k, v) => { out.set(k, v.trim()); return ''; });
  return out;
}

const autos = [...css.matchAll(
  /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}\n\}/g)];
const manuals = [...css.matchAll(/\n:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/g)];

let bad = 0;
if (!autos.length) { console.log('✗ 找不到任何 @media 深色區塊'); process.exit(1); }
if (autos.length !== manuals.length) {
  console.log(`✗ 區塊數對不上：@media ${autos.length} 個、[data-theme="dark"] ${manuals.length} 個`);
  process.exit(1);
}

autos.forEach((a, i) => {
  const A = decls(a[1]), M = decls(manuals[i][1]);
  for (const [k, v] of A) {
    if (!M.has(k)) { console.log(`✗ 第 ${i + 1} 組：手動深色少了 ${k}`); bad++; }
    else if (M.get(k) !== v) {
      console.log(`✗ 第 ${i + 1} 組：${k} 兩邊不一樣（跟系統 ${v} ／ 手動 ${M.get(k)}）`);
      bad++;
    }
  }
  for (const k of M.keys()) {
    if (!A.has(k)) { console.log(`✗ 第 ${i + 1} 組：跟系統那份少了 ${k}`); bad++; }
  }
});

if (bad) { console.log(`\n共 ${bad} 處不一致`); process.exit(1); }
const n = autos.reduce((s, a) => s + decls(a[1]).size, 0);
console.log(`✓ 深色色票：${autos.length} 組、${n} 個變數，跟系統與手動兩份完全一致`);
