/* 線上試打 —— 直接查 assets/dict.json，那份是從 data/codes.json 產生的，
 * 所以這裡打得出來的字跟真正的輸入法一致（每次網站部署時重新產生）。
 *
 * 這是「夠真實可以體會設計」的版本，不是完整模擬。目前有：
 *   主碼／完整碼／兼容碼查詢、前綴補全、字頻排序、約定簡碼（含提示，可關）、
 *   三簡碼（可開，預設關——用剩法查很容易誤觸，Wilson 決定跟真正輸入法一樣預設關）、
 *   萬用鍵、正體標點。
 * 還沒有（真正的輸入法有）：左簡碼、詞組連打、輸入容錯、同類字、偏旁碼。
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
    // ⚠️ '=' 不在這裡 —— 它是提示鍵（見 hintStep）。原本佔著提示的是 '/'，
    // 改成 '=' 之後 / 就還給頓號了，兩顆都打得出 、。
    '\\': '、', '/': '、', '(': '（', ')': '）', '[': '「', ']': '」',
    '{': '『', '}': '』', '<': '《', '>': '》', '^': '……', '_': '——',
    '~': '～', '-': '－'
  };

  var MAX_CANDS = 9;

  /* 萬用鍵 —— 鍵盤左上角那一顆。語意照 rime/lua/aiphabi_wildcard.lua：
   *   單一個 `  = 一碼以上（wj`m 找得到 wjstm）
   *   連按 N 個 = 剛好補 N 碼（wj``m 只找剛好多兩碼的）
   * 而且是**整串比對**，不是前綴 —— 打 `d 找的是「剛好兩碼、第二碼是 D」的字。 */
  var WILD = '`';

  /* 提示鍵。本來用 '/'，Wilson 改成 '='：/ 是頓號原本的鍵，佔著它等於為了提示
     犧牲一顆標點；= 在打字時完全用不到，讓出來沒有代價。 */
  var HINT_KEY = '=';

  /* 簡碼／三簡碼各自獨立開關，記在 localStorage（跟這頁其他不需要驚動伺服器的
     暫存狀態一樣）。約定簡碼預設開（本來就一直是開的，加開關只是讓人看得到、
     關得掉），三簡碼預設關——用剩法查很容易誤觸（打三碼常常也剛好是別的字的
     完整碼），真正的輸入法裡它也預設關（Wilson）。 */
  var SHORT_KEY = 'aiphabi_try_short', SHORT3_KEY = 'aiphabi_try_short3';
  var SHORT_ON = true, SHORT3_ON = false;
  try {
    var savedShort = localStorage.getItem(SHORT_KEY);
    if (savedShort != null) SHORT_ON = savedShort === '1';
    var savedShort3 = localStorage.getItem(SHORT3_KEY);
    if (savedShort3 != null) SHORT3_ON = savedShort3 === '1';
  } catch (e) {}

  /* 三簡碼：約定簡碼的自動版，不用手動挑，4 碼以上的字全部適用。打 3 碼當
     「頭兩碼＋末一碼」查，跟 build_rime.py／Squirrel、標註站試打頁（type.html
     的 buildShort3）算法一致。掃一次全部的碼建索引，跟萬用鍵一樣量體不大
     （8000 出頭個碼），沒必要每按一鍵重算。 */
  function buildShort3(d) {
    var map = {};
    for (var i = 0; i < d.keys.length; i++) {
      var code = d.keys[i];
      if (code.length < 4) continue;
      var sig = code[0] + code[1] + code[code.length - 1];
      var chs = d.codes[code];
      if (!map[sig]) map[sig] = [];
      for (var k = 0; k < chs.length; k++) {
        if (map[sig].indexOf(chs[k]) < 0) map[sig].push(chs[k]);
      }
    }
    return map;
  }

  function ready(data) {
    state.data = data;
    data.keys = Object.keys(data.codes).sort();
    // 字頻 rank：萬用鍵掃全表，命中的字散在各個碼底下，沒有這個就只能照
    // 碼的字母順序排，候選列開頭會是一堆罕見字。
    data.rank = {};
    for (var i = 0; i < data.order.length; i++) data.rank[data.order[i]] = i;
    data.short3 = buildShort3(data);
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
    if (SHORT_ON && d.short[buf]) push(d.short[buf], { tag: '簡碼', exact: true });

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

    // 三簡碼：剛好打了 3 碼，當「頭兩碼＋末一碼」查——排在補全後面，它是自動
    // 配對，不像約定簡碼認定過「就這個字」，不該搶到真正打中／補全的候選前面。
    if (SHORT3_ON && buf.length === 3 && list.length < MAX_CANDS) {
      var s3 = d.short3[buf];
      if (s3) for (var j = 0; j < s3.length && list.length < MAX_CANDS; j++) {
        push(s3[j], { tag: '三簡', code: d.main[s3[j]] ? d.main[s3[j]].toUpperCase() : '' });
      }
    }
    return list.slice(0, MAX_CANDS);
  }

  /* 打了主碼、而這個字有更短的簡碼時，在旁邊小聲提一句。
     這是設計主張本身：教學發生在使用當中，不是先背一張表。 */
  function hintFor(buf, cands) {
    var d = state.data;
    if (!d || !cands.length || !SHORT_ON) return '';
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
      rail.appendChild(el('span', 'empty',
        '在上框中輸入英文字母，即可用愛發筆輸入法打字！'
        + (P.on ? '如果不知如何拆碼，可以按「=」鍵取得提示。' : '')));
      return;
    }

    // 跟著打的時候，打歪的那幾碼標紅 —— 錯在第幾碼一眼看得出來
    var split = null;
    if (P.on && P.pos < P.chars.length) {
      var tgt = P.chars[P.pos], tsegs = P.segs && P.segs[tgt];
      if (tsegs && tsegs.length) {
        var mm = typedMatch(tgt, tsegs);
        if (mm.bad) split = Math.min(mm.ok, state.buf.length);
      }
    }
    if (split == null) {
      rail.appendChild(el('span', 'buf', state.buf));
    } else {
      var b = el('span', 'buf');
      b.appendChild(document.createTextNode(state.buf.slice(0, split)));
      b.appendChild(el('span', 'is-bad', state.buf.slice(split)));
      rail.appendChild(b);
    }

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
    on: false, host: null, chars: [], pos: 0, glyphs: null, main: null, segs: null, conv: null, progbar: null,
    texts: null, ti: 0, pick: null,
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

  /* 已經「講到」第幾條字根 —— 兩個來源取大的：
       1. 按 = 給的提示（P.hseg）
       2. 自己打對的碼：打了幾碼就亮幾條字根，不用等打完整個字
     第 2 條是為了讓人邊打邊看到進度（Wilson）。判斷方式是拿目前打的這幾碼
     去比對這個字的**完整碼**（每一條字根一個字母）：是它的前綴，就表示前面
     那幾條字根都打對了。打完整個主碼（可能被「頭四尾一」截短過，跟完整碼
     不一樣）就整個字亮起來。比不上就不亮 —— 那表示打的是別條路（約定簡碼、
     兼容碼）或根本打錯，硬亮會亮在錯的筆畫上。 */
  /* 這個字要打的那幾條字根，**照主碼的順序**。
     practice.json 的 segs[字] = { s: 全部分段（照筆順）, c: 主碼用到第幾段 }。
     兩者不一樣：碼超過 max 就「頭四尾一」，中間那幾段根本不用打 ——
     親 的分段是 I V T D J L，主碼卻是 IVTDL，第五碼是最後那段的 L 而不是 J。
     提示、上色、進度全部走這一份，不然會叫人打一個打下去是錯的碼（Wilson 抓到）。
     被略過的那幾段沒有對應的碼，就一直是黑的 —— 那正好看得出「頭四尾一」丟掉了誰。 */
  function segsFrom(table, ch) {
    var e = table && table[ch];
    if (!e || !e.s || !e.s.length) return null;
    var list = [];
    for (var i = 0; i < e.c.length; i++) if (e.s[e.c[i]]) list.push(e.s[e.c[i]]);
    return list.length ? list : null;
  }
  function segsOf(ch) { return segsFrom(P.segs, ch); }

  function fullCodeOf(ch) {
    var e = P.segs && P.segs[ch], out = '';
    if (!e || !e.s) return '';
    for (var i = 0; i < e.s.length; i++) out += e.s[i].L.toLowerCase();
    return out;
  }

  function typedMatch(ch, segs) {
    var buf = state.buf, d = state.data, none = { ok: 0, bad: false };
    if (!buf || !segs.length) return none;
    // 走別條路也算全對：主碼打完（可能被「頭四尾一」截短）、約定簡碼、兼容碼、完整碼
    if ((P.main && buf === P.main[ch]) ||
        (d && ((d.codes[buf] && d.codes[buf].indexOf(ch) >= 0) || d.short[buf] === ch))) {
      return { ok: segs.length, bad: false };
    }
    var main = '';
    for (var i = 0; i < segs.length; i++) main += segs[i].L.toLowerCase();
    var k = 0;
    while (k < buf.length && k < main.length && buf[k] === main[k]) k++;
    // 完整碼（每一段都打，不截）也是這個字打得出來的一條路，不能標紅。
    // 但上色還是照主碼那幾段來 —— 兩條路的前幾碼本來就一樣。
    var bad = buf.length > k && fullCodeOf(ch).indexOf(buf) !== 0;
    return { ok: k, bad: bad };
  }

  function typedSegs(ch, segs) { return typedMatch(ch, segs).ok - 1; }

  /* 預設整個字都是黑的 —— 這裡講的是「這個字長這樣」，不是在講字根，
     上色會讓人以為顏色有意思。被提示到、或自己打對的那幾條字根才上色，
     用的是取碼原則頁那一套彩虹分組色（同一條字根同一個顏色）。 */
  function strokeColours(ch) {
    var segs = segsOf(ch);
    if (!segs) return null;
    var upto = Math.max(P.hstep ? P.hseg : -1, typedSegs(ch, segs));
    if (upto < 0) return null;
    var map = {};
    for (var i = 0; i <= upto && i < segs.length; i++) {
      for (var k = 0; k < segs[i].st.length; k++) map[segs[i].st[k]] = i;
    }
    return map;
  }

  /* 田字格畫格子：跟著打（P.cell，逐碼漸進上色）跟拼音查字（PY.cell，選字後
   * 整個字一次上色）共用同一支——差別只在呼叫的人給的 colour map 怎麼算。 */
  function paintGlyph(target, ch, strokes, colour) {
    if (strokes) {
      var paths = '';
      for (var i = 0; i < strokes.length; i++) {
        var gi = colour && colour[i] != null ? colour[i] : -1;
        var cls = gi >= 0 ? 'tz-z' + (gi % 6) : 'tz-ink';
        paths += '<path class="' + cls + '" d="' + strokes[i] + '"/>';
      }
      target.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + ch + '">' +
        GRID + '<g transform="' + SVG_TF + '">' + paths + '</g></svg>';
    } else {
      // 標點、或者沒有字形資料的字：照樣放進格子裡，只是用系統字型
      target.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + (ch || '') + '">' +
        GRID + '</svg>' +
        '<span class="tz-fallback">' + (ch || '') + '</span>';
    }
  }

  function drawCell(ch) {
    var strokes = ch && P.glyphs ? P.glyphs[ch] : null;
    paintGlyph(P.cell, ch, strokes, strokeColours(ch));
  }


  /* 田字格那一塊（格子＋下一個字＋提示）。打字時只重畫這裡 —— 參考文章有一千
     三百多個 span，每按一鍵重建一次太浪費，而它的內容只在換字時才會變。 */
  /* 慶祝畫面：整篇打完了，格子裡放幾個 emoji 小小彈一下，取代原本要畫的字
   * （反正也沒有下一個字可畫）。動畫很短、每片彈跳時間錯開一點點，見
   * site.css 的 .tz-confetti* （Wilson：完成的時候想要一點慶祝感）。 */
  function celebrateCell() {
    var pieces = ['🎉', '✨', '🎊'];
    var html = '<svg viewBox="0 0 1024 1024" role="img" aria-label="完成">' + GRID + '</svg>' +
      '<div class="tz-confetti">' + pieces.map(function (p, i) {
        return '<span class="tz-confetti-piece" style="animation-delay:' + (i * 70) + 'ms">' + p + '</span>';
      }).join('') + '</div>';
    P.cell.innerHTML = html;
  }

  function renderCell() {
    if (!P.on) return;
    var now = P.chars[P.pos];
    var done = P.pos >= P.chars.length;
    if (done) celebrateCell();
    else drawCell(now === '\n' ? '' : now);

    var uncoded = now && isHan(now) && P.main && !P.main[now];
    P.next.innerHTML = '';
    if (done) {
      P.next.appendChild(el('span', 'ok', '恭喜你完成試打練習！'));
    } else if (uncoded) {
      P.next.appendChild(el('b', null, now));
      P.next.appendChild(el('span', 'warn', '尚未取碼，按「跳過這個字」'));
    } else if (now) {
      P.next.appendChild(el('b', null, now === '\n' ? '↵' : now));
      // 約定字：不是照筆畫拆的，整字背下來——標出來，不然學的人會以為
      // 自己看不出字根，其實這個字本來就不歸那套推理管（Wilson）。
      if (P.conv && P.conv.has(now)) P.next.appendChild(el('span', 'conv-badge', '約定字'));
      P.next.appendChild(el('span', null, '下一個'));
    }
    renderHint(now);
  }

  function renderPractice() {
    if (!P.on) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < P.chars.length; i++) {
      var c = P.chars[i];
      if (c === '\n') { frag.appendChild(document.createElement('br')); continue; }
      var cls = i < P.pos ? 'pc is-done' : i === P.pos ? 'pc is-now' : 'pc';
      var sp = el('span', cls, c);
      sp.dataset.i = i;                 // 點一下就跳到那個字（見 setupPractice）
      frag.appendChild(sp);
    }
    P.text.innerHTML = '';
    P.text.appendChild(frag);

    renderCell();

    // 換行不用打，所以不算進進度裡 —— 算進去的話永遠打不到 100%
    var done = P.typedBefore[P.pos] || 0, total = P.total;
    var pct = Math.round(done * 100 / total);
    P.prog.textContent = done + ' / ' + total + '　' + pct + '%';
    if (P.progbar) P.progbar.style.width = pct + '%';

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
    render();
  }


  /* 提示的文字放在田字格底下 —— 講的是格子裡那個字的哪幾筆，就該貼著那個字
     （Wilson）。候選列那一行只留一句「想不出來就按 = 給提示」當入口，
     真正給出來的提示不放那裡。沒按過 / 就整塊不出現。 */
  function renderHint(ch) {
    var box = P.hintbox;
    box.innerHTML = '';
    var segs = segsOf(ch);
    if (!segs) return;

    /* 打歪了：前面對的那幾條字根照樣留著顏色（不要整個字變回黑的，那等於
       把好不容易打對的進度也一起收掉），這裡只講「這一碼應該是哪一條字根」。
       講的是取形意圖，不是字母 —— 直接給字母就沒得練了。 */
    var m = typedMatch(ch, segs);
    if (m.bad) {
      var want = segs[Math.min(m.ok, segs.length - 1)];
      box.appendChild(el('span', 'tz-wrong', '再試一次'));
      if (want && want.d) box.appendChild(el('span', 'tz-intent', '應該是：' + want.d));
      return;
    }

    /* 沒按過 / 也要給正回饋：自己打對 JK，格子底下就該出現紅 J、黃 K，
       顏色跟剛剛亮起來的筆畫對得上（Wilson）。所以只要有打對的碼就顯示。 */
    if (!P.hstep && !m.ok) return;

    /* 自己打對的那幾條也要翻牌 —— 提示亮出筆畫、人看懂了、打對了，那一格就該
       從「？」變成字母（顏色跟格子裡那幾筆一樣），才有「猜中了」的回饋（Wilson）。
       所以「已知」有三種來源：提示已經走過去的、提示走到第三步給了字母的、
       還有自己打對的。 */
    var typed = m.ok;
    var upto = Math.max(P.hstep ? P.hseg : -1, typed - 1);
    var row = el('span', 'tz-hintcodes');
    for (var i = 0; i <= upto && i < segs.length; i++) {
      var known = i < P.hseg || (i === P.hseg && P.hstep >= 3) || i < typed;
      var chip = el('span', 'tz-chip z' + (i % 6) + (known ? '' : ' is-blank'),
                    known ? segs[i].L : '？');
      row.appendChild(chip);
    }
    box.appendChild(row);

    var cur = segs[Math.min(P.hseg, segs.length - 1)];
    if (P.hstep >= 2 && cur.d) box.appendChild(el('span', 'tz-intent', cur.d));

    if (typed >= segs.length) {
      box.appendChild(el('span', 'tz-more', '打字成功！'));
    } else {
      var more = P.hseg < segs.length - 1 || P.hstep < 3;
      box.appendChild(el('span', 'tz-more', more ? '再按 = 給更多提示' : '已顯示全部編碼'));
    }
  }

  /* 按 = 往前一步。走完一條字根（標筆畫 → 說意圖 → 給字母）才換下一條。
     比對不到字根的那幾段沒有取形意圖（建置時會印出來），中間那一步直接跳過，
     不要留一個空白的提示讓人以為壞掉了。

     ⚠️ 提示的進度要跟著**打對的碼**走（Wilson）：自己打對到第 n 條了，就別再
     回頭講第 n 條。例：我 的碼是 JKXQ，打了 J → 按 = 亮 K 那幾筆 → 自己想出 K 打了
     → 再按 = 應該直接亮 X 那幾筆，而不是回來解釋 K 是什麼。所以每次按 = 都先
     看打到哪了，已經被打過去的就整段跳掉。 */
  function hintStep() {
    if (!P.on || P.pos >= P.chars.length) return;
    var ch = P.chars[P.pos];
    var segs = segsOf(ch);
    if (!segs) return;

    var typed = typedSegs(ch, segs);        // 自己打對到第幾條（-1 = 還沒打）
    if (P.hseg <= typed) {
      // 提示落後於實際進度：跳到還沒打的第一條，從「標筆畫」開始
      P.hseg = Math.min(typed + 1, segs.length - 1);
      P.hstep = typed + 1 > segs.length - 1 ? 3 : 1;
    } else if (P.hstep < 3) {
      P.hstep++;
    } else if (P.hseg < segs.length - 1) {
      P.hseg++;
      P.hstep = 1;
    }
    if (P.hstep === 2 && !segs[P.hseg].d) P.hstep = 3;   // 沒有取形意圖就跳過那一步
    renderPractice();
  }

  /* 換一篇文章。字形與字根分段是所有篇共用的（practice.json 只存一份），
     所以換篇只要重算「要打的那一串字元」跟進度表就好。 */
  function setText(i) {
    var t = P.texts[i];
    if (!t) return;
    P.ti = i;
    P.chars = t.paras.join('\n').split('');
    // typedBefore[i] = 第 i 格之前有幾個「真的要打」的字元（換行不算）
    P.typedBefore = [];
    var n = 0;
    for (var k = 0; k < P.chars.length; k++) {
      P.typedBefore[k] = n;
      if (P.chars[k] !== '\n') n++;
    }
    P.typedBefore[P.chars.length] = n;
    P.total = n;
    P.pos = 0; P.hseg = 0; P.hstep = 0;
    setBuf('');
    document.getElementById('practice-src').textContent = '《' + t.title + '》' + t.author;
    [].forEach.call(P.pick.children, function (b, k) {
      b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
    });
    P.text.scrollTop = 0;
    renderPractice();
  }

  /* 跟著打／自由試打：兩種模式共用同一個試打框跟候選邏輯，差別在右邊那格
   * 顯示什麼（田字格＋提示，還是拼音查字）跟要不要顯示參考文章。
   * P.on 決定 advance()／renderCell()／renderHint() 要不要動作，見上面
   * 各函式開頭的 `if (!P.on) return`。側欄本身（.practice-cell）兩種模式
   * 都顯示，不是自由試打就收起來——拼音查字要有地方放。
   * 選過一次就記住，下次開這頁直接回到上次的模式（localStorage，跟這頁
   * 其他不需要驚動伺服器的暫存狀態一樣）。 */
  var MODE_KEY = 'aiphabi_try_mode';
  function setMode(m) {
    var free = m === 'free';
    P.on = !free;
    [].forEach.call(P.host.querySelectorAll('[data-practice]'), function (n) { n.hidden = free; });
    [].forEach.call(P.host.querySelectorAll('[data-mode-panel="practice"]'), function (n) { n.hidden = free; });
    [].forEach.call(P.host.querySelectorAll('[data-mode-panel="free"]'), function (n) { n.hidden = !free; });
    [].forEach.call(P.host.querySelectorAll('[data-mode]'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === m));
    });
    if (!free) renderPractice();
    setBuf('');
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  }

  function setupPractice(pd, dict) {
    var host = document.getElementById('tryarea');
    if (!host || !pd || !pd.texts || !pd.texts.length) return;
    P.host = host;
    P.glyphs = pd.glyphs || null;
    P.segs = pd.segs || null;
    P.conv = new Set(pd.conv || []);
    P.main = dict.main;
    P.texts = pd.texts;
    P.text = document.getElementById('practice-text');
    P.cell = document.getElementById('tianzi');
    P.next = document.getElementById('practice-next');
    P.prog = document.getElementById('practice-prog');
    P.progbar = document.getElementById('practice-progbar-fill');
    P.hintbox = document.getElementById('practice-hint');

    // 篇目選單：一篇一顆。只有一篇的時候整排不出現（按了也沒事發生的按鈕是雜訊）
    P.pick = document.getElementById('practice-pick');
    if (P.texts.length > 1) {
      P.texts.forEach(function (t, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'practice-pickbtn';
        b.textContent = t.title;
        b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
        b.addEventListener('click', function () { setText(i); out.focus(); });
        P.pick.appendChild(b);
      });
    }

    /* 點參考文章裡任何一個字就從那裡開始。沒有這個的話，想試某個字只能一路按
       「跳過這個字」——文章一千三百多字，光是走到第 290 個字的 付 就要按 289 次。 */
    P.text.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.pc');
      if (!t || t.dataset.i == null) return;
      P.pos = +t.dataset.i;
      while (P.chars[P.pos] === '\n') P.pos++;
      P.hseg = 0; P.hstep = 0;
      setBuf('');
      renderPractice();
      out.focus();
    });

    document.getElementById('practice-skip').addEventListener('click', function () {
      if (P.pos < P.chars.length) { P.pos++; while (P.chars[P.pos] === '\n') P.pos++; }
      P.hseg = 0; P.hstep = 0;
      renderPractice(); render(); out.focus();
    });
    document.getElementById('practice-reset').addEventListener('click', function () {
      P.pos = 0; P.hseg = 0; P.hstep = 0; renderPractice(); render(); out.focus();
    });

    [].forEach.call(host.querySelectorAll('[data-mode]'), function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); out.focus(); });
    });

    // 模式切換那顆按鈕、側欄本身一直露出來（跟著打／自由試打都用得到，
    // 側欄裡面放什麼交給 setMode 決定）；參考文章那幾塊要不要顯示才是照模式。
    [].forEach.call(host.querySelectorAll('[data-practice-toggle]'), function (n) { n.hidden = false; });
    host.classList.remove('is-plain');
    setText(0);

    var savedMode = 'practice';
    try { savedMode = localStorage.getItem(MODE_KEY) || 'practice'; } catch (e) {}
    setMode(savedMode);
  }


  /* ---- 自由試打：拼音查字 -------------------------------------------
   * 資料是 assets/pinyin.json（site/tools/build_site_data.py 的
   * build_pinyin()）：已取碼的字裡現代字頻最高的 3000 個，查拼音（不分聲調）
   * 帶出候選字，選了就用上面同一套 paintGlyph／segsFrom 畫出拆碼圖，
   * 跟〈跟著打〉共用畫法，差別是不分步驟、選了就整個字一次上色——
   * 這裡不是在「練打」，是在「查這個字怎麼打」。 */
  var PY = { data: null, conv: null, cands: [], sel: null, input: null, candsBox: null, cell: null, hintBox: null };

  /* 選出來的字，所有字根一次全部上色（不像 P.strokeColours 是打對幾碼亮幾條）。 */
  function fullColourMap(segs) {
    if (!segs) return null;
    var map = {};
    for (var i = 0; i < segs.length; i++)
      for (var k = 0; k < segs[i].st.length; k++) map[segs[i].st[k]] = i;
    return map;
  }

  function renderPyqCands() {
    PY.candsBox.innerHTML = '';
    if (!PY.cands.length) {
      // 輸入框自己的 placeholder 已經示範怎麼打，這裡不必重講一次——
      // 只在真的查無結果時才出聲，順便講收字範圍（Wilson：兩個框現在排一起，
      // 沒查詢也放一整句「輸入拼音查字」是重複的）。
      if (PY.input.value.trim()) PY.candsBox.appendChild(el('span', 'empty',
        '查無這個拼音的字（目前只收已取碼的字，最多 3000 個）'));
      return;
    }
    PY.cands.forEach(function (ch, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cand' + (ch === PY.sel ? ' is-exact' : '');
      b.appendChild(el('span', 'n', String(i + 1)));
      b.appendChild(el('span', 'g', ch));
      b.addEventListener('click', function () { selectPyq(ch); });
      PY.candsBox.appendChild(b);
    });
  }

  function selectPyq(ch) {
    PY.sel = ch;
    renderPyqCands();
    var strokes = PY.data.glyphs && PY.data.glyphs[ch];
    var segs = segsFrom(PY.data.segs, ch);
    paintGlyph(PY.cell, ch, strokes, fullColourMap(segs));

    PY.hintBox.innerHTML = '';
    if (PY.conv && PY.conv.has(ch)) PY.hintBox.appendChild(el('span', 'conv-badge', '約定字'));
    if (segs) {
      var row = el('span', 'tz-hintcodes');
      segs.forEach(function (s, i) { row.appendChild(el('span', 'tz-chip z' + (i % 6), s.L)); });
      PY.hintBox.appendChild(row);
    } else {
      var code = state.data && state.data.main[ch];
      PY.hintBox.appendChild(el('span', 'tz-more', code ? '碼：' + code.toUpperCase() : ''));
    }
  }

  /* 拆碼圖清空回「空格子」，不是清空成什麼都沒有——paintGlyph 在沒有筆畫
   * 資料時本來就會畫格線＋退回文字（見上面），傳空字串、沒有筆畫，就只剩
   * 格線，剛好當「還沒選字」的預留位置，跟選了字之後同一個尺寸，側欄不會
   * 從空的跳成一大格（Wilson）。 */
  function clearPyqCell() {
    paintGlyph(PY.cell, '', null, null);
    PY.hintBox.innerHTML = '';
  }

  function onPyqInput() {
    var q = PY.input.value.trim().toLowerCase();
    PY.cands = q ? (PY.data.index[q] || []).slice(0, 12) : [];
    if (PY.cands.length && PY.cands.indexOf(PY.sel) < 0) selectPyq(PY.cands[0]);
    else renderPyqCands();
    if (!PY.cands.length) { PY.sel = null; clearPyqCell(); }
  }

  function setupPyq(pyd) {
    if (!pyd || !pyd.index) return;
    PY.data = pyd;
    PY.conv = new Set(pyd.conv || []);
    PY.input = document.getElementById('pyq-input');
    PY.candsBox = document.getElementById('pyq-cands');
    PY.cell = document.getElementById('pyq-tianzi');
    PY.hintBox = document.getElementById('pyq-hint');
    PY.input.addEventListener('input', onPyqInput);
    renderPyqCands();
    clearPyqCell();
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
    renderCell();          // 打錯的時候 advance 不會動，格子的顏色要自己收掉
  }

  function setBuf(b) {
    state.buf = b;
    state.cands = lookup(b);
    render();
    renderCell();          // 打對幾碼就亮幾條字根
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

    // 提示鍵。放在標點之前判斷 —— 將來要是 = 也收進 PUNCT，提示還是要贏，
    // 否則這顆鍵就按不出提示了。
    if (k === HINT_KEY) { e.preventDefault(); hintStep(); return; }

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

  // 簡碼／三簡碼開關：checkbox 本身不等資料載入就能綁定，反正 lookup() 每次
  // 都是現查 SHORT_ON／SHORT3_ON，切換後重算一次目前的 buf 就會反映出來。
  [].forEach.call(document.querySelectorAll('[data-short]'), function (b) {
    var is3 = b.dataset.short === 'short3';
    var key = is3 ? SHORT3_KEY : SHORT_KEY;
    b.checked = is3 ? SHORT3_ON : SHORT_ON;
    b.addEventListener('change', function () {
      if (is3) SHORT3_ON = b.checked; else SHORT_ON = b.checked;
      try { localStorage.setItem(key, b.checked ? '1' : '0'); } catch (e) {}
      setBuf(state.buf);
      out.focus();
    });
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
      // 拼音查字同理，跟參考文章互相獨立抓——沒裝 pypinyin 或抓失敗，
      // 自由試打的查字框就一直停在「輸入拼音查字」那句提示，其餘照常能用。
      fetch('assets/pinyin.json')
        .then(function (r) { return r.json(); })
        .then(function (pyd) { setupPyq(pyd); })
        .catch(function () { /* 沒有就沒有 */ });
    })
    .catch(function () {
      rail.innerHTML = '';
      rail.appendChild(el('span', 'empty',
        '碼表載入失敗。在本機預覽的話，先跑 site/tools/build_site_data.py 產生 assets/dict.json。'));
    });
})();
