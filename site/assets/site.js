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

  /* ---------- 側邊欄章節清單：可以收起來 ----------
     目前這一頁的章節（.pr-sidenav）掛在它自己那條連結底下。頁面長的時候那串
     錨點會把「線上試打／拆碼查詢／後記」推到很下面，所以給它一個箭頭可以收。

     ⚠️ 按鈕是這裡長出來的，不寫在 HTML 裡：沒有 JS 的時候不該出現一顆按不動的
     按鈕，而「展開」本來就是正確的預設狀態，什麼都不做剛好就是對的。
     收合狀態記在 localStorage，跨頁共用一個鍵 —— 使用者收起來的是「章節清單」
     這個東西，不是「自動上屏那一頁的章節清單」。 */
  var SUB_KEY = 'aiphabi-site-subnav';
  var sub = document.querySelector('nav.site .pr-sidenav');
  if (sub) {
    var link = sub.previousElementSibling;
    if (link && link.tagName === 'A') {
      var head = document.createElement('div');
      head.className = 'pr-navhead';
      link.parentNode.insertBefore(head, link);
      head.appendChild(link);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pr-toggle';
      head.appendChild(btn);

      if (!sub.id) sub.id = 'pr-subnav';
      btn.setAttribute('aria-controls', sub.id);

      var collapsed = false;
      try { collapsed = localStorage.getItem(SUB_KEY) === '1'; } catch (e) {}

      var apply = function () {
        sub.hidden = collapsed;
        btn.setAttribute('aria-expanded', String(!collapsed));
        // 名字要講「按下去會發生什麼」，不是「現在是什麼狀態」
        btn.setAttribute('aria-label', collapsed ? '展開章節' : '收合章節');
        btn.title = btn.getAttribute('aria-label');
      };
      apply();

      btn.addEventListener('click', function () {
        collapsed = !collapsed;
        apply();
        try { localStorage.setItem(SUB_KEY, collapsed ? '1' : '0'); } catch (e) {}
      });
    }
  }

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

  /* ---------- 字級（小／標準／大） ----------
   * 每一頁的頁首都有這組按鈕（原本只在字根表頁），縮放全站套用 —— 見 site.css
   * 的 html { font-size: calc(100% * var(--zg-scale)) }。這裡只負責讀、存、切換。 */
  var SIZE_KEY = 'aiphabi-zigen-size';
  var VALID_SIZES = ['small', 'normal', 'large'];

  function applySize(name) {
    var sizeName = VALID_SIZES.indexOf(name) === -1 ? 'normal' : name;
    document.documentElement.setAttribute('data-zg-size', sizeName);
    document.querySelectorAll('.zg-size button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.size === sizeName));
    });
    try { localStorage.setItem(SIZE_KEY, sizeName); } catch (e) { /* 無痕模式 */ }
  }

  document.querySelectorAll('.zg-size button').forEach(function (b) {
    b.addEventListener('click', function () { applySize(b.dataset.size); });
  });

  try { applySize(localStorage.getItem(SIZE_KEY) || 'normal'); }
  catch (e) { applySize('normal'); }

  /* ---------- 進度數字：從 dict.json 填，HTML 裡寫的是離線後備值 ----------
   * 頁面在沒有 JS／抓不到檔案時仍然顯示得出數字，只是可能舊一點；有 JS 時一律以
   * 產生當下的 codes.json 為準。手抄的數字撐不過幾天取碼。 */
  var slots = document.querySelectorAll('[data-stat]');
  var tw4808El = document.getElementById('tw4808-stat');
  if (slots.length || tw4808El) {
    fetch('assets/dict.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        slots.forEach(function (el) {
          var v = el.dataset.stat.split('.').reduce(function (o, k) {
            return (o == null ? o : o[k]);
          }, d.stats || {});
          if (v != null) el.textContent = v;
        });
        /* 〈簡介〉頁：教育部甲表收滿了就講「全部收錄」，沒收滿就講分數——哪一句
           由資料決定，不要在 HTML 裡手寫死其中一句（2026-08-17 Wilson 的指示，
           原本寫在 index.html 移除〈目前進度〉那段旁邊的註解裡；首頁改版成
           landing 頁之後，這個位置跟著〈簡介〉的內容一起搬進 jieshao.html）。 */
        if (tw4808El && d.stats && d.stats.tw4808) {
          var s = d.stats.tw4808;
          tw4808El.textContent = s.done >= s.total
            ? ('教育部常用國字甲表 ' + s.total.toLocaleString('en-US') + ' 字，全部收錄')
            : ('教育部常用國字甲表已收錄 ' + s.done.toLocaleString('en-US') + '／' + s.total.toLocaleString('en-US') + ' 字');
        }
      })
      .catch(function () { /* 留著 HTML 裡的後備值 */ });
  }

  /* 給試打頁用：候選字是後來才畫上去的，畫完要跟著轉 */
  window.AiPhaBiSite = {
    localize: function (root) { if (current() === 'simp' && t2s) toSimplified(root); }
  };
})();
