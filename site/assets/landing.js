/* 首頁拆件動畫——只有 index.html 用得到。
 *
 * 輪流播三個手選的字（哈／竹／晶）。每個字按字根分好組（跟〈拆碼查詢〉田字格
 * 揭碼同一種資料格式，見 assets/landing-glyphs.json 自己的 note），一組一組
 * 依序登場：先出現那個字根的英文字母本身（跟字根表講的「這個字根長這樣」一致），
 * 定住一下，再讓字母淡出、同時真正的筆畫淡入、疊在同一個位置——不是找一個
 * 「看起來像」的過場，就是字母消失的瞬間換成這個字真正的那幾筆。下一個字母接著
 * 登場，一路把整個字疊出來。
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

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

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
      piecesHtml += '<g class="lg-piece lg-z' + (gi % 6) + '" style="opacity:0">' + d + '</g>';
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
      centers.push({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        size: clamp(Math.max(box.width, box.height) * 0.9, 160, 380)
      });
      pieces[i].style.transformOrigin = centers[i].x + 'px ' + centers[i].y + 'px';
    }

    if (REDUCED) {
      // 不做逐字登場，直接呈現組好的字
      for (var r = 0; r < pieces.length; r++) pieces[r].style.opacity = '1';
      return;
    }

    // 字母疊在跟筆畫同一個點上——外層先 translate 到那個點、再 scale(1,-1)
    // 抵消 SVG_TF 的 y 軸翻轉（不然字母會上下顛倒），字母本身用 text-anchor
    // /dominant-baseline 置中在 (0,0)，動畫只動裡面這層 .lg-letter 的
    // transform／opacity，外層的定位 transform 不動。
    var lettersHtml = '';
    for (gi = 0; gi < entry.groups.length; gi++) {
      var c = centers[gi];
      lettersHtml +=
        '<g transform="translate(' + c.x.toFixed(1) + ',' + c.y.toFixed(1) + ') scale(1,-1)">' +
          '<g class="lg-letter lg-z' + (gi % 6) + '" style="opacity:0">' +
            '<text text-anchor="middle" dominant-baseline="central" ' +
              'font-family="sans-serif" font-weight="700" ' +
              'font-size="' + c.size.toFixed(0) + '">' + entry.groups[gi].L + '</text>' +
          '</g>' +
        '</g>';
    }
    outer.insertAdjacentHTML('beforeend', lettersHtml);
    var letters = svg.querySelectorAll('.lg-letter');

    // 逼一次重排，讓上面設好的「字母/筆畫都還沒登場」狀態先真的畫出來，
    // 下面才有東西可以做 transition。
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

    function revealPiece(idx, done) {
      if (idx >= pieces.length) { done(); return; }
      var letter = letters[idx], piece = pieces[idx];

      // 1. 字母先登場（一點回彈，像是「啪」一下冒出來）
      popIn(letter, 'cubic-bezier(.34,1.56,.64,1)');

      timers.push(window.setTimeout(function () {
        // 2. 定住一下之後，字母淡出、真正的筆畫在同一個點淡入——這一刻是
        //    「這個字母＝這幾筆」的重點，所以慢一點、清楚一點。
        letter.style.transition = 'transform .34s ease, opacity .34s ease';
        letter.style.transform = 'scale(1.25)';
        letter.style.opacity = '0';
        popIn(piece, 'cubic-bezier(.22,.68,0,1)');

        timers.push(window.setTimeout(function () {
          revealPiece(idx + 1, done);
        }, 480));
      }, 760));
    }

    revealPiece(0, function () {
      var hold = 1500;
      timers.push(window.setTimeout(function () {
        svg.style.transition = 'opacity .35s ease';
        svg.style.opacity = '0';
        timers.push(window.setTimeout(playNext, 380));
      }, hold));
    });
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
