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

    // 萬用鍵。放在標點之前判斷 —— ` 在 PUNCT 裡沒有對應，但將來要是加了，
    // 萬用鍵也必須贏，否則這一顆鍵就打不進碼裡了。
    if (k === WILD) { e.preventDefault(); setBuf(state.buf + WILD); return; }

    if (PUNCT[k]) { e.preventDefault(); insert(PUNCT[k]); if (state.buf) setBuf(''); return; }
  });

  fetch('assets/dict.json')
    .then(function (r) { return r.json(); })
    .then(ready)
    .catch(function () {
      rail.innerHTML = '';
      rail.appendChild(el('span', 'empty',
        '碼表載入失敗。在本機預覽的話，先跑 site/tools/build_site_data.py 產生 assets/dict.json。'));
    });
})();
