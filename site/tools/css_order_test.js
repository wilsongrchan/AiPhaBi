#!/usr/bin/env node
/* site.css 的「排序陷阱」檢查。
 *
 * 為什麼要有這一支：@media 不會提高權重。`@media (max-width: 40rem) { X { p: a } }`
 * 寫在無條件的 `X { p: b }` **前面**的話，同權重、後面贏 —— 那條 media query
 * 靜靜地失效，沒有任何錯誤訊息。
 *
 * 實際踩過（2026-09-02）：字根表的表頭。第 606 行在 @media 裡寫
 * `.zg-tbl thead th { position: static }`，第 856 行無條件寫
 * `.zg-tbl thead th { position: sticky }` —— 手機上表頭一直是 sticky，而
 * .tablewrap 在窄螢幕會變成捲動容器，於是表頭飄到表格中間蓋住內容。
 * 註解早就寫明會這樣，只是修正被排序吃掉了。
 *
 * 這支只認**完全相同的選擇器字串**（同權重最明確的一種），誤報少。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'assets', 'site.css');
const css = fs.readFileSync(file, 'utf8');

// 註解有沒有收好。踩過（2026-09-02）：用內容比對插入一段新註解，插入點落在一個
// 既有註解的**中間**，於是留下一個沒有開頭的結束記號 —— CSS 剖析器從那裡開始把
// 後面一整個 @media 區塊當成垃圾丟掉，畫面上整組手機版樣式靜靜消失。症狀跟
// 「規則沒生效」一模一樣，看程式碼看不出來（那一次是 891 條規則掉到 868 條）。
// ⚠️ 這一段用 // 而不是區塊註解：內容本身要提到結束記號，寫在區塊註解裡會把
// 自己關掉 —— 我寫這支檢查的時候就是這樣中招的。
{
  const OPEN = '/' + '*', CLOSE = '*' + '/';
  let d = 0, ln = 1, bad = null;
  for (let i = 0; i < css.length && bad === null; i++) {
    if (css[i] === '\n') ln++;
    else if (css.startsWith(OPEN, i)) { d++; i++; }
    else if (css.startsWith(CLOSE, i)) { d--; i++; if (d < 0) bad = ln; }
  }
  if (bad !== null) {
    console.error('✗ 第 ' + bad + ' 行有一個沒有開頭的註解結束記號 —— 註解被插壞了，'
      + '後面的規則會被整段當成垃圾丟掉。');
    process.exit(1);
  }
  if (d !== 0) {
    console.error('✗ 有 ' + d + ' 個註解沒有收尾。');
    process.exit(1);
  }
}

/* 很小的一台掃描器：只要知道「這條宣告在第幾行、在不在 @media 裡、
   選擇器是什麼、設了哪些屬性」。不處理巢狀規則以外的花樣。 */
const rules = [];
let depth = 0, media = [], buf = '', line = 1, i = 0;
while (i < css.length) {
  const ch = css[i];
  if (ch === '\n') line++;
  if (ch === '/' && css[i + 1] === '*') {          // 跳過註解
    const end = css.indexOf('*/', i + 2);
    const skipped = css.slice(i, end < 0 ? css.length : end + 2);
    line += (skipped.match(/\n/g) || []).length;
    i = end < 0 ? css.length : end + 2;
    buf = '';
    continue;
  }
  if (ch === '{') {
    const sel = buf.trim();
    buf = '';
    if (sel.startsWith('@')) { media.push(sel); depth++; }
    else {
      // 這是一條真的規則，把它的內容整段吃掉
      let body = '', d = 1, j = i + 1;
      for (; j < css.length && d > 0; j++) {
        if (css[j] === '{') d++;
        else if (css[j] === '}') { d--; if (!d) break; }
        body += css[j];
      }
      const startLine = line;
      line += (css.slice(i, j).match(/\n/g) || []).length;
      const props = [];
      body.replace(/(^|;)\s*([-a-zA-Z]+)\s*:/g, (_, __, p) => { props.push(p); return _; });
      sel.split(',').forEach(s => {
        s = s.trim().replace(/\s+/g, ' ');
        if (s) rules.push({ sel: s, props, line: startLine, media: media.slice() });
      });
      i = j + 1;
      continue;
    }
  } else if (ch === '}') {
    if (media.length && depth > 0) { media.pop(); depth--; }
    buf = '';
  } else buf += ch;
  i++;
}

