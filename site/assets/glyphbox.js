/* 田字格與拆碼分段：〈線上試打〉〈拆碼查詢〉〈字根練習〉〈字根表〉共用的一小塊。
 *
 * 這一份的存在理由只有一個：**不要抄**。兩頁畫的是同一種田字格、讀的是同一種
 * practice.json/pinyin_glyphs.json 分段格式，抄一份過去就等於埋一個「改了一邊
 * 忘了另一邊」的坑（INSET 調過一次、GRID 的圓角調過一次，都是會再調的東西）。
 *
 * try.js 不改呼叫端 —— 它在自己的 IIFE 開頭把這幾支接成同名的區域變數，
 * 原本那 50 幾處呼叫一個字都不用動。
 *
 * ⚠️ 這支要排在 try.js／chaima.js／lianxi.js／zigen.js **前面**載入。
 *
 * 2026-09-01 又搬了一支進來：rootIconSvg（把某幾筆單獨畫成一個字根圖示），原本
 * 只有 zigen.js 有，〈字根練習〉揭曉那一格也要畫同一種圖示。它的尺寸規則是調過
 * 好幾輪的（見 rootIcon 自己的註解），正是不能抄第二份的那種東西。 */
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

  /* 整個字身框的 y 翻轉（不縮）—— 字例、辨析欄那種「畫整個字」的圖用這個，
     跟上面 SVG_TF 差在沒有田字格的 86% 內縮。makemeahanzi 的路徑是 y 軸朝上的
     1024 em 框，兩者都得先把它翻回螢幕慣用的方向。 */
  var FLIP = 'scale(1,-1) translate(0,-900)';

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

  /* 只畫選中的那幾筆，並裁切到它們的範圍 —— 三筆的字根在整個字身框裡會變成一個
     小點。做法跟標註工具的 rootIconSvg 一樣。
     ⚠️ 這一段的尺寸規則是調過好幾輪的，改之前先讀完：

     viewBox 的**大小固定成整個字身框（1024）**，只移動位置把字根置中。這樣
     〈字根表〉字根欄的黑色字根，跟字例欄裡同一個形狀的橙色部分是**同一個比例**——
     先前是裁切到字根自己的邊界再放大，於是每個字根各自放大不同倍率：兩筆的字根
     被撐得很大、六筆的偏小（然 明顯比 月 小就是這樣來的），而且跟字例欄裡的大小
     完全對不上。置中則解決「貓 的字根偏在上方」。

     字根欄要的是「一排大小一致、看得清楚的形狀」，不是「忠實反映它在字裡佔多大」——
     佔比忠實的話 豹 的字根只有 11px、月 有 20px，同一欄裡差快兩倍，看起來就是亂的。
     所以把每個字根放大到至少佔框的 85%：實測大小收斂成 21.1–22.9px（1.1 倍極差），
     而 月 本來就佔得多，只從 20.3 變 21.1px，跟字例欄裡的橙色 月 仍然一樣大。
     框的大小仍以字身框為上限，所以佔滿整個字的字根不會被切掉。

     回傳 SVG 字串；那幾筆都查不到（字形資料沒載到）時回傳 null，呼叫端各自退回
     文字版。 */
  function rootIcon(strokes, sel, cls) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    for (var k = 0; k < sel.length; k++) {
      var d = strokes && strokes[sel[k]];
      if (!d) continue;
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(d))) {
        var x = +m[1], y = 900 - (+m[2]);      // 還原 y 翻轉
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) return null;

    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var span = Math.max(x1 - x0, y1 - y0);
    var BOX = Math.min(1024, span / 0.85) || 1024;
    var paths = '';
    for (var j = 0; j < sel.length; j++) {
      if (strokes[sel[j]]) paths += '<path d="' + strokes[sel[j]] + '"/>';
    }
    return '<svg class="' + (cls || 'zg-svg') + '" viewBox="' + (cx - BOX / 2) + ' ' + (cy - BOX / 2) +
      ' ' + BOX + ' ' + BOX + '" aria-hidden="true">' +
      '<g transform="' + FLIP + '">' + paths + '</g></svg>';
  }

  /* 選中那幾筆在**畫出來之後**的位置（田字格那一套 SVG_TF 之下的座標），
     給〈字根練習〉把字母疊在字根正上方用 —— 疊的位置要跟筆畫真的對得上，
     不能靠目測。回傳 null 表示那幾筆查不到。 */
  function rootBox(strokes, sel) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    for (var k = 0; k < sel.length; k++) {
      var d = strokes && strokes[sel[k]];
      if (!d) continue;
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(d))) {
        var x = +m[1], y = 900 - (+m[2]);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) return null;
    // SVG_TF 展開就是：先 y 翻轉（上面那個 900 - y 已經做完），再縮 INSET、再置中位移
    var off = 1024 * (1 - INSET) / 2;
    return {
      x: off + INSET * x0, y: off + INSET * y0,
      w: INSET * (x1 - x0), h: INSET * (y1 - y0),
      cx: off + INSET * (x0 + x1) / 2, cy: off + INSET * (y0 + y1) / 2
    };
  }

  root.ZG = {
    el: el, segsOfEntry: segsOfEntry, segsFrom: segsFrom, paintGlyph: paintGlyph,
    GRID: GRID, TF: SVG_TF, FLIP: FLIP, rootIcon: rootIcon, rootBox: rootBox
  };
})(window);
