/* 〈取碼原則〉頁：把 assets/principles.json 的拆法資料畫成插圖。
 * 顏色和描邊規則跟 zigen.js 的 altMiniCard 同一套（見 site.css 的 .zg-altsvg／rb-*），
 * 這裡只是換一個更大的容器尺寸，用在正文裡當插圖，不是表格小圖示。
 * 資料本身（正確拆法對過 codes.json、錯誤拆法只收有把筆畫講清楚的那幾個）
 * 見 site/tools/build_site_data.py 的 PRINCIPLE_WRONG。 */
(function () {
  'use strict';

  var slots = document.querySelectorAll('.pr-example[data-char]');
  if (!slots.length) return;

  var RAINBOW = ['rb-0', 'rb-1', 'rb-2', 'rb-3', 'rb-4', 'rb-5'];
  var GLYPHS = null;
  var DATA = null;

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* ok: true=正確、false=示範用的錯拆法、null=還沒判定（逐步示範用，見 setupSteppers） */
  function card(ch, breakdown, ok, label) {
    var c = el('div', 'pr-card ' + (ok == null ? 'is-pending' : ok ? 'is-ok' : 'is-bad'));
    if (label) c.setAttribute('data-label', label);
    // 有些例子（川）正文會用「拆法A／B／C」指名討論，卡片上要標出來才對得起來
    if (label) {
      var lb = el('span', 'pr-label');
      lb.textContent = label;
      lb.setAttribute('data-keep', '');
      c.appendChild(lb);
    }
    var icon = el('span', 'pr-icon');
    var strokes = GLYPHS && GLYPHS[ch];
    if (strokes) {
      var paths = '';
      for (var i = 0; i < strokes.length; i++) {
        var gi = -1;
        for (var k = 0; k < breakdown.groups.length; k++) {
          if (breakdown.groups[k].indexOf(i) >= 0) { gi = k; break; }
        }
        var cls = gi >= 0 ? RAINBOW[gi % RAINBOW.length] : 'off';
        paths += '<path class="' + cls + '" d="' + strokes[i] + '"/>';
      }
      icon.innerHTML = '<svg class="zg-altsvg" viewBox="0 0 1024 1024" aria-hidden="true">' +
        '<g transform="scale(1,-1) translate(0,-900)">' + paths + '</g></svg>';
    } else {
      icon.textContent = ch;
      icon.setAttribute('data-keep', '');
    }
    c.appendChild(icon);
    // 打勾／打叉放在碼的右邊，不疊在圖示上——疊上去會蓋住角落的筆畫（Wilson）。
    var row = el('span', 'pr-coderow');
    var code = el('span', 'pr-code');
    code.setAttribute('data-keep', '');
    // 每個字母對應 groups 裡的哪一段，優先看 codeGroups（碼被砍過時，字母個數會
    // 少於 groups 的段數，例：藍 HCKAI 只有 5 個字母卻對到 6 段真正的取碼——見
    // build_principles() 的註解）；沒有 codeGroups 就退回「第幾個字母就是第幾段」
    // 這個一般情況。顏色跟圖示的分組上色一一對應——正確、錯誤拆法都上色，錯誤那邊
    // 靠 CSS（.pr-card.is-bad .pr-code）調暗＋加刪除線，區分「這是不取的示範」。
    for (var ci = 0; ci < breakdown.code.length; ci++) {
      var gi = breakdown.codeGroups ? breakdown.codeGroups[ci] : ci;
      var letter = el('span', gi != null && gi < breakdown.groups.length ? RAINBOW[gi % RAINBOW.length] : 'off');
      letter.textContent = breakdown.code[ci];
      code.appendChild(letter);
    }
    row.appendChild(code);
    var mark = el('span', 'pr-mark');
    mark.textContent = ok == null ? '' : ok ? '✓' : '✕';
    mark.setAttribute('aria-hidden', 'true');
    row.appendChild(mark);
    c.appendChild(row);
    c.title = ch + '　' + breakdown.code +
      (ok == null ? '（尚未判定）' : ok ? '（正確）' : '（不取，示範用）');
    c.setAttribute('data-keep', '');
    return c;
  }

  /* 說明文字裡的「V（第 1、2 筆）」這種文字描述，換成就地畫出來的字根小圖——
   * 用法跟 zigen.js 的 {字#筆序} 一樣，但那支程式的函式沒有對外開放，這裡另外
   * 寫一份（裁切／置中算法照抄 zigen.js 的 rootIconSvg，見那邊的註解）。
   * 標記寫法：<span class="pr-inline" data-char="美" data-st="1,2"></span> */
  var ROOT_PAD = 40;

  function rootIconSvg(strokes, sel) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    for (var k = 0; k < sel.length; k++) {
      var d = strokes[sel[k]];
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
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var span = Math.max(x1 - x0, y1 - y0);
    var BOX = Math.min(1024, span / 0.85) || 1024;
    var paths = '';
    for (var j = 0; j < sel.length; j++) {
      if (strokes[sel[j]]) paths += '<path d="' + strokes[sel[j]] + '"/>';
    }
    return '<svg class="zg-svg" viewBox="' + (cx - BOX / 2) + ' ' + (cy - BOX / 2) +
      ' ' + BOX + ' ' + BOX + '" aria-hidden="true">' +
      '<g transform="scale(1,-1) translate(0,-900)">' + paths + '</g></svg>';
  }

  function renderInline() {
    document.querySelectorAll('.pr-inline[data-char]').forEach(function (span) {
      if (span.dataset.done) return;
      var ch = span.getAttribute('data-char');
      var strokes = GLYPHS && GLYPHS[ch];
      var sel = (span.getAttribute('data-st') || '').split(',')
        .filter(Boolean).map(function (n) { return +n - 1; });
      if (!strokes || !sel.length) return;
      var svg = rootIconSvg(strokes, sel);
      if (!svg) return;
      span.innerHTML = svg;
      span.className = 'zg-inline';
      span.title = ch + '　第 ' + sel.map(function (i) { return i + 1; }).join('、') + ' 筆';
      span.setAttribute('data-keep', '');
      span.dataset.done = '1';
    });
  }

  function render() {
    slots.forEach(function (slot) {
      var ch = slot.getAttribute('data-char');
      var entry = DATA && DATA[ch];
      if (!entry) return;
      var cards = slot.querySelector('.pr-cards');
      if (!cards) {
        cards = el('div', 'pr-cards');
        slot.insertBefore(cards, slot.firstChild);
      }
      cards.textContent = '';

      // 預設「正確在前、示範在後」。但正文若要按特定順序討論（川 的 A→B→C），
      // 可用 data-order 指定要照哪個碼的順序排、data-labels 給每張卡片一個標籤。
      var all = [{ b: entry.correct, ok: true }]
        .concat((entry.wrongs || []).map(function (w) { return { b: w, ok: false }; }));
      var order = (slot.getAttribute('data-order') || '').split(',').filter(Boolean);
      if (order.length) {
        all.sort(function (x, y) {
          var a = order.indexOf(x.b.code), b2 = order.indexOf(y.b.code);
          return (a < 0 ? 99 : a) - (b2 < 0 ? 99 : b2);
        });
      }
      var labels = (slot.getAttribute('data-labels') || '').split(',').filter(Boolean);
      // 逐步示範的卡片一開始不掛勾叉——先掛等於先講答案（Wilson）。真正的 ok
      // 還是留在 title／CSS 之外的地方：由 setupSteppers 依步驟一張張填上去。
      var stepped = slot.hasAttribute('data-stepped');
      all.forEach(function (x, i) {
        var c = card(ch, x.b, stepped ? null : x.ok, labels[i] || '');
        c.dataset.verdict = x.ok ? 'ok' : 'bad';
        cards.appendChild(c);
      });
    });
    renderInline();
    setupSteppers();
  }

  /* 逐條原則的步進器。
   * 每個 <dt> 是一步；dt 上的 data-out="B" 表示「這一步淘汰拆法 B」，
   * data-in="C" 表示「這一步判定 C 為正解」。兩個都可以有多個，用逗號分隔。
   *
   * 狀態完全由「目前走到第幾步」重算（而不是累加），所以往回走、直接跳到某一步、
   * 重來，走的都是同一段程式，不會有殘留。步數記在 dl.dataset.at 上，卡片則是每次
   * 都重新查——render() 會跑兩次（筆畫資料到之前一次、之後一次，第二次會把卡片
   * 整批換掉），快取住卡片就會在第二次之後指到已經被丟掉的節點。
   */
  function setupSteppers() {
    document.querySelectorAll('.pr-walk[data-stepper]').forEach(function (dl) {
      var box = dl.closest('.pr-walkbox');
      var slot = box && box.querySelector('.pr-example[data-stepped]');
      if (!slot) return;
      var dts = [].slice.call(dl.children).filter(function (n) { return n.tagName === 'DT'; });
      if (!dts.length) return;

      function list(dt, attr) {
        return (dt.getAttribute(attr) || '').split(',').filter(Boolean);
      }

      // 有沒有任何一步宣告 data-show？有的話卡片就是「逐步登場」——在宣告它的那一步
      // 之前完全不出現（Wilson：三種拆法是筆順原則推出來的，在那之前不該先擺著）。
      // 沒有任何 data-show 的例子維持原樣，一開始就全部顯示。
      var staged = dts.some(function (dt) { return dt.hasAttribute('data-show'); });

      function mark(label, ok) {
        var c = slot.querySelector('.pr-card[data-label="' + label + '"]');
        if (!c) return;
        c.className = 'pr-card ' + (ok ? 'is-ok' : 'is-bad') +
          (c.classList.contains('is-unborn') ? ' is-unborn' : '');
        c.querySelector('.pr-mark').textContent = ok ? '✓' : '✕';
        c.title = c.title.replace(/（[^（）]*）$/, ok ? '（正確）' : '（不取，示範用）');
      }

      var bar = box.querySelector('.pr-steps');
      var prev, next, now;
      if (!bar) {
        bar = el('div', 'pr-steps');
        prev = el('button', 'pr-stepbtn');
        next = el('button', 'pr-stepbtn');
        now = el('span', 'pr-stepnow');
        prev.type = next.type = 'button';
        prev.textContent = '‹ 上一步';
        bar.appendChild(prev);
        bar.appendChild(now);
        bar.appendChild(next);
        (box.querySelector('.pr-sticky') || box).appendChild(bar);
        prev.addEventListener('click', function () { show(+dl.dataset.at - 1); });
        next.addEventListener('click', function () {
          var i = +dl.dataset.at;
          show(i >= dts.length - 1 ? 0 : i + 1);
        });
        // 直接點某一條原則就跳到那一步——想回頭看某一步不必按好幾次
        dts.forEach(function (dt, k) {
          dt.tabIndex = 0;
          dt.setAttribute('role', 'button');
          dt.addEventListener('click', function () { show(k); });
          dt.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(k); }
          });
        });
      } else {
        prev = bar.querySelector('.pr-stepbtn');
        next = bar.querySelectorAll('.pr-stepbtn')[1];
        now = bar.querySelector('.pr-stepnow');
      }

      function show(i) {
        var at = Math.max(0, Math.min(dts.length - 1, i || 0));
        dl.dataset.at = at;
        slot.querySelectorAll('.pr-card[data-label]').forEach(function (c) {
          c.className = 'pr-card is-pending' + (staged ? ' is-unborn' : '');
          c.querySelector('.pr-mark').textContent = '';
          c.title = c.title.replace(/（[^（）]*）$/, '（尚未判定）');
        });
        var shown = 0;
        for (var k = 0; k <= at; k++) {
          list(dts[k], 'data-show').forEach(function (L) {
            var c = slot.querySelector('.pr-card[data-label="' + L + '"]');
            if (c) { c.classList.remove('is-unborn'); shown++; }
          });
          list(dts[k], 'data-out').forEach(function (L) { mark(L, false); });
          list(dts[k], 'data-in').forEach(function (L) { mark(L, true); });
        }
        // 一張都還沒登場時，整個方塊收起來——留一個空框在那裡只是雜訊
        slot.classList.toggle('is-unborn', staged && !shown);
        dts.forEach(function (dt, k) {
          dt.classList.toggle('is-now', k === at);
          dt.classList.toggle('is-later', k > at);
          var dd = dt.nextElementSibling;
          if (dd && dd.tagName === 'DD') dd.classList.toggle('is-later', k > at);
        });
        now.textContent = '第 ' + (at + 1) + ' 步／共 ' + dts.length + ' 步';
        prev.disabled = at === 0;
        next.textContent = at === dts.length - 1 ? '↻ 重來' : '下一步 ›';
      }

      show(+dl.dataset.at || 0);   // 重畫之後回到原本那一步，不要跳回開頭
    });
  }

  fetch('assets/principles.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      render();               // 文字先畫出來，筆畫資料還沒到就先顯示純文字退路
      return fetch('assets/glyphs.json');
    })
    .then(function (r) { return r.json(); })
    .then(function (g) {
      GLYPHS = g.glyphs;
      render();                // 拿到筆畫資料後重畫一次，補上顏色分組
    })
    .catch(function () { /* 保持純文字退路 */ });
})();
