/* 〈簡碼〉頁：把 assets/jianma.json 的三種簡碼機制畫成表格。
 * 資料本身（約定簡碼、左簡碼的名單，三簡碼的示範字）全部由
 * site/tools/build_site_data.py 從 data/rules.json＋data/codes.json 現算，
 * 這支程式只負責畫表，不做任何取碼邏輯。 */
(function () {
  'use strict';

  var root = document.getElementById('jm-convention');
  if (!root) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function code(text) {
    var c = el('code', null, text);
    c.setAttribute('data-keep', '');
    return c;
  }

  function convRow(e) {
    var tr = el('tr');
    var tdc = el('td');
    tdc.appendChild(el('span', 'jm-char', e.c));
    tdc.lastChild.setAttribute('data-keep', '');
    var tdCode = el('td'); tdCode.appendChild(code(e.code));
    var tdShort = el('td'); tdShort.appendChild(code(e.short));
    tr.appendChild(tdc); tr.appendChild(tdCode); tr.appendChild(tdShort);
    return tr;
  }

  var CONVENTION = [];

  // 「預設」＝ rules.json 原本的收字順序（不重排，原地回傳）；筆劃數／簡碼字母序
  // 兩種都是穩定排序（Array#sort 自 ES2019 起保證穩定），同筆劃或同碼時仍照預設順序排。
  function sortedConvention(mode) {
    var arr = CONVENTION.slice();
    if (mode === 'strokes') {
      arr.sort(function (a, b) { return a.strokes - b.strokes; });
    } else if (mode === 'alpha') {
      arr.sort(function (a, b) { return a.short < b.short ? -1 : a.short > b.short ? 1 : 0; });
    }
    return arr;
  }

  function renderConvention(entries) {
    var tbodyA = document.querySelector('#jm-convention tbody');
    var tbodyB = document.querySelector('#jm-convention-2 tbody');
    tbodyA.textContent = '';
    tbodyB.textContent = '';
    // 拆兩欄減少捲動：前一半在左欄，後一半在右欄（不是逐行左右交錯），
    // 這樣同一欄裡的字仍照原本的順序連續排列，找字比較好找。
    var half = Math.ceil(entries.length / 2);
    entries.slice(0, half).forEach(function (e) { tbodyA.appendChild(convRow(e)); });
    entries.slice(half).forEach(function (e) { tbodyB.appendChild(convRow(e)); });
    var count = document.getElementById('jm-conv-count');
    if (count) count.textContent = entries.length;
  }

  function renderShort3(data) {
    var tbody = document.querySelector('#jm-short3 tbody');
    tbody.textContent = '';
    (data.examples || []).forEach(function (e) {
      var tr = el('tr');
      var tdc = el('td'); tdc.textContent = e.c; tdc.setAttribute('data-keep', '');
      var tdCode = el('td'); tdCode.appendChild(code(e.code));
      var tdShort = el('td'); tdShort.appendChild(code(e.short));
      tr.appendChild(tdc); tr.appendChild(tdCode); tr.appendChild(tdShort);
      tbody.appendChild(tr);
    });
    var count = document.getElementById('jm-short3-count');
    if (count) count.textContent = data.eligible;
  }

  function charList(chars) {
    var span = el('span');
    span.setAttribute('data-keep', '');
    span.textContent = chars.join('、');
    return span;
  }

  function renderLeftShort(families) {
    var tbody = document.querySelector('#jm-leftshort tbody');
    tbody.textContent = '';
    families.forEach(function (f) {
      var tr = el('tr');

      var tdComp = el('td');
      tdComp.appendChild(el('span', null, f.alias.join('／')));
      tdComp.lastChild.setAttribute('data-keep', '');
      tr.appendChild(tdComp);

      var tdCode = el('td'); tdCode.appendChild(code(f.code));
      tr.appendChild(tdCode);

      var tdShort = el('td'); tdShort.appendChild(code(f.short));
      tr.appendChild(tdShort);

      var tdOk = el('td'); tdOk.appendChild(charList(f.ok));
      tr.appendChild(tdOk);

      var tdNo = el('td');
      if (f.no) { tdNo.appendChild(charList([f.no])); }
      tr.appendChild(tdNo);

      var tdCount = el('td');
      var details = el('details');
      var summary = el('summary', null, f.members.length + ' 字');
      details.appendChild(summary);
      var list = el('div', 'jm-members');
      list.appendChild(charList(f.members));
      details.appendChild(list);
      tdCount.appendChild(details);
      tr.appendChild(tdCount);

      tbody.appendChild(tr);
    });
  }

  var sortBtns = document.querySelectorAll('.jm-sortbar [data-sort]');
  sortBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-pressed') === 'true') return;
      sortBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      btn.setAttribute('aria-pressed', 'true');
      renderConvention(sortedConvention(btn.dataset.sort));
    });
  });

  fetch('assets/jianma.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      CONVENTION = d.convention || [];
      renderConvention(CONVENTION);
      renderShort3(d.short3 || { examples: [], eligible: 0 });
      renderLeftShort(d.left_short || []);
    })
    .catch(function () {
      document.querySelectorAll('.jm-tbl tbody').forEach(function (tb) {
        tb.innerHTML = '<tr><td colspan="6">簡碼表載入失敗，請重新整理。</td></tr>';
      });
    });
})();
