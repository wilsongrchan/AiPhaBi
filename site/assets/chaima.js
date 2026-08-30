/* 〈拆碼查詢〉：兩個輸入框，一塊結果。
 *
 *   拼音框 —— 知道讀音、不知道怎麼拆。資料是 assets/pinyin.json：**全部**已取碼
 *             的字都查得到，查拼音（不分聲調）。有沒有彩色拆碼圖是另一件事，
 *             見下面的說明。
 *   貼字框 —— 手上已經有字了（一個、或整句），要知道每個字怎麼打。
 *
 * 兩個框查出來的東西是同一種（一批字），所以共用下面同一片卡牆，不各自佔一節
 * （Wilson）。同時只有一個框說了算：在一個框裡打字，另一個框就清空 —— 兩批
 * 結果疊在一起沒有意義，而且看不出現在這批是誰查出來的。
 *
 * ⚠️ 兩種資料的涵蓋範圍不一樣，這是刻意的，不是漏做：
 *   · 碼 來自 dict.json 的 main，**全部**已取碼的字都有（7000 上下）。
 *   · 田字格的筆畫與字根上色 來自 pinyin_glyphs.json，只有現代字頻最高的一批、
 *     加上真正的簡化字裡最常用的一批才有（見 build_site_data.py 的
 *     PINYIN_TOP_N／PINYIN_SIMP_TOP_N）。
 *   冷僻字查得到碼，只是沒有彩色拆碼圖（Wilson 指定：有碼就給碼，不要因為畫
 *   不出圖就假裝查不到）。所以每張卡有三種樣子：
 *     有碼有圖 → 彩色田字格＋彩色碼格
 *     有碼沒圖 → 空田字格（paintGlyph 自己會退回系統字型）＋深灰的碼格
 *     沒有碼   → 明說還沒取碼
 *
 * pinyin_glyphs.json 有 7.9 MB，不在開頁時抓 —— 第一次真的查東西才開始抓，
 * 到之前先把碼顯示出來，到了之後把已經畫出來的卡牆重畫一次補上顏色。
 */
