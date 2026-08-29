/* 〈拆碼查詢〉：兩個輸入框，一塊結果。
 *
 *   拼音框 —— 知道讀音、不知道怎麼拆。資料是 assets/pinyin.json：已取碼的字裡
 *             現代字頻最高的 3000 個，查拼音（不分聲調）。
 *   貼字框 —— 手上已經有字了（一個、或整句），要知道每個字怎麼打。
 *
 * 兩個框查出來的東西是同一種（一批字），所以共用下面同一片卡牆，不各自佔一節
 * （Wilson）。同時只有一個框說了算：在一個框裡打字，另一個框就清空 —— 兩批
 * 結果疊在一起沒有意義，而且看不出現在這批是誰查出來的。
 *
 * ⚠️ 兩種資料的涵蓋範圍不一樣，這是刻意的，不是漏做：
 *   · 碼 來自 dict.json 的 main，**全部**已取碼的字都有（7000 上下）。
 *   · 田字格的筆畫與字根上色 來自 pinyin_glyphs.json，只有 3000 個字有。
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
  var G = { state: null, segs: null, glyphs: null };   // pinyin_glyphs.json
  var PP = { state: null, idx: null };                // pyphrase.json：拼音串 → 詞

  var pyIn, txIn, wall, note;
  var src = null;               // 'py' | 'tx'：現在牆上這批是誰查出來的

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


  /* 這個字的簡碼用到哪幾條字根。
       · 約定簡碼（dict.json 的 short_rev，67 個）優先 —— 它是人挑的，沒有規則
         可循，所以拿簡碼的字母去跟這個字的字根字母**由左到右貪心比對**，
         比到的那幾條就是它用到的（的 JA 對上 J…A，我 JKQ 對上 JK…Q）。
       · 沒有約定簡碼、而字根有四條以上 → 三簡碼，規則是「頭兩條＋最後一條」。
         這裡直接用**位置**（0、1、末），不用字母比對 —— 末碼的字母要是在中間
         也出現過，貪心會比到前面那一個，淡錯字根。
       · 三條以下又沒有約定簡碼 → 沒有簡碼可講，回 null，照原樣顯示。
     回傳的是「要保留顏色的字根序號」。 */
  function shortIdx(ch, segs) {
    if (!segs || !D) return null;
    var conv = D.short_rev && D.short_rev[ch];
    if (conv) {
      var want = conv.toUpperCase(), keep = [], k = 0;
      for (var i = 0; i < segs.length && k < want.length; i++) {
        if (segs[i].L.toUpperCase() === want.charAt(k)) { keep.push(i); k++; }
      }
      return k === want.length ? keep : null;   // 比不完就別亂淡
    }
    if (segs.length >= 4) return [0, 1, segs.length - 1];
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

  /* 一個音節的候選字，照現代字頻排。
     ⚠️ pinyin.json 裡每個音節的字**不是**照字頻排的（實測 bai 是「敗派白百…」，
     白 排第三）。那一份的字頻只用在「挑哪 3000 個字收進來」，收進來之後就沒再
     排過。查字的人要的是最常用的排前面，所以這裡自己照 dict.json 的 order
     （現代字頻序）排一次。 */
  var rank = null;
  function byFreq(list) {
    if (!rank) {
      rank = {};
      var o = (D && D.order) || '';
      for (var i = 0; i < o.length; i++) rank[o.charAt(i)] = i;
    }
    return list.slice().sort(function (a, b) {
      return (rank[a] == null ? 1e9 : rank[a]) - (rank[b] == null ? 1e9 : rank[b]);
    });
  }

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
  var pySplit = null;                   // 這次是怎麼切的，給下面那句說明用
  var pyWords = null;                   // 這次配到的詞

  /* 打 bairi 的人要的是「白日」，不是 bai 的十二個字接著 ri 的一個字（Wilson）。
     所以整串拼音先去 pyphrase.json 配詞：配到就把那些詞的字**排在最前面**，
     照詞裡的順序，後面才接每個音節的常用字。詞是出貨碼表裡本來就有的，這裡
     只是多一條從拼音找到它的路。 */
  function pyChars() {
    var q = pyIn.value.trim().toLowerCase().replace(/[\s'’]+/g, '');
    pySplit = null;
    pyWords = null;
    if (!q || !PY) return [];

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
      byFreq(PY.index[q]).forEach(push);
      return out;
    }

    var syls = splitPinyin(q);
    if (!syls) return out;
    pySplit = syls;
    syls.forEach(function (sy) {
      byFreq(PY.index[sy]).slice(0, PER_SYL).forEach(push);
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

    var keep = opts.short ? shortIdx(ch, segs) : null;

    var cell = el('div', 'tianzi');
    paintGlyph(cell, ch, G.glyphs && G.glyphs[ch], fullColourMap(segs, keep));
    box.appendChild(cell);

    /* 純文字的字，永遠畫、平常用 CSS 藏起來。關掉「拆碼圖」之後田字格會
       display:none，那時字就只剩在 SVG 的 aria-label 裡了 —— 看不見的字等於
       沒查到。放在這裡而不是在切換時才補，是為了讓切換只動 class，不重畫。 */
    box.appendChild(el('span', 'cm-ch', ch));

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
        note.textContent = '查無這個拼音的字。拼音查字只收已取碼的字裡最常用的 3000 個，' +
                           '冷僻字請直接把字貼進右邊的框。';
      return;
    }

    var shown = chars.slice(0, WALL_MAX);
    shown.forEach(function (ch) { wall.appendChild(card(ch)); });

    var notes = [];
    if (pyWords) notes.push('配到詞：' + pyWords.join('、') + '（排在最前面）');
    if (pySplit)
      notes.push('拼音切成 ' + pySplit.join('・') + '，每個音節列最常用的 ' + PER_SYL + ' 個字');
    if (chars.length > WALL_MAX)
      notes.push('這裡只畫前 ' + WALL_MAX + ' 個（一共 ' + chars.length + ' 個字）');

    /* 底下這兩句講的是「有幾個字沒有圖／沒有碼」，算的是**不重複**的字 ——
       牆上不去重，一句話裡出現五次的同一個冷僻字要是算成五個，這句話就變成
       在嚇人。 */
    var uniq = [], seen = {};
    shown.forEach(function (ch) { if (!seen[ch]) { seen[ch] = 1; uniq.push(ch); } });
    if (G.state === 'ready') {
      var noGlyph = uniq.filter(function (ch) { return D && D.main[ch] && !segsFrom(G.segs, ch); });
      if (noGlyph.length)
        notes.push(noGlyph.length + ' 個字只有碼、沒有拆碼圖（拆碼圖只做了最常用的 3000 個字）');
    }
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


  /* ---------- 顯示選項 ----------
     三個都只改「看起來怎樣」，查到的是哪些字完全不受影響 —— 所以全部做成
     卡牆上的 class，切換時一個節點都不用重畫。
       大小       is-lg / is-md / is-sm
       字根顏色   is-mono（田字格全黑、碼格全部同一個深色）
       拆碼圖     is-nogrid（藏起田字格，只剩字與碼）
     選擇記在 localStorage，跟站上其他開關同一個做法。 */
  var OPT_KEY = 'aiphabi-chaima-opts';
  var opts = { size: 'md', colour: true, grid: true, short: false };

  function applyOpts() {
    wall.className = 'cm-wall is-' + opts.size +
      (opts.colour ? '' : ' is-mono') + (opts.grid ? '' : ' is-nogrid');
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
        opts.short = saved.short === true;
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

    var cc = document.getElementById('cm-colour'), cg = document.getElementById('cm-grid'),
        cs = document.getElementById('cm-short');
    cc.checked = opts.colour;
    cg.checked = opts.grid;
    cs.checked = opts.short;
    cc.addEventListener('change', function () { opts.colour = cc.checked; applyOpts(); saveOpts(); });
    cg.addEventListener('change', function () { opts.grid = cg.checked; applyOpts(); saveOpts(); });
    /* ⚠️ 簡碼跟另外兩個不一樣：它改的是**每張卡要畫成什麼樣子**，不是整片牆的
       長相，所以不能只換 class，要重畫。 */
    cs.addEventListener('change', function () { opts.short = cs.checked; saveOpts(); render(); });

    applyOpts();
  }

  /* ---------- 起手 ---------- */
  function boot() {
    pyIn = document.getElementById('cm-py-input');
    txIn = document.getElementById('cm-tx-input');
    wall = document.getElementById('cm-wall');
    note = document.getElementById('cm-note');

    setupOpts();

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
