/* 田字格與拆碼分段：〈線上試打〉與〈拆碼查詢〉共用的一小塊。
 *
 * 這一份的存在理由只有一個：**不要抄**。兩頁畫的是同一種田字格、讀的是同一種
 * practice.json/pinyin_glyphs.json 分段格式，抄一份過去就等於埋一個「改了一邊
 * 忘了另一邊」的坑（INSET 調過一次、GRID 的圓角調過一次，都是會再調的東西）。
 *
 * try.js 不改呼叫端 —— 它在自己的 IIFE 開頭把這幾支接成同名的區域變數，
 * 原本那 50 幾處呼叫一個字都不用動。
 *
 * ⚠️ 這支要排在 try.js／chaima.js **前面**載入。 */
(function (root) {
  'use strict';

  // 田字格：外框＋十字虛線，跟標註頁那個一樣（annotate.html 的 #glyph .grid）。
  // 字形的 y 軸要翻過來 —— graphics.txt 的座標系原點在左下，位移是 900 不是 1024。
  // 字形本身正好填滿 0–1024，直接畫會頂到格線。縮到 86% 置中，看起來才像
  // 練習簿上的田字格（標註頁不縮是因為那裡要看字跟框的關係，這裡不用）。
  var INSET = 0.86;
  var SVG_TF = 'translate(' + (1024 * (1 - INSET) / 2).toFixed(1) + ',' +
               (1024 * (1 - INSET) / 2).toFixed(1) + ') scale(' + INSET + ') ' +
               'scale(1,-1) translate(0,-900)';
  var GRID =
    '<rect class="tz-grid" x="2" y="2" width="1020" height="1020" rx="20"/>' +
    '<line class="tz-grid" x1="512" y1="2" x2="512" y2="1022"/>' +
    '<line class="tz-grid" x1="2" y1="512" x2="1022" y2="512"/>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function segsOfEntry(e) {
    if (!e || !e.s || !e.s.length) return null;
    var list = [];
    for (var i = 0; i < e.c.length; i++) if (e.s[e.c[i]]) list.push(e.s[e.c[i]]);
    return list.length ? list : null;
  }
  function segsFrom(table, ch) { return segsOfEntry(table && table[ch]); }

  function paintGlyph(target, ch, strokes, colour) {
    if (strokes) {
      var paths = '';
      for (var i = 0; i < strokes.length; i++) {
        var gi = colour && colour[i] != null ? colour[i] : -1;
        /* -1（或沒給）＝這一筆不屬於任何取到的字根，畫成正文的墨色。
           -2 ＝屬於某條字根、但這次刻意不強調它（〈拆碼查詢〉的「顯示簡碼」把
           簡碼沒用到的那幾條字根淡掉），畫成 --zg-off 的淺灰。try.js 從來不傳
           -2，所以這一條對它沒有任何影響。 */
        var cls = gi >= 0 ? 'tz-z' + (gi % 6) : (gi === -2 ? 'tz-off' : 'tz-ink');
        paths += '<path class="' + cls + '" d="' + strokes[i] + '"/>';
      }
      target.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + ch + '">' +
        GRID + '<g transform="' + SVG_TF + '">' + paths + '</g></svg>';
    } else {
      // 標點、或者沒有字形資料的字：照樣放進格子裡，只是用系統字型
      target.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + (ch || '') + '">' +
        GRID + '</svg>' +
        '<span class="tz-fallback">' + (ch || '') + '</span>';
    }
  }

  root.ZG = { el: el, segsOfEntry: segsOfEntry, segsFrom: segsFrom, paintGlyph: paintGlyph };
})(window);
