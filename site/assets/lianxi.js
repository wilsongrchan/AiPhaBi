/* 字根練習 —— 一次一條字根，把它在字裡的筆畫標出來，問「像哪個英文字母」。
 *
 * 為什麼要有這一頁：〈字根表〉是拿來查的。字根一路捲到底，看完不等於認得。
 * 這一頁把同一張表**翻過來**用 —— 先給形狀，問字母，答完才講取形意圖。
 * （Wilson 2026-09-01：首頁再多一顆「我想學習更多字根」。）
 *
 * ⚠️ **考哪幾條字根是 Wilson 手挑的**，不是整張字根表（366 條全部拿來出題太多，
 * 他 2026-09-01 說得很清楚）。清單在 `site/content/lianxi.md`，建置時對回
 * zigen.json 產生 assets/lianxi.json。這支只讀那份清單，**不自己決定要考什麼**。
 *
 * 資料全部來自站上已經有的檔，這一頁**不另外產一份字根資料**：
 *   assets/lianxi.json  考哪幾條（手挑）
 *   assets/zigen.json   字母 → 取形意圖 → 字根形狀 → 例字（含哪幾筆屬於這條字根）
 *   assets/glyphs.json  例字的筆畫輪廓（Arphic PL，出處見頁尾）
 * 好處不只是省一個建置步驟：出題內容跟〈字根表〉保證一模一樣，字根表改了這裡
 * 隔天就跟著改；而且 glyphs.json 跟〈字根表〉是同一個網址，先逛過字根表再過來
 * 是直接命中瀏覽器快取。
 * ⚠️ 絕對不要在這支裡手寫任何一條「某某字根是某字母」——那是這個專案最會過期
 * 的東西（見 CLAUDE.md）。哪幾筆屬於哪一條字根也一樣，是建置時算好寫在
 * zigen.json 的 ex[].st 裡的。
 *
 * ⚠️ glyphbox.js 要排在這支**前面**載入（田字格、字根圖示、字根位置都在那裡）。
 */
