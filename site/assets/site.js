/* 愛發筆公開網站 —— 共用行為：導覽列高亮 ＋ 繁簡切換。
 *
 * 繁簡切換的做法：內容一律用繁體寫一次，簡體在瀏覽器裡即時轉。理由是維護成本 ——
 * 兩份手寫內容一定會走鐘，而且轉換資料（data/opencc.json）本來就在這個 repo 裡。
 *
 * 只轉「繁 → 簡」這個方向，而且第一次轉換前先把原文存進 WeakMap。切回繁體是還原原文，
 * 不是反向再轉一次 —— 簡 → 繁 是一對多（发 = 發／髮），反向轉一定會出錯字。
 */
(function () {
  'use strict';

  /* ---------- 導覽列：標出目前頁面 ---------- */
  var here = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '/index.html');
  document.querySelectorAll('nav.site a').forEach(function (a) {
    var target = a.getAttribute('href');
    if (!target) return;
    var path = new URL(target, location.href).pathname
      .replace(/\/index\.html$/, '/').replace(/\/$/, '/index.html');
    if (path === here) a.setAttribute('aria-current', 'page');
  });

  /* ---------- 繁簡切換 ---------- */
  var KEY = 'aiphabi-site-lang';
  var SKIP = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, KBD: 1, TEXTAREA: 1 };
  var original = new WeakMap();     // textNode -> 原本的繁體字串
  var t2s = null;
  var pending = false;

  function convertible(node) {
    for (var el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (SKIP[el.tagName]) return false;
      if (el.hasAttribute('data-keep')) return false;   // 專有名詞／不該轉的段落
    }
    return true;
  }

  function walk(root, fn) {
    var it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = it.nextNode())) if (n.nodeValue.trim() && convertible(n)) fn(n);
  }

  function toSimplified(root) {
    walk(root, function (node) {
      if (!original.has(node)) original.set(node, node.nodeValue);
      var src = original.get(node), out = '';
      // 用 for...of 逐「碼位」走，非 BMP 字（罕用字）才不會被拆成兩半
      for (var ch of src) out += (t2s[ch] || ch);
      if (out !== node.nodeValue) node.nodeValue = out;
    });
  }

  function toTraditional(root) {
    walk(root, function (node) {
      if (original.has(node)) node.nodeValue = original.get(node);
    });
  }

  function paint(lang) {
    document.documentElement.lang = lang === 'simp' ? 'zh-Hans' : 'zh-Hant';
    document.querySelectorAll('.langtoggle button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
  }

  function apply(lang, root) {
    root = root || document.body;
    if (lang !== 'simp') { toTraditional(root); paint('trad'); return; }
    if (t2s) { toSimplified(root); paint('simp'); return; }
    if (pending) return;
    pending = true;
    fetch('assets/t2s.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { t2s = data; pending = false; toSimplified(document.body); paint('simp'); })
      .catch(function () {
        pending = false;
        // 轉換資料抓不到就維持繁體 —— 半轉一半的頁面比沒轉還糟
        paint('trad');
      });
  }

  function current() {
    try { return localStorage.getItem(KEY) === 'simp' ? 'simp' : 'trad'; }
    catch (e) { return 'trad'; }
  }

  document.querySelectorAll('.langtoggle button').forEach(function (b) {
    b.addEventListener('click', function () {
      var lang = b.dataset.lang;
      try { localStorage.setItem(KEY, lang); } catch (e) { /* 無痕模式：只影響這一頁 */ }
      apply(lang);
    });
  });

  apply(current());

  /* ---------- 進度數字：從 dict.json 填，HTML 裡寫的是離線後備值 ----------
   * 頁面在沒有 JS／抓不到檔案時仍然顯示得出數字，只是可能舊一點；有 JS 時一律以
   * 產生當下的 codes.json 為準。手抄的數字撐不過幾天取碼。 */
  var slots = document.querySelectorAll('[data-stat]');
  if (slots.length) {
    fetch('assets/dict.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        slots.forEach(function (el) {
          var v = el.dataset.stat.split('.').reduce(function (o, k) {
            return (o == null ? o : o[k]);
          }, d.stats || {});
          if (v != null) el.textContent = v;
        });
      })
      .catch(function () { /* 留著 HTML 裡的後備值 */ });
  }

  /* 給試打頁用：候選字是後來才畫上去的，畫完要跟著轉 */
  window.AiPhaBiSite = {
    localize: function (root) { if (current() === 'simp' && t2s) toSimplified(root); }
  };
})();
