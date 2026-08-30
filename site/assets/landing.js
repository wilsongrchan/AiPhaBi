/* 首頁專用——只有 index.html 用得到，分兩個各自獨立的小工具：
 *
 * 1. 拆件動畫（#lg-svg／#lg-code）：輪流播三個手選的字（哈／竹／晶），每個字的
 *    筆畫先按字根分好組、炸開、上色，再一起飛回原位組成完整的字。資料來自
 *    assets/landing-glyphs.json（從 pinyin_glyphs.json 摘出來的一個小檔案，
 *    只收這三個字，見那個檔案自己的 note）。飛回去的終點是這個字真正的筆畫
 *    座標，不是另外畫一份假動畫。
 *
 * 2. 打字查詢框（#ld-input／#ld-out）：任何字母組合都能查，接的是 dict.json
 *    真正的碼表——跟拆件動畫完全獨立，只是剛好在同一頁。
 */
(function () {
  'use strict';

  /* ---------- 1. 拆件動畫 ---------- */
  (function () {
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

    function buildChar(ch) {
      var entry = DATA && DATA.chars[ch];
      if (!entry) return;

      var piecesHtml = '';
      for (var gi = 0; gi < entry.groups.length; gi++) {
        var group = entry.groups[gi];
        var d = '';
        for (var j = 0; j < group.st.length; j++) {
          d += '<path d="' + entry.strokes[group.st[j]] + '"/>';
        }
        piecesHtml += '<g class="lg-piece lg-z' + (gi % 6) + '" data-gi="' + gi + '">' + d + '</g>';
      }
      svg.innerHTML = '<g transform="' + SVG_TF + '">' + piecesHtml + '</g>';
      codeEl.innerHTML = entry.code.split('').join(' ') + ' → <b>' + ch + '</b>';

      if (REDUCED) return; // 不做飛入，直接呈現組好的字

      var pieces = svg.querySelectorAll('.lg-piece');
      if (!pieces.length) return;

      // 先量出每一組的中心點（getBBox 量的是這一組自己「還沒套自己的 transform」
      // 之前的座標，正好就是它組好之後該在的位置），再算整個字的中心。
      var centers = [];
      var cx = 0, cy = 0;
      for (var i = 0; i < pieces.length; i++) {
        var box = pieces[i].getBBox();
        var pc = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        centers.push(pc);
        cx += pc.x; cy += pc.y;
      }
      cx /= pieces.length; cy /= pieces.length;

      // 每一組往「中心→自己」的方向炸開；正好在中心上的（少見）退回用角度分散。
      for (var k = 0; k < pieces.length; k++) {
        var dx = centers[k].x - cx, dy = centers[k].y - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) {
          var ang = (k / pieces.length) * Math.PI * 2;
          dx = Math.cos(ang); dy = Math.sin(ang); dist = 1;
        }
        dx /= dist; dy /= dist;
        var ox = (dx * 520).toFixed(1), oy = (dy * 520).toFixed(1);
        var rot = (k % 2 === 0 ? 1 : -1) * (10 + k * 4);
        var p = pieces[k];
        p.style.transformOrigin = centers[k].x + 'px ' + centers[k].y + 'px';
        p.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(1.6) rotate(' + rot + 'deg)';
        p.style.opacity = '0';
      }

      // 逼一次重排，讓上面「炸開」的初始狀態先真的畫出來，下一幀再拉回原位，
      // 才會有 transition；不這樣做瀏覽器可能把兩個狀態合成一步，動畫就消失了。
      // eslint-disable-next-line no-unused-expressions
      svg.getBoundingClientRect();
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          for (var m = 0; m < pieces.length; m++) {
            (function (p, delay) {
              window.setTimeout(function () {
                p.style.transform = 'translate(0,0) scale(1) rotate(0deg)';
                p.style.opacity = '1';
              }, delay);
            })(pieces[m], m * 70);
          }
        });
      });
    }

    var idx = 0;
    var cycleTimer = null;
    function playNext() {
      var ch = ORDER[idx % ORDER.length];
      idx++;
      svg.style.opacity = '1';
      buildChar(ch);
      var hold = REDUCED ? 2200 : 3400;
      cycleTimer = window.setTimeout(function () {
        svg.style.transition = 'opacity .35s ease';
        svg.style.opacity = '0';
        window.setTimeout(playNext, 380);
      }, hold);
    }

    fetch('assets/landing-glyphs.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        playNext();
      })
      .catch(function () { /* 拆件動畫顯示不出來就算了，不擋首頁其他部分 */ });
  })();

  /* ---------- 2. 打字查詢框 ---------- */
  (function () {
    var input = document.getElementById('ld-input');
    var out = document.getElementById('ld-out');
    if (!input || !out) return;

    var codes = {};

    function render() {
      var v = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
      if (v !== input.value) input.value = v;
      if (!v) { out.textContent = ''; out.classList.remove('is-hit'); return; }
      var hit = codes[v.toLowerCase()];
      if (hit) { out.textContent = '→ ' + hit.charAt(0); out.classList.add('is-hit'); }
      else { out.textContent = ''; out.classList.remove('is-hit'); }
    }

    input.addEventListener('input', render);

    fetch('assets/dict.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { codes = d.codes || {}; })
      .catch(function () { /* 查不到表就讓框子留空，不擋頁面其餘部分 */ });
  })();
})();
