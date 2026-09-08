/* 〈功能鍵〉頁第 4 節（部件）：把 assets/gongnengjian.json 的字母清單畫成表格。
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
    var tdL = el('td'); tdL.appendChild(el('code', null, g.letter)).setAttribute('data-keep', '');
    var tdM = el('td'); tdM.appendChild(chars(g.main));
    var tdC = el('td'); tdC.appendChild(chars(g.components));
    if (!g.main.length) tr.className = 'gj-no-main';
    tr.appendChild(tdL); tr.appendChild(tdM); tr.appendChild(tdC);
    return tr;
  }

  fetch('assets/gongnengjian.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var letters = d.letters || [];
      body.innerHTML = '';
      letters.forEach(function (g) { body.appendChild(row(g)); });
      var countEl = document.getElementById('gj-component-count');
      if (countEl) {
        var n = letters.reduce(function (s, g) { return s + g.components.length; }, 0);
        countEl.textContent = n;
      }
    })
    .catch(function () {
      body.innerHTML = '<tr><td colspan="3">部件表載入失敗，請重新整理。</td></tr>';
    });
})();
