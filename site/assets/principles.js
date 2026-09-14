/* 〈取碼原則〉頁：把 assets/principles.json 的拆法資料畫成插圖。
 * 顏色和描邊規則跟 zigen.js 的 altMiniCard 同一套（見 site.css 的 .zg-altsvg／rb-*），
 * 這裡只是換一個更大的容器尺寸，用在正文裡當插圖，不是表格小圖示。
 * 資料本身（正確拆法對過 codes.json、錯誤拆法只收有把筆畫講清楚的那幾個）
 * 見 site/tools/build_site_data.py 的 PRINCIPLE_WRONG。 */
(function () {
  'use strict';

  var slots = document.querySelectorAll('.pr-example[data-char]');
  if (!slots.length) return;

  var RAINBOW = ['rb-0', 'rb-1', 'rb-2', 'rb-3', 'rb-4', 'rb-5'];
  var GLYPHS = null;
  var DATA = null;

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* ok: true=正確、false=示範用的錯拆法、null=還沒判定（逐步示範用，見 setupSteppers） */
  function card(ch, breakdown, ok, label) {
    var c = el('div', 'pr-card ' + (ok == null ? 'is-pending' : ok ? 'is-ok' : 'is-bad'));
    if (label) c.setAttribute('data-label', label);
    // 有些例子（川）正文會用「拆法A／B／C」指名討論，卡片上要標出來才對得起來
    if (label) {
      var lb = el('span', 'pr-label');
      lb.textContent = label;
      lb.setAttribute('data-keep', '');
      c.appendChild(lb);
    }
    var icon = el('span', 'pr-icon');
    var strokes = GLYPHS && GLYPHS[ch];
    if (strokes) {
      var paths = '';
      for (var i = 0; i < strokes.length; i++) {
        var gi = -1;
        for (var k = 0; k < breakdown.groups.length; k++) {
          if (breakdown.groups[k].indexOf(i) >= 0) { gi = k; break; }
        }
        var cls = gi >= 0 ? RAINBOW[gi % RAINBOW.length] : 'off';
        paths += '<path class="' + cls + '" d="' + strokes[i] + '"/>';
      }
      icon.innerHTML = '<svg class="zg-altsvg" viewBox="0 0 1024 1024" aria-hidden="true">' +
        '<g transform="scale(1,-1) translate(0,-900)">' + paths + '</g></svg>';
    } else {
      icon.textContent = ch;
      icon.setAttribute('data-keep', '');
    }
    c.appendChild(icon);
    // 打勾／打叉放在碼的右邊，不疊在圖示上——疊上去會蓋住角落的筆畫（Wilson）。
    var row = el('span', 'pr-coderow');
    var code = el('span', 'pr-code');
    code.setAttribute('data-keep', '');
    // 每個字母對應 groups 裡的哪一段，優先看 codeGroups（碼被砍過時，字母個數會
    // 少於 groups 的段數，例：藍 HCKAI 只有 5 個字母卻對到 6 段真正的取碼——見
    // build_principles() 的註解）；沒有 codeGroups 就退回「第幾個字母就是第幾段」
    // 這個一般情況。顏色跟圖示的分組上色一一對應——正確、錯誤拆法都上色，錯誤那邊
    // 靠 CSS（.pr-card.is-bad .pr-code）調暗＋加刪除線，區分「這是不取的示範」。
    for (var ci = 0; ci < breakdown.code.length; ci++) {
      var gi = breakdown.codeGroups ? breakdown.codeGroups[ci] : ci;
      var letter = el('span', gi != null && gi < breakdown.groups.length ? RAINBOW[gi % RAINBOW.length] : 'off');
      letter.textContent = breakdown.code[ci];
      code.appendChild(letter);
    }
    row.appendChild(code);
    var mark = el('span', 'pr-mark');
    mark.textContent = ok == null ? '' : ok ? '✓' : '✕';
    mark.setAttribute('aria-hidden', 'true');
    row.appendChild(mark);
    c.appendChild(row);
    c.title = ch + '　' + breakdown.code +
      (ok == null ? '（尚未判定）' : ok ? '（正確）' : '（不取，示範用）');
    c.setAttribute('data-keep', '');
    return c;
  }

  /* 逐步示範的第 1、2 步（約定原則、外框／主幹原則）還沒開始拆碼，看的就是這個字
   * 本身 —— 所以擺一個沒有上色、沒有碼的原字（Wilson）。走到筆順原則、三種拆法
   * 登場時它就退場。用 .pr-card 而不是自成一格，好讓它跟後面三張卡片對齊同寬同高。 */
  function plainCard(ch) {
    var c = el('div', 'pr-card is-plain');
    c.setAttribute('data-plain', '');
    /* ⚠️ 佔一格標籤的高度。這張「還沒開始拆」的原字卡沒有 A／B／C 標籤，但走到
       第三步換成三張有標籤的卡片時，整個方塊會突然高 21px，底下的「下一步」
       按鈕跟著往下跳 —— 使用者正連續點那顆按鈕，它卻在手指底下移動
       （Wilson 的朋友回報）。放一個空標籤把那一行的高度先佔住，兩種狀態就一樣高。
       用真的 .pr-label 元素而不是寫死 min-height：字級控制項（小／中／大）會改
       rem，寫死的數字會跟著失準，空標籤則自己跟著縮放。 */
    var ph = el('span', 'pr-label is-placeholder');
    // 用真的字母而不是空白：&nbsp; 的行高跟拉丁字母差 1px，方塊還是會抖一下
    ph.textContent = 'A';
    ph.setAttribute('aria-hidden', 'true');
    ph.setAttribute('data-keep', '');
    c.appendChild(ph);
    var icon = el('span', 'pr-icon');
    var strokes = GLYPHS && GLYPHS[ch];
    if (strokes) {
      var paths = '';
      for (var i = 0; i < strokes.length; i++) paths += '<path class="ink" d="' + strokes[i] + '"/>';
      icon.innerHTML = '<svg class="zg-altsvg" viewBox="0 0 1024 1024" aria-hidden="true">' +
        '<g transform="scale(1,-1) translate(0,-900)">' + paths + '</g></svg>';
    } else {
      icon.textContent = ch;
      icon.setAttribute('data-keep', '');
    }
    c.appendChild(icon);
    /* 同理，把碼那一列的高度也佔住（有標籤的卡片下面是 .pr-coderow：判定圓點
       ＋碼）。標籤佔住上面那一行、這個佔住下面那一行，兩種卡片的結構就完全
       一樣，任何字級底下高度都相等 —— 不必再用 padding 去湊。 */
    var cr = el('span', 'pr-coderow is-placeholder');
    cr.setAttribute('aria-hidden', 'true');
    cr.setAttribute('data-keep', '');
    var m = el('span', 'pr-mark'); cr.appendChild(m);
    var cd = el('span', 'pr-code'); cd.textContent = 'A'; cr.appendChild(cd);
    c.appendChild(cr);
    c.title = ch + '（尚未拆碼）';
    c.setAttribute('data-keep', '');
    return c;
  }

  /* 說明文字裡的「V（第 1、2 筆）」這種文字描述，換成就地畫出來的字根小圖——
   * 用法跟 zigen.js 的 {字#筆序} 一樣，但那支程式的函式沒有對外開放，這裡另外
   * 寫一份（裁切／置中算法照抄 zigen.js 的 rootIconSvg，見那邊的註解）。
   * 標記寫法：<span class="pr-inline" data-char="美" data-st="1,2"></span>
   * 想讓這一筆跟上面卡片同一個顏色（例如指名卡片裡那個被略過的字根），加一個
   * data-rb="0".."5"（對應卡片那個字根在 breakdown.groups 裡的序號），
   * 圖示就會套 rb-N 而不是預設的墨色——顏色系統跟卡片同一套（見 card() 的
   * RAINBOW 陣列），不是另外配的一套。 */
  var ROOT_PAD = 40;

  function rootIconSvg(strokes, sel, rbClass) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    for (var k = 0; k < sel.length; k++) {
      var d = strokes[sel[k]];
      if (!d) continue;
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(d))) {
        var x = +m[1], y = 900 - (+m[2]);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) return null;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var span = Math.max(x1 - x0, y1 - y0);
    var BOX = Math.min(1024, span / 0.85) || 1024;
    var cls = rbClass ? ' class="' + rbClass + '"' : '';
    var paths = '';
    for (var j = 0; j < sel.length; j++) {
      if (strokes[sel[j]]) paths += '<path' + cls + ' d="' + strokes[sel[j]] + '"/>';
    }
    return '<svg class="' + (rbClass ? 'zg-altsvg' : 'zg-svg') + '" viewBox="' +
      (cx - BOX / 2) + ' ' + (cy - BOX / 2) + ' ' + BOX + ' ' + BOX + '" aria-hidden="true">' +
      '<g transform="scale(1,-1) translate(0,-900)">' + paths + '</g></svg>';
  }

  function renderInline() {
    document.querySelectorAll('.pr-inline[data-char]').forEach(function (span) {
      if (span.dataset.done) return;
      var ch = span.getAttribute('data-char');
      var strokes = GLYPHS && GLYPHS[ch];
      var sel = (span.getAttribute('data-st') || '').split(',')
        .filter(Boolean).map(function (n) { return +n - 1; });
      if (!strokes || !sel.length) return;
      var rbIdx = span.getAttribute('data-rb');
      var rbClass = rbIdx === 'off' ? 'off'
        : (rbIdx !== null && rbIdx !== '' ? RAINBOW[+rbIdx % RAINBOW.length] : null);
      var svg = rootIconSvg(strokes, sel, rbClass);
      if (!svg) return;
      span.innerHTML = svg;
      span.className = rbClass ? 'zg-inline is-rb' : 'zg-inline';
      span.title = ch + '　第 ' + sel.map(function (i) { return i + 1; }).join('、') + ' 筆';
      span.setAttribute('data-keep', '');
      span.dataset.done = '1';
    });
  }

  function render() {
    slots.forEach(function (slot) {
      var ch = slot.getAttribute('data-char');
      var entry = DATA && DATA[ch];
      if (!entry) return;
      var cards = slot.querySelector('.pr-cards');
      if (!cards) {
        cards = el('div', 'pr-cards');
        slot.insertBefore(cards, slot.firstChild);
      }
      cards.textContent = '';

      // 預設「正確在前、示範在後」。但正文若要按特定順序討論（川 的 A→B→C），
      // 可用 data-order 指定要照哪個碼的順序排、data-labels 給每張卡片一個標籤。
      var all = [{ b: entry.correct, ok: true }]
        .concat((entry.wrongs || []).map(function (w) { return { b: w, ok: false }; }));
      var order = (slot.getAttribute('data-order') || '').split(',').filter(Boolean);
      if (order.length) {
        all.sort(function (x, y) {
          var a = order.indexOf(x.b.code), b2 = order.indexOf(y.b.code);
          return (a < 0 ? 99 : a) - (b2 < 0 ? 99 : b2);
        });
      }
      var labels = (slot.getAttribute('data-labels') || '').split(',').filter(Boolean);
      // 逐步示範的卡片一開始不掛勾叉——先掛等於先講答案（Wilson）。真正的 ok
      // 還是留在 title／CSS 之外的地方：由 setupSteppers 依步驟一張張填上去。
      var stepped = slot.hasAttribute('data-stepped');
      if (stepped) cards.appendChild(plainCard(ch));
      all.forEach(function (x, i) {
        var c = card(ch, x.b, stepped ? null : x.ok, labels[i] || '');
        c.dataset.verdict = x.ok ? 'ok' : 'bad';
        cards.appendChild(c);
      });
    });
    renderInline();
    setupSteppers();
  }

  /* 逐條原則的步進器。
   * 每個 <dt> 是一步；dt 上的 data-out="B" 表示「這一步淘汰拆法 B」，
   * data-in="C" 表示「這一步判定 C 為正解」。兩個都可以有多個，用逗號分隔。
   *
   * 狀態完全由「目前走到第幾步」重算（而不是累加），所以往回走、直接跳到某一步、
   * 重來，走的都是同一段程式，不會有殘留。步數記在 dl.dataset.at 上，卡片則是每次
   * 都重新查——render() 會跑兩次（筆畫資料到之前一次、之後一次，第二次會把卡片
   * 整批換掉），快取住卡片就會在第二次之後指到已經被丟掉的節點。
   */
  function setupSteppers() {
    document.querySelectorAll('.pr-walk[data-stepper]').forEach(function (dl) {
      var box = dl.closest('.pr-walkbox');
      var slot = box && box.querySelector('.pr-example[data-stepped]');
      if (!slot) return;
      var dts = [].slice.call(dl.children).filter(function (n) { return n.tagName === 'DT'; });
      if (!dts.length) return;

      function list(dt, attr) {
        return (dt.getAttribute(attr) || '').split(',').filter(Boolean);
      }

      // 有沒有任何一步宣告 data-show？有的話卡片就是「逐步登場」——在宣告它的那一步
      // 之前完全不出現（Wilson：三種拆法是筆順原則推出來的，在那之前不該先擺著）。
      // 沒有任何 data-show 的例子維持原樣，一開始就全部顯示。
      var staged = dts.some(function (dt) { return dt.hasAttribute('data-show'); });

      function mark(label, ok) {
        var c = slot.querySelector('.pr-card[data-label="' + label + '"]');
        if (!c) return;
        c.className = 'pr-card ' + (ok ? 'is-ok' : 'is-bad') +
          (c.classList.contains('is-unborn') ? ' is-unborn' : '');
        c.querySelector('.pr-mark').textContent = ok ? '✓' : '✕';
        c.title = c.title.replace(/（[^（）]*）$/, ok ? '（正確）' : '（不取，示範用）');
      }

      var bar = box.querySelector('.pr-steps');
      var prev, next, now;
      if (!bar) {
        bar = el('div', 'pr-steps');
        prev = el('button', 'pr-stepbtn');
        next = el('button', 'pr-stepbtn');
        now = el('span', 'pr-stepnow');
        prev.type = next.type = 'button';
        prev.textContent = '‹ 上一步';
        bar.appendChild(prev);
        bar.appendChild(now);
        bar.appendChild(next);
        (box.querySelector('.pr-sticky') || box).appendChild(bar);
        prev.addEventListener('click', function () { show(+dl.dataset.at - 1); });
        next.addEventListener('click', function () {
          var i = +dl.dataset.at;
          show(i >= dts.length - 1 ? 0 : i + 1);
        });
        // 直接點某一條原則就跳到那一步——想回頭看某一步不必按好幾次
        dts.forEach(function (dt, k) {
          dt.tabIndex = 0;
          dt.setAttribute('role', 'button');
          dt.addEventListener('click', function () { show(k); });
          dt.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(k); }
          });
        });
      } else {
        prev = bar.querySelector('.pr-stepbtn');
        next = bar.querySelectorAll('.pr-stepbtn')[1];
        now = bar.querySelector('.pr-stepnow');
      }

      function show(i) {
        var at = Math.max(0, Math.min(dts.length - 1, i || 0));
        dl.dataset.at = at;
        slot.querySelectorAll('.pr-card[data-label]').forEach(function (c) {
          c.className = 'pr-card is-pending' + (staged ? ' is-unborn' : '');
          c.querySelector('.pr-mark').textContent = '';
          c.title = c.title.replace(/（[^（）]*）$/, '（尚未判定）');
        });
        var shown = 0;
        for (var k = 0; k <= at; k++) {
          list(dts[k], 'data-show').forEach(function (L) {
            var c = slot.querySelector('.pr-card[data-label="' + L + '"]');
            if (c) { c.classList.remove('is-unborn'); shown++; }
          });
          list(dts[k], 'data-out').forEach(function (L) { mark(L, false); });
          list(dts[k], 'data-in').forEach(function (L) { mark(L, true); });
        }
        // 三張拆法還沒登場前，方塊裡放沒上色的原字（Wilson）；沒有原字可放的
        // 例子（沒附 plainCard）才把整個方塊收起來，免得留一個空框。
        var plain = slot.querySelector('.pr-card[data-plain]');
        if (plain) plain.classList.toggle('is-unborn', shown > 0);
        slot.classList.toggle('is-unborn', staged && !shown && !plain);
        dts.forEach(function (dt, k) {
          dt.classList.toggle('is-now', k === at);
          dt.classList.toggle('is-later', k > at);
          var dd = dt.nextElementSibling;
          if (dd && dd.tagName === 'DD') dd.classList.toggle('is-later', k > at);
        });
        now.textContent = '第 ' + (at + 1) + ' 步／共 ' + dts.length + ' 步';
        prev.disabled = at === 0;
        next.textContent = at === dts.length - 1 ? '↻ 重來' : '下一步 ›';
      }

      show(+dl.dataset.at || 0);   // 重畫之後回到原本那一步，不要跳回開頭
    });
  }

  /* 孤筆略過判斷流程圖：按一個例字，沿著它實際走的問題／分支高亮一次，
   * 面板右上角同時冒出這個字真正的拆碼小卡（跟正文例字卡同一個 card()，
   * 資料也是同一份 DATA／GLYPHS，不用另外抓一次）。
   * 路徑是手追出來的，不是程式跑出來的——孤筆略過本身（kind=enforced）雖然
   * 有算法可以驗證，但目字旁例外那條在 rules.json 是 kind=manual，沒有一支
   * 函式能回答「這個字走到哪一步」。每條路徑對過 codes.json 的實際 segments
   * 才寫下來（見 yuanze.html 那幾個 pr-example 的說明文字，路徑跟文字說的
   * 是同一件事，只是這裡換成節點 id 的清單）：
   *   文／石：第一筆能跟別的筆劃組成字根，第 1 題就結束。
   *   更：不能組成字根，但它是全字第一筆，第 2 題結束。
   *   便：不能組成字根、不是首尾筆、是橫劃，但不是「目」字本身那一橫，第 4
   *       題以「略過」結束——這裡的橫跟目字旁一點關係都沒有，只是恰好也是橫。
   *   相：跟更同一類（不能組成字根，是全字最後一筆），第 2 題結束，不是靠
   *       目字旁例外，是孤筆略過原則本身「首尾筆不略過」那句。
   *   睛：一路答到第 5 題「是」，目字旁例外成立。
   *   想：跟睛前四題一樣，但第 5 題「不是」（目不在最左，因為木在它左邊），
   *       落到最後那個共用的略過終點（pf-final），不是 pf-out4／pf-out5。
   *   腈：月字旁本身沒有目那多出來的一橫，根本沒有孤立筆劃可以問——這個字
   *       不會進到這個流程圖，path 留空，但整張圖照樣灰掉（is-tracing 沒有
   *       任何 is-active），跟其他字選中時「大部分灰、一條路亮」是同一個
   *       視覺語言，不是另外開一種「無效」狀態。
   */
  function setupFlowTester() {
    var wrap = document.querySelector('.pr-flow-test');
    if (!wrap) return;
    var svg = document.querySelector('.pr-flow-svg');
    var note = document.querySelector('.pr-flow-test-note');
    var glyph = document.querySelector('.pr-flow-glyph');
    var buttons = wrap.querySelectorAll('[data-flow-char]');
    var clearBtn = wrap.querySelector('[data-flow-clear]');

    var FLOW = {
      '文': { path: ['pf-q1', 'pf-hline1', 'pf-out1'],
              result: '「文」：這一橫能跟上方的一點組成「亠」，取 I，整個字取 IX。' },
      '石': { path: ['pf-q1', 'pf-hline1', 'pf-out1'],
              result: '「石」：這一橫能跟下面的撇組成一個字根，取 J，整個字取 JO。' },
      '更': { path: ['pf-q1', 'pf-vline1', 'pf-q2', 'pf-hline2', 'pf-out2'],
              result: '「更」：這一橫不能跟其他筆劃組成字根，但它是全字第一筆，不略過，整個字取 IBX。' },
      '相': { path: ['pf-q1', 'pf-vline1', 'pf-q2', 'pf-hline2', 'pf-out2'],
              result: '「相」：這一橫不能跟其他筆劃組成字根，但它是全字最後一筆，不略過，整個字取 TDI。' },
      '便': { path: ['pf-q1', 'pf-vline1', 'pf-q2', 'pf-vline2', 'pf-q3', 'pf-vline3',
                     'pf-q4', 'pf-hline4', 'pf-out4'],
              result: '「便」：這一橫不能跟其他筆劃組成字根，不是首尾筆，雖然是橫劃，但不是「目」字本身那一橫，略過，整個字取 YBX。' },
      '睛': { path: ['pf-q1', 'pf-vline1', 'pf-q2', 'pf-vline2', 'pf-q3', 'pf-vline3',
                     'pf-q4', 'pf-vline4', 'pf-q5', 'pf-hline5', 'pf-out5'],
              result: '「睛」：這一橫一路確認到「目」在全字最左方，目字旁例外成立，不略過，取 I，整個字取 DIFD。' },
      '想': { path: ['pf-q1', 'pf-vline1', 'pf-q2', 'pf-vline2', 'pf-q3', 'pf-vline3',
                     'pf-q4', 'pf-vline4', 'pf-q5', 'pf-vline5', 'pf-final'],
              result: '「想」：跟「睛」前四題答案一樣，但「目」不在全字最左方（木在它左邊），略過，整個字取 TDW。' },
      '腈': { path: [], result: '「腈」：沒有孤立的橫劃或豎劃。' }
    };

    function clear() {
      if (svg) {
        svg.classList.remove('is-tracing');
        Array.prototype.forEach.call(svg.querySelectorAll('.is-active'), function (n) {
          n.classList.remove('is-active');
        });
      }
      Array.prototype.forEach.call(buttons, function (b) { b.classList.remove('is-active'); });
      note.hidden = true;
      if (glyph) { glyph.hidden = true; glyph.textContent = ''; }
    }

    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var ch = btn.getAttribute('data-flow-char');
        var wasActive = btn.classList.contains('is-active');
        clear();
        if (wasActive) return;   // 再按一次同一個字＝取消
        var info = FLOW[ch];
        if (!info) return;
        btn.classList.add('is-active');
        note.textContent = info.result;
        note.hidden = false;
        if (svg) {
          svg.classList.add('is-tracing');   // 沒有路徑（腈）也整張圖照樣灰掉
          info.path.forEach(function (id) {
            var n = document.getElementById(id);
            if (n) n.classList.add('is-active');
          });
        }
        var entry = DATA && DATA[ch];
        if (glyph && entry) {
          glyph.textContent = '';
          glyph.appendChild(card(ch, entry.correct, true));
          glyph.hidden = false;
        }
      });
    });

    if (clearBtn) clearBtn.addEventListener('click', clear);
  }

  fetch('assets/principles.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      render();               // 文字先畫出來，筆畫資料還沒到就先顯示純文字退路
      return fetch('assets/glyphs.json');
    })
    .then(function (r) { return r.json(); })
    .then(function (g) {
      GLYPHS = g.glyphs;
      render();                // 拿到筆畫資料後重畫一次，補上顏色分組
    })
    .catch(function () { /* 保持純文字退路 */ });

  setupFlowTester();   // 跟 DATA／GLYPHS 是否已經到位無關，按鈕點下去那一刻才需要
})();
