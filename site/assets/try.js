/* 線上試打 —— 直接查 assets/dict.json，那份是從 data/codes.json 產生的，
 * 所以這裡打得出來的字跟真正的輸入法一致（每次網站部署時重新產生）。
 *
 * 這是「夠真實可以體會設計」的版本，不是完整模擬。目前有：
 *   主碼／完整碼／兼容碼查詢、前綴補全、字頻排序、約定簡碼（含提示）、正體標點。
 * 還沒有（真正的輸入法有）：三簡碼、左簡碼、詞組連打、輸入容錯、萬用鍵、同類字、偏旁碼。
 * 缺哪些請看 site/README.md，別讓這一頁默默宣稱它是全部。
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

  function ready(data) {
    state.data = data;
    data.keys = Object.keys(data.codes).sort();
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

  function lookup(buf) {
    var d = state.data;
    if (!d || !buf) return [];
    var list = [], seen = {};

    function push(ch, tag) {
      if (seen[ch]) return;
      seen[ch] = 1;
      list.push({ ch: ch, tag: tag || '' });
    }

    // 約定簡碼排最前面 —— 這幾個字常用到值得插隊，這正是要示範的行為
    if (d.short[buf]) push(d.short[buf], '簡碼');

    var exact = d.codes[buf];
    if (exact) for (var ch of exact) push(ch);

    // 還沒打完的碼：把以它開頭的碼也帶出來（真正的輸入法靠 enable_completion 做同一件事）
    if (list.length < MAX_CANDS) {
      var r = prefixRange(d.keys, buf);
      for (var i = r[0]; i < r[1] && list.length < MAX_CANDS; i++) {
        if (d.keys[i] === buf) continue;
        for (var c of d.codes[d.keys[i]]) {
          push(c);
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
      b.className = 'cand';
      b.appendChild(el('span', 'n', String(i + 1)));
      b.appendChild(el('span', 'g', c.ch));
      if (c.tag) b.appendChild(el('span', 'n', c.tag));
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
