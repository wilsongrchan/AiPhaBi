/* 〈取碼原則〉頁：把 assets/principles.json 的拆法資料畫成插圖。
 * 顏色和描邊規則跟 zigen.js 的 altMiniCard 同一套（見 site.css 的 .zg-altsvg／rb-*），
 * 這裡只是換一個更大的容器尺寸，用在正文裡當插圖，不是表格小圖示。
 * 資料本身（正確拆法對過 codes.json、錯誤拆法只收有把筆畫講清楚的那幾個）
 * 見 site/tools/build_site_data.py 的 PRINCIPLE_WRONG。 */
(function () {
  'use strict';

  var slots = document.querySelectorAll('.pr-example[data-char]');
  if (!slots.length) return;

  var RAINBOW = ['rb-0', 'rb-1', 'rb-2', 'rb-3', 'rb-4'];
  var GLYPHS = null;
  var DATA = null;

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function card(ch, breakdown, ok) {
    var c = el('div', 'pr-card ' + (ok ? 'is-ok' : 'is-bad'));
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
    var mark = el('span', 'pr-mark');
    mark.textContent = ok ? '✓' : '✕';
    mark.setAttribute('aria-hidden', 'true');
    icon.appendChild(mark);
    c.appendChild(icon);
    var code = el('span', 'pr-code');
    code.textContent = breakdown.code;
    code.setAttribute('data-keep', '');
    c.appendChild(code);
    c.title = ch + '　' + breakdown.code + (ok ? '（正確）' : '（不取，示範用）');
    c.setAttribute('data-keep', '');
    return c;
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
      cards.appendChild(card(ch, entry.correct, true));
      if (entry.wrong) cards.appendChild(card(ch, entry.wrong, false));
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
