/* 字根練習 —— 一次一條字根，把它在字裡的筆畫標出來，問「像哪個英文字母」。
 *
 * 為什麼要有這一頁：〈字根表〉是拿來查的。字根一路捲到底，看完不等於認得。
 * 這一頁把同一張表**翻過來**用 —— 先給形狀，問字母，答完才講取形意圖。
 * （Wilson 2026-09-01：首頁再多一顆「我想學習更多字根」。）
 *
 * ⚠️ **用哪個字出題、考它的哪幾條字根，全部是 Wilson 手挑的**，寫在
 * `site/content/lianxi.md`（`檢 = A O` 這種一行一個字的格式）。建置時對回
 * codes.json 算出「那條字根是哪幾筆」、比對出取形意圖，產生 assets/lianxi.json。
 * 這支只讀那一份，**自己不決定要考什麼、也不自己配例字**。
 *
 * 因此這一頁只抓一個檔（20 KB 上下）：題目、筆畫輪廓、碼、取形意圖都在裡面。
 * 早期版本是自己讀 zigen.json ＋ glyphs.json（3.4 MB）現配例字 —— 那個做法連
 * 「考哪幾條」都是自己決定的，不是 Wilson 要的東西。
 *
 * ⚠️ 絕對不要在這支裡手寫任何一條「某某字根是某字母」——那是這個專案最會過期
 * 的東西（見 CLAUDE.md）。
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
  var padEl = document.getElementById('xz-pad');
  var nudgeEl = document.getElementById('xz-nudge');
  var revealEl = document.getElementById('xz-reveal');
  var hintBtn = document.getElementById('xz-hint');
  var showBtn = document.getElementById('xz-show');
  var nextBtn = document.getElementById('xz-next');
  var prevBtn = document.getElementById('xz-prev');
  var skipBtn = document.getElementById('xz-skip');
  var resetBtn = document.getElementById('xz-reset');
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

  // 猜錯幾次就直接把答案攤開（Wilson）。一直猜不到還讓人繼續猜下去，
  // 練的就不是字根而是耐性了。
  var MAX_WRONG = 3;

  var OK_KEY = 'aiphabi-lianxi-ok';       // 已經一次答對的題目

  var GLYPHS = null;
  var POOL = [];
  var mastered = {};
  var cur = null;           // 目前這一題（POOL 裡的一筆，外加 revealed/right）
  var answered = false, hinted = false, wrong = 0;
  var streak = 0;
  var lastKey = '';
  var keyBtns = {};
  /* 出過的題目留一份，「上一題」才回得去（Wilson 2026-09-01）。回頭看的人多半是
     想再看一眼剛才的答案，所以連「當時揭曉了沒」一起記，重新問一次等於把他要的
     東西收走。 */
  var history = [], histPos = -1;

  function keyOf(q) { return q.c + '|' + q.L; }

  /* ---------- 存下來的東西 ---------- */

  function loadState() {
    try {
      var raw = localStorage.getItem(OK_KEY);
      if (raw) JSON.parse(raw).forEach(function (k) { mastered[k] = 1; });
    } catch (e) { /* 無痕模式：這一輪照樣練得起來，只是不會記住 */ }
  }
  function saveOk() {
    try { localStorage.setItem(OK_KEY, JSON.stringify(Object.keys(mastered))); }
    catch (e) {}
  }

  /* ---------- 挑題目 ----------
     沒答對過的優先，全部答對過就整池重來一輪（不清紀錄——進度條照樣是滿的）。
     連續兩題不會撞同一題。 */
  function pickQuestion() {
    if (!POOL.length) return null;
    var left = POOL.filter(function (q) { return !mastered[keyOf(q)]; });
    var list = left.length ? left : POOL;
    if (list.length > 1) {
      list = list.filter(function (q) { return keyOf(q) !== lastKey; });
    }
    var q = list[Math.floor(Math.random() * list.length)];
    return { q: q };
  }

  /* ---------- 畫題目 ----------
     屬於這條字根的筆畫上色、其餘塗淺 —— 跟〈字根表〉字例欄同一套顏色語言
     （--zg-on／--zg-off）。同一條字根在一個字裡出現兩次（檢 的兩個 O）時第二處
     用深一階，不然會被當成「這條字根就是這一整塊」。 */
  function paintQuestion(q) {
    var strokes = GLYPHS[q.c] || [];
    var shade = {};
    q.g.forEach(function (grp, gi) {
      grp.forEach(function (i) { shade[i] = Math.min(gi + 1, 3); });
    });
    // 沒被選中的先畫完，選中的才畫 —— 照筆順混著畫的話，序號較後的淺色筆畫會
    // 蓋在高亮的筆畫上面（跟〈字根表〉exampleGlyph 同一個坑）。
    var off = '', on = '';
    for (var i = 0; i < strokes.length; i++) {
      if (shade[i]) on += '<path class="xz-on xz-on-' + shade[i] + '" d="' + strokes[i] + '"/>';
      else off += '<path class="xz-dim" d="' + strokes[i] + '"/>';
    }
    stage.classList.remove('is-revealed');
    stage.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="題目">' +
      ZG.GRID + '<g transform="' + ZG.TF + '">' + off + on + '</g></svg>';
  }

  /* 揭曉時把字母疊在字根**正上方**：位置是從那幾筆真正的座標算出來的
     （ZG.rootBox），不是目測擺中間。字根的筆畫同時淡下去 —— 讀起來是
     「這幾筆就是這個字母」，跟首頁那段拆件動畫講的是同一件事，只是反過來。
     出現兩次的字根**兩處各疊一個**，那正是「這兩塊都是 O」要講的事。 */
  function overlayLetter(q) {
    var svg = stage.querySelector('svg');
    if (!svg || !ZG.rootBox) return;
    var strokes = GLYPHS[q.c] || [];
    q.g.forEach(function (grp) {
      var box = ZG.rootBox(strokes, grp);
      if (!box) return;
      var span = Math.max(box.w, box.h);
      // 字母大約蓋住字根，但不讓它小到看不清、也不讓它撐出田字格
      var size = Math.max(180, Math.min(560, span * 1.3));
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
      if (REDUCED) { g.classList.add('is-in'); return; }
      svg.getBoundingClientRect();          // 逼一次重排，不然過渡不會跑
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { g.classList.add('is-in'); });
      });
    });
    stage.classList.add('is-revealed');
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

  /* fresh＝這是新出的題（可以計分）；從歷史回頭看的那一題已經計過分了，
     再算一次會讓進度條和連續數字自己長大。 */
  function show(item, fresh) {
    cur = item;
    lastKey = keyOf(item.q);
    answered = false;
    hinted = false;
    wrong = 0;
    resetPad();
    nudge('');
    revealEl.hidden = true;
    hintBtn.disabled = false;
    hintBtn.hidden = false;
    showBtn.hidden = false;
    nextBtn.hidden = true;
    paintQuestion(item.q);
    if (!fresh && item.revealed) reveal(item.right, true);
    paintNav();
  }

  function paintNav() { prevBtn.disabled = histPos <= 0; }

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

  /* 字母鍵盤底下那一句話 —— 答對、答錯、看答案**全部講在這裡**（Wilson）。
     對錯講在不同地方的話，眼睛每答一次就要重新找它在哪。
     tone：'good' 綠、'bad' 紅、不給就是中性灰。 */
  function nudge(text, tone) {
    nudgeEl.textContent = text || '';
    nudgeEl.className = 'xz-nudge' + (tone ? ' is-' + tone : '');
  }

  function answer(L) {
    if (answered || !cur) return;
    if (L === cur.q.L) { reveal(true); return; }
    /* 猜錯：那顆鍵變紅、抖一下，並且說一句「沒關係，再試一次」（Wilson）——
       原本是灰掉加刪除線，看起來像「這顆壞了」而不是「這個猜錯了」。
       鍵留在畫面上但按不動：同一個字母不用再試一次，而且「我剛剛猜過哪幾個」
       本身就是有用的資訊。 */
    var b = keyBtns[L];
    if (b) { b.classList.add('is-wrong'); b.disabled = true; }
    wrong++;
    streak = 0;
    paintScore();
    if (wrong >= MAX_WRONG) {
      reveal(false, false, '猜了 ' + MAX_WRONG + ' 次，先看答案吧');
      return;
    }
    nudge('沒關係，再試一次', 'bad');
  }

  /* 提示：把選項收成四個字母（正解＋三個隨機）。用過提示這一題就不算學會 —— 不然
     進度條會虛報，而虛報的進度條比沒有進度條還糟。 */
  function hint() {
    if (answered || !cur || hinted) return;
    hinted = true;
    hintBtn.disabled = true;
    var keep = {};
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
    nudge('剩下這四個，選一個');
  }

  /* 「取自『會』第 1–3 筆」——sst 是那條字根在取自字裡的筆序，
     連號印成「1–3」，不連號逐一列出，佔滿整個字就說「整個字」。 */
  function spanText(src, sst) {
    if (!sst || !sst.length) return '';
    var total = (GLYPHS[src] || []).length;
    var ss = sst.slice().sort(function (a, b) { return a - b; });
    if (total && ss.length === total) return '整個字';
    var run = ss[ss.length - 1] - ss[0] === ss.length - 1;
    if (ss.length === 1) return '第 ' + (ss[0] + 1) + ' 筆';
    if (run) return '第 ' + (ss[0] + 1) + '–' + (ss[ss.length - 1] + 1) + ' 筆';
    return '第 ' + ss.map(function (n) { return n + 1; }).join('、') + ' 筆';
  }

  function reveal(right, replay, msg) {
    if (answered || !cur) return;
    answered = true;
    var q = cur.q;

    ALPHA.forEach(function (L) { keyBtns[L].disabled = true; });
    keyBtns[q.L].classList.remove('is-dim');
    keyBtns[q.L].classList.add('is-right');

    // ⚠️ replay＝從「上一題」回頭看已經答過的那一題，**不能再計一次分**：
    // 記過的題目不會重複記，但連續數字會一路自己長大。
    if (!replay) {
      cur.revealed = true;
      cur.right = right && !wrong;
      if (right && !wrong && !hinted && !mastered[keyOf(q)]) {
        mastered[keyOf(q)] = 1;
        saveOk();
      }
      streak = right && !wrong ? streak + 1 : 0;
      paintScore();
    }

    /* ⚠️ 這裡一定要覆蓋掉那句話，不能只在猜錯時寫 —— 猜錯一次之後再答對，
       「沒關係，再試一次」會**留在畫面上**跟「答對了！」互相矛盾（Wilson 抓到）。
       答對、看答案、猜滿三次，三條路都會走到這裡，所以在這裡寫一定蓋得到。 */
    nudge(msg || (right ? '答對了！' : '答案是這個'), msg ? '' : (right ? 'good' : ''));

    keyEl.textContent = q.L;
    descEl.textContent = q.d || '（取形意圖待補）';
    descEl.classList.toggle('is-todo', !q.d);

    srcIconEl.innerHTML = '';
    srcTextEl.textContent = '';
    if (q.src && GLYPHS[q.src] && q.sst && q.sst.length) {
      var icon = ZG.rootIcon ? ZG.rootIcon(GLYPHS[q.src], q.sst) : null;
      if (icon) srcIconEl.innerHTML = icon;
      srcTextEl.textContent = '取自「' + q.src + '」' + spanText(q.src, q.sst);
    }

    codeEl.textContent = '這個字：' + q.c + (q.code ? '　' + q.code : '');
    // 錨點是字母那一節（LA、LO…），zigen.js 畫完表格會自己捲過去
    linkEl.href = 'zigen.html#L' + q.L;
    linkEl.textContent = '在字根表看 ' + q.L + ' 這一組';

    overlayLetter(q);
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

  /* ---------- 進度 ---------- */
  function paintScore() {
    var done = 0;
    POOL.forEach(function (q) { if (mastered[keyOf(q)]) done++; });
    doneEl.textContent = done;
    totalEl.textContent = POOL.length;
    streakEl.textContent = streak;
    fillEl.style.width = POOL.length ? (done / POOL.length * 100).toFixed(1) + '%' : '0';
  }

  hintBtn.addEventListener('click', hint);
  showBtn.addEventListener('click', function () { reveal(false); });
  nextBtn.addEventListener('click', nextQuestion);
  skipBtn.addEventListener('click', nextQuestion);
  prevBtn.addEventListener('click', prevQuestion);
  resetBtn.addEventListener('click', function () {
    // 進度是使用者自己累積的東西，砍掉之前先問一聲
    if (!window.confirm('清掉練習紀錄？答對過的題目會全部重來。')) return;
    mastered = {};
    streak = 0;
    saveOk();
    paintScore();
    history = [];
    histPos = -1;
    nextQuestion();
  });

  // 實體鍵盤：直接按字母作答，答完按 Enter／空白鍵換下一題，左右鍵走前後。
  // 輸入框在這一頁一個都沒有，所以不必擔心搶走誰的按鍵。
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
     只有一個檔（20 KB 上下）：題目、字形、碼、取形意圖全在裡面。抓不到就老實說，
     這一頁的題目**就是**那張圖，退不回文字版。 */
  loadState();
  buildPad();

  fetch('assets/lianxi.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      GLYPHS = (d && d.glyphs) || null;
      POOL = (d && d.questions) || [];
      if (!GLYPHS || !POOL.length) {
        // 還沒挑不是壞掉，講清楚是哪一種，不要丟一個「載入失敗」讓人去猜
        loadingEl.textContent = '還沒挑要考哪幾題（site/content/lianxi.md）。';
        return;
      }
      loadingEl.hidden = true;
      gameEl.hidden = false;
      optsEl.hidden = false;
      if (creditEl) creditEl.hidden = false;
      paintScore();
      nextQuestion();
    })
    .catch(function () {
      loadingEl.textContent =
        '題目載入失敗。本機預覽請先跑 python3 site/tools/build_site_data.py。';
    });
})();