/* 很粗的權重計算：夠分辨「ID 比 class 大」就好，不追求完全符合規格。 */
function spec(sel) {
  return [ (sel.match(/#[\w-]+/g) || []).length,
           (sel.match(/\.[\w-]+|\[[^\]]*\]|:[a-z-]+\(?/g) || []).length ];
}
function higher(a, b) {           // a 的權重是不是嚴格大於 b
  const x = spec(a), y = spec(b);
  return x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);
}

const bad = [];
for (let a = 0; a < rules.length; a++) {
  const ra = rules[a];
  if (!ra.media.some(m => /max-width|min-width/.test(m))) continue;
  for (let b = 0; b < rules.length; b++) {
    const rb = rules[b];
    if (rb.media.length) continue;                 // 對手也有條件就不算
    const clash = ra.props.filter(p => rb.props.includes(p));
    if (!clash.length) continue;

    /* 兩種輸法：
       1. 選擇器一模一樣，而對手排在**後面** —— 同權重，後面贏。
       2. 對手的選擇器**以這一條結尾**（`#cv-groups .jm-cols` 之於 `.jm-cols`）
          而且權重更高 —— 不管前後都贏。@media 不會提高權重，這一種最容易被
          「我加了 media query 啊」騙過去。 */
    const same = rb.sel === ra.sel && b > a;
    /* ⚠️ 只認**多一個 ID** 的那種。多一個 class（`.cm-wall.is-lg .tianzi` 之於
       `.tianzi`）通常是「另一個地方的另一個東西」，兩條規則實際上根本match
       不到同一顆元素，全報出來會淹掉真的問題（實測 6 條裡 3 條是這種）。 */
    const beats = rb.sel !== ra.sel && rb.sel.endsWith(' ' + ra.sel) &&
                  spec(rb.sel)[0] > spec(ra.sel)[0];
    if (!same && !beats) continue;

    if (beats) {
      // 同一條規則的逗號清單裡已經自己寫了高權重那一版 → 作者處理過了
      const siblings = rules.filter(r => r.line === ra.line && r.media.join() === ra.media.join());
      if (siblings.some(r => r.sel === rb.sel)) continue;
      // 別的 @media 裡已經用同樣高的權重補了一條 → 也算處理過了
      if (rules.some(r => r.sel === rb.sel && r.media.some(m => /max-width|min-width/.test(m))
                          && clash.some(p => r.props.includes(p)))) continue;
    }

    bad.push(`  ${ra.sel}\n    ${ra.media.join(' ')} 第 ${ra.line} 行設了 ${clash.join('、')}\n` +
      (same
        ? `    但第 ${rb.line} 行無條件又設了一次 —— 同權重、排在後面，media query 沒有作用`
        : `    但第 ${rb.line} 行的 \`${rb.sel}\` 權重更高（ID 壓過 class），`
          + `不管前後都贏 —— media query 沒有作用`));
  }
}

if (bad.length) {
  console.error('✗ CSS 排序陷阱：@media 裡的宣告被後面無條件的同名規則蓋掉\n');
  console.error(bad.join('\n\n'));
  console.error('\n修法：把 @media 那一條搬到後面（檔尾那一區就是為此存在），或提高它的權重。');
  process.exit(1);
}
console.log('✓ CSS 排序：沒有被後面無條件規則蓋掉的 @media 宣告（掃了 ' + rules.length + ' 條）');
