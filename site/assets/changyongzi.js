/* 〈常用字表 PDF〉頁的「把字貼進來看哪些是常用字」小工具。
 *
 * 版面借〈拆碼查詢〉貼字查碼那一套的感覺：一個字一格，只是這裡不畫拆碼圖，
 * 只用底色分兩種——綠＝常用字、灰＝非常用——右上角一顆「簡」角標標出簡體
 * 專屬字。
 *
 * 名單來源跟頁面上的 PDF 同一份：site/assets/charset.json 的 common
 * （build_site_data.py 從 rime/lua/aiphabi_data.lua 抄，跟輸入法實際在用的
 * 一致）。simp 是簡體專屬字。charset.json 約 40 KB，點進這頁才抓；抓不到
 * 就只讓這個小工具失效，PDF 預覽跟下載不受影響。 */
(function () {
  'use strict';

  var q = document.getElementById('cy-q');
  var wall = document.getElementById('cy-wall');
  var summary = document.getElementById('cy-summary');
  if (!q || !wall || !summary) return;

  var MAX = 500;                       // 貼太長只看前 500 字，夠用又不會卡
  var COMMON = null, SIMP = null, state = 'idle';

  function isHan(ch) {
    var o = ch.codePointAt(0);
    return (o >= 0x3400 && o <= 0x9FFF) || (o >= 0xF900 && o <= 0xFAFF) ||
           (o >= 0x20000 && o <= 0x2FA1F);
  }

  function load(after) {
    if (state === 'ready') { after(); return; }
    if (state === 'loading') return;
    state = 'loading';
    summary.textContent = '名單載入中……';
    fetch('assets/charset.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        COMMON = new Set(Array.from(d.common || ''));
        SIMP = new Set(Array.from(d.simp || ''));
        state = 'ready';
        after();
      })
      .catch(function () {
        state = 'idle';
        summary.textContent = '名單載入失敗，請重新整理頁面再試。';
      });
  }

  function render() {
    var chars = [];
    for (var ch of q.value) {
      if (isHan(ch)) chars.push(ch);
      if (chars.length >= MAX) break;
    }
    wall.textContent = '';
    if (!chars.length) { summary.textContent = ''; return; }

    load(function () {
      wall.textContent = '';
      var yes = 0, simp = 0;
      chars.forEach(function (ch) {
        var inC = COMMON.has(ch), inS = SIMP.has(ch);
        if (inC) yes++;
        if (inS) simp++;
        var cell = document.createElement('span');
        cell.className = 'cy-cell ' + (inC ? 'is-yes' : 'is-no');
        cell.textContent = ch;
        cell.setAttribute('data-keep', '');
        cell.title = ch + (inC ? '　常用字' : '　非常用') + (inS ? '　簡體專屬字' : '');
        if (inS) {
          var tag = document.createElement('span');
          tag.className = 'cy-tag';
          tag.textContent = '簡';
          cell.appendChild(tag);
        }
        wall.appendChild(cell);
      });
      var n = chars.length;
      var s = '共 ' + n + ' 字：' + yes + ' 個常用、' + (n - yes) + ' 個非常用。';
      if (simp) s += '其中 ' + simp + ' 個是簡體專屬字（「不打簡體」也會擋掉）。';
      if (n >= MAX) s += '超過 ' + MAX + ' 字，只看前面這些。';
      summary.textContent = s;
    });
  }

  var t;
  q.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(render, 120);
  });
})();