(function () {
  'use strict';

  var stage = document.getElementById('xz-glyph');
  if (!stage) return;

  var ZG = window.ZG || {};
  var NS = 'http://www.w3.org/2000/svg';
  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var loadingEl = document.getElementById('xz-loading');
  var gameEl = document.getElementById('xz-game');
  var optsEl = document.getElementById('xz-opts');
  var prevBtn = document.getElementById('xz-prev');
  var skipBtn = document.getElementById('xz-skip');
  var padEl = document.getElementById('xz-pad');
  var revealEl = document.getElementById('xz-reveal');
  var hintBtn = document.getElementById('xz-hint');
  var showBtn = document.getElementById('xz-show');
  var nextBtn = document.getElementById('xz-next');
  var resetBtn = document.getElementById('xz-reset');
  var verdictEl = document.getElementById('xz-verdict');
  var keyEl = document.getElementById('xz-key');
  var descEl = document.getElementById('xz-desc');
  var srcIconEl = document.getElementById('xz-srcicon');
  var srcTextEl = document.getElementById('xz-srctext');
  var codeEl = document.getElementById('xz-code');
  var linkEl = document.getElementById('xz-link');
  var doneEl = document.getElementById('xz-done');
  var totalEl = document.getElementById('xz-total');
  var streakEl = document.getElementById('xz-streak');
  var fillEl = document.getElementById('xz-fill');
  var creditEl = document.getElementById('zg-credit');

  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  /* 字母的長相跟首頁的拆件動畫對齊（見 assets/landing.js 開頭那一整段）：
     一般字重、只有 J 單獨用 Verdana ——那套字型的 J 頂端天生帶一橫，而愛發筆的
     J 字根正是那個形狀。兩頁講的是同一件事，字母就不該長得不一樣。 */
  var LETTER_FONT = 'sans-serif';
  var LETTER_FONT_J = "Verdana, Tahoma, 'DejaVu Sans', sans-serif";
  function fontFor(letter) { return letter === 'J' ? LETTER_FONT_J : LETTER_FONT; }

  var OK_KEY = 'aiphabi-lianxi-ok';       // 已經一次答對的字根
  var OPT_KEY = 'aiphabi-lianxi-opt';     // 出題順序

  var DATA = null, GLYPHS = null, PICKS = null, MAIN = null, mainState = null;
  var POOL = [];
  var mastered = {};
  var opts = { order: 'common' };
  var cur = null;           // { q: 字根, ex: 這一題用的例字 }
  var answered = false, missed = false, hinted = false;
  var streak = 0;
  var lastKey = '';
  var keyBtns = {};
  /* 出過的題目留一份，「上一題」才回得去（Wilson 2026-09-01）。存的是整個
     {q, ex} 加上當時揭曉了沒 —— 回頭看的人多半是想再看一眼剛才的答案，
     重新問一次等於把他要的東西收走。 */
  var history = [], histPos = -1;

  /* ---------- 存下來的東西 ---------- */

  function loadState() {
    try {
      var raw = localStorage.getItem(OK_KEY);
      if (raw) {
        JSON.parse(raw).forEach(function (k) { mastered[k] = 1; });
      }
      var o = localStorage.getItem(OPT_KEY);
      if (o) {
        o = JSON.parse(o);
        if (o.order === 'random' || o.order === 'common') opts.order = o.order;
      }
    } catch (e) { /* 無痕模式：這一輪照樣練得起來，只是不會記住 */ }
  }
  function saveOk() {
    try { localStorage.setItem(OK_KEY, JSON.stringify(Object.keys(mastered))); }
    catch (e) {}
  }
  function saveOpts() {
    try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (e) {}
  }

  /* ---------- 題庫 ----------
     一條字根＝一題。同一條字根底下的幾個例字是同一題的不同問法，隨機挑一個。
     ⚠️ 例字挑的時候**避開取自字本身**（夕 這一條的例字第一個就是 夕）：整個字
     就是這條字根的時候畫面上一筆灰的都沒有，看不出「這是字裡的一部分」，而那正
     是要練的事。只有這條字根找不到別的例字時才用它。 */
  function buildPool() {
    // 手挑的清單（assets/lianxi.json）決定考哪幾條。查表用 key，跟建置那邊
    // 產生的字串是同一個寫法：字母|取自字|筆序範圍。
    var want = {};
    (PICKS || []).forEach(function (k) { want[k] = 1; });
    var out = [];
    DATA.letters.forEach(function (L) {
      L.groups.forEach(function (g) {
        g.shapes.forEach(function (sh) {
          if (!want[L.letter + '|' + (sh.src || '') + '|' + (sh.span || '')]) return;
          var ex = (sh.ex || []).filter(function (e) {
            return e.st && e.st.length && GLYPHS[e.c];
          });
          if (!ex.length) return;
          out.push({
            L: L.letter,
            desc: (g.desc || '').trim(),
            note: (g.note || '').trim(),
            src: sh.src || '',
            // st＝這條字根在取自字裡的哪幾筆（建置時算好的）。⚠️ 不要拿 span 回推：
            // span 是給人讀的字串，多數是「1–3」，但也有「1、2、6」「1、11」這種
            // 不連續的（實測 366 條裡有 7 條），解析它遲早會解錯。
            st: sh.st || [],
            span: sh.span || '',
            count: sh.count || 0,
            ex: ex,
            key: L.letter + '|' + (sh.src || '') + '|' + (sh.span || '')
          });
        });
      });
    });
    return out;
  }

  function pickQuestion() {
    var pool = POOL;
    if (!pool.length) return null;
    var left = pool.filter(function (q) { return !mastered[q.key]; });
    // 全部答對過就整池重來一輪（不清紀錄——進度條照樣是滿的）
    var list = left.length ? left : pool;
    if (list.length > 1) {
      list = list.filter(function (q) { return q.key !== lastKey; });
    }
    var q;
    if (opts.order === 'random') {
      q = list[Math.floor(Math.random() * list.length)];
    } else {
      // 由常見到少見：count 是這條字根在全部取碼字裡出現幾次，先練用得多的
      q = list.reduce(function (a, b) { return b.count > a.count ? b : a; }, list[0]);
    }
    var pool2 = q.ex.filter(function (e) { return e.c !== q.src; });
    var exList = pool2.length ? pool2 : q.ex;
    return { q: q, ex: exList[Math.floor(Math.random() * exList.length)] };
  }

  /* ---------- 畫題目 ----------
     屬於這條字根的筆畫上色、其餘塗淺 —— 跟〈字根表〉字例欄同一套顏色語言
     （--zg-on／--zg-off），同一個字根在一個字裡出現兩次時第二次用深一階，
     不然會被當成「這條字根就是這一整塊」。 */
  function paintQuestion(ex) {
    var strokes = GLYPHS[ex.c];
    var segs = (ex.segs && ex.segs.length) ? ex.segs : [ex.st];
    var shade = {};
    segs.forEach(function (g, gi) {
      g.forEach(function (i) { shade[i] = Math.min(gi + 1, 3); });
    });
    // 沒被選中的先畫完，選中的才畫 —— 照筆順混著畫的話，序號較後的淺色筆畫會
    // 蓋在高亮的筆畫上面（跟〈字根表〉exampleGlyph 同一個坑）。
    var off = '', on = '';
    for (var i = 0; i < strokes.length; i++) {
      if (shade[i]) on += '<path class="xz-on xz-on-' + shade[i] + '" d="' + strokes[i] + '"/>';
      else off += '<path class="xz-dim" d="' + strokes[i] + '"/>';
    }
    stage.classList.remove('is-revealed');
    stage.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="字例">' +
      ZG.GRID + '<g transform="' + ZG.TF + '">' + off + on + '</g></svg>';
  }

  /* 揭曉時把字母疊在字根**正上方**：位置是從那幾筆真正的座標算出來的
     （ZG.rootBox），不是目測擺中間。字根的筆畫同時淡下去 —— 讀起來是
     「這幾筆就是這個字母」，跟首頁那段拆件動畫講的是同一件事，只是反過來。 */
  function overlayLetter(q, ex) {
    var svg = stage.querySelector('svg');
    if (!svg || !ZG.rootBox) return;
    var box = ZG.rootBox(GLYPHS[ex.c], ex.st);
    if (!box) return;
    var span = Math.max(box.w, box.h);
    // 字母大約蓋住字根，但不讓它小到看不清、也不讓它撐出田字格
    var size = Math.max(220, Math.min(560, span * 1.3));
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'xz-letter');
    g.style.transformOrigin = box.cx.toFixed(1) + 'px ' + box.cy.toFixed(1) + 'px';
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', box.cx.toFixed(1));
    t.setAttribute('y', box.cy.toFixed(1));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-family', fontFor(q.L));
    t.setAttribute('font-weight', '400');
    t.setAttribute('font-size', size.toFixed(0));
    t.textContent = q.L;
    g.appendChild(t);
    svg.appendChild(g);
    stage.classList.add('is-revealed');
    if (REDUCED) { g.classList.add('is-in'); return; }
    svg.getBoundingClientRect();            // 逼一次重排，不然過渡不會跑
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { g.classList.add('is-in'); });
    });
  }

  /* ---------- 字母鍵盤 ---------- */
  function buildPad() {
    padEl.textContent = '';
    ALPHA.forEach(function (L) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'xz-key';
      b.textContent = L;
      b.setAttribute('data-keep', '');
      b.addEventListener('click', function () { answer(L); });
      padEl.appendChild(b);
      keyBtns[L] = b;
    });
  }

  function resetPad() {
    ALPHA.forEach(function (L) {
      var b = keyBtns[L];
      b.className = 'xz-key';
      b.disabled = false;
    });
  }

  /* ---------- 一題的流程 ---------- */

  /* 把一題擺上畫面。fresh＝這是新出的題（可以計分）；從歷史回頭看的那一題
     已經計過分了，再算一次會讓進度條和連續數字自己長大。 */
  function show(item, fresh) {
    cur = item;
    lastKey = item.q.key;
    answered = false;
    missed = false;
    hinted = false;
    resetPad();
    revealEl.hidden = true;
    hintBtn.disabled = false;
    showBtn.disabled = false;
    hintBtn.hidden = false;
    showBtn.hidden = false;
    nextBtn.hidden = true;
    paintQuestion(item.ex);
    // 之前已經看過答案的那一題，回頭時直接把答案再攤開來 —— 會按「上一題」的人
    // 多半是想再看一眼剛才那條字根，重問一次等於把他要的東西收走。
    if (!fresh && item.revealed) reveal(item.right, true);
    paintNav();
  }

  function paintNav() {
    prevBtn.disabled = histPos <= 0;
  }

  /* 下一題／跳過是同一件事：往前走一格。之前按過「上一題」的話，往前是回到
     已經出過的那幾題（不重抽），走到頭才抽新的。 */
  function nextQuestion() {
    if (histPos < history.length - 1) {
      histPos++;
      show(history[histPos], false);
      return;
    }
    var pick = pickQuestion();
    if (!pick) return;
    history.push(pick);
    histPos = history.length - 1;
    show(pick, true);
  }

  function prevQuestion() {
    if (histPos <= 0) return;
    histPos--;
    show(history[histPos], false);
  }

  function answer(L) {
    if (answered || !cur) return;
    if (L === cur.q.L) { reveal(true); return; }
    // 答錯：那顆鍵留在畫面上但按不動（同一個字母不用再試一次），連續歸零。
    // 不直接公布答案 —— 還可以再猜，這一題只是不算「學會了」。
    var b = keyBtns[L];
    if (b) { b.classList.add('is-wrong'); b.disabled = true; }
    missed = true;
    streak = 0;
    paintScore();
  }

  /* 提示：把選項收成四個字母（正解＋三個隨機）。用過提示這一題就不算學會 —— 不然
     進度條會虛報，而虛報的進度條比沒有進度條還糟。 */
  function hint() {
    if (answered || !cur || hinted) return;
    hinted = true;
    hintBtn.disabled = true;
    var keep = { };
    keep[cur.q.L] = 1;
    var others = ALPHA.filter(function (L) {
      return L !== cur.q.L && !keyBtns[L].classList.contains('is-wrong');
    });
    for (var i = 0; i < 3 && others.length; i++) {
      keep[others.splice(Math.floor(Math.random() * others.length), 1)[0]] = 1;
    }
    ALPHA.forEach(function (L) {
      if (!keep[L]) { keyBtns[L].classList.add('is-dim'); keyBtns[L].disabled = true; }
    });
  }

  function reveal(right, replay) {
    if (answered || !cur) return;
    answered = true;
    var q = cur.q, ex = cur.ex;

    ALPHA.forEach(function (L) { keyBtns[L].disabled = true; });
    keyBtns[q.L].classList.remove('is-dim');
    keyBtns[q.L].classList.add('is-right');

    // ⚠️ replay＝從「上一題」回頭看已經答過的那一題，**不能再計一次分**：
    // 記過的字根不會重複記，但連續數字會一路自己長大。
    if (!replay) {
      cur.revealed = true;
      cur.right = right && !missed;
      if (right && !missed && !hinted && !mastered[q.key]) {
        mastered[q.key] = 1;
        saveOk();
      }
      streak = right && !missed ? streak + 1 : 0;
      paintScore();
    }

    verdictEl.textContent = right
      ? (missed ? '對了 —— 這一條再看一眼' : '答對了')
      : '答案是';
    verdictEl.className = 'xz-verdict ' + (right && !missed ? 'is-right' : 'is-plain');

    keyEl.textContent = q.L;
    descEl.textContent = q.desc || '（取形意圖待補）';
    if (!q.desc) descEl.classList.add('is-todo');
    else descEl.classList.remove('is-todo');

    srcIconEl.innerHTML = '';
    var icon = ZG.rootIcon && GLYPHS[q.src] && q.st.length
      ? ZG.rootIcon(GLYPHS[q.src], q.st) : null;
    if (icon) srcIconEl.innerHTML = icon;
    srcTextEl.textContent = '取自「' + q.src + '」' +
      (q.span === 'whole' ? '整個字' : '第 ' + q.span + ' 筆');

    codeEl.textContent = '例字「' + ex.c + '」';
    loadMain(function () {
      if (cur && cur.ex === ex) {
        var code = MAIN && MAIN[ex.c];
        codeEl.textContent = '例字「' + ex.c + '」' + (code ? '　' + code.toUpperCase() : '');
      }
    });

    // 錨點裡有中文（ZA-夕-whole），一定要編碼過再放進網址
    linkEl.href = 'zigen.html#' +
      encodeURIComponent('Z' + q.L + '-' + q.src + '-' + q.span);

    overlayLetter(q, ex);
    revealEl.hidden = false;
    /* 「提示／看答案」換成「下一題」—— 同一排、同一個位置。⚠️ 不要用「收掉那一排
       再把下一題放到別處」的做法：底下整塊會往上跳，而使用者的游標正停在剛按下的
       那顆字母鍵上，下一個畫面跑到那個位置的是別的東西。〈取碼原則〉頁的「川」字
       示範踩過同一個坑（Wilson 的朋友回報「按著按著按鈕會自己跑掉」）。 */
    hintBtn.hidden = true;
    showBtn.hidden = true;
    nextBtn.hidden = false;
    // 揭曉那一段是現生出來的文字，簡體模式下要自己補轉一次
    if (window.AiPhaBiSite) window.AiPhaBiSite.localize(revealEl);
    /* ⚠️ focus() 預設會把畫面捲到那顆按鈕上 —— 在桌機上整頁會突然往下跳一大段，
       而題目和字母鍵本來就都看得到（實測捲了 646px）。所以焦點照給（鍵盤操作要
       用），捲動交給 block: 'nearest'：已經看得到就完全不動，被切掉才捲最少的量。 */
    nextBtn.focus({ preventScroll: true });
    revealEl.scrollIntoView({ block: 'nearest' });
  }

  function loadMain(after) {
    if (mainState === 'ready') { after && after(); return; }
    if (mainState === 'loading') return;
    mainState = 'loading';
    fetch('assets/dict.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { MAIN = d.main || null; mainState = 'ready'; after && after(); })
      .catch(function () { mainState = null; });   // 失敗就下次再試，不擋練習
  }

  /* ---------- 進度 ---------- */
  function paintScore() {
    var pool = POOL;
    var done = 0;
    pool.forEach(function (q) { if (mastered[q.key]) done++; });
    doneEl.textContent = done;
    totalEl.textContent = pool.length;
    streakEl.textContent = streak;
    fillEl.style.width = pool.length ? (done / pool.length * 100).toFixed(1) + '%' : '0';
  }

  /* ---------- 設定 ---------- */
  function bindOpts() {
    document.querySelectorAll('input[name="xzorder"]').forEach(function (r) {
      r.checked = r.value === opts.order;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        opts.order = r.value;
        saveOpts();
      });
    });
    resetBtn.addEventListener('click', function () {
      // 進度是使用者自己累積的東西，砍掉之前先問一聲
      if (!window.confirm('清掉練習紀錄？答對過的字根會全部重來。')) return;
      mastered = {};
      streak = 0;
      saveOk();
      paintScore();
      history = [];
      histPos = -1;
      nextQuestion();
    });
  }

  hintBtn.addEventListener('click', hint);
  showBtn.addEventListener('click', function () { reveal(false); });
  nextBtn.addEventListener('click', nextQuestion);
  skipBtn.addEventListener('click', nextQuestion);
  prevBtn.addEventListener('click', prevQuestion);

  // 實體鍵盤：直接按字母作答，答完按 Enter／空白鍵換下一題。輸入框在這一頁
  // 一個都沒有，所以不必擔心搶走誰的按鍵。
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!cur) return;
    if (!answered && /^[a-zA-Z]$/.test(e.key)) {
      answer(e.key.toUpperCase());
      e.preventDefault();
      return;
    }
    if (answered && (e.key === 'Enter' || e.key === ' ')) {
      nextQuestion();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft') { prevQuestion(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { nextQuestion(); e.preventDefault(); }
  });

  /* ---------- 起手 ----------
     兩個檔都到齊才開得了場：沒有 zigen.json 沒有題目，沒有 glyphs.json 畫不出
     字根 —— 這一頁的題目**就是**那張圖，退不回文字版（〈字根表〉可以，因為那裡
     的圖只是輔助）。所以載入中就老老實實說在載入。 */
  loadState();
  buildPad();
  bindOpts();

  Promise.all([
    fetch('assets/zigen.json').then(function (r) { return r.json(); }),
    fetch('assets/glyphs.json').then(function (r) { return r.json(); }),
    fetch('assets/lianxi.json').then(function (r) { return r.json(); })
  ]).then(function (got) {
    DATA = got[0];
    GLYPHS = (got[1] && got[1].glyphs) || null;
    PICKS = (got[2] && got[2].picks) || [];
    if (!DATA || !GLYPHS) throw new Error('no data');
    POOL = buildPool();
    if (!POOL.length) {
      // 一條都沒挑，或挑的那幾條都沒有可用的例字 —— 這不是壞掉，是還沒挑，
      // 所以講清楚是哪一種，不要丟一個「載入失敗」讓人去猜。
      loadingEl.textContent = '還沒挑要考哪幾條字根（site/content/lianxi.md）。';
      return;
    }
    loadingEl.hidden = true;
    gameEl.hidden = false;
    optsEl.hidden = false;
    if (creditEl) creditEl.hidden = false;
    paintScore();
    nextQuestion();
  }).catch(function () {
    loadingEl.textContent =
      '字根資料載入失敗。本機預覽請先跑 python3 site/tools/build_site_data.py。';
  });
})();