(function () {
  'use strict';

  var el = ZG.el, segsFrom = ZG.segsFrom, paintGlyph = ZG.paintGlyph;

  var D = null;                 // dict.json：main（字 → 碼）
  var PY = null;                // pinyin.json：index（拼音 → 字）、conv（約定字）
  var convSet = null;           // PY.conv 轉成 Set，卡片角標查詢用
  var G = { state: null, segs: null, glyphs: null };   // pinyin_glyphs.json
  var PP = { state: null, idx: null };                // pyphrase.json：拼音串 → 詞

  var pyIn, txIn, wall, note, cbColour, cbGrid, bpmfBox;
  var src = null;               // 'py' | 'tx'：現在牆上這批是誰查出來的
  var pyMode = 'pinyin';        // 'pinyin' | 'zhuyin'：拼音框現在收哪種輸入

  /* 一次最多畫幾張卡。貼一整篇文章進來的話，幾百張田字格的 SVG 會讓頁面明顯
     卡頓，而且也不是查閱該有的樣子 —— 超過就只畫前面這些，並且說清楚。 */
  var WALL_MAX = 200;

  function isHan(c) { return c >= '一' && c <= '鿿'; }

  /* ---------- 重的那一份：第一次查才抓 ---------- */
  function loadGlyphs() {
    if (G.state) return;                       // 'loading' 或 'ready' 都不再抓
    G.state = 'loading';
    fetch('assets/pinyin_glyphs.json')
      .then(function (r) { return r.json(); })
      .then(function (g) {
        G.state = 'ready';
        G.segs = g.segs;
        G.glyphs = g.glyphs;
        render();                              // 補上顏色
      })
      .catch(function () { G.state = null; });  // 失敗就讓下一次再試
  }

  /* 拼音查詞的表（0.9 MB）：跟拆碼圖一樣，等使用者真的打了拼音才抓。
     它到之前查得到字、查不到詞，到了之後把畫面重畫一次補上詞。 */
  function loadPhrases() {
    if (PP.state) return;
    PP.state = 'loading';
    fetch('assets/pyphrase.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { PP.state = 'ready'; PP.idx = j; if (src === 'py') render(); })
      .catch(function () { PP.state = null; });
  }


  /* 這個字的簡碼用到哪幾條字根。兩種簡碼**各自一個開關**（Wilson），跟試打頁
     那一排「套用簡碼」是同一組詞、同一個關係：

       · 約定簡碼（dict.json 的 short_rev，67 個）—— **也是照位置**：兩碼取
         「首＋末」，三碼取「首二＋末」。〈簡碼〉頁講的就是這條規則，建置時也
         驗過（56 條兩碼、11 條三碼，零例外）。
         ⚠️ 一開始這裡寫成「拿簡碼字母去貪心比對」，錯在字母會重複：個 的字根是
         Y O T O、簡碼 YO 指的是**首與末**那兩個 O 裡的後面那個，貪心卻比到第二
         條字根（Wilson 抓到）。全部 66 個有字形資料的約定簡碼跑過一遍：位置法
         全對，貪心法在 個 能 看 幾 從 這五個字上淡錯字根。
       · 三簡碼 —— 四條字根以上的字才有，規則是「頭兩條＋最後一條」。這裡直接用
         **位置**（0、1、末），不用字母比對：末碼的字母要是在中間也出現過，貪心
         會比到前面那一個，淡錯字根。

     兩個都開的時候約定簡碼優先，那 67 個字走約定、其餘走三簡 —— 跟輸入法裡的
     關係一致（約定簡碼是手挑的例外，三簡碼是自動的通則）。
     回傳 { keep: 要保留顏色的字根序號, kind: 'conv' | 'short3' }，沒有簡碼可講
     就回 null，照原樣顯示。kind 是給卡片右上角那個角標用的。 */
  function shortIdx(ch, segs) {
    if (!segs || !D) return null;
    if (opts.conv) {
      var conv = D.short_rev && D.short_rev[ch];
      if (conv) {
        var want = conv.toUpperCase(), last = segs.length - 1;
        var keep = want.length === 2 ? [0, last]
                 : want.length === 3 ? [0, 1, last] : null;
        if (!keep || last < keep.length - 1) return null;
        // 對不起來就不要亂淡（將來多一條不照規則的簡碼，寧可什麼都不做）
        for (var i = 0; i < keep.length; i++)
          if (segs[keep[i]].L.toUpperCase() !== want.charAt(i)) return null;
        return { keep: keep, kind: 'conv' };
      }
    }
    if (opts.short3 && segs.length >= 4)
      return { keep: [0, 1, segs.length - 1], kind: 'short3' };
    return null;
  }

  /* 選出來的字，所有字根一次全部上色（不像〈跟著打〉是打對幾碼亮幾條）。 */
  function fullColourMap(segs, keep) {
    if (!segs) return null;
    var map = {};
    for (var i = 0; i < segs.length; i++) {
      // keep 有給、而且這一條不在裡面 → -2，paintGlyph 會畫成淺灰（見 glyphbox.js）
      var v = (keep && keep.indexOf(i) < 0) ? -2 : i;
      for (var k = 0; k < segs[i].st.length; k++) map[segs[i].st[k]] = v;
    }
    return map;
  }

  /* ---------- 現在要畫哪些字 ---------- */

  /* 貼進來的東西 → 要查的字。只留漢字（標點、英數、空白都跳過），**不去重**：
     重複出現的字要照樣一張一張畫出來（Wilson）。貼一句話進來的人是照著這排
     卡片一個一個往下打的，把第二次出現的「的」抽掉，卡片的順序就跟他要打的
     順序對不上了。 */
  function charsOf(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (isHan(c)) out.push(c);
    }
    return out;
  }

  /* ⚠️ 候選字的順序**照 pinyin.json 給的**，這裡不要再排一次。
     build_pinyin() 已經排好兩層：本音的字在前、破音的字在後，各自再照
     charfreq（台港新聞用字）排。客戶端要是拿 dict.json 的 order 重排一次，
     第一層就沒了 —— 打 long 會再看到 寵龐弄 混在 龍隆籠 裡面。
     （dict.json 的 order 來自 freq.json，跟 charfreq 是**兩份不同的字頻**，
     排出來不一樣：bai 底下 charfreq 給 敗 在前、freq.json 給 白 在前。
     要換成哪一份是另一個問題，換的話應該在 build_pinyin 裡換，不是在這裡。） */

  /* 把一串拼音切成音節：bairi → ['bai','ri']（Wilson 要能查詞）。
     貪心取最長 —— 每一步都拿還接得下去的最長音節，這是拼音切分的通例，
     xian 會切成 xian 而不是 xi+an。任何一步切不出東西就整串當作切不開，
     回 null，呼叫端退回「就當它是一個音節」去查（查不到自然會說查無）。 */
  var SYL_MAX = 6;                      // zhuang、chuang 這類最長就是六個字母
  function splitPinyin(q) {
    var out = [], i = 0;
    while (i < q.length) {
      var hit = null;
      for (var n = Math.min(SYL_MAX, q.length - i); n >= 1; n--) {
        var seg = q.substr(i, n);
        if (PY.index[seg]) { hit = seg; break; }
      }
      if (!hit) return null;
      out.push(hit);
      i += hit.length;
    }
    return out.length ? out : null;
  }

  /* 多音節時每個音節只取前幾個字：查「bairi」是想看 白日，不是想看 bai 的
     十二個字加 ri 的一個字全部攤開。單音節不設限 —— 那時使用者要的正是
     「這個音有哪些字」。 */
  var PER_SYL = 8;
  var pyWords = null;                   // 這次配到的詞（排在最前面，不對外解釋）

  /* 打 bairi 的人要的是「白日」，不是 bai 的十二個字接著 ri 的一個字（Wilson）。
     所以整串拼音先去 pyphrase.json 配詞：配到就把那些詞的字**排在最前面**，
     照詞裡的順序，後面才接每個音節的常用字。詞是出貨碼表裡本來就有的，這裡
     只是多一條從拼音找到它的路。
     ⚠️ 注音模式不查詞、不切多音節——螢幕鍵盤跟鍵盤直接對應（見 assets/bpmf.js）
     一次就是一個注音符號一個注音符號地拼，拼出來的是**一個音節**，跟拼音那種
     可以貼一整串字母、要靠 splitPinyin() 猜切法的情況不一樣，直接查
     zhuyin_index 就好，不必比照辦理。 */
  function pyChars() {
    var raw = pyIn.value.trim();
    pyWords = null;
    if (!raw || !PY) return [];

    if (pyMode === 'zhuyin') {
      // 打了調號鍵就查帶調的那份（只找那個聲調），沒打就查不分調的那份
      // （四聲全找）——跟〈線上試打〉同一套規則（見 try.js 的 onPyqInput）。
      var zidx = raw.search(BPMF.TONE_MARKS) >= 0 ? PY.zhuyin_tone_index : PY.zhuyin_index;
      return raw && zidx ? (zidx[raw] || []).slice() : [];
    }

    var q = raw.toLowerCase().replace(/[\s'’]+/g, '');
    var out = [], seen = {};
    function push(ch) { if (!seen[ch]) { seen[ch] = 1; out.push(ch); } }

    var words = PP.idx && PP.idx[q];
    if (words && words.length) {
      pyWords = words.slice(0, 6);
      pyWords.forEach(function (w) {
        for (var i = 0; i < w.length; i++) push(w.charAt(i));
      });
    }

    if (PY.index[q]) {                               // 整串就是一個音節
      PY.index[q].forEach(push);
      return out;
    }

    var syls = splitPinyin(q);
    if (!syls) return out;
    syls.forEach(function (sy) {
      PY.index[sy].slice(0, PER_SYL).forEach(push);
    });
    return out;
  }

  function wanted() {
    if (src === 'py') return pyChars();
    if (src === 'tx') return charsOf(txIn.value);
    return [];
  }

  /* ---------- 畫 ---------- */
  function card(ch) {
    var box = el('div', 'cm-card');
    var segs = segsFrom(G.segs, ch);
    var code = D && D.main[ch];

    var sh = shortIdx(ch, segs), keep = sh && sh.keep;

    var cell = el('div', 'tianzi');
    paintGlyph(cell, ch, G.glyphs && G.glyphs[ch], fullColourMap(segs, keep));
    box.appendChild(cell);

    /* 純文字的字，永遠畫、平常用 CSS 藏起來。關掉「拆碼圖」之後田字格會
       display:none，那時字就只剩在 SVG 的 aria-label 裡了 —— 看不見的字等於
       沒查到。放在這裡而不是在切換時才補，是為了讓切換只動 class，不重畫。 */
    box.appendChild(el('span', 'cm-ch', ch));

    /* 右上角的角標：這個字現在是照簡碼在顯示（Wilson）。沒有它，淡掉的碼格
       跟「這個字本來就沒有那幾條字根」看起來一樣。兩種簡碼各一個字，全名放在
       title／aria-label 裡 —— 卡片只有幾 rem 寬，塞不下四個字。 */
    if (sh) {
      var tag = el('span', 'cm-tag is-' + sh.kind, sh.kind === 'conv' ? '簡' : '三');
      tag.title = sh.kind === 'conv' ? '約定簡碼' : '三簡碼';
      tag.setAttribute('aria-label', tag.title);
      box.appendChild(tag);
    }

    /* 右上角另一顆角標，疊在簡碼角標正下方：這個字本身不是照筆畫拆的，是
       取碼原則第 8 條「約定俗成」整字認的（見〈約定字表〉）——跟上面那顆
       簡碼角標是兩件不相干的事（一個講「這個字有沒有更短的簡碼」，這個講
       「這個字本身怎麼取碼」）。放左上角會被讀成「左邊那張卡的角標溢出來」
       （卡牆一排一排排，Wilson 指出這個歧義），所以跟簡碼角標同一側，
       用兩行字疊起來（見 site.css 的 .cm-tag.is-except）維持窄版面。 */
    if (convSet && convSet.has(ch)) {
      // 簡碼角標不在的話，約定角標直接佔右上角那個位置；兩顆都要出現時
      // 才把約定角標往下推（is-bumped，見 site.css），免得疊在一起
      // （Wilson：預設要在右上角，兩顆都有才往下擠）。
      var exTag = el('span', 'cm-tag is-except' + (sh ? ' is-bumped' : ''));
      exTag.innerHTML = '約<br>定';
      exTag.title = '約定字：不是照筆畫拆的，取碼原則第 8 條整字認';
      exTag.setAttribute('aria-label', exTag.title);
      box.appendChild(exTag);
    }

    var foot = el('div', 'cm-foot');
    if (segs) {
      /* 碼一律整條顯示，簡碼沒用到的那幾格只是淡掉，不是拿走（Wilson）——
         看得到完整的主碼，才知道簡碼是從哪裡簡出來的。 */
      var row = el('span', 'tz-hintcodes');
      segs.forEach(function (s, i) {
        var dim = keep && keep.indexOf(i) < 0;
        row.appendChild(el('span', 'tz-chip z' + (i % 6) + (dim ? ' is-dim' : ''), s.L));
      });
      foot.appendChild(row);
    } else if (code) {
      /* 沒有拆碼圖，但碼還是照同一個樣子排：一個字母一格、白字。只是沒有分段
         資訊，配不出顏色，所以整排是中性的深灰（Wilson）—— 一眼就分得出
         「這個字沒有拆碼圖」，又不會變成另一種長相的東西。 */
      var plain = el('span', 'tz-hintcodes');
      code.toUpperCase().split('').forEach(function (L) {
        plain.appendChild(el('span', 'tz-chip is-plain', L));
      });
      foot.appendChild(plain);
    } else {
      // 有這個字、但字表裡還沒有它的碼。說出來，不要留一格空白讓人以為壞了。
      box.className += ' is-none';
      foot.appendChild(el('span', 'cm-none', '尚未取碼'));
    }
    box.appendChild(foot);
    return box;
  }

  function render() {
    var chars = wanted();
    wall.innerHTML = '';
    note.textContent = '';

    if (!chars.length) {
      // 只在真的打了東西卻查不到時才出聲。空白的框不必被唸。
      if (src === 'py' && pyIn.value.trim())
        note.textContent = pyMode === 'zhuyin'
          ? '查無這個注音的字，冷僻字請直接把字貼進右邊的框。'
          : '查無這個拼音的字，冷僻字請直接把字貼進右邊的框。';
      return;
    }

    var shown = chars.slice(0, WALL_MAX);
    shown.forEach(function (ch) { wall.appendChild(card(ch)); });

    /* ⚠️ 這裡**不要**解釋自己是怎麼查的（Wilson）。「配到詞：你好、妳好」、
       「拼音切成 ni・hao」那類話講的是程式的內部推論，不是使用者的問題的答案 ——
       他要的是「這些字怎麼打」，答案就在卡片上。留下來的兩句都是他真的需要
       知道的事：畫不完，以及有字還沒取碼。 */
    var notes = [];
    if (chars.length > WALL_MAX)
      notes.push('這裡只畫前 ' + WALL_MAX + ' 個（一共 ' + chars.length + ' 個字）');

    /* 「有幾個字沒有拆碼圖」這句話**不要講**（Wilson）——查到的人要的是碼，
       碼已經在那裡了；補一句「有一個字沒有圖」只是在提醒他一件他沒有損失的事。
       深灰的碼格本身就說明了那個字沒有圖，不必再用文字重複一次。
       「還沒取碼」那句留著：那是真的查不到東西，不說他會以為是壞了。

       ⚠️ 算的是**不重複**的字 —— 牆上不去重，一句話裡出現五次的同一個字要是
       算成五個，這句話就變成在嚇人。 */
    var uniq = [], seen = {};
    shown.forEach(function (ch) { if (!seen[ch]) { seen[ch] = 1; uniq.push(ch); } });
    var noCode = uniq.filter(function (ch) { return !(D && D.main[ch]); });
    if (noCode.length) notes.push(noCode.length + ' 個字還沒取碼');
    if (notes.length) note.textContent = notes.join('；') + '。';
  }

  /* 在一個框裡打字，就把另一個框清掉：牆上同時只呈現一批結果 */
  function onInput(which, other) {
    return function () {
      loadGlyphs();
      if (which === 'py') loadPhrases();
      src = which;
      other.value = '';
      render();
    };
  }

  /* 插入注音符號到拼音框游標位置——鍵盤直接對應跟螢幕鍵盤點選共用這一個
   * 函式（跟〈線上試打〉的 insertPyqChar 同一個做法）。 */
  function insertPy(ch) {
    var s = pyIn.selectionStart, e = pyIn.selectionEnd, v = pyIn.value;
    pyIn.value = v.slice(0, s) + ch + v.slice(e);
    pyIn.selectionStart = pyIn.selectionEnd = s + ch.length;
    onInput('py', txIn)();
  }


  /* ---------- 顯示選項 ----------
     三個都只改「看起來怎樣」，查到的是哪些字完全不受影響 —— 所以全部做成
     卡牆上的 class，切換時一個節點都不用重畫。
       大小       is-lg / is-md / is-sm
       字根顏色   is-mono（田字格全黑、碼格全部同一個深色）
       拆碼圖     is-nogrid（藏起田字格，只剩字與碼）
     選擇記在 localStorage，跟站上其他開關同一個做法。 */
  var OPT_KEY = 'aiphabi-chaima-opts';
  var opts = { size: 'md', colour: true, grid: true, conv: false, short3: false };

  function applyOpts() {
    /* ⚠️ 沒有拆碼圖就一律黑白（Wilson）：彩色的碼格是在指路 —— 每一格的顏色
       對應田字格裡那幾筆。田字格不在了，那些顏色就沒有指向任何東西，只剩一排
       莫名其妙的彩色方塊。所以「字根顏色」只有在拆碼圖開著時才作數。
       使用者原本的選擇留在 opts.colour 裡，拆碼圖開回來就照舊 —— 不要因為他
       關過一次拆碼圖，就把他的顏色偏好也一起洗掉。 */
    var colour = opts.colour && opts.grid;
    wall.className = 'cm-wall is-' + opts.size +
      (colour ? '' : ' is-mono') + (opts.grid ? '' : ' is-nogrid');
    if (cbColour) {
      cbColour.checked = colour;
      cbColour.disabled = !opts.grid;
      cbColour.parentNode.classList.toggle('is-off', !opts.grid);
    }
  }

  function saveOpts() {
    try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (e) {}
  }

  function setupOpts() {
    try {
      var saved = JSON.parse(localStorage.getItem(OPT_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (saved.size === 'lg' || saved.size === 'md' || saved.size === 'sm') opts.size = saved.size;
        opts.colour = saved.colour !== false;
        opts.grid = saved.grid !== false;
        opts.conv = saved.conv === true;
        opts.short3 = saved.short3 === true;
      }
    } catch (e) {}

    var radios = document.querySelectorAll('input[data-cmsize]');
    Array.prototype.forEach.call(radios, function (r) {
      r.checked = r.getAttribute('data-cmsize') === opts.size;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        opts.size = r.getAttribute('data-cmsize');
        applyOpts(); saveOpts();
      });
    });

    var cc = cbColour = document.getElementById('cm-colour'),
        cg = cbGrid = document.getElementById('cm-grid'),
        cv = document.getElementById('cm-conv'), c3 = document.getElementById('cm-short3');
    cg.checked = opts.grid;
    cv.checked = opts.conv;
    c3.checked = opts.short3;
    cc.addEventListener('change', function () { opts.colour = cc.checked; applyOpts(); saveOpts(); });
    cg.addEventListener('change', function () { opts.grid = cg.checked; applyOpts(); saveOpts(); });
    /* ⚠️ 兩個簡碼開關跟另外兩個不一樣：它們改的是**每張卡要畫成什麼樣子**，
       不是整片牆的長相，所以不能只換 class，要重畫。 */
    cv.addEventListener('change', function () { opts.conv = cv.checked; saveOpts(); render(); });
    c3.addEventListener('change', function () { opts.short3 = c3.checked; saveOpts(); render(); });

    applyOpts();
  }

  /* ---------- 起手 ---------- */
  function boot() {
    pyIn = document.getElementById('cm-py-input');
    txIn = document.getElementById('cm-tx-input');
    wall = document.getElementById('cm-wall');
    note = document.getElementById('cm-note');
    bpmfBox = document.getElementById('cm-bpmf');

    setupOpts();

    // 拼音／注音切換：跟〈線上試打〉共用 assets/bpmf.js，切模式時清掉輸入框
    // （兩邊查的索引不一樣，舊的查詢字串留著沒意義），換 placeholder，
    // 注音模式才展開螢幕鍵盤。
    Array.prototype.forEach.call(document.querySelectorAll('[data-pyq-mode]'), function (b) {
      b.addEventListener('click', function () {
        pyMode = b.dataset.pyqMode;
        var zh = pyMode === 'zhuyin';
        pyIn.value = '';
        pyIn.placeholder = zh ? '在這裡輸入注音，或點選下面鍵盤' : '例如：bai 或 bairi';
        bpmfBox.hidden = !zh;
        Array.prototype.forEach.call(document.querySelectorAll('[data-pyq-mode]'), function (btn) {
          btn.setAttribute('aria-pressed', String(btn.dataset.pyqMode === pyMode));
        });
        src = 'py'; txIn.value = ''; render();
        pyIn.focus();
      });
    });
    BPMF.attachKeydown(pyIn, function () { return pyMode === 'zhuyin'; }, insertPy);
    BPMF.build(bpmfBox, function (ch) { insertPy(ch); pyIn.focus(); },
               function () { pyIn.value = pyIn.value.slice(0, -1); onInput('py', txIn)(); pyIn.focus(); });

    pyIn.addEventListener('input', onInput('py', txIn));
    txIn.addEventListener('input', onInput('tx', pyIn));
    pyIn.addEventListener('focus', function () { loadGlyphs(); loadPhrases(); });
    txIn.addEventListener('focus', loadGlyphs);

    // 碼是兩個框都要的，沒有它整頁都沒得查，所以失敗要說話
    fetch('assets/dict.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        D = d;
        // 重新整理時瀏覽器可能把上次打的字留在框裡
        if (txIn.value.trim()) { src = 'tx'; render(); }
        else if (pyIn.value.trim()) { src = 'py'; render(); }
      })
      .catch(function () { note.textContent = '字表載入失敗，請重新整理。'; });

    // 拼音只有左邊那個框要用，抓不到就把它關掉，不影響貼字查碼
    fetch('assets/pinyin.json')
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (!p || !p.index) throw new Error('no index');
        PY = p;
        convSet = new Set(p.conv || []);
        if (src === 'py') render();
      })
      .catch(function () {
        pyIn.disabled = true;
        pyIn.placeholder = '拼音資料載入失敗';
      });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
