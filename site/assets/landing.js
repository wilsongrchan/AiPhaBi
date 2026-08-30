/* 首頁拆件動畫——只有 index.html 用得到。
 *
 * 輪流播三個手選的字（哈／竹／晶）。每個字按字根分好組（跟〈拆碼查詢〉田字格
 * 揭碼同一種資料格式，見 assets/landing-glyphs.json 自己的 note）：
 *
 *   1. 這個字要用到的英文字母（O／A／O…）先一起在左邊排成一排登場——
 *      跟打字時「這幾個鍵」是同一組。
 *   2. 一個一個飛到自己真正該在的位置（跟打字的先後順序一樣，由左邊排隊
 *      依序出發，不是同時飛）。
 *   3. 飛到定點後，字母原地淡出、真正的筆畫在同一個點淡入——這一刻就是
 *      「這個字母＝這幾筆」，不是找一個「看起來像」的過場。
 *
 * 下一個字母等前一個字母完全變成筆畫之後才出發，一路把整個字疊出來。
 */
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

  var ORDER = ['哈', '竹', '晶'];
  var DATA = null;
  var LETTER_SIZE = 260; // 排隊／飛行時的字母大小，統一一個尺寸，不跟著各組筆畫的大小走

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
    for (var s = 0; s < n; s++) sumY += centers[s].y;
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
        '<g class="lg-letter-pos" style="transform:translate(' + q.x + 'px,' + q.y.toFixed(1) + 'px)">' +
          '<g transform="scale(1,-1)">' +
            '<g class="lg-letter" style="opacity:0">' +
              '<text text-anchor="middle" dominant-baseline="central" ' +
                'font-family="sans-serif" font-weight="700" ' +
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
      el.style.transform = 'scale(.4)';
      el.getBoundingClientRect();
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          el.style.transition = 'transform .38s ' + easing + ', opacity .3s ease';
          el.style.transform = 'scale(1)';
          el.style.opacity = '1';
        });
      });
    }

    // 1. 全部字母先一起在排隊位置登場（一點點錯開，像排成一列走進畫面）
    for (var pi = 0; pi < n; pi++) {
      (function (letter, delay) {
        timers.push(window.setTimeout(function () {
          popIn(letter, 'cubic-bezier(.34,1.56,.64,1)');
        }, delay));
      })(letters[pi], pi * 100);
    }

    function flyAndLand(idx, done) {
      if (idx >= n) { done(); return; }
      var pos = letterPos[idx], letter = letters[idx], piece = pieces[idx], c = centers[idx];

      // 2. 離隊，飛到自己真正該在的位置
      pos.style.transition = 'transform .62s cubic-bezier(.32,.68,.14,1)';
      pos.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px)';

      timers.push(window.setTimeout(function () {
        // 3. 落定之後，字母淡出、真正的筆畫在同一個點淡入——這一刻是
        //    「這個字母＝這幾筆」的重點，所以慢一點、清楚一點。
        letter.style.transition = 'transform .34s ease, opacity .34s ease';
        letter.style.transform = 'scale(1.25)';
        letter.style.opacity = '0';
        popIn(piece, 'cubic-bezier(.22,.68,0,1)');

        timers.push(window.setTimeout(function () {
          flyAndLand(idx + 1, done);
        }, 480));
      }, 620));
    }

    // 全部字母排隊登場的動畫跑完（最後一個 delay + popIn 的 .38s）之後，
    // 留一小段時間讓人看清楚「這幾個字母排在這裡」，才開始第一個出發。
    timers.push(window.setTimeout(function () {
      flyAndLand(0, function () {
        var hold = 1500;
        timers.push(window.setTimeout(function () {
          svg.style.transition = 'opacity .35s ease';
          svg.style.opacity = '0';
          timers.push(window.setTimeout(playNext, 380));
        }, hold));
      });
    }, (n - 1) * 100 + 380 + 450));
  }

  var idx = 0;
  var timers = [];
  function clearTimers() {
    for (var i = 0; i < timers.length; i++) window.clearTimeout(timers[i]);
    timers = [];
  }

  function playNext() {
    clearTimers();
    var ch = ORDER[idx % ORDER.length];
    idx++;
    svg.style.transition = 'none';
    svg.style.opacity = '1';
    buildChar(ch);
    if (REDUCED) {
      timers.push(window.setTimeout(function () {
        svg.style.transition = 'opacity .35s ease';
        svg.style.opacity = '0';
        timers.push(window.setTimeout(playNext, 380));
      }, 2200));
    }
  }

  fetch('assets/landing-glyphs.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      playNext();
    })
    .catch(function () { /* 拆件動畫顯示不出來就算了，不擋首頁其他部分 */ });
})();
