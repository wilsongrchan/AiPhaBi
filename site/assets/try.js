/* 線上試打 —— 直接查 assets/dict.json，那份是從 data/codes.json 產生的，
 * 所以這裡打得出來的字跟真正的輸入法一致（每次網站部署時重新產生）。
 *
 * 這是「夠真實可以體會設計」的版本，不是完整模擬。目前有：
 *   主碼／完整碼／兼容碼查詢、前綴補全、字頻排序、約定簡碼（含提示）、萬用鍵、正體標點。
 * 還沒有（真正的輸入法有）：三簡碼、左簡碼、詞組連打、輸入容錯、同類字、偏旁碼。
 * 別讓這一頁默默宣稱它是全部 —— 頁面底下那個 .todo 方塊要跟這段話一起改。
 */
(function () {
  'use strict';

  var out   = document.getElementById('out');
  var rail  = document.getElementById('rail');
  var state = { buf: '', cands: [], data: null };

  // 字母鍵全給字根用了，標點落在原本的標點鍵上（跟 rime/README.md 那張表一致）
  var PUNCT = {
    ',': '，', '.': '。', '?': '？', '!': '！', ';': '；', ':': '：',
    // ⚠️ '/' 不在這裡 —— 它是提示鍵（見 hintStep）。、 還是打得出來，用 \ 那一顆。
    '\\': '、', '(': '（', ')': '）', '[': '「', ']': '」',
    '{': '『', '}': '』', '<': '《', '>': '》', '^': '……', '_': '——',
    '~': '～', '-': '－'
  };

  var MAX_CANDS = 9;

  /* 萬用鍵 —— 鍵盤左上角那一顆。語意照 rime/lua/aiphabi_wildcard.lua：
   *   單一個 `  = 一碼以上（wj`m 找得到 wjstm）
   *   連按 N 個 = 剛好補 N 碼（wj``m 只找剛好多兩碼的）
   * 而且是**整串比對**，不是前綴 —— 打 `d 找的是「剛好兩碼、第二碼是 D」的字。 */
  var WILD = '`';

  function ready(data) {
    state.data = data;
    data.keys = Object.keys(data.codes).sort();
    // 字頻 rank：萬用鍵掃全表，命中的字散在各個碼底下，沒有這個就只能照
    // 碼的字母順序排，候選列開頭會是一堆罕見字。
    data.rank = {};
    for (var i = 0; i < data.order.length; i++) data.rank[data.order[i]] = i;
    rail.dataset.ready = '1';
    render();
  }

  /* 前綴補全：碼表的 key 已排序，二分找出前綴區間就好，不必掃全表 */
  function lowerBound(keys, target, from) {
    var lo = from || 0, hi = keys.length, m;
    while (lo < hi) { m = (lo + hi) >> 1; if (keys[m] < target) lo = m + 1; else hi = m; }
    return lo;
  }

  function prefixRange(keys, p) {
    var start = lowerBound(keys, p, 0);
    // 前綴區間的右界＝把最後一個字元加一（"jk" → "jl"）之後的下界
    var end = p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1);
    return [start, lowerBound(keys, end, start)];
  }

  /* 萬用鍵：把 buf 轉成整串比對的 regex，掃過碼表所有的碼。
     7993 個碼，每按一鍵掃一次，實測 1ms 以內，不值得為它建索引。 */
  function wildLookup(buf) {
    var d = state.data;
    var pat = '^' + buf.replace(/`+|[a-z]+/g, function (run) {
      if (run[0] !== WILD) return run;
      return run.length === 1 ? '[a-z]+' : '[a-z]{' + run.length + '}';
    }) + '$';
    var re = new RegExp(pat), hits = [], seen = {};
    for (var i = 0; i < d.keys.length; i++) {
      if (!re.test(d.keys[i])) continue;
      var chs = d.codes[d.keys[i]];
      for (var k = 0; k < chs.length; k++) {
        if (seen[chs[k]]) continue;
        seen[chs[k]] = 1;
        hits.push(chs[k]);
      }
    }
    var far = d.order.length + 1;
    hits.sort(function (a, b) {
      return (d.rank[a] == null ? far : d.rank[a]) - (d.rank[b] == null ? far : d.rank[b]);
    });
    return hits.slice(0, MAX_CANDS).map(function (ch) {
      // 標的是主碼，不是比對到的那個碼 —— 萬用鍵很常比對到長得看不完的完整碼。
      // 加圓括號表示「這是拿來看的參考碼」，不是叫你改打它（跟 IME 那邊同一套規矩）。
      return { ch: ch, exact: true,
               code: d.main[ch] ? '(' + d.main[ch].toUpperCase() + ')' : '' };
    });
  }

  function lookup(buf) {
    var d = state.data;
    if (!d || !buf) return [];
    if (buf.indexOf(WILD) >= 0) return wildLookup(buf);
    var list = [], seen = {};

    /* 打中的（exact）：你打的這幾碼**就是**這個字的碼，按空白就出來。字用主色標出來。
       補全的：你打的是它的前綴，還要再補幾碼。跟著標「- 還差的那幾碼」，
       這樣不必去查表就知道還要按什麼——跟標註站那個試打頁同一套顯示規則。 */
    function push(ch, opt) {
      if (seen[ch]) return;
      seen[ch] = 1;
      opt = opt || {};
      list.push({ ch: ch, tag: opt.tag || '', code: opt.code || '', exact: !!opt.exact });
    }

    /* 還差幾碼。主碼是你打的這幾碼的延伸就秀「- 差的那幾碼」；不是的話
       （只配到完整碼／兼容碼那條路）就整個主碼秀出來當參考——差幾碼算不出來，
       硬算會得出一個按了也沒用的字串。 */
    function restOf(ch) {
      var mc = d.main[ch];
      if (!mc) return '';
      return mc.indexOf(buf) === 0 ? '- ' + mc.slice(buf.length).toUpperCase()
                                   : mc.toUpperCase();
    }

    // 約定簡碼排最前面 —— 這幾個字常用到值得插隊，這正是要示範的行為
    if (d.short[buf]) push(d.short[buf], { tag: '簡碼', exact: true });

    var exact = d.codes[buf];
    // 打中了但主碼不是你打的這串（走的是完整碼或兼容碼），把主碼標出來當參考
    if (exact) for (var ch of exact) {
      push(ch, { exact: true, code: d.main[ch] && d.main[ch] !== buf ? d.main[ch].toUpperCase() : '' });
    }

    // 還沒打完的碼：把以它開頭的碼也帶出來（真正的輸入法靠 enable_completion 做同一件事）
    if (list.length < MAX_CANDS) {
      var r = prefixRange(d.keys, buf);
      for (var i = r[0]; i < r[1] && list.length < MAX_CANDS; i++) {
        if (d.keys[i] === buf) continue;
        for (var c of d.codes[d.keys[i]]) {
          push(c, { code: restOf(c) });
          if (list.length >= MAX_CANDS) break;
        }
      }
    }
    return list.slice(0, MAX_CANDS);
  }

  /* 打了主碼、而這個字有更短的簡碼時，在旁邊小聲提一句。
     這是設計主張本身：教學發生在使用當中，不是先背一張表。 */
  function hintFor(buf, cands) {
    var d = state.data;
    if (!d || !cands.length) return '';
    if (buf.indexOf(WILD) >= 0) return '';   // 萬用鍵的候選旁邊已經標了主碼
    var top = cands[0].ch;
    var s = d.short_rev[top];
    if (!s || s === buf || s.length >= buf.length) return '';
    return '簡碼 ' + s.toUpperCase();
  }

  function render() {
    rail.innerHTML = '';
    if (!state.data) {
      rail.appendChild(el('span', 'empty', '碼表載入中…'));
      return;
    }
    if (!state.buf) {
      rail.appendChild(el('span', 'empty', '在上面的框裡打英文字母，這裡會出現候選字。'));
      return;
    }

    rail.appendChild(el('span', 'buf', state.buf));

    var box = el('span', 'cands');
    state.cands.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cand' + (c.exact ? ' is-exact' : '');
      b.appendChild(el('span', 'n', String(i + 1)));
      b.appendChild(el('span', 'g', c.ch));
      // 標籤（簡碼）疊在碼上面，兩個都沒有就整欄不出現 —— 空的 span 會撐出縫隙
      if (c.tag || c.code) {
        var em = el('span', 'c');
        if (c.tag) em.appendChild(el('span', 'tag', c.tag));
        if (c.code) em.appendChild(el('span', 'rest', c.code));
        b.appendChild(em);
      }
      b.addEventListener('click', function () { commit(c.ch); out.focus(); });
      box.appendChild(b);
    });
    rail.appendChild(box);

    if (!state.cands.length) rail.appendChild(el('span', 'empty', '這個碼還沒有字'));

    var h = hintFor(state.buf, state.cands);
    if (h) rail.appendChild(el('span', 'hint', h));

    if (window.AiPhaBiSite) window.AiPhaBiSite.localize(rail);
  }


  /* ---- 跟著打：參考文章 + 田字格 -------------------------------------
   * 資料是 assets/practice.json（文章本文＋它用得到的字形，見
   * site/content/practice.md）。抓不到就整塊拿掉，試打框本身不受影響 ——
   * 這一頁的主要功能是試打，參考文章是加分項，不該把它拖下水。 */
  var P = {
    on: false, chars: [], pos: 0, glyphs: null, main: null, segs: null,
    text: null, cell: null, next: null, prog: null, hintbox: null,
    // 提示鏈：seg = 現在講到第幾個字根，step = 講到哪一步
    //   0 還沒開始 · 1 標出筆畫 · 2 說取形意圖 · 3 給字母
    // 按一次 / 往前一步，走完一個字根就換下一個。字換了就整個歸零。
    hseg: 0, hstep: 0
  };

  // 田字格：外框＋十字虛線，跟標註頁那個一樣（annotate.html 的 #glyph .grid）。
  // 字形的 y 軸要翻過來 —— graphics.txt 的座標系原點在左下，位移是 900 不是 1024。
  // 字形本身正好填滿 0–1024，直接畫會頂到格線。縮到 86% 置中，看起來才像
  // 練習簿上的田字格（標註頁不縮是因為那裡要看字跟框的關係，這裡不用）。
  var INSET = 0.86;
  var SVG_TF = 'translate(' + (1024 * (1 - INSET) / 2).toFixed(1) + ',' +
               (1024 * (1 - INSET) / 2).toFixed(1) + ') scale(' + INSET + ') ' +
               'scale(1,-1) translate(0,-900)';
  var GRID =
    '<rect class="tz-grid" x="2" y="2" width="1020" height="1020" rx="20"/>' +
    '<line class="tz-grid" x1="512" y1="2" x2="512" y2="1022"/>' +
    '<line class="tz-grid" x1="2" y1="512" x2="1022" y2="512"/>';

  function isHan(c) { return c >= '\u4e00' && c <= '\u9fff'; }

  /* 預設整個字都是黑的 —— 這裡講的是「這個字長這樣」，不是在講字根，
     上色會讓人以為顏色有意思。只有按了 / 之後，被提示到的那幾筆才上色，
     用的是取碼原則頁那一套彩虹分組色（同一條字根同一個顏色）。 */
  function strokeColours(ch) {
    var segs = P.segs && P.segs[ch];
    if (!segs || !P.hstep) return null;
    var map = {};
    for (var i = 0; i <= P.hseg && i < segs.length; i++) {
      for (var k = 0; k < segs[i].st.length; k++) map[segs[i].st[k]] = i;
    }
    return map;
  }

  function drawCell(ch) {
    var strokes = ch && P.glyphs ? P.glyphs[ch] : null;
    if (strokes) {
      var colour = strokeColours(ch);
      var paths = '';
      for (var i = 0; i < strokes.length; i++) {
        var gi = colour && colour[i] != null ? colour[i] : -1;
        var cls = gi >= 0 ? 'tz-z' + (gi % 6) : 'tz-ink';
        paths += '<path class="' + cls + '" d="' + strokes[i] + '"/>';
      }
      P.cell.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + ch + '">' +
        GRID + '<g transform="' + SVG_TF + '">' + paths + '</g></svg>';
    } else {
      // 標點、或者沒有字形資料的字：照樣放進格子裡，只是用系統字型
      P.cell.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + (ch || '') + '">' +
        GRID + '</svg>' +
        '<span class="tz-fallback">' + (ch || '') + '</span>';
    }
  }

  function renderPractice() {
    if (!P.on) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < P.chars.length; i++) {
      var c = P.chars[i];
      if (c === '\n') { frag.appendChild(document.createElement('br')); continue; }
      var cls = i < P.pos ? 'pc is-done' : i === P.pos ? 'pc is-now' : 'pc';
      frag.appendChild(el('span', cls, c));
    }
    P.text.innerHTML = '';
    P.text.appendChild(frag);

    var now = P.chars[P.pos];
    drawCell(now === '\n' ? '' : now);

    // 沒取碼的字打不出來 —— 直說，並且讓人跳過去，不要讓人卡在那一格試半天
    var uncoded = now && isHan(now) && P.main && !P.main[now];
    P.next.innerHTML = '';
    if (P.pos >= P.chars.length) {
      P.next.appendChild(el('span', 'ok', '整篇打完了。'));
    } else if (uncoded) {
      P.next.appendChild(el('b', null, now));
      P.next.appendChild(el('span', 'warn', '尚未取碼，按「跳過這個字」'));
    } else if (now) {
      P.next.appendChild(el('b', null, now === '\n' ? '↵' : now));
      P.next.appendChild(el('span', null, '下一個'));
    }

    // 換行不用打，所以不算進進度裡 —— 算進去的話永遠打不到 100%
    renderHint(now);

    var done = P.typedBefore[P.pos] || 0, total = P.total;
    P.prog.textContent = done + ' / ' + total +
      '　' + Math.round(done * 100 / total) + '%';

    // 目前這個字捲進視野：只捲文章那個框，不要動整頁
    var cur = P.text.querySelector('.is-now');
    if (cur) {
      var box = P.text.getBoundingClientRect(), r = cur.getBoundingClientRect();
      if (r.top < box.top + 4 || r.bottom > box.bottom - 4) {
        P.text.scrollTop += (r.top - box.top) - box.height / 2;
      }
    }
    if (window.AiPhaBiSite) window.AiPhaBiSite.localize(P.text);
  }

  /* 打出來的字跟目前這一格一樣就往前走。不一樣不做事 —— 字照樣進了試打框
     （那是使用者自己打的東西，不該被吃掉），只是進度不動。 */
  function advance(ch) {
    if (!P.on || P.pos >= P.chars.length) return;
    while (P.chars[P.pos] === '\n') P.pos++;      // 換行不用打
    if (P.chars[P.pos] !== ch) return;
    P.pos++;
    while (P.chars[P.pos] === '\n') P.pos++;
    P.hseg = 0; P.hstep = 0;          // 換字了，提示從頭來
    renderPractice();
  }


  /* 提示面板：已經揭曉的字根排成一列（字母），現在講到的那一條另外把取形意圖
     寫出來。沒按過 / 就整塊不出現 —— 這一頁的預設是「自己想」。 */
  function renderHint(ch) {
    var box = P.hintbox;
    box.innerHTML = '';
    var segs = P.segs && P.segs[ch];
    if (!P.hstep || !segs || !segs.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    var row = el('span', 'tz-hintcodes');
    for (var i = 0; i <= P.hseg && i < segs.length; i++) {
      var known = i < P.hseg || P.hstep >= 3;
      var chip = el('span', 'tz-chip z' + (i % 6) + (known ? '' : ' is-blank'),
                    known ? segs[i].L : '？');
      row.appendChild(chip);
    }
    box.appendChild(row);

    var cur = segs[Math.min(P.hseg, segs.length - 1)];
    if (P.hstep >= 2 && cur.d) box.appendChild(el('span', 'tz-intent', cur.d));

    var more = P.hseg < segs.length - 1 || P.hstep < 3;
    box.appendChild(el('span', 'tz-more', more ? '再按 / 給更多提示' : '這個字的碼全給了'));
  }

  /* 按 / 往前一步。走完一條字根（標筆畫 → 說意圖 → 給字母）才換下一條。
     比對不到字根的那幾段沒有取形意圖（建置時會印出來），中間那一步直接跳過，
     不要留一個空白的提示讓人以為壞掉了。 */
  function hintStep() {
    if (!P.on || P.pos >= P.chars.length) return;
    var ch = P.chars[P.pos];
    var segs = P.segs && P.segs[ch];
    if (!segs || !segs.length) return;
    if (P.hstep < 3) {
      P.hstep++;
      if (P.hstep === 2 && !segs[P.hseg].d) P.hstep = 3;
    } else if (P.hseg < segs.length - 1) {
      P.hseg++;
      P.hstep = 1;
    }
    renderPractice();
  }

  function setupPractice(pd, dict) {
    var host = document.getElementById('practice');
    if (!host || !pd || !pd.paras || !pd.paras.length) return;
    P.on = true;
    P.glyphs = pd.glyphs || null;
    P.segs = pd.segs || null;
    P.main = dict.main;
    P.chars = pd.paras.join('\n').split('');
    // typedBefore[i] = 第 i 格之前有幾個「真的要打」的字元（換行不算）
    P.typedBefore = [];
    var n = 0;
    for (var i = 0; i < P.chars.length; i++) {
      P.typedBefore[i] = n;
      if (P.chars[i] !== '\n') n++;
    }
    P.typedBefore[P.chars.length] = n;
    P.total = n;
    P.text = document.getElementById('practice-text');
    P.cell = document.getElementById('tianzi');
    P.next = document.getElementById('practice-next');
    P.prog = document.getElementById('practice-prog');
    P.hintbox = document.getElementById('practice-hint');

    var src = document.getElementById('practice-src');
    src.textContent = pd.title + '　' + pd.author + '　' + pd.license;

    document.getElementById('practice-skip').addEventListener('click', function () {
      if (P.pos < P.chars.length) { P.pos++; while (P.chars[P.pos] === '\n') P.pos++; }
      P.hseg = 0; P.hstep = 0;
      renderPractice(); out.focus();
    });
    document.getElementById('practice-reset').addEventListener('click', function () {
      P.pos = 0; P.hseg = 0; P.hstep = 0; renderPractice(); out.focus();
    });

    host.hidden = false;
    renderPractice();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function insert(text) {
    var s = out.selectionStart, e = out.selectionEnd, v = out.value;
    out.value = v.slice(0, s) + text + v.slice(e);
    out.selectionStart = out.selectionEnd = s + text.length;
  }

  function commit(ch) {
    insert(ch);
    state.buf = '';
    state.cands = [];
    render();
    advance(ch);
  }

  function setBuf(b) {
    state.buf = b;
    state.cands = lookup(b);
    render();
  }

  out.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;

    if (state.buf) {
      if (k === 'Backspace') { e.preventDefault(); setBuf(state.buf.slice(0, -1)); return; }
      if (k === 'Escape')    { e.preventDefault(); setBuf(''); return; }
      if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        if (state.cands.length) commit(state.cands[0].ch);
        return;
      }
      if (k >= '1' && k <= '9') {
        var i = +k - 1;
        if (i < state.cands.length) { e.preventDefault(); commit(state.cands[i].ch); return; }
      }
    }

    if (/^[a-zA-Z]$/.test(k)) { e.preventDefault(); setBuf(state.buf + k.toLowerCase()); return; }

    // 提示鍵。放在標點之前 —— / 原本是 、 的鍵，現在讓給提示，、 還在 \\ 上面。
    if (k === '/') { e.preventDefault(); hintStep(); return; }

    // 萬用鍵。放在標點之前判斷 —— ` 在 PUNCT 裡沒有對應，但將來要是加了，
    // 萬用鍵也必須贏，否則這一顆鍵就打不進碼裡了。
    if (k === WILD) { e.preventDefault(); setBuf(state.buf + WILD); return; }

    if (PUNCT[k]) {
      e.preventDefault();
      insert(PUNCT[k]);
      if (state.buf) setBuf('');
      advance(PUNCT[k]);        // 標點也是文章的一部分，打對了一樣往前一格
      return;
    }
  });

  fetch('assets/dict.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      ready(d);
      // 參考文章另外抓：它帶著自己的字形（約 830KB），抓失敗或還沒回來，
      // 試打框都已經可以用了 —— 所以放在 dict.json 之後，而且不接進同一條鏈。
      fetch('assets/practice.json')
        .then(function (r) { return r.json(); })
        .then(function (pd) { setupPractice(pd, d); })
        .catch(function () { /* 沒有就沒有，那一塊不出現 */ });
    })
    .catch(function () {
      rail.innerHTML = '';
      rail.appendChild(el('span', 'empty',
        '碼表載入失敗。在本機預覽的話，先跑 site/tools/build_site_data.py 產生 assets/dict.json。'));
    });
})();
