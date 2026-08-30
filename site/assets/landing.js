/* 首頁拆件動畫——只有 index.html 用得到。
 *
 * 輪流播幾個手選的字（哈／竹／昌／石）各一次。每個字按字根分好組（跟〈拆碼
 * 查詢〉田字格揭碼同一種資料格式，見 assets/landing-glyphs.json 自己的 note）：
 *
 *   1. 這個字要用到的英文字母（O／A／O…）先一起在左邊排成一排登場——
 *      跟打字時「這幾個鍵」是同一組。
 *   2. 一個一個飛到自己真正該在的位置（跟打字的先後順序一樣，由左邊排隊
 *      依序出發，不是同時飛）。
 *   3. 飛到定點後，字母原地淡出、真正的筆畫在同一個點淡入——這一刻就是
 *      「這個字母＝這幾筆」，不是找一個「看起來像」的過場。
 *
 * 下一個字母等前一個字母完全變成筆畫之後才出發，一路把整個字疊出來。全部
 * 播完一輪（每個字各一次，不循環）就把這個位置換成「猜猜看」小遊戲——見檔案
 * 下半段——不是繼續放給人看膩（Wilson 2026-08-30）。 */
(function () {
  'use strict';

  var svg = document.getElementById('lg-svg');
  var codeEl = document.getElementById('lg-code');
  if (!svg || !codeEl) return;

  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 跟 glyphbox.js 的 SVG_TF 同一套算法：字形本身填滿 0–1024，y 軸原點在
   * 左下，縮到 86% 置中再把 y 軸翻回螢幕慣用的方向。 */
  var INSET = 0.86;
  var SVG_TF = 'translate(' + (1024 * (1 - INSET) / 2).toFixed(1) + ',' +
               (1024 * (1 - INSET) / 2).toFixed(1) + ') scale(' + INSET + ') ' +
               'scale(1,-1) translate(0,-900)';

  var ORDER = ['哈', '竹', '昌', '石'];
  var DATA = null;
  var LETTER_SIZE = 260; // 排隊／飛行時的字母大小，統一一個尺寸，不跟著各組筆畫的大小走
  // ⚠️ 原本改用襯線字體（Georgia）讓 J 的字腳帶一橫，跟石字 J 那組字根的
  // 取形意圖對得上；但改完不久 Wilson 就開始回報 A 飛的時候留殘影，時間點
  // 很接近，換過三種完全不同的動畫排程方式（CSS transition、Web
  // Animations API、手動 requestAnimationFrame）都沒解決，懷疑問題出在
  // 襯線字體本身，不是排程方式——退回無襯線字體之後改用別的辦法解決 J：
  // 截圖比對過一輪常見系統字型（見 scratchpad 的 j_test.html，這份沒收進
  // repo），Verdana／Tahoma 這兩個無襯線字體剛好在 J 的頂端天生就帶一條
  // 橫槓（不是襯線，是這兩套字型自己的設計），其他字母走一般無襯線字體，
  // 只有 J 這個字母單獨指定字型（見下面 fontFor()）。
  var LETTER_FONT = 'sans-serif';
  var LETTER_FONT_J = "Verdana, Tahoma, 'DejaVu Sans', sans-serif";
  function fontFor(letter) { return letter === 'J' ? LETTER_FONT_J : LETTER_FONT; }

  /* 整體節奏的倍率——嫌動畫太趕就調大這個數字，其他時間值都跟著它縮放，
     不用整支檔案一個一個改（Wilson 2026-08-30：原本的節奏「有點 overwhelming」）。
     ms() 給 setTimeout 用（純數字），s() 給 CSS transition 的時間字串用。 */
  var PACE = 1.4;
  function ms(v) { return Math.round(v * PACE); }
  function s(v) { return (v * PACE).toFixed(2) + 's'; }

  function buildChar(ch) {
    var entry = DATA && DATA.chars[ch];
    if (!entry) return;

    var piecesHtml = '';
    var gi;
    for (gi = 0; gi < entry.groups.length; gi++) {
      var group = entry.groups[gi];
      var d = '';
      for (var j = 0; j < group.st.length; j++) {
        d += '<path d="' + entry.strokes[group.st[j]] + '"/>';
      }
      piecesHtml += '<g class="lg-piece" style="opacity:0">' + d + '</g>';
    }
    svg.innerHTML = '<g transform="' + SVG_TF + '">' + piecesHtml + '</g>';
    codeEl.innerHTML = entry.code.split('').join(' ') + ' → <b>' + ch + '</b>';

    var outer = svg.firstChild;
    var pieces = svg.querySelectorAll('.lg-piece');
    if (!pieces.length) return;

    // 量出每一組真正該在的位置（getBBox 量的是這一組「還沒套自己的 transform」
    // 之前的座標，正好就是組好之後該在的位置），字母就疊在同一個點上。
    var centers = [];
    for (var i = 0; i < pieces.length; i++) {
      var box = pieces[i].getBBox();
      centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      pieces[i].style.transformOrigin = centers[i].x + 'px ' + centers[i].y + 'px';
    }

    if (REDUCED) {
      // 不做逐字登場，直接呈現組好的字
      for (var r = 0; r < pieces.length; r++) pieces[r].style.opacity = '1';
      return;
    }

    // 排隊位置：全部字母先在左邊排成一橫排，由左到右照碼的順序排（跟打字、
    // 跟閱讀方向一樣，第一個字母在最左邊），等飛的時候才一個一個離隊往右飛到
    // 自己真正該在的位置。整排都站到可視範圍（0–1024）外面，讀起來才像
    // 「排隊等著上場」而不是「已經在畫面裡了」。
    var n = pieces.length;
    var sumY = 0;
    for (var si = 0; si < n; si++) sumY += centers[si].y;
    var midY = sumY / n;
    var spacing = 210;
    var queueNearX = -170; // 隊伍裡最靠近舞台（最右）的那個位置
    var queue = [];
    for (var qi = 0; qi < n; qi++) {
      queue.push({ x: queueNearX - (n - 1 - qi) * spacing, y: midY });
    }

    // 字母的位置分兩層：外層 .lg-letter-pos 只管「人在哪」（排隊位置飛到定點，
    // CSS transition 動這一層的 translate）；裡層 scale(1,-1) 抵消 SVG_TF 的
    // y 軸翻轉（不然字母會上下顛倒），是固定的 SVG transform 屬性，不參與動畫；
    // 最裡層 .lg-letter 只管「登場的彈跳」跟跟筆畫交接時的淡出，字母本身用
    // text-anchor／dominant-baseline 置中在 (0,0)。三層互不干擾。字母顏色跟
    // 大小統一（.lg-letter 的 fill、這裡的 LETTER_SIZE），不跟著各組筆畫的
    // 顏色／大小走——那是筆畫淡入之後才要分組講的事，字母階段先講「這是哪個鍵」。
    var lettersHtml = '';
    for (gi = 0; gi < entry.groups.length; gi++) {
      var q = queue[gi];
      lettersHtml +=
        '<g class="lg-letter-pos" style="transform:translate(' + q.x + 'px,' + q.y.toFixed(1) + 'px) translateZ(0)">' +
          '<g transform="scale(1,-1)">' +
            '<g class="lg-letter" style="opacity:0">' +
              '<text text-anchor="middle" dominant-baseline="central" ' +
                'font-family="' + fontFor(entry.groups[gi].L) + '" font-weight="700" ' +
                'font-size="' + LETTER_SIZE + '">' + entry.groups[gi].L + '</text>' +
            '</g>' +
          '</g>' +
        '</g>';
    }
    outer.insertAdjacentHTML('beforeend', lettersHtml);
    var letterPos = svg.querySelectorAll('.lg-letter-pos');
    var letters = svg.querySelectorAll('.lg-letter');

    // 逼一次重排，讓上面設好的「字母都還在排隊、筆畫都還沒登場」狀態先真的
    // 畫出來，下面才有東西可以做 transition。
    svg.getBoundingClientRect();

    function popIn(el, easing) {
      el.style.transition = 'none';
      el.style.transform = 'scale(.4) translateZ(0)';
      el.getBoundingClientRect();
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          el.style.transition = 'transform ' + s(.38) + ' ' + easing + ', opacity ' + s(.3) + ' ease';
          el.style.transform = 'scale(1) translateZ(0)';
          el.style.opacity = '1';
        });
      });
    }

    // 字母消失、筆畫出現那一刻——不是簡單的一個淡出一個淡入，是字母被拉開、
    // 模糊、揉散掉，筆畫同時從同一個點「長」出來（clip-path 從一個點擴散開，
    // 配模糊度收斂），兩邊時間重疊，讀起來像一個形狀流動變成另一個形狀，
    // 不是兩張圖疊在一起切換。真正逐點對應筆畫去做形變太複雜（一個字母常常
    // 要對應兩三筆各自獨立的筆畫，沒有天然的對應關係，勉強做只會看起來亂），
    // 這是不需要那套數學、但看起來夠「流動」的替代做法。
    function dissolveLetter(el) {
      el.style.transition =
        'transform ' + s(.42) + ' cubic-bezier(.4,0,1,1), ' +
        'opacity ' + s(.36) + ' ease ' + s(.08) + ', filter ' + s(.42) + ' ease';
      el.style.transform = 'scale(1.55) skewX(-10deg) translateZ(0)';
      el.style.opacity = '0';
      el.style.filter = 'blur(11px)';
    }

    function materializePiece(el) {
      el.style.transition = 'none';
      el.style.opacity = '0';
      el.style.clipPath = 'circle(0% at 50% 50%)';
      el.style.filter = 'blur(10px)';
      el.style.transform = 'scale(.86) translateZ(0)';
      el.getBoundingClientRect();
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          el.style.transition =
            'clip-path ' + s(.6) + ' cubic-bezier(.22,.68,0,1), filter ' + s(.55) + ' ease, ' +
            'opacity ' + s(.3) + ' ease, transform ' + s(.6) + ' cubic-bezier(.22,.68,0,1)';
          el.style.opacity = '1';
          el.style.clipPath = 'circle(150% at 50% 50%)';
          el.style.filter = 'blur(0px)';
          el.style.transform = 'scale(1) translateZ(0)';
        });
      });
    }

    // 1. 全部字母先一起在排隊位置登場（一點點錯開，像排成一列走進畫面）
    for (var pi = 0; pi < n; pi++) {
      (function (letter, delay) {
        timers.push(window.setTimeout(function () {
          popIn(letter, 'cubic-bezier(.34,1.56,.64,1)');
        }, delay));
      })(letters[pi], ms(pi * 100));
    }

    function flyAndLand(idx, done) {
      if (idx >= n) { done(); return; }
      var pos = letterPos[idx], letter = letters[idx], piece = pieces[idx], c = centers[idx];

      // 2. 離隊，飛到自己真正該在的位置——這裡故意不靠瀏覽器自己插值
      //    （CSS transition、Web Animations API 都試過，飛的時候還是會留
      //    殘影，越看越明顯，Wilson 多次截圖回報）。改成自己用
      //    requestAnimationFrame 逐幀算出當下的位置、直接寫 transform，
      //    瀏覽器不用做任何插值，每一幀畫的都是明確給的值——這是目前試過
      //    最不依賴瀏覽器合成器行為的做法。
      var m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(pos.style.transform);
      var fromX = m ? parseFloat(m[1]) : c.x;
      var fromY = m ? parseFloat(m[2]) : c.y;
      var dur = ms(620);
      var t0 = null;
      pos.style.transition = 'none';

      function step(ts) {
        if (t0 === null) t0 = ts;
        var t = Math.min((ts - t0) / dur, 1);
        var e = 1 - Math.pow(1 - t, 3); // easeOutCubic，跟原本的 cubic-bezier 手感相近
        var x = fromX + (c.x - fromX) * e;
        var y = fromY + (c.y - fromY) * e;
        pos.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translateZ(0)';
        if (t < 1) {
          raf = window.requestAnimationFrame(step);
        } else {
          landed();
        }
      }
      raf = window.requestAnimationFrame(step);

      function landed() {
        // 3. 落定之後，字母揉散、真正的筆畫在同一個點長出來——這一刻是
        //    「這個字母＝這幾筆」的重點，所以慢一點、清楚一點。
        dissolveLetter(letter);
        materializePiece(piece);

        timers.push(window.setTimeout(function () {
          flyAndLand(idx + 1, done);
        }, ms(480)));
      }
    }

    // 全部字母排隊登場的動畫跑完（最後一個 delay + popIn 的 .38s）之後，
    // 留一小段時間讓人看清楚「這幾個字母排在這裡」，才開始第一個出發。
    timers.push(window.setTimeout(function () {
      flyAndLand(0, function () {
        var hold = ms(1500);
        timers.push(window.setTimeout(function () {
          svg.style.transition = 'opacity ' + s(.35) + ' ease';
          svg.style.opacity = '0';
          timers.push(window.setTimeout(advance, ms(380)));
        }, hold));
      });
    }, ms((n - 1) * 100 + 380 + 450)));
  }

  var idx = 0;
  var timers = [];
  var raf = null; // flyAndLand 手動 tween 用的 requestAnimationFrame id，restart()／skip() 要連這個一起取消
  var restartBtn = document.getElementById('lg-restart');
  var skipBtn = document.getElementById('lg-skip');
  var stageEl = document.getElementById('lg-stage');
  var guessEl = document.getElementById('guess');

  // 播完一輪（每個字各一次，不循環）就把這個位置換成「猜猜看」小遊戲——
  // 一直循環播給人看久了會膩（Wilson：「有點 overwhelming」），播完就讓畫面
  // 靜下來、換成可以自己動手的東西，不是繼續演給人看。重播圖示隨時都在、
  // 兩個階段都按得到，想再看動畫的人自己按（見 restart()）。
  var TOTAL_PLAYS = ORDER.length;
  var playCount = 0;

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) window.clearTimeout(timers[i]);
    timers = [];
    if (raf !== null) { window.cancelAnimationFrame(raf); raf = null; }
  }

  function showGuess() {
    if (stageEl) stageEl.hidden = true;
    codeEl.hidden = true;
    if (guessEl) guessEl.hidden = false;
    if (window.AiPhaBiGuess) window.AiPhaBiGuess.start();
  }

  function advance() {
    if (playCount >= TOTAL_PLAYS) {
      showGuess();
      return;
    }
    playNext();
  }

  function playNext() {
    clearTimers();
    playCount++;
    var ch = ORDER[idx % ORDER.length];
    idx++;
    svg.style.transition = 'none';
    svg.style.opacity = '1';
    buildChar(ch);
    if (REDUCED) {
      timers.push(window.setTimeout(function () {
        svg.style.transition = 'opacity .35s ease';
        svg.style.opacity = '0';
        timers.push(window.setTimeout(advance, 380));
      }, 2200));
    }
  }

  // 重播——不管現在播到哪、還是已經在猜猜看階段，按下去都從頭開始一輪動畫。
  function restart() {
    clearTimers();
    playCount = 0;
    idx = 0;
    if (guessEl) guessEl.hidden = true;
    if (stageEl) stageEl.hidden = false;
    codeEl.hidden = false;
    svg.style.transition = 'none';
    svg.style.opacity = '1';
    advance();
  }

  // 跳過——不管現在播到哪，直接把剩下的動畫關掉、跳去猜猜看，不用等播完。
  function skip() {
    clearTimers();
    playCount = TOTAL_PLAYS;
    showGuess();
  }

  if (restartBtn) restartBtn.addEventListener('click', restart);
  if (skipBtn) skipBtn.addEventListener('click', skip);

  fetch('assets/landing-glyphs.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      advance();
    })
    .catch(function () { /* 拆件動畫顯示不出來就算了，不擋首頁其他部分 */ });
})();

