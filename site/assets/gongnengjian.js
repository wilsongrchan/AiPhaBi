/* 〈功能鍵〉頁第 4 節（部件）：把 assets/gongnengjian.json 的碼清單畫成表格。
 * 清單本身（哪些字算部件、哪個字獨立成字）全部由
 * site/tools/build_site_data.py 從 data/codes.json 的 componentOnly 旗標現算，
 * 這支程式只負責畫表。 */
(function () {
  'use strict';

  var root = document.getElementById('gj-component-tbl');
  if (!root) return;
  var body = root.querySelector('tbody');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function chars(list) {
    var wrap = el('span');
    wrap.setAttribute('data-keep', '');
    wrap.textContent = list.length ? list.join('、') : '（無）';
    return wrap;
  }

  function row(g) {
    var tr = el('tr');
    var tdL = el('td'); tdL.appendChild(el('code', null, g.code)).setAttribute('data-keep', '');
    var tdM = el('td'); tdM.appendChild(chars(g.main));
    var tdC = el('td'); tdC.appendChild(chars(g.components));
    if (!g.main.length) tr.className = 'gj-no-main';
    tr.appendChild(tdL); tr.appendChild(tdM); tr.appendChild(tdC);
    return tr;
  }

  fetch('assets/gongnengjian.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var rows = d.codes || [];
      body.innerHTML = '';
      rows.forEach(function (g) { body.appendChild(row(g)); });
    })
    .catch(function () {
      body.innerHTML = '<tr><td colspan="3">部件表載入失敗，請重新整理。</td></tr>';
    });
})();

/* 〈萬用鍵〉範例圖：候選列裡塞的是完整的候選清單（最多 16 個），但畫面上
 * 只留得下幾個就顯示幾個，超過的裁掉、補一個「…」——不用 .rail 原本的
 * 橫向捲動，因為這裡要讓人一眼看出「範圍大不大」，捲軸會把多的候選藏起來，
 * 反而看不出差別（Wilson）。絕對不要切到候選字一半——沒地方放的整個藏起來，
 * 不是縮小或截斷文字。 */
(function () {
  'use strict';

  function fitRail(rail) {
    var box = rail.querySelector('.cands');
    if (!box) return;
    var cands = Array.prototype.slice.call(box.children).filter(function (c) {
      return c.classList.contains('cand') && !c.classList.contains('gj-more');
    });
    if (!cands.length) return;

    var more = box.querySelector('.cand.gj-more');
    if (!more) {
      more = document.createElement('span');
      more.className = 'cand gj-more';
      more.setAttribute('aria-hidden', 'true');
      var g = document.createElement('span');
      g.className = 'g';
      g.textContent = '…';
      more.appendChild(g);
    }
    box.appendChild(more); // 永遠排最後一個

    // 重置：全部候選先顯示，才量得出「照順序放下去，第幾個會超出去」。
    // .hint 這時候的**位置**不能信——它靠 margin-inline-start:auto 貼右，
    // 全部候選攤開時 .cands 一定比容器寬，.hint 會被推到看不見的地方去；
    // 但它的**寬度**跟位置無關，一樣準，用寬度回推「候選最多能占多寬」。
    cands.forEach(function (c) { c.style.display = ''; });
    more.style.display = 'none';

    var hint = rail.querySelector('.hint');
    var railCs = getComputedStyle(rail);
    var gap = parseFloat(railCs.columnGap || railCs.gap) || 0;
    var padRight = parseFloat(railCs.paddingRight) || 0;
    var limit = rail.getBoundingClientRect().right - padRight;
    if (hint) limit -= hint.getBoundingClientRect().width + gap;

    // .cands 這時候不縮（flex-shrink:0），候選字彼此的位置是正常排版算出來的，
    // 靠自己在 .cands 起點往右排，不受還沒決定要不要顯示的 .hint 影響，能信。
    var cut = -1;
    for (var i = 0; i < cands.length; i++) {
      if (cands[i].getBoundingClientRect().right > limit) { cut = i; break; }
    }
    if (cut === -1) return; // 全部放得下，不用省略號

    for (var j = cut; j < cands.length; j++) cands[j].style.display = 'none';
    more.style.display = '';
  }

  function fitAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.rail.gj-demo'), fitRail);
  }

  if (!document.querySelector('.rail.gj-demo')) return;

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitAll);
  }
  window.addEventListener('load', fitAll);
  if (document.readyState !== 'loading') fitAll();
  else document.addEventListener('DOMContentLoaded', fitAll);

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitAll, 150);
  });
  // 繁簡切換、字級切換都會改候選字寬度，量過的結果要重算
  document.addEventListener('aiphabi:lang', function () { setTimeout(fitAll, 50); });
  Array.prototype.forEach.call(document.querySelectorAll('.zg-size button'), function (b) {
    b.addEventListener('click', function () { setTimeout(fitAll, 50); });
  });
})();
