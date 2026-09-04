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

      /* ⚠️ 這支一定要叫 paintCollapse，不能叫 apply —— 底下「繁簡切換」那一節
         有一個 function apply(lang, root)，而整個檔案是同一個 IIFE、var 又是
         函式作用域，取同一個名字會在執行到這裡時把它整個蓋掉。症狀很難聯想：
         有章節清單的那六頁（字根表／取碼原則／約定字表／簡碼／詞組連打／自動
         上屏）按「简」完全沒反應，沒有任何錯誤訊息，因為按鈕呼叫到的是這支
         收合函式；沒有章節清單的頁面（首頁等）則完全正常。 */
      var paintCollapse = function () {
        sub.hidden = collapsed;
        btn.setAttribute('aria-expanded', String(!collapsed));
        // 名字要講「按下去會發生什麼」，不是「現在是什麼狀態」
        btn.setAttribute('aria-label', collapsed ? '展開章節' : '收合章節');
        btn.title = btn.getAttribute('aria-label');
      };
      paintCollapse();

      btn.addEventListener('click', function () {
        collapsed = !collapsed;
        paintCollapse();
        try { localStorage.setItem(SUB_KEY, collapsed ? '1' : '0'); } catch (e) {}
      });
    }
  }

  /* ---------- 「現在讀到哪一節」：一份捲動偵測，兩個地方用（Wilson 2026-09-04）----------
     桌面側邊欄把目前這一頁的十條章節全部列出來，卻不會告訴你人在哪一節
     （量過：捲到 0／2500／5000，十條的樣式一模一樣）。〈取碼原則〉4,456px、
     〈詞組連打〉6,786px、〈字根表〉15,420px —— 清單愈長，愈需要它。

     ⚠️ 只有一份偵測，兩個消費者：側邊欄的高亮，與手機麵包屑的第四格。手機那一格
     本來自己跑一輪一模一樣的迴圈；兩份「哪一節是現在」的判斷遲早會各說各的，
     所以合成一份，其餘的用訂閱。
     ⚠️ 判斷線是視窗頂端往下 90px：剛好在頁首底下一點，跟麵包屑原本用的同一個值，
     換掉的話兩邊會在不同的時機跳。 */
  var spyItems = [];
  var spySubs = [];
  var spyAt;                    // undefined ＝還沒算過，所以第一次一定會發出通知
  var spyRaf = 0;

  /* ⚠️ 這一份清單有兩件事會在載入之後才變，兩件都會讓高亮**完全不會出現**，
     而且兩件都不報錯 —— 〈約定字表〉一頁同時中了兩個：

     一、標題不一定在載入時就存在：那八個章節標題是 conventional.js 抓完 JSON
         才畫上去的，載入當下 getElementById 全部落空。所以只記 id，元素等用得到
         時才找，找不到下一輪再找。判斷「要不要掛捲動監聽」也只能看**連結**幾條，
         不能看解析出幾個元素 —— 後者在那一頁載入當下是 0，監聽根本不會掛上，
         之後就永遠不會恢復。
     二、側邊欄那串連結本身會被整批換掉：conventional.js 的 renderSideNav() 用
         `ul.textContent = ''` 清空再重建（它有它的道理：清單要從資料長出來，
         手寫的那版就漏過一組）。快取住的 <a> 因此變成**已經離開文件的節點**，
         classList 照樣加得上去，畫面上卻什麼都不會發生。所以掛一個
         MutationObserver 盯著它，被換掉就重建這份清單。 */
  function spyBuild() {
    if (!sub) return;
    var was = {};
    spyItems.forEach(function (o) { if (o.el) was[o.id] = o.el; });
    spyItems = [];
    [].forEach.call(sub.querySelectorAll('a[href^="#"]'), function (a) {
      var id = a.getAttribute('href').slice(1);
      spyItems.push({ id: id, el: was[id] || null, a: a });
    });
    spyAt = undefined;          // 清單換了，重新判一次並通知訂閱者
  }
  spyBuild();

  /* 側邊欄自己也會捲（〈取碼原則〉展開章節後內容 1,065px、視窗只有 900px）。
     亮起來的那一條如果剛好在捲動範圍外，等於沒亮 —— 把側邊欄自己的 scrollTop
     推一下就好，不要用 scrollIntoView：那會連帶把**整頁**捲走。 */
  function spyReveal(a) {
    if (window.matchMedia('(max-width: 52rem)').matches) return;   // 手機沒有側邊欄
    var bar = document.querySelector('.topbar');
    if (!bar || bar.scrollHeight <= bar.clientHeight) return;
    var r = a.getBoundingClientRect(), br = bar.getBoundingClientRect();
    if (r.top < br.top + 8) bar.scrollTop -= (br.top + 8 - r.top);
    else if (r.bottom > br.bottom - 8) bar.scrollTop += (r.bottom - (br.bottom - 8));
  }

  function spyPaint() {
    spyRaf = 0;
    var hit = null;
    spyItems.forEach(function (o) {
      if (!o.el) o.el = document.getElementById(o.id);
      if (o.el && o.el.getBoundingClientRect().top <= 90) hit = o;
    });
    if (hit === spyAt) return;
    spyAt = hit;
    spyItems.forEach(function (o) { o.a.classList.toggle('is-here', o === hit); });
    if (hit) spyReveal(hit.a);
    spySubs.forEach(function (fn) { fn(hit); });
  }

  /* 新的訂閱者要立刻拿到現況：spyPaint 只在「換了一節」時才通知，掛得晚的
     訂閱者等不到那一次。 */
  function spyWatch(fn) {
    spySubs.push(fn);
    fn(spyAt || null);
  }

  if (spyItems.length) {
    var spyQueue = function () { if (!spyRaf) spyRaf = requestAnimationFrame(spyPaint); };
    if (window.MutationObserver) {
      new MutationObserver(function () { spyBuild(); spyQueue(); })
        .observe(sub, { childList: true });
    }
    window.addEventListener('scroll', spyQueue, { passive: true });
    /* ⚠️ 版面長高時要重算：字根表那幾頁的表格是抓完 JSON 才畫的，剛載入時整頁
       還很短，錨點全擠在視窗頂端 —— 只算一次的話會亮在一個還沒讀到的章節上。 */
    window.addEventListener('resize', spyQueue, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(spyQueue).observe(document.body);
    spyPaint();
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

  /* ⚠️ placeholder／title／aria-label 是**屬性**，不是文字節點，TreeWalker 走不到
     它們 —— 切成简體之後，輸入框裡的提示字（「在這裡輸入拼音即可查字」）仍然是
     繁體（Wilson 2026-08-31 發現）。這裡另外走一遍這幾個屬性，規則跟文字節點
     一樣：SKIP 標籤與 data-keep 底下的一律不碰。 */
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  var origAttr = new WeakMap();      // 元素 -> { 屬性名: 原本的繁體字串 }

  function walkAttrs(root, fn) {
    var all = root.querySelectorAll('[placeholder], [title], [aria-label]');
    Array.prototype.forEach.call(all, function (el) {
      // convertible() 是看文字節點的父鏈，這裡直接看元素自己這條鏈
      for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
        if (SKIP[e.tagName] && e !== el) return;
        if (e.hasAttribute('data-keep')) return;
      }
      ATTRS.forEach(function (a) { if (el.hasAttribute(a)) fn(el, a); });
    });
  }

  function toSimplified(root) {
    walkAttrs(root, function (el, a) {
      var store = origAttr.get(el) || {};
      if (!(a in store)) { store[a] = el.getAttribute(a); origAttr.set(el, store); }
      var out = '';
      for (var ch of store[a]) out += (t2s[ch] || ch);
      if (out !== el.getAttribute(a)) el.setAttribute(a, out);
    });
    walk(root, function (node) {
      if (!original.has(node)) original.set(node, node.nodeValue);
      var src = original.get(node), out = '';
      // 用 for...of 逐「碼位」走，非 BMP 字（罕用字）才不會被拆成兩半
      for (var ch of src) out += (t2s[ch] || ch);
      if (out !== node.nodeValue) node.nodeValue = out;
    });
  }

  function toTraditional(root) {
    walkAttrs(root, function (el, a) {
      var store = origAttr.get(el);
      if (store && a in store) el.setAttribute(a, store[a]);
    });
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
  var gbL1El = document.getElementById('gb2312l1-stat');
  var covEl = document.getElementById('coverage-stat');
  if (slots.length || tw4808El || gbL1El || covEl) {
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
           landing 頁之後，這個位置跟著〈簡介〉的內容一起搬進 jieshao.html）。
           「台灣教育部常用國字甲表」連到教育部語文成果入口網的常用字下載頁（Wilson
           要求加連結）——那一頁掛的是「教育部4808個常用字」的 ODF／PDF 下載，
           4,808 字這個數字跟 data/standards/tw_common_4808.txt 的來源說明
           一致。HTML 裡的靜態後備值（沒 JS／抓不到 dict.json 時）也要是同一顆
           連結，兩處手動保持一致。 */
        if (tw4808El && d.stats && d.stats.tw4808) {
          var s = d.stats.tw4808;
          var tw4808Link = '<a href="https://language.moe.gov.tw/material/info?m=9fe3ff5a-5a8c-4817-9e60-6337dd55a509" ' +
            'target="_blank" rel="noopener">台灣地區教育部常用國字甲表</a>';
          tw4808El.innerHTML = s.done >= s.total
            ? (tw4808Link + ' ' + s.total.toLocaleString('en-US') + ' 字，全部收錄')
            : (tw4808Link + '已收錄 ' + s.done.toLocaleString('en-US') + '／' + s.total.toLocaleString('en-US') + ' 字');
        }
        /* GB 2312 一級漢字，跟上面那行同一套規矩：收滿了才講「全部收錄」，
           沒收滿就講分數，哪一句由資料決定。

           ⚠️ 用的是 stats.gb2312_l1（一級 3,755 字），**不是** stats.gb2312
           （一級＋二級 6,763 字）。二級還沒收完，拿合併的數字講「全部收錄」
           會是假話（Side A 2026-09-02 特別提醒）。分級是照 GB 2312 自己的
           區位碼算的，不是照檔案裡的位置切，見 build_site_data.py。

           連結指向「國家標準全文公開系統」的 GB/T 2312-1980 頁（2026-09-02 實查
           200、標題確實是「信息交换用汉字编码字符集 基本集」）—— 那是大陸這邊
           對應教育部語文成果入口網的官方頁。⚠️ 跟上面那行一樣，HTML 裡的靜態
           後備值也要是同一顆連結，兩處手動保持一致。 */
        if (gbL1El && d.stats && d.stats.gb2312_l1) {
          var g = d.stats.gb2312_l1;
          var gbLink = '<a href="https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=5664A728BD9D523DE3B99BC37AC7A2CC" ' +
            'target="_blank" rel="noopener">大陸地區國標 GB 2312 第一級漢字</a>';
          gbL1El.innerHTML = g.done >= g.total
            ? (gbLink + ' ' + g.total.toLocaleString('en-US') + ' 字，全部收錄')
            : (gbLink + '已收錄 ' + g.done.toLocaleString('en-US') + '／' +
               g.total.toLocaleString('en-US') + ' 字');
        }
        /* 行文覆蓋率——「打得出多少實際文字」，不是字數覆蓋率。
           ⚠️ 兩個數字的意思不一樣，不要只印一個：
             everyday 扣掉語料裡的合成底重之後的日常文本數字（99.67）
             all      全量語料，含那批灌水字（91.01）—— 它**低估**，
                      因為分母有 12.69% 的字次不對應任何真實文字。
           兩個都印是 Wilson 2026-09-02 的決定。算法見 build_site_data.py。
           ⚠️ 一律**無條件捨去**，不要四捨五入：99.67 進位成「約 100%」等於把
           「幾乎全部」講成「全部」（實測差點就這樣上線）。日常那個取到小數
           一位（99.6%，Wilson 指定），全量那個取整數。 */
        if (covEl && d.stats && d.stats.coverage &&
            d.stats.coverage.everyday != null && d.stats.coverage.all != null) {
          var cv = d.stats.coverage;
          covEl.textContent =
            '日常文本（廣告、公告、文章、報章）覆蓋率約 ' +
            (Math.floor(cv.everyday * 10) / 10).toFixed(1) +
            '%；含生僻字的全量語料統計約 ' + Math.floor(cv.all) + '%';
        }
        /* ⚠️ 這幾行的字是 fetch 回來之後才寫進 DOM 的，而繁簡轉換是**載入時掃一遍**
           做的。目前碰巧不會出錯（t2s.json 比 dict.json 晚回來，最後那次
           toSimplified(document.body) 會蓋過去），但那是**賽跑**，不是保證 ——
           哪天 dict.json 比較慢，這幾行就會卡在繁體。寫完就自己轉一次，不要賭。
           跟 lianxi.js 的 loc() 是同一條規矩。 */
        if (window.AiPhaBiSite) {
          slots.forEach(function (el) { window.AiPhaBiSite.localize(el); });
          if (tw4808El) window.AiPhaBiSite.localize(tw4808El);
          if (gbL1El) window.AiPhaBiSite.localize(gbL1El);
          if (covEl) window.AiPhaBiSite.localize(covEl);
        }
      })
      .catch(function () { /* 留著 HTML 裡的後備值 */ });
  }


  /* ---------- 桌面：側邊欄可以收起來（Wilson 2026-09-04）----------
     「maybe add a little arrow tab or something that allows collapsing or
     minimizing the side bar」。

     ⚠️ 收起來**不會讓正文變寬**：正文欄有 58rem 的上限，1280 也好 1920 也好都是
     928px。這一顆的用處是把畫面清乾淨、讓那一欄置中，不是爭寬度 —— 別把它當成
     版面優化在賣。
     ⚠️ 整件事只靠一個 CSS 變數：--nav-w 只被兩條規則用到（側邊欄的 width、body
     的 padding-inline-start），把它改成 0 兩邊自然跟著走，不必各改各的。
     ⚠️ 那顆把手要掛在 <body> 上、不能放進 .topbar：收起來的側邊欄是
     width:0 ＋ overflow:hidden，放進去會跟著被裁掉，變成一顆按不到的按鈕。
     ⚠️ 手機沒有側邊欄（頁首是一條橫的），這一顆在窄螢幕整個不出現，見 site.css。 */
  var NAVMIN_KEY = 'aiphabi-site-navmin';
  var nmBar = document.querySelector('.topbar');
  if (nmBar) {
    var nmBtn = document.createElement('button');
    nmBtn.type = 'button';
    nmBtn.className = 'navmin';
    nmBtn.innerHTML = '<span class="navmin-arrow" aria-hidden="true"></span>';

    var nmOff = false;
    try { nmOff = localStorage.getItem(NAVMIN_KEY) === '1'; } catch (e) {}

    var nmPaint = function () {
      document.documentElement.classList.toggle('nav-min', nmOff);
      nmBtn.setAttribute('aria-expanded', String(!nmOff));
      // 名字講「按下去會怎樣」，不是「現在是什麼狀態」
      nmBtn.setAttribute('aria-label', nmOff ? '展開側邊導覽' : '收合側邊導覽');
      nmBtn.title = nmBtn.getAttribute('aria-label');
    };
    nmPaint();
    document.body.appendChild(nmBtn);

    nmBtn.addEventListener('click', function () {
      nmOff = !nmOff;
      nmPaint();
      try { localStorage.setItem(NAVMIN_KEY, nmOff ? '1' : '0'); } catch (e) {}
    });
  }

  /* ---------- 每一頁底部的上一頁／下一頁（Wilson 2026-09-04）----------
     「at the bottom of each subpage, it should have an arrow to navigate to the
     next page so when someone is done reading all of a page, they can just click
     that to go to the next page」。

     ⚠️ 順序**從導覽自己讀出來**，不在這裡再寫一張表：導覽的 DOM 順序就是閱讀
     順序，而它已經在每一頁的 HTML 裡了。寫死第二份順序表的話，哪天加一頁、或
     把某頁換組，兩邊就會各說各的 —— 而錯的那一份會是這裡。
     ⚠️ 章節錨點（.pr-sidenav 裡那些 #pr-1）要濾掉，它們不是「下一頁」。
     ⚠️ 首頁不在 nav.site 裡（它是品牌那顆連結），所以在首頁找不到目前頁，
     整塊就不出現 —— 首頁不是「一篇讀完要接下一篇」的頁。 */
  var pnMain = document.querySelector('main');
  var pnNav = document.querySelector('nav.site');
  if (pnMain && pnNav) {
    var pnLinks = [].filter.call(pnNav.querySelectorAll('a'), function (a) {
      return !a.closest('.pr-sidenav');
    });
    var pnAt = -1;
    pnLinks.forEach(function (a, i) {
      if (a.getAttribute('aria-current') === 'page') pnAt = i;
    });
    if (pnAt >= 0 && pnLinks.length > 1) {
      var pnBox = document.createElement('nav');
      pnBox.className = 'pagenav';
      pnBox.setAttribute('aria-label', '上一頁與下一頁');

      var pnMake = function (src, dir, label) {
        var a = document.createElement('a');
        a.className = 'pagenav-' + dir;
        a.href = src.getAttribute('href');
        a.rel = dir;
        var k = document.createElement('span');
        k.className = 'pagenav-k';
        k.textContent = label;
        var t = document.createElement('span');
        t.className = 'pagenav-t';
        t.textContent = src.textContent.trim();
        a.appendChild(k);
        a.appendChild(t);
        return a;
      };
      if (pnAt > 0) pnBox.appendChild(pnMake(pnLinks[pnAt - 1], 'prev', '上一頁'));
      if (pnAt < pnLinks.length - 1) pnBox.appendChild(pnMake(pnLinks[pnAt + 1], 'next', '下一頁'));
      if (pnBox.children.length) pnMain.appendChild(pnBox);
    }
  }

  /* ---------- 窄螢幕：導覽收成漢堡選單 ----------
     手機上十二條連結橫排會折成三行，加上底下那排切換共 225px —— 視窗才 844px，
     等於每一頁一打開有 27% 是導覽。掛了章節清單的頁面更誇張：〈取碼原則〉542px
     （64%），〈約定字表〉472px，而且章節清單在橫排裡會變成一條窄窄的直欄，
     旁邊的連結繞著它排，看起來像壞掉。

     ⚠️ 按鈕在這裡長出來、不寫進十二份 HTML：沒有 JS 的時候不該出現一顆按不動的
     按鈕，而「全部攤開」本來就是可用的狀態 —— 什麼都不做剛好就是對的。
     跟上面章節清單那顆收合鈕同一個道理。CSS 也一律掛在 .has-navtoggle 底下，
     所以沒有 JS 就完全不會進入收合模式。 */
  var mnBar = document.querySelector('.topbar');
  var mnNav = document.querySelector('nav.site');
  if (mnBar && mnNav) {
    var mnWrap = mnBar.querySelector('.wrap') || mnBar;
    if (!mnNav.id) mnNav.id = 'site-nav';

    var mnBtn = document.createElement('button');
    mnBtn.type = 'button';
    mnBtn.className = 'navtoggle';
    mnBtn.setAttribute('aria-controls', mnNav.id);
    mnBtn.setAttribute('aria-expanded', 'false');
    mnBtn.setAttribute('aria-label', '選單');
    /* 三條線用 span 畫，不用文字的 ☰ —— 那個字在不同系統上大小差很多，
       而且會被繁簡轉換掃到。打開時兩條線交叉成 ✕，第三條淡出。 */
    mnBtn.innerHTML = '<span class="navtoggle-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
    mnWrap.appendChild(mnBtn);
    mnBar.classList.add('has-navtoggle');
    /* 同一個 class 也加到 <html>：頁面別處（字根表那幾層黏頂的 top）要知道
       頁首現在只有一列高，而它們不在 .topbar 裡面，掛在根節點上最好寫。 */
    document.documentElement.classList.add('has-navtoggle');

    var mnQuery = window.matchMedia('(max-width: 52rem)');

    /* 選單外面再包一層 .navpanel。⚠️ 這一層在桌面與收起來的狀態是
       `display: contents`，自己不生盒子，版面跟沒有它一模一樣；只有手機把選單
       打開時它才變成真的區塊。
       它存在的唯一理由是「把手往上撥」那個手勢（Wilson 2026-09-03：「it should
       slide up the entire menu panel, not just the text inside it」）：前一版只
       對 nav 下 translateY，nav 是 .wrap 這個 flex 的項目，往上位移只是**壓過
       頁首那一列**，底下的正文一動也不動 —— 看起來就是「字往上跑」，不是
       「整片收起來」。有了這一層，拖曳時同時做兩件事：nav 往上位移、panel 的
       高度等量變矮並且切邊，於是選單被切齊頁首往上捲走，底下的正文跟著遞補
       上來，就是一般手機上「把面板往上推掉」的樣子。 */
    var mnPanel = document.createElement('div');
    mnPanel.className = 'navpanel';
    mnNav.parentNode.insertBefore(mnPanel, mnNav);
    mnPanel.appendChild(mnNav);

    /* 選單底部那條小橫桿。⚠️ 做成真的按鈕、不是純裝飾的 ::after —— 它長得像
       「可以往上收」的把手，那就該真的按得動；看起來能按卻按不動比沒有更糟。
       aria-hidden 是因為它跟漢堡鈕做同一件事，讀螢幕的人已經有那一顆了。 */
    var mnGrab = document.createElement('button');
    mnGrab.type = 'button';
    mnGrab.className = 'navtoggle-grab';
    mnGrab.setAttribute('aria-hidden', 'true');
    mnGrab.tabIndex = -1;
    mnGrab.addEventListener('click', function () {
      /* 剛剛是拖上去關的話，收尾的那個 click 不要再關一次；拖到一半又放回來的
         也不算數 —— 手指動過就不是「點」。 */
      if (mnGrabDragged) { mnGrabDragged = false; return; }
      mnSet(false);
    });
    mnNav.appendChild(mnGrab);

    /* 把手往上一推就收（Wilson 2026-09-03）：它長得像可以往上撥的把手，那就該
       真的撥得動 —— 這是「按 ✕」之外的第二條路，手指本來就在螢幕下半。
       ⚠️ 用 Pointer Events 一次收掉滑鼠與觸控；.navtoggle-grab 那邊配了
       `touch-action: none`，不然 iOS 會先把這個手勢當成捲選單、pointermove
       根本收不到。
       ⚠️ 跟著手指走的位移直接寫 inline style（不是加 class）：拖到一半放手要能
       原地彈回去，class 做不到「停在任意位置」。放手時一律清掉，交還給 CSS。 */
    var mnGrabDrag = null;      // 正在拖：{ id, y0 }
    var mnGrabDragged = false;  // 這一輪拖動過（給 click 判斷用）
    var MN_GRAB_CLOSE = 36;     // 往上超過這麼多 px 就當作要收起來

    var mnGrabH = 0;            // 拖曳開始時整片面板的高度

    function mnGrabPaint(dy) {
      /* 往下拉沒有意義（選單上緣就貼著頁首），給阻力擋住，只讓它往上走。 */
      var d = dy < 0 ? dy : dy / 5;
      mnPanel.style.transition = 'none';
      mnPanel.style.overflow = 'hidden';
      mnPanel.style.height = Math.max(0, mnGrabH + d) + 'px';
      mnNav.style.transition = 'none';
      mnNav.style.transform = 'translateY(' + d.toFixed(1) + 'px)';
    }

    function mnGrabReset() {
      mnPanel.style.transition = '';
      mnPanel.style.overflow = '';
      mnPanel.style.height = '';
      mnNav.style.transition = '';
      mnNav.style.transform = '';
      mnNav.style.opacity = '';
    }

    /* 放手之後把剩下的那一段**演完**，不要瞬移（Wilson：「isn't smooth」）。
       關的那一路走到底再真的收掉，所以 mnSet 不必再播一次自己的關閉動畫。 */
    function mnGrabSettle(close) {
      if (mnReduced.matches) { mnGrabReset(); if (close) mnSet(false, true); return; }
      var ease = 'cubic-bezier(.22,.61,.36,1)';
      mnPanel.style.transition = 'height .2s ' + ease;
      mnNav.style.transition = 'transform .2s ' + ease + ', opacity .2s ease';
      mnPanel.style.height = close ? '0px' : mnGrabH + 'px';
      mnNav.style.transform = close ? 'translateY(' + (-mnGrabH) + 'px)' : 'translateY(0)';
      mnNav.style.opacity = close ? '0' : '1';
      var fired = false;
      var done = function () {
        if (fired) return;
        fired = true;
        mnPanel.removeEventListener('transitionend', done);
        mnGrabReset();
        if (close) mnSet(false, true);
      };
      mnPanel.addEventListener('transitionend', done);
      setTimeout(done, 300);        // transitionend 沒發（高度本來就是 0 之類）的保險
    }

    mnGrab.addEventListener('pointerdown', function (e) {
      if (!mnBar.classList.contains('nav-open')) return;
      mnGrabDrag = { id: e.pointerId, y0: e.clientY };
      mnGrabDragged = false;
      mnGrabH = mnPanel.getBoundingClientRect().height;
      try { mnGrab.setPointerCapture(e.pointerId); } catch (err) {}
    });

    mnGrab.addEventListener('pointermove', function (e) {
      if (!mnGrabDrag || e.pointerId !== mnGrabDrag.id) return;
      var dy = e.clientY - mnGrabDrag.y0;
      if (Math.abs(dy) > 4) mnGrabDragged = true;
      if (mnGrabDragged) { mnGrabPaint(dy); e.preventDefault(); }
    });

    function mnGrabEnd(e) {
      if (!mnGrabDrag || e.pointerId !== mnGrabDrag.id) return;
      var dy = e.clientY - mnGrabDrag.y0;
      var moved = mnGrabDragged;
      mnGrabDrag = null;
      if (!moved) { mnGrabReset(); return; }
      /* 推得夠遠就收，差一點就放手的滑回原位 —— 兩邊都是演出來的。 */
      mnGrabSettle(dy < -MN_GRAB_CLOSE);
    }
    mnGrab.addEventListener('pointerup', mnGrabEnd);
    /* 手指被系統搶走（來電、滑出邊界）也要收乾淨，不然選單會卡在半路。 */
    mnGrab.addEventListener('pointercancel', function (e) {
      if (!mnGrabDrag || e.pointerId !== mnGrabDrag.id) return;
      mnGrabDrag = null;
      mnGrabDragged = false;
      mnGrabReset();
    });

    /* ---------- 手機選單：每一條有章節的連結都能就地展開 ----------
       Wilson 2026-09-03：「if you build a clear enough button (+ or like a
       downward arrow) toward the right hand side, then people will know these
       can be expanded, then if they click that button then it expands,
       otherwise, if they click the heading directly, it should navigate」。

       ⚠️ 十二頁的 <nav> 裡各自只寫著**自己**那一頁的章節清單，別頁的要另外拿。
       來源是建置時掃出來的 assets/nav.json（見 site/tools/build_nav.py）——
       不把六份清單複製進十二個檔案，也不在這裡寫死一張表，兩種都會走味。
       ⚠️ 只有窄螢幕才長出來，而且轉回寬螢幕要拆掉：桌面側邊欄照舊只有「目前
       這一頁」有章節清單，多出來的幾串會把試打／拆碼查詢／後記推到看不見。 */
    var mnSubs = null;            // nav.json 的內容
    var mnSubsFetching = false;
    var mnSubsBuilt = false;

    function mnBuildSubs() {
      if (mnSubsBuilt || !mnSubs) return;
      mnSubsBuilt = true;
      Object.keys(mnSubs).forEach(function (page) {
        var a = mnNav.querySelector('a[href="' + page + '"]');
        /* 已經包在 .pr-navhead 裡的就是目前這一頁 —— 它本來就有清單與箭頭 */
        if (!a || (a.parentNode && a.parentNode.classList.contains('pr-navhead'))) return;

        var head = document.createElement('div');
        head.className = 'pr-navhead navsub-xhead';
        a.parentNode.insertBefore(head, a);
        head.appendChild(a);

        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pr-toggle navsub-xbtn';
        head.appendChild(b);

        var ul = document.createElement('ul');
        ul.className = 'pr-sidenav navsub-x';
        ul.id = 'navsub-' + page.replace(/[^a-z0-9]+/gi, '-');
        ul.hidden = true;
        b.setAttribute('aria-controls', ul.id);
        mnSubs[page].forEach(function (it) {
          var li = document.createElement('li');
          var link = document.createElement('a');
          /* ⚠️ 錨點要帶上頁名：這是**別頁**的章節，只寫 #pr-3 會跳到本頁的同名
             錨點（多半不存在），看起來就是「按了沒反應」。 */
          link.href = page + it[0];
          link.textContent = it[1];
          li.appendChild(link);
          ul.appendChild(li);
        });
        head.parentNode.insertBefore(ul, head.nextSibling);

        var paint = function (open) {
          ul.hidden = !open;
          b.setAttribute('aria-expanded', String(open));
          b.setAttribute('aria-label', (open ? '收合' : '展開') + a.textContent.trim() + '的章節');
          b.title = b.getAttribute('aria-label');
        };
        paint(false);
        b.addEventListener('click', function () { paint(ul.hidden); });
      });
      /* 剛長出來的字沒經過繁簡轉換，選「简」的時候會夾著幾條繁體 */
      if (window.AiPhaBiSite) window.AiPhaBiSite.localize(mnNav);
    }

    function mnDropSubs() {
      if (!mnSubsBuilt) return;
      mnSubsBuilt = false;
      [].forEach.call(mnNav.querySelectorAll('.navsub-x'), function (ul) {
        ul.parentNode.removeChild(ul);
      });
      [].forEach.call(mnNav.querySelectorAll('.navsub-xhead'), function (h) {
        var a = h.querySelector('a');
        if (a) h.parentNode.insertBefore(a, h);
        h.parentNode.removeChild(h);
      });
    }

    function mnEnsureSubs() {
      if (!mnQuery.matches || mnSubsBuilt) return;
      if (mnSubs) { mnBuildSubs(); return; }
      if (mnSubsFetching) return;
      mnSubsFetching = true;
      fetch('assets/nav.json')
        .then(function (r) { return r.json(); })
        .then(function (d) { mnSubs = d; if (mnQuery.matches) mnBuildSubs(); })
        .catch(function () { /* 抓不到就維持原樣：每一條連結照樣點得動 */ });
    }

    /* 收起來要**演完再消失**：display 從 flex 變 none 是不能過渡的，所以關閉時
       先掛 nav-closing（版面還在、播反向動畫），動畫跑完才真的收掉。
       ⚠️ 一定要接 animationend 之外的保險：動畫被 prefers-reduced-motion 關掉時
       animationend 不會發，選單就永遠卡在「正在關」的狀態。所以那種情況直接收。 */
    var mnReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    function mnSet(open, skipAnim) {
      if (open) {
        mnBar.classList.remove('nav-closing');
        mnBar.classList.add('nav-open');
        mnEnsureSubs();
      } else if (mnBar.classList.contains('nav-open')) {
        mnBar.classList.remove('nav-open');
        if (!mnReduced.matches && !skipAnim) {
          mnBar.classList.add('nav-closing');
          var done = function () {
            mnBar.classList.remove('nav-closing');
            mnNav.removeEventListener('animationend', done);
          };
          mnNav.addEventListener('animationend', done);
        }
      }
      mnBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      mnBtn.setAttribute('aria-label', open ? '關閉選單' : '選單');
    }

    mnBtn.addEventListener('click', function () {
      mnSet(!mnBar.classList.contains('nav-open'));
    });

    /* 點了連結就關 —— 同一頁裡的錨點（章節清單）不會重新載入頁面，
       選單留在原地擋著內容的話，等於點了沒反應。 */
    mnNav.addEventListener('click', function (e) {
      /* 只有連結才關 —— 字級那一組現在也住在選單裡，按「大」之後選單就消失的話
         沒辦法連按兩下比較大小。 */
      if (e.target.closest('a')) mnSet(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mnBar.classList.contains('nav-open')) {
        mnSet(false);
        mnBtn.focus();
      }
    });

    /* 點選單以外的地方就關。用 pointerdown 而不是 click：click 要等手指離開，
       在捲動的頁面上常常不會發生。 */
    document.addEventListener('pointerdown', function (e) {
      if (!mnBar.classList.contains('nav-open')) return;
      if (!mnBar.contains(e.target)) mnSet(false);
    });

    /* 「字級」那一組**留在頁首那一列**，不搬進選單（Wilson 2026-09-03：
       「the font size S/M/L toggle should be outside the burger menu, just like
       the trad/simp toggle」）。
       它本來是搬進去的，理由是量到的寬度：品牌 143px ＋ 兩組切換 181px ＋
       漢堡 44px ＋ 內距與間隔 59px ＝ 427px，而視窗只有 390px。現在改成把那
       84px 從別的地方省出來（見 site.css 第 18 節）：手機上收掉品牌的英文
       字樣與「字級」兩個字的標籤，間隔從 .75rem 收到 .45rem。
       ⚠️ 頁首那一列在手機上同時改成可以換行 —— 省下來的寬度在 390px 上綽綽
       有餘，但更窄的機器（或使用者把系統字級調大）擠不下時，寧可讓控制項
       整組掉到第二列，也不要像上次那樣把整頁撐寬 19px。 */
    function mnPlaceSize() {
      /* 把手永遠是選單的最後一個子元素 —— 它是「這一片可以往上收」的提示，
         夾在連結中間會被讀成分隔線。 */
      if (mnGrab.parentNode === mnNav) mnNav.appendChild(mnGrab);
    }
    mnPlaceSize();

    /* 轉成寬螢幕（轉橫、或桌機縮放）時把狀態收掉 —— 留著 nav-open 不會怎樣，
       但轉回窄螢幕時選單會自己是開的，那不是使用者按的。 */
    var mnOnChange = function () {
      mnPlaceSize();
      if (!mnQuery.matches) { mnSet(false); mnDropSubs(); }
    };
    if (mnQuery.addEventListener) mnQuery.addEventListener('change', mnOnChange);
    else if (mnQuery.addListener) mnQuery.addListener(mnOnChange);

    /* ---------- 手機版：麵包屑（Wilson 2026-09-03）----------
       「it should show on the top like Home / Page / Subpage bar so people can
       see where they are in the tree, and these should also be clickable」。
       收成漢堡選單之後，「我在整個網站的哪裡」這件事只有打開選單才看得到；
       這一條把它擺回頁面最上面。

       ⚠️ 四個層級都要按得動，但按下去的意思不一樣：
         首頁    → 真的是一頁，直接連過去
         分組    → **不是一頁**（基礎學習／流暢模式／體驗工具沒有自己的頁面，
                   這是刻意的，見 .nav-sec-t 的說明），所以它打開選單，
                   而不是假裝連到一個不存在的網址
         本頁    → 捲回頁首（連到自己會整頁重載，那是白花一次載入）
         本節    → 也是打開選單（選單裡就是這一頁的章節清單，可以跳到別節）
       ⚠️ 每一格的字都從**現成的 DOM** 抄，不要另外寫一份：抄過來的已經是使用者
       選的繁／簡，也不會跟導覽的用詞各講各的。 */
    /* 麵包屑要黏在頁首**底下**，而頁首那一列的高度不是固定的：字級調大、或是
       螢幕窄到控制項掉第二列（見 site.css 第 18 節），它就會變高。量出來寫進
       一個 CSS 變數，CSS 那邊拿 var() 用。
       ⚠️ 選單打開時 <nav> 也在 .topbar 裡面，這時量到的是「頁首＋整片選單」——
       所以開著的時候不量，維持上一次的值。 */
    function mnTopH() {
      if (mnBar.classList.contains('nav-open') || mnBar.classList.contains('nav-closing')) return;
      var h = mnBar.getBoundingClientRect().height;
      if (h > 0) document.documentElement.style.setProperty('--topbar-h', h.toFixed(1) + 'px');
    }
    mnTopH();
    if (window.ResizeObserver) new ResizeObserver(mnTopH).observe(mnBar);
    window.addEventListener('resize', mnTopH, { passive: true });

    var bcCur = null;
    [].forEach.call(mnNav.querySelectorAll('a[aria-current="page"]'), function (a) {
      if (!a.closest('.pr-sidenav')) bcCur = a;
    });
    var bcMain = document.querySelector('main');
    if (bcCur && bcMain && !/(^|\/)index\.html$/.test(bcCur.getAttribute('href') || '')) {
      var bc = document.createElement('nav');
      bc.className = 'crumbs';
      bc.setAttribute('aria-label', '所在位置');

      var bcHome = document.createElement('a');
      bcHome.href = 'index.html';
      bcHome.textContent = '首頁';
      bc.appendChild(bcHome);

      var bcSec = bcCur.closest('.nav-sec');
      var bcSecT = bcSec && bcSec.querySelector('.nav-sec-t');
      if (bcSecT) {
        var bcGrp = document.createElement('button');
        bcGrp.type = 'button';
        bcGrp.className = 'crumb-btn';
        bcGrp.textContent = bcSecT.textContent;
        bcGrp.addEventListener('click', function () { mnSet(true); });
        bc.appendChild(bcGrp);
      }

      var bcSelf = document.createElement('a');
      bcSelf.href = bcCur.getAttribute('href');
      bcSelf.textContent = bcCur.textContent.trim();
      bcSelf.addEventListener('click', function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      /* 「你在這裡」那一格用 class 標，不用 :last-child —— 第四格只是 hidden，
         它仍然是最後一個子元素，靠 :last-child 的話捲到頁頂時整條都沒有重點色。 */
      bcSelf.className = 'crumb-tail';
      bc.appendChild(bcSelf);

      /* 第四格：目前捲到哪一節。只有本來就有章節清單的那六頁才有。 */
      var bcNow = null;
      if (sub) {
        bcNow = document.createElement('button');
        bcNow.type = 'button';
        bcNow.className = 'crumb-btn crumb-now';
        bcNow.hidden = true;
        bcNow.addEventListener('click', function () { mnSet(true); });
        bc.appendChild(bcNow);
      }

      bcMain.insertBefore(bc, bcMain.firstChild);

      /* 第四格跟側邊欄的高亮共用同一份捲動偵測（見上面的 spyWatch），
         不再自己跑一輪一樣的迴圈。 */
      if (bcNow) {
        spyWatch(function (hit) {
          if (hit) {
            var t = hit.a.textContent.trim();
            if (bcNow.textContent !== t) bcNow.textContent = t;
            bcNow.hidden = false;
            bcNow.classList.add('crumb-tail');
            bcSelf.classList.remove('crumb-tail');
          } else {
            bcNow.hidden = true;
            bcNow.classList.remove('crumb-tail');
            bcSelf.classList.add('crumb-tail');
          }
        });
      }
    }
  }

  /* 給試打頁用：候選字是後來才畫上去的，畫完要跟著轉 */
  window.AiPhaBiSite = {
    localize: function (root) { if (current() === 'simp' && t2s) toSimplified(root); }
  };

  /* ---------- Vercel Web Analytics ----------
     `/_vercel/insights/script.js` 是 Vercel 邊緣自己生出來的路徑，**只有 Vercel
     服務的網域上有**。GitHub Pages 那一份（專案站，掛在 /AiPhaBi/ 底下）和本機
     預覽都會 404，所以先看網域再決定要不要載入 —— 不然每一頁都在主控台噴一行紅字。

     ⚠️ 為什麼寫在這裡而不是十二份 HTML 的 <head>：十二頁全都載入 site.js，寫在
     這裡只有一處要維護，而且才有地方擺上面那個網域判斷。頁與頁之間是**整頁換頁**
     （不是單頁應用），所以每次導覽本來就是一次新的載入 ＝ 一次瀏覽紀錄，
     不需要自己接管路由事件。

     只有 Vercel 預設的瀏覽計數，不送自訂事件、不帶任何識別碼。 */
  var vaHost = location.hostname;
  if (/(^|\.)aiphabi\.com$/.test(vaHost) || /(^|\.)vercel\.app$/.test(vaHost)) {
    var vaTag = document.createElement('script');
    vaTag.defer = true;
    vaTag.src = '/_vercel/insights/script.js';
    document.head.appendChild(vaTag);
  }
})();
