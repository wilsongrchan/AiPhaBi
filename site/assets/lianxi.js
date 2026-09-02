/* 字根練習 —— 一次一條字根，把它在字裡的筆畫標出來，問「像哪個英文字母」。
 *
 * 為什麼要有這一頁：〈字根表〉是拿來查的。字根一路捲到底，看完不等於認得。
 * 這一頁把同一張表**翻過來**用 —— 先給形狀，問字母，答完才講取形意圖。
 * （Wilson 2026-09-01：首頁再多一顆「我想學習更多字根」。）
 *
 * ⚠️ **這一頁是「歡迎模式」**：首頁直接連過來的三關入門，題目是手挑的一小批。
 * 將來可能另外做一個「完整模式」把整張字根表練過一遍（Wilson 2026-09-01），
 * 那會是另一個進入點 —— 不要把這裡的題目長成幾百題，這一頁刻意保持短。
 *
 * ⚠️ **用哪個字出題、考它的哪幾條字根，全部是 Wilson 手挑的**，寫在
 * `site/content/lianxi.md`（`檢 = A O` 這種一行一個字的格式）。建置時對回
 * codes.json 算出「那條字根是哪幾筆」、比對出取形意圖，產生 assets/lianxi.json。
 * 這支只讀那一份，**自己不決定要考什麼、也不自己配例字**。
 *
 * 因此這一頁只抓一個檔：題目與筆畫輪廓都在裡面。
 * ⚠️ 答對之後**不列出取形意圖／取自哪個字／整串碼**（Wilson 2026-09-01：每答對
 * 一次頁面就長出一塊、畫面跟著彈；那些東西在〈字根表〉看就好）。答案就是疊在
 * 字根上的那個字母，加上鍵盤上亮起來的那一顆。
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
  var typedEl = document.getElementById('xz-typed');
  var askEl = document.getElementById('xz-ask');
  var spinBar = document.getElementById('xz-spinbar');
  var cwBtn = document.getElementById('xz-cw');
  var ccwBtn = document.getElementById('xz-ccw');
  var ccw45Btn = document.getElementById('xz-ccw45');
  var flipXBtn = document.getElementById('xz-flipx');
  var flipYBtn = document.getElementById('xz-flipy');
  var unspinBtn = document.getElementById('xz-reset-spin');
  var nudgeEl = document.getElementById('xz-nudge');
  var levelEl = document.getElementById('xz-chapter');
  var playEl = document.getElementById('xz-play');
  var donePanel = document.getElementById('xz-done-panel');
  var doneTitle = document.getElementById('xz-done-title');
  var doneSub = document.getElementById('xz-done-sub');
  var confettiEl = document.getElementById('xz-confetti');
  var hintBtn = document.getElementById('xz-hint');
  var showBtn = document.getElementById('xz-show');
  var nextBtn = document.getElementById('xz-next');
  var prevBtn = document.getElementById('xz-prev');
  var skipBtn = document.getElementById('xz-skip');
  var levelBtn = document.getElementById('xz-level');
  var nextLvBtn = document.getElementById('xz-nextlv');
  var stayBtn = document.getElementById('xz-stay');
  var toZigenBtn = document.getElementById('xz-tozigen');
  var resetBtn = document.getElementById('xz-reset');
  var doneEl = document.getElementById('xz-done');
  var totalEl = document.getElementById('xz-total');
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
  var NLEVELS = 0;          // 一共幾關（關卡只有編號，沒有名字）
  /* 一關要答對幾題才過關。⚠️ 一關**可以有更多題**——多出來的是備胎，不喜歡的
     題目可以跳過，還有別的可以練（Wilson 2026-09-01）。所以「過關」看的是答對
     幾題，不是把整關的題目都答完。 */
  var PASS = 8;             // 建置會蓋掉這個值（lianxi.json 的 pass）
  var forcedLevel = null;   // 按過「下一關」之後暫時鎖在那一關
  /* 這一輪看過答案的題目。⚠️ 不寫進 localStorage：它只管「這一關能不能往下走」，
     不是學會了。看過答案（或猜滿三次）就算走過，不然一直按「看答案」的人會卡在
     第一關出不去 —— 而「跳過」不算走過，那只是換一題。 */
  var seenThisRound = {};
  var mastered = {};
  /* ⚠️ 進度條走的是**這一輪**答對了幾題（roundOk），不是 localStorage 裡的終身
     紀錄（mastered）。上一版用 mastered 算，於是練過一輪的人再打開這一頁，
     進度條永遠停在 8／8、關卡永遠是過的，整頁看起來像壞掉（Wilson 回報兩次）。
     mastered 留著只做一件事：決定先出哪幾題（沒答對過的優先）。 */
  var roundOk = {};
  /* 卡關的出路（Wilson 2026-09-02）：只差一兩題就過關、卻連著好幾題拿不到分的人，
     很容易覺得自己被關在同一關裡繞不出去。到那個地步就主動請他往下走 ——
     ⚠️ 是**邀請**不是強制：這一頁沒有「答不對就不准走」這回事。 */
  var STUCK_NEAR = 2;     // 離過關只差 1～2 題＝「就快到了」
  var STUCK_MISS = 3;     // 在那個狀態下，幾個**不同**的題目沒拿到分就出手
  var stuckMiss = {};     // {關: {題目: 1}}，同一題反覆答錯只算一次
  var stuckShown = {};    // 每一關每一輪只邀請一次 —— 一直跳出來比卡住還煩
  /* 田字格那一塊會被三種面板輪流佔住，靠這個記得現在是哪一種 ——
     ''＝正在答題、'done'＝過關了、'stuck'＝卡住了嗎、'warn'＝還沒學夠就想跳到最後一關。
     ⚠️ 「繼續」那顆按鈕三種面板意思都不一樣，全靠這個分辨。 */
  var panelMode = '';
  /* 答對了就自己往下一題走，不用再按一次「下一題」（Wilson 2026-09-02）。
     ⚠️ 只有**答對**才自動走：看答案、猜滿三次那幾條路都要停下來讓人看清楚。
     ⚠️ 使用者一動（按了轉、按了任何按鈕）就取消 —— 他正在看的東西被抽走
     是這種自動行為唯一會惹人生氣的地方。 */
  var AUTO_NEXT_MS = 3000;
  var autoTimer = null;
  function clearAuto() {
    if (autoTimer) { window.clearTimeout(autoTimer); autoTimer = null; }
  }
  var cur = null;           // 目前這一題（POOL 裡的一筆，外加 revealed/right）
  var answered = false, hinted = false, wrong = 0;
  var lastKey = '';
  var keyBtns = {};
  /* 出過的題目留一份，「上一題」才回得去（Wilson 2026-09-01）。回頭看的人多半是
     想再看一眼剛才的答案，所以連「當時揭曉了沒」一起記，重新問一次等於把他要的
     東西收走。 */
  var history = [], histPos = -1;
  /* 「轉轉看」的狀態：deg 是**累加的**角度（可正可負，45 的倍數，刻意不收進
     0–359，見 turn()），fx／fy 是左右／上下翻（1 或 -1）。只有寫了提示的題目
     才給這排按鈕。每換一題就歸零。 */
  var deg = 0, fx = 1, fy = 1;
  var typed = '';           // 第三關（打整個字）已經打對的碼
  var hintN = 0;            // 第三關按過幾次提示（＝先幫他標出前幾條字根）

  /* ⚠️ 繁簡切換是**在載入時掃一遍 DOM**做的（site.js 的 toSimplified），所以
     任何「JS 後來才寫進去的字」預設都會停在繁體 —— 使用者切成简體之後，
     「沒關係，再試一次」「第一關」這些字全部沒跟著轉（Wilson 2026-09-02：
     「all the hint text … are all stale」）。凡是寫中文進畫面的地方，寫完就
     過一次這個。 */
  function loc(el) { if (el && window.AiPhaBiSite) window.AiPhaBiSite.localize(el); }

  // 打整個字那一種沒有 L，用「打」當它的身分
  function keyOf(q) { return q.c + '|' + (q.t ? '打' : q.L); }

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
  /* 一關一關出（Wilson 2026-09-01）：先把第一關出完，才進第二關。
     「出完」＝這一關每一題都答對過、或至少看過答案 —— 只看 mastered 的話，
     一直按「看答案」的人永遠出不了第一關。 */
  function levelLeft(li) {
    return POOL.filter(function (q) {
      return q.lv === li && !mastered[keyOf(q)] && !seenThisRound[keyOf(q)];
    });
  }

  /* 從指定的一關抽一題。那一關還沒做完就從沒做完的裡面抽，做完了就整關重抽
     （「繼續練習這一關」要的正是後者）。 */
  function pickFromLevel(li) {
    var pool = levelLeft(li);
    if (!pool.length) pool = POOL.filter(function (q) { return q.lv === li; });
    if (!pool.length) return null;
    if (pool.length > 1) {
      pool = pool.filter(function (q) { return keyOf(q) !== lastKey; });
    }
    return { q: pool[Math.floor(Math.random() * pool.length)] };
  }

  function levelPool(li) { return POOL.filter(function (q) { return q.lv === li; }); }
  function levelGoal(li) { return Math.min(PASS, levelPool(li).length); }
  function levelScore(li) {
    var n = 0;
    levelPool(li).forEach(function (q) { if (roundOk[keyOf(q)]) n++; });
    return n;
  }
  function levelDone(li) { return levelScore(li) >= levelGoal(li); }

  /* 「就快到了卻拿不到分」的計數。⚠️ 只在**快到了**的時候才記：一開始就答錯
     幾題是正常的學習過程，那不叫卡住。 */
  function noteMiss(q) {
    var goal = levelGoal(q.lv);
    var sc = levelScore(q.lv);
    if (sc >= goal || sc < goal - STUCK_NEAR) return;
    (stuckMiss[q.lv] = stuckMiss[q.lv] || {})[keyOf(q)] = 1;
  }
  function isStuck(li) {
    return !stuckShown[li] && !levelDone(li) &&
      Object.keys(stuckMiss[li] || {}).length >= STUCK_MISS;
  }

  /* 這一關接下來能出什麼：先出沒答對也沒看過的，都出過了就從沒答對的裡面再抽。
     兩種都沒有（整關都答對了）回 null，換下一關。 */
  function levelSource(li) {
    var a = levelLeft(li);                                  // 沒答對過也沒看過的
    if (a.length) return a;
    var b = levelPool(li).filter(function (q) { return !mastered[keyOf(q)]; });
    if (b.length) return b;                                 // 看過但還沒答對過的
    // 以前全部答對過了，但**這一輪**還沒過關 —— 照樣要出題給他打
    var c = levelPool(li).filter(function (q) { return !roundOk[keyOf(q)]; });
    return c.length ? c : null;
  }

  function pickQuestion() {
    if (!POOL.length) return null;
    var left = null;
    // 按過「下一關」或「繼續練習這一關」就鎖在那一關，直到再按一次
    if (forcedLevel !== null) {
      var forced = levelLeft(forcedLevel);
      left = forced.length ? forced : POOL.filter(function (q) { return q.lv === forcedLevel; });
    }
    for (var li = 0; left === null && li < NLEVELS; li++) {
      if (levelDone(li)) continue;          // 已經過關的就跳過（不必把整關做完）
      left = levelSource(li);
    }
    /* 每一關都走完了：回頭把還沒答對的再練一遍 —— ⚠️ 一樣要**照關卡順序**找，
       不能一口氣把所有沒答對的混在一起抽。混在一起的話關卡名稱會一題一題在
       「第 1 關」「第 2 關」之間跳（實測連按看答案走完兩關之後就是這樣），
       看起來像壞掉。全都答對過就整池重來。 */
    if (!left) {
      for (var lj = 0; lj < NLEVELS; lj++) {
        var rest = POOL.filter(function (q) {
          return q.lv === lj && !mastered[keyOf(q)];
        });
        if (rest.length) { left = rest; break; }
      }
    }
    // ⚠️ 每一題都答對過的時候上面兩個迴圈都不會給值，left 會留在 null。
    // 少了這一行，練到全部答對的那一刻整頁就當掉（單元測試抓到的）。
    if (!left) left = POOL;
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
  /* 轉的是**整個田字格**（連格線一起），不是格子裡的筆畫（Wilson 2026-09-01：
     整塊一起轉在版面上看起來才一致）。田字格是正方形，轉 90° 佔的位置一樣大，
     所以版面不會動。
     ⚠️ 揭曉時疊上去的字母要**反向轉回來**才會是正的（見 overlayLetter 裡那一層
     .xz-letter-fix）—— 字根轉過去之後像哪個字母，那個字母本身當然要正著寫。 */
  function paintSpin() {
    var svg = stage.querySelector('svg');
    /* ⚠️ 轉 45 度的時候要縮到 1/√2：正方形斜著擺，外接框會變成 1.41 倍，
       不縮就會壓到上面的關卡列和下面的題目那一句話。轉 90 的倍數則不必縮。 */
    var k = (((deg % 90) + 90) % 90) ? 0.72 : 1;   // deg 可能是負的，先正規化再判斷
    if (svg) {
      svg.style.transform = 'rotate(' + deg + 'deg) scale(' + (fx * k) + ',' + (fy * k) + ')';
    }
    /* 字母要抵消掉轉與翻（字母本身當然要正著寫），但**不抵消那個等比縮放** ——
       縮放是等比的，字母跟著縮才會一直貼合字根的大小。 */
    var fix = stage.querySelectorAll('.xz-letter-fix');
    Array.prototype.forEach.call(fix, function (g) {
      g.style.transform = 'scale(' + fx + ',' + fy + ') rotate(' + (-deg) + 'deg)';
    });
    /* ⚠️ 用 class 不用 hidden：hidden 會把它從版面上拿掉，整排按鈕跟著往中間縮
       一次 —— 「轉一下按鈕就自己跑掉」（Wilson）。位置一直留著，只是看不見。 */
    unspinBtn.classList.toggle('is-idle', !(deg || fx < 0 || fy < 0));
  }

  function resetSpin() {
    deg = 0;
    fx = 1;
    fy = 1;
    paintSpin();
  }

  function paintQuestion(q) {
    var strokes = GLYPHS[q.c] || [];
    var cls = {};
    if (q.t) {
      /* 第三關的提示，做法跟試打頁的〈跟著打〉一樣（Wilson）：把已經揭開的那幾條
         字根用彩虹色分組標出來，一條一個顏色，跟底下碼格那個字母的顏色對得上。
         揭開幾條 = 已經打對的字數，加上按過幾次提示。⚠️ 提示只上色**不給字母** ——
         「這幾筆是一組」才是卡住的人需要的，字母要自己認。 */
      var shown = Math.max(typed.length, hintN);
      (q.seg || []).forEach(function (grp, gi) {
        if (gi < shown) grp.forEach(function (i) { cls[i] = 'tz-z' + (gi % 6); });
      });
    } else {
      (q.g || []).forEach(function (grp, gi) {
        grp.forEach(function (i) { cls[i] = 'xz-on xz-on-' + Math.min(gi + 1, 3); });
      });
    }
    // 沒被選中的先畫完，選中的才畫 —— 照筆順混著畫的話，序號較後的淺色筆畫會
    // 蓋在高亮的筆畫上面（跟〈字根表〉exampleGlyph 同一個坑）。
    var off = '', on = '';
    for (var i = 0; i < strokes.length; i++) {
      if (cls[i]) on += '<path class="' + cls[i] + '" d="' + strokes[i] + '"/>';
      else off += '<path class="' + (q.t ? 'xz-ink' : 'xz-dim') + '" d="' + strokes[i] + '"/>';
    }
    stage.classList.remove('is-revealed');
    stage.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="題目">' +
      ZG.GRID + '<g transform="' + ZG.TF + '">' + off + on + '</g></svg>';
    paintSpin();
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
      /* 兩層：外層 .xz-letter-fix 把整個田字格的轉／翻**抵消掉**（字母要正著寫），
         內層 .xz-letter 只管登場那一下的淡入放大。兩件事分開才不會互相蓋掉。 */
      var fix = document.createElementNS(NS, 'g');
      fix.setAttribute('class', 'xz-letter-fix');
      fix.style.transformOrigin = box.cx.toFixed(1) + 'px ' + box.cy.toFixed(1) + 'px';
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
      fix.appendChild(g);
      svg.appendChild(fix);
      paintSpin();                            // 讓新加的字母立刻套上反向轉
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
    clearAuto();                 // 換題就把上一題排的自動跳轉收掉
    cur = item;
    lastKey = keyOf(item.q);
    answered = false;
    hinted = false;
    wrong = 0;
    resetPad();
    nudge('');
    hintBtn.disabled = false;
    hintBtn.hidden = false;
    showBtn.hidden = false;
    nextBtn.hidden = true;
    resetSpin();
    hideDone();
    typed = '';
    hintN = 0;
    paintQuestion(item.q);
    paintAsk(item.q);
    paintTyped(item.q, false);
    paintScore();                     // 換關卡時上面那條要跟著換成新關卡的分數
    spinBar.hidden = !item.q.h;
    hintBtn.textContent = item.q.t ? '提示：標出下一條字根' : '提示：減至四個選項';
    paintLevel(item.q);
    if (!fresh && item.revealed) {
      if (item.q.t) typed = item.q.code;       // 回頭看已答過的打字題，碼格填滿
      reveal(item.right, true);
    }
    paintNav();
  }

  function paintNav() {
    prevBtn.disabled = histPos <= 0;
    // 最後一關沒有下一關可跳（Wilson）
    levelBtn.hidden = NLEVELS < 2 || (cur && cur.q.lv >= NLEVELS - 1);
  }

  /* 第三關的碼格：打對的填上去，還沒打的留空。**先讓人看到碼有幾個字母**——
     那是這種題目唯一的線索，也讓「還差幾個」一目瞭然。 */
  function paintTyped(q, revealed) {
    if (!q.t) { typedEl.hidden = true; typedEl.textContent = ''; return; }
    typedEl.hidden = false;
    var html = '';
    for (var i = 0; i < q.code.length; i++) {
      var mine = i < typed.length;                    // 自己打對的
      var told = revealed && !mine;                   // 看答案時才補上的
      /* 打對的字母用跟筆畫同色的反白小方塊（.tz-chip）—— 跟試打頁的提示同一種
         長相，一眼看得出「這個字母就是那幾筆」。 */
      html += mine
        ? '<span class="xz-slot is-on"><span class="tz-chip z' + (i % 6) + '">' +
            q.code[i] + '</span></span>'
        : '<span class="xz-slot' + (told ? ' is-told' : '') + '">' +
            (told ? q.code[i] : '') + '</span>';
    }
    typedEl.innerHTML = html;
  }

  // 打對一個字母、或按了提示之後，圖跟碼格都要重畫
  function repaintType(q) { paintQuestion(q); paintTyped(q, false); }

  /* 題目那一句話（兩句都是 Wilson 2026-09-01 指定的字）：

       沒有提示 → 「這個字根像哪個字母？」
       有提示   → 提示原文 ＋「，像哪個字母？」
                 例：「旋轉或翻轉這個字根後，像哪個字母？」
                     「把這個字根旋轉 180 度後，像哪個字母？」

     要轉、要翻才看得出來的字根，**問題本身**就得把該怎麼看講出來 —— 不先講
     一聲，那題就不是在考眼力而是在考通靈。提示寫在 site/content/lianxi.md
     的每一題後面（`雪 = E · 旋轉或翻轉`），所以之後想把某一題講得更細
     （`· 水平翻轉`）不必改這支。 */
  function paintAsk(q) {
    // ⚠️ 提示是**一整句**（「旋轉或翻轉這個字根後」），這裡只接後半，不要再補字：
    // 補了就會變成「旋轉或翻轉這個字根後這個字根後，像哪個字母？」
    askEl.textContent = q.t ? '試一下打這個字'
      : (q.h ? q.h + '，像哪個字母？' : '這個字根像哪個字母？');
    loc(askEl);
  }

  /* 「第一關　8／10」——關卡只有編號，沒有名字（Wilson 2026-09-01）。
     一題該怎麼看是那一題自己的提示在講，不需要再給關卡取一個名字。 */
  var CN = '〇一二三四五六七八九十';
  function cn(n) {
    if (n <= 10) return CN[n];
    if (n < 20) return '十' + CN[n - 10];
    return String(n);
  }

  function paintLevel(q) {
    if (!NLEVELS) { levelEl.textContent = ''; return; }
    // 分數在上面那條進度條講過了，這裡只講在第幾關
    levelEl.textContent = '第' + cn(q.lv + 1) + '關';
    loc(levelEl);
  }

  /* 下一題／跳過是同一件事：往前走一格。之前按過「上一題」的話，往前是回到
     已經出過的那幾題（不重抽），走到頭才抽新的。 */
  function nextQuestion() {
    /* 「跳過」也算沒拿到分 —— 一直跳過正是「在同一關裡繞」的樣子（Wilson）。
       按「下一題」時 answered 已經是 true，不會重複記。 */
    if (cur && !answered) noteMiss(cur.q);
    /* ⚠️ 邀請寫在**換下一題的那一刻**，不是揭曉的那一刻：揭曉時蓋掉畫面，
       等於把他剛剛才看到的答案收走。 */
    if (cur && isStuck(cur.q.lv)) { showStuck(cur.q.lv); return; }
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

  /* 「下一關」——不想把這一關做完也可以直接跳過去（Wilson）。跳過去之後暫時鎖在
     那一關（forcedLevel），把它做完才回到「照順序出」。只有一關的時候不出現。 */
  /* 前面幾關到底學會了幾條字根。⚠️ 這裡**連 localStorage 的終身紀錄一起算**
     （進度條刻意只算這一輪，見上面）—— 這一個是「他懂不懂」的判斷，不是進度，
     昨天練過的人今天一開頁就被擋下來會很莫名其妙。 */
  function learnedBefore(li) {
    var n = 0;
    for (var i = 0; i < li; i++) {
      levelPool(i).forEach(function (q) {
        if (roundOk[keyOf(q)] || mastered[keyOf(q)]) n++;
      });
    }
    return n;
  }

  /* 「下一關」——不想把這一關做完也可以直接跳過去（Wilson）。跳過去之後暫時鎖在
     那一關（forcedLevel），把它做完才回到「照順序出」。只有一關的時候不出現。

     ⚠️ force 一定要**明著傳**：`addEventListener('click', jumpLevel)` 會把 click
     事件當第一個參數塞進來，那是個 truthy 物件，等於每一次點擊都跳過勸告。
     所有監聽器都包一層函式。 */
  function jumpLevel(force) {
    if (NLEVELS < 2) return;
    var to = ((cur ? cur.q.lv : 0) + 1) % NLEVELS;
    /* 最後一關是「把整個字打出來」，靠的是前面兩關認過的字根。字根還沒認幾條
       就跳過去只會一直打錯 —— 先勸一句，但**不擋**（Wilson 2026-09-02：
       「給兩個選項 回去第二關／挑戰一下」）。 */
    if (!force && to === NLEVELS - 1 && learnedBefore(to) < PASS) {
      showWarn(to);
      return;
    }
    panelMode = '';
    hideDone();                      // 從別的面板按過來的，先把那塊收掉
    forcedLevel = to;
    var pick = pickFromLevel(forcedLevel);
    if (!pick) return;
    history.push(pick);
    histPos = history.length - 1;
    show(pick, true);
  }

  /* 「繼續練習這一關」——這一關十題都答對了，但想再練一遍。鎖在這一關，
     整關重抽（不管答對過沒有），直到按「下一關」為止。 */
  function stayLevel() {
    if (!cur) return;
    forcedLevel = cur.q.lv;
    // 重開一輪 —— 卡關的計數跟著歸零，不然剛重來就又被問一次「卡住了嗎？」
    delete stuckMiss[forcedLevel];
    delete stuckShown[forcedLevel];
    // 「再練一遍」就是重新開一輪：進度條歸零，不然按下去畫面停在 8／8 沒事發生
    levelPool(forcedLevel).forEach(function (q) { delete roundOk[keyOf(q)]; });
    paintScore();
    var pick = pickFromLevel(forcedLevel);
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
    loc(nudgeEl);
  }

  function answer(L) {
    if (answered || !cur) return;
    if (cur.q.t) { typeLetter(L); return; }
    if (L === cur.q.L) { reveal(true); return; }
    /* 猜錯：那顆鍵變紅、抖一下，並且說一句「沒關係，再試一次」（Wilson）——
       原本是灰掉加刪除線，看起來像「這顆壞了」而不是「這個猜錯了」。
       鍵留在畫面上但按不動：同一個字母不用再試一次，而且「我剛剛猜過哪幾個」
       本身就是有用的資訊。 */
    var b = keyBtns[L];
    if (b) { b.classList.add('is-wrong'); b.disabled = true; }
    wrong++;
    paintScore();
    if (wrong >= MAX_WRONG) {
      reveal(false, false, '猜了 ' + MAX_WRONG + ' 次，先看答案吧');
      return;
    }
    nudge('沒關係，再試一次', 'bad');
  }

  /* 第三關：一個字母一個字母把碼打出來。打對就填進碼格，打錯就抖一下 ——
     ⚠️ 打錯的那顆**不能像別關那樣鎖起來**：同一個字母後面可能還要再打一次
     （嶇 是 WCOOO，O 連著三個）。 */
  function typeLetter(L) {
    var q = cur.q;
    if (L === q.code[typed.length]) {
      typed += L;
      repaintType(q);
      if (typed.length === q.code.length) { reveal(true); return; }
      nudge('');
      return;
    }
    wrong++;
    paintScore();
    // 抖的是碼格不是按鍵：錯的是「這個字母不是下一個」，不是那顆鍵壞了
    typedEl.classList.remove('is-bad');
    void typedEl.offsetWidth;                 // 逼重排，同一顆再按一次也會再抖
    typedEl.classList.add('is-bad');
    if (wrong >= MAX_WRONG) {
      reveal(false, false, '打錯 ' + MAX_WRONG + ' 次，先看答案吧');
      return;
    }
    nudge('沒關係，再試一次', 'bad');
  }

  /* 提示：把選項收成四個字母（正解＋三個隨機）。用過提示這一題就不算學會 —— 不然
     進度條會虛報，而虛報的進度條比沒有進度條還糟。 */
  function hint() {
    if (answered || !cur) return;
    var q = cur.q;
    if (q.t) {
      // 第三關：一次揭開一條字根（只上色，不給字母）
      if (hintN >= q.seg.length) return;
      hinted = true;
      hintN = Math.max(hintN, typed.length) + 1;
      repaintType(q);
      hintBtn.disabled = hintN >= q.seg.length;
      nudge('這幾筆是一組，它像哪個字母？');
      return;
    }
    if (hinted) return;
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

  function reveal(right, replay, msg) {
    if (answered || !cur) return;
    answered = true;
    var q = cur.q;

    ALPHA.forEach(function (L) { keyBtns[L].disabled = true; });
    if (q.t) {
      typedEl.classList.remove('is-bad');
      hintN = q.seg ? q.seg.length : 0;       // 整個字的分組都標出來
      paintQuestion(q);
      paintTyped(q, true);                    // 沒打完的格子把答案填上去
    } else {
      keyBtns[q.L].classList.remove('is-dim');
      keyBtns[q.L].classList.add('is-right');
    }

    /* ⚠️ 過關畫面只在**剛好過關的那一次**出現。少了這一行，關卡一旦過了，
       之後每答一題都會跳出「第一關完成！」，畫面像卡住一樣（Wilson：
       「why is the page stuck at im always answered 8/8」）—— 紀錄是存在
       localStorage 的，他早就把每一關都練過了。 */
    var wasDone = levelDone(q.lv);

    // ⚠️ replay＝從「上一題」回頭看已經答過的那一題，**不能再計一次分**。
    if (!replay) {
      cur.revealed = true;
      cur.right = right && !wrong;
      seenThisRound[keyOf(q)] = 1;      // 這一關能不能往下走看這個，見 levelLeft
      if (right && !wrong && !hinted) {
        roundOk[keyOf(q)] = 1;                              // 這一輪的分數
        if (!mastered[keyOf(q)]) { mastered[keyOf(q)] = 1; saveOk(); }
      } else {
        noteMiss(q);          // 這一題沒拿到分 —— 快過關卻一直沒拿到分就是卡住了
      }
      paintScore();
      paintLevel(q);
    }

    /* ⚠️ 這裡一定要覆蓋掉那句話，不能只在猜錯時寫 —— 猜錯一次之後再答對，
       「沒關係，再試一次」會**留在畫面上**跟「答對了！」互相矛盾（Wilson 抓到）。
       答對、看答案、猜滿三次，三條路都會走到這裡，所以在這裡寫一定蓋得到。 */
    nudge(msg || (right ? '答對了！' : '答案是這個'), msg ? '' : (right ? 'good' : ''));

    /* 第二關揭曉時**自己轉給他看**（Wilson 2026-09-02）：題目說「逆轉 45 度後
       像哪個字母」，答案卻用沒轉過的角度疊上去，形狀根本對不上那個字母。
       ⚠️ 只在他**自己完全沒動過**的時候才轉 —— 已經轉到某個角度的人，畫面
       在揭曉那一刻跳掉，等於把他剛剛的操作抹掉。轉法是建置時從提示那句話
       解析出來的（`tf`），不是在這裡認中文字串。 */
    if (q.tf && !deg && fx > 0 && fy > 0) {
      deg = q.tf.deg || 0;
      fx = q.tf.fx || 1;
      fy = q.tf.fy || 1;
      paintSpin();
    }
    if (!q.t) overlayLetter(q);               // 打整個字沒有「那一段像哪個字母」
    /* 「提示／看答案」換成「下一題」—— 同一排、同一個位置。⚠️ 不要用「收掉那一排
       再把下一題放到別處」的做法，也不要在底下長出一塊新的東西：畫面會往上／往下
       跳，而使用者的游標正停在剛按下的那顆字母鍵上（Wilson 兩次回報同一件事，
       〈取碼原則〉頁的「川」字示範也踩過）。 */
    hintBtn.hidden = true;
    showBtn.hidden = true;
    /* 這一關十題全部答對了就不要再說「下一題」——做完一關是一件事，該讓人挑
       接下來要幹嘛（Wilson 2026-09-01）。只有一關的時候沒有「下一關」可去。 */
    var done = levelDone(q.lv);
    // 最後一關過了就沒有「下一關」可去 —— 改成把人送去〈字根表〉（Wilson）：
    // 這一頁只練手挑的那幾條，整張表在那邊。
    var last = q.lv >= NLEVELS - 1;
    var justDone = done && !wasDone && !replay;
    nextBtn.hidden = justDone;
    if (justDone) { clearAuto(); showDone(q.lv, last); return; }
    nextBtn.focus({ preventScroll: true });
    /* 答對了 → 幾秒後自己換下一題。replay（從「上一題」回頭看）不算 ——
       他是特地回來看的，不該被推著走。 */
    if (right && !replay) {
      clearAuto();
      autoTimer = window.setTimeout(function () {
        autoTimer = null;
        nextQuestion();
      }, AUTO_NEXT_MS);
    }
  }

  /* 過關：田字格那一整塊換成完成畫面 —— 完成一關是個里程碑，讓它佔住畫面正中間，
     而不是在角落換一顆按鈕（Wilson 2026-09-01）。 */
  function showDone(lv, last) {
    panelMode = 'done';
    clearAuto();
    doneTitle.textContent = last ? '全部關卡完成！' : ('第' + cn(lv + 1) + '關完成！');
    doneSub.hidden = true;
    doneSub.textContent = '';
    stayBtn.textContent = '繼續練習這一關';
    nextLvBtn.textContent = '下一關 →';        // 「挑戰一下」那一版可能留在上面
    nextLvBtn.hidden = last;
    toZigenBtn.hidden = !last;
    stayBtn.hidden = false;
    playEl.hidden = true;
    donePanel.hidden = false;
    loc(donePanel);
    confetti();
    (last ? toZigenBtn : nextLvBtn).focus({ preventScroll: true });
  }

  /* 「卡住了嗎？」—— 跟過關用**同一塊**版面（田字格那一整格），所以底下的東西
     不會被推來推去；差別是沒有紙屑（這不是慶祝），而且「繼續」不會把這一輪歸零。
     最後一關沒有下一關可跳，改成把人送去〈字根表〉自己逛（Wilson 2026-09-02：
     「if at level 3, show the explore more page, so they dont feel like stuck
     in an endless cycle」）。 */
  function showStuck(lv) {
    var last = lv >= NLEVELS - 1;
    clearAuto();
    stuckShown[lv] = 1;
    panelMode = 'stuck';
    doneTitle.textContent = '卡住了嗎？';
    doneSub.hidden = false;
    doneSub.textContent = last
      ? '不用全部答對也可以往下走 —— 整張字根表在〈字根表〉那一頁，想看哪一條就看哪一條。'
      : '不用把這一關全部答對才能往下走，下一關隨時可以開始。';
    nextLvBtn.hidden = last;
    toZigenBtn.hidden = !last;
    nextLvBtn.textContent = '下一關 →';
    stayBtn.hidden = false;
    stayBtn.textContent = '再試幾題';
    playEl.hidden = true;
    donePanel.hidden = false;
    loc(donePanel);
    (last ? toZigenBtn : nextLvBtn).focus({ preventScroll: true });
  }

  /* 「還沒學夠就想跳到最後一關」—— 一樣是那塊版面，一樣是勸不是擋。
     兩顆按鈕的字是 Wilson 指定的：「回去第N關」「挑戰一下」。 */
  function showWarn(to) {
    panelMode = 'warn';
    clearAuto();
    doneTitle.textContent = '建議多學習幾個字根再來第' + cn(to + 1) + '關哦';
    doneSub.hidden = false;
    doneSub.textContent = '第' + cn(to + 1) + '關要把整個字的碼打出來，用的是前面幾關認過的字根。';
    nextLvBtn.hidden = false;
    nextLvBtn.textContent = '挑戰一下';
    toZigenBtn.hidden = true;
    stayBtn.hidden = false;
    stayBtn.textContent = '回去第' + cn((cur ? cur.q.lv : to - 1) + 1) + '關';
    playEl.hidden = true;
    donePanel.hidden = false;
    loc(donePanel);
    stayBtn.focus({ preventScroll: true });
  }

  function hideDone() {
    donePanel.hidden = true;
    playEl.hidden = false;
    confettiEl.textContent = '';        // 紙屑用完就收，不要留在 DOM 裡跑動畫
  }

  /* 小紙屑。純 CSS 動畫，一張一張隨機給位置、顏色、快慢 —— 「減少動態效果」
     底下整個不放（那是慶祝，不是資訊）。 */
  function confetti() {
    if (REDUCED) return;
    confettiEl.textContent = '';
    for (var i = 0; i < 30; i++) {
      var bit = document.createElement('i');
      bit.className = 'xz-bit c' + (i % 6);
      bit.style.left = (Math.random() * 100).toFixed(1) + '%';
      bit.style.animationDelay = (Math.random() * 0.45).toFixed(2) + 's';
      bit.style.animationDuration = (1.5 + Math.random() * 0.9).toFixed(2) + 's';
      confettiEl.appendChild(bit);
    }
  }

  /* ---------- 進度 ---------- */
  /* 進度條走的是**這一關**：答對幾題 / 過關要幾題（Wilson 2026-09-01：
     「should reflect out of 8 not out of 44」）。整站總題數對練的人沒有意義 ——
     他一次只在闖一關，而且一關還有備胎題根本不必做完。 */
  function paintScore() {
    var lv = cur ? cur.q.lv : 0;
    var goal = levelGoal(lv);
    var done = Math.min(levelScore(lv), goal);
    doneEl.textContent = done;
    totalEl.textContent = goal;
    fillEl.style.width = goal ? (done / goal * 100).toFixed(1) + '%' : '0';
  }

  /* ⚠️ 只要在遊戲區裡按下任何東西就取消自動跳轉 —— 尤其是「轉轉看」那一排：
     那幾顆不會換題，計時器照樣會在他正看著的時候把畫面抽走。 */
  gameEl.addEventListener('pointerdown', clearAuto);
  hintBtn.addEventListener('click', hint);
  showBtn.addEventListener('click', function () { reveal(false); });
  nextBtn.addEventListener('click', nextQuestion);
  skipBtn.addEventListener('click', nextQuestion);
  prevBtn.addEventListener('click', prevQuestion);
  // ⚠️ 都要包一層：直接把 jumpLevel 當監聽器，click 事件會變成 force=true
  levelBtn.addEventListener('click', function () { jumpLevel(false); });
  /* 面板上那顆主要按鈕：'warn' 版是「挑戰一下」——他已經被勸過一次了，
     這一次要真的過去（force），不然按下去又跳同一塊面板，變成死循環。 */
  nextLvBtn.addEventListener('click', function () { jumpLevel(panelMode === 'warn'); });
  /* ⚠️ 同一顆按鈕三種意思：
       'done'  「繼續練習這一關」——整輪歸零重來
       'stuck' 「再試幾題」——**絕對不能歸零**（把人辛苦拿到的 6／8 清掉
               才是真的讓人想關掉頁面）
       'warn'  「回去第 N 關」——留在原來那一關，什麼都不動 */
  stayBtn.addEventListener('click', function () {
    if (panelMode === 'done') { stayLevel(); return; }
    var wasWarn = panelMode === 'warn';
    panelMode = '';
    hideDone();
    if (wasWarn) return;             // 本來就在這一關，畫面收掉就好，不用換題
    nextQuestion();
  });
  /* ⚠️ **不要**把角度收進 0–359：從 0 逆轉 90 度會變成 270，CSS 就繞遠路轉了
     四分之三圈（Wilson：「按逆轉 90 它其實在順轉 270」）。角度一路累加，
     轉幾圈都無所謂，瀏覽器自然會走最短的那條路。 */
  function turn(by) { deg += by; paintSpin(); }
  cwBtn.addEventListener('click', function () { turn(90); });
  ccwBtn.addEventListener('click', function () { turn(-90); });
  ccw45Btn.addEventListener('click', function () { turn(-45); });
  flipXBtn.addEventListener('click', function () { fx = -fx; paintSpin(); });
  flipYBtn.addEventListener('click', function () { fy = -fy; paintSpin(); });
  unspinBtn.addEventListener('click', resetSpin);
  resetBtn.addEventListener('click', function () {
    // 進度是使用者自己累積的東西，砍掉之前先問一聲
    if (!window.confirm('清掉練習紀錄？答對過的題目會全部重來。')) return;
    mastered = {};
    roundOk = {};
    stuckMiss = {};
    stuckShown = {};
    panelMode = '';
    clearAuto();
    saveOk();
    paintScore();
    history = [];
    histPos = -1;
    seenThisRound = {};
    forcedLevel = null;
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
      NLEVELS = (d && d.levels) || 0;
      PASS = (d && d.pass) || 8;
      if (!GLYPHS || !POOL.length) {
        // 還沒挑不是壞掉，講清楚是哪一種，不要丟一個「載入失敗」讓人去猜
        loadingEl.textContent = '還沒挑要考哪幾題（site/content/lianxi.md）。';
        loc(loadingEl);
        return;
      }
      loadingEl.hidden = true;
      gameEl.hidden = false;
      optsEl.hidden = false;
      if (creditEl) creditEl.hidden = false;
      paintScore();
      levelBtn.hidden = NLEVELS < 2;
      nextQuestion();
    })
    .catch(function () {
      loadingEl.textContent =
        '題目載入失敗。本機預覽請先跑 python3 site/tools/build_site_data.py。';
    });
})();
