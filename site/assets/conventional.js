/* 〈約定字〉頁：把 assets/conventional.json 的約定字表畫成一組一組的表格。
 * 資料由 site/tools/build_site_data.py 的 build_conventional() 從
 * data/rules.json（約定原則的組別／字表）＋data/codes.json（現查每個字的真碼）產生，
 * 這支程式只負責畫表。表格樣式沿用 jianma.js 那一套（.jm-tbl／.jm-char），
 * 兩頁看起來一致，也不用另外重寫一份 CSS。 */
(function () {
  'use strict';

  var root = document.getElementById('cv-groups');
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

  function charRow(c) {
    var tr = el('tr');
    var tdc = el('td');
    tdc.appendChild(el('span', 'jm-char', c.c));
    tdc.lastChild.setAttribute('data-keep', '');
    tr.appendChild(tdc);

    var tdCode = el('td'); tdCode.appendChild(code(c.code));
    tr.appendChild(tdCode);

    var tdComp = el('td');
    if (c.comp) {
      tdComp.appendChild(code(c.comp));
    } else {
      var same = el('span', 'jm-same', '同');
      same.title = '作為偏旁時取碼不變';
      tdComp.appendChild(same);
    }
    tr.appendChild(tdComp);

    return tr;
  }

  function table(cls) {
    var t = el('table', 'jm-tbl jm-compact' + (cls ? ' ' + cls : ''));
    var thead = el('thead');
    var htr = el('tr');
    ['字', '單獨成字', '作為偏旁'].forEach(function (h) { htr.appendChild(el('th', null, h)); });
    thead.appendChild(htr);
    t.appendChild(thead);
    t.appendChild(el('tbody'));
    return t;
  }

  // 字數多的組（數字／木／土字類）拆兩欄，跟〈簡碼〉頁約定簡碼表同一招——減少捲動，
  // 兩欄各自完整連續（不是逐行交錯）。字數少的組（4～6 字）一欄就夠，硬拆兩欄反而
  // 兩邊都稀稀落落。閾值抓 9：剛好卡在「土字類」9 字跟「甲字類」6 字之間。
  var TWO_COL_MIN = 9;

  function groupTables(chars) {
    if (chars.length < TWO_COL_MIN) {
      var t = table();
      var tbody = t.querySelector('tbody');
      chars.forEach(function (c) { tbody.appendChild(charRow(c)); });
      var wrap1 = el('div', 'tablewrap');
      wrap1.appendChild(t);
      return wrap1;
    }
    var cols = el('div', 'jm-cols');
    var tA = table(), tB = table();
    var half = Math.ceil(chars.length / 2);
    var bodyA = tA.querySelector('tbody'), bodyB = tB.querySelector('tbody');
    chars.slice(0, half).forEach(function (c) { bodyA.appendChild(charRow(c)); });
    chars.slice(half).forEach(function (c) { bodyB.appendChild(charRow(c)); });
    cols.appendChild(tA);
    cols.appendChild(tB);
    return cols;
  }

  function groupBlock(g, i) {
    var wrap = el('div');
    var h2 = el('h2', null, g.name);
    h2.id = 'cv-' + (i + 1);
    h2.appendChild(el('span', 'jm-groupcount', '（' + g.chars.length + ' 字）'));
    wrap.appendChild(h2);
    wrap.appendChild(groupTables(g.chars));
    return wrap;
  }

  fetch('assets/conventional.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      root.textContent = '';
      (d.groups || []).forEach(function (g, i) { root.appendChild(groupBlock(g, i)); });
    })
    .catch(function () {
      root.textContent = '約定字表載入失敗，請重新整理。';
    });
})();