/* 猜猜看——只有 index.html 用得到，跟上面的拆件動畫完全獨立（一個是看展示、
 * 一個是自己動手想），只是剛好在同一頁。
 *
 * 答案（碼）不是寫死在這裡的字串——開頁就去查 dict.json 真正的碼表，找出
 * GUESS_CHARS 這幾個字各自的碼，「看答案」才有東西可以顯示。碼表換了、
 * 這幾個字的碼跟著換，這裡不用跟著改（呼應這個專案「碼不能手抄，會過期」
 * 的規矩，見 CLAUDE.md）。
 *
 * 字不是用系統字型印出來的文字，是跟上面拆件動畫同一種真正的筆畫（田字格
 * 也是全站共用的 .tianzi，見 assets/glyphbox.js）——猜之前只給看字的樣子，
 * 不能先看到字根怎麼分（田字格不上色，見 ZG.paintGlyph 沒傳 colour 參數
 * 的情形），這是 assets/landing-glyphs.json 的 guessChars 只收 strokes、
 * 不收 groups 的原因。
 *
 * 不會自己開始——等 assets/landing.js 的拆件動畫播完一輪，呼叫這裡暴露的
 * window.AiPhaBiGuess.start() 才會顯示、才會出第一題。
 */
(function () {
  'use strict';

  var tianziEl = document.getElementById('guess-tianzi');
  var input = document.getElementById('guess-input');
  var checkBtn = document.getElementById('guess-check');
  var answerEl = document.getElementById('guess-answer');
  var nextBtn = document.getElementById('guess-next');
  var guessEl = document.getElementById('guess');
  if (!tianziEl || !input || !checkBtn || !answerEl || !nextBtn || !guessEl) return;

  var GUESS_CHARS = ['回', '岩', '唱', '凶', '今'];
  var codeOf = {};
  var strokesOf = {};
  var qi = 0;
  var started = false;

  function paint(ch) {
    if (window.ZG && strokesOf[ch]) {
      window.ZG.paintGlyph(tianziEl, ch, strokesOf[ch]);
    } else {
      tianziEl.innerHTML = '';
    }
  }

  function showQuestion(i) {
    qi = ((i % GUESS_CHARS.length) + GUESS_CHARS.length) % GUESS_CHARS.length;
    paint(GUESS_CHARS[qi]);
    input.value = '';
    answerEl.textContent = '';
    answerEl.classList.remove('is-right', 'is-wrong');
    checkBtn.hidden = false;
    // 「換一個字」不用等看過答案才給按——想直接跳下一題也可以，不用先看答案
    // 或先猜（Wilson）。
    nextBtn.hidden = false;
  }

  function reveal() {
    var code = codeOf[GUESS_CHARS[qi]];
    if (!code) return; // dict.json 還沒查回來，先不動作
    var upper = code.toUpperCase();
    var guess = input.value.toUpperCase().replace(/[^A-Z]/g, '');
    var right = guess === upper;
    var spaced = upper.split('').join(' ');
    answerEl.textContent = guess
      ? (right ? '猜對了！就是 ' + spaced : '差一點，答案是 ' + spaced)
      : '答案是 ' + spaced;
    // classList.add('') 丟例外——guess 是空字串（還沒打就直接看答案）時不能
    // 傳空字串進去，這裡先判斷有沒有真的要加的 class 再加。
    if (right) answerEl.classList.add('is-right');
    else if (guess) answerEl.classList.add('is-wrong');
    checkBtn.hidden = true;
  }

  checkBtn.addEventListener('click', reveal);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') reveal();
  });
  // 打對了不用等按「看答案」——輸入框內容一變就順便比對一次，字母湊齊、
  // 順序對了就直接算猜對，當場顯示（Wilson：打完 OO 應該馬上知道對了）。
  // 還沒打對／沒打完的時候什麼都不做，不要在打到一半就先講「錯了」。
  input.addEventListener('input', function () {
    var code = codeOf[GUESS_CHARS[qi]];
    if (!code) return;
    var guess = input.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (guess === code.toUpperCase()) reveal();
  });
  nextBtn.addEventListener('click', function () { showQuestion(qi + 1); });

  window.AiPhaBiGuess = {
    start: function () {
      started = true;
      showQuestion(qi);
    }
  };

  fetch('assets/dict.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var codes = d.codes || {};
      GUESS_CHARS.forEach(function (ch) {
        for (var code in codes) {
          if (codes[code].indexOf(ch) !== -1) { codeOf[ch] = code; break; }
        }
      });
    })
    .catch(function () { /* 查不到碼「看答案」就先沒反應，不擋頁面其餘部分 */ });

  fetch('assets/landing-glyphs.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var gc = (d && d.guessChars) || {};
      GUESS_CHARS.forEach(function (ch) {
        if (gc[ch]) strokesOf[ch] = gc[ch].strokes;
      });
      if (started) paint(GUESS_CHARS[qi]); // 資料比 start() 晚到就補畫一次
    })
    .catch(function () { /* 田字格畫不出來就留空，不擋其他功能 */ });
})();
