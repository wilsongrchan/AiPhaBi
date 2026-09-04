/* 〈自動上屏〉頁：唯一上屏與即時頂。
 *
 * 這一頁**不寫死任何一個碼**。開頁時抓 assets/dict.json（建置時由 data/codes.json
 * 現算的那一份，跟試打頁同一個檔），例字、統計、按鍵流程全部當場算出來 ——
 * 手抄的碼會過期，而過期的碼會被人照著唸出來（見 PROJECT_NOTES）。
 *
 * 判斷規則跟 try.js 的 autoType／codeAlive 一致，而那兩支又是照
 * rime/lua/aiphabi_autocommit.lua 移植的。這裡只重算一次，不共用程式碼 ——
 * 這一頁是說明，不是輸入法本身，硬要共用得先把 try.js 拆成模組，不划算。
 */
(function () {
  'use strict';

  var COMMON = 1000;        // 「常用字」＝字頻表前 1000 名（統計數字要說得出定義）
  var D = null;

  function nf(n) { return n.toLocaleString('en-US'); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function put(id, text) { var n = document.getElementById(id); if (n) n.textContent = text; }

  /* ── 碼表查詢（跟 try.js 同一套二分找前綴）───────────────────────────── */
  function lowerBound(keys, t, from) {
    var lo = from || 0, hi = keys.length, m;
    while (lo < hi) { m = (lo + hi) >> 1; if (keys[m] < t) lo = m + 1; else hi = m; }
    return lo;
  }
  function range(keys, p) {
    var a = lowerBound(keys, p, 0);
    var end = p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1);
    return [a, lowerBound(keys, end, a)];
  }
  // 比這串碼更長、而且以它開頭的碼（＝還在排隊的那些）——**不管長度**，給
  // cands()／pickPartial() 這種「還有什麼字接得下去」的完整候選清單用。
  function longer(code) {
    var r = range(D.keys, code), out = [];
    for (var i = r[0]; i < r[1]; i++) if (D.keys[i] !== code) out.push(D.keys[i]);
    return out;
  }
  /* code 還能不能接出「更長、但仍在正常主碼長度（≤5 碼）內」的碼——跟
     rime/lua/aiphabi_autocommit.lua 的 has_longer_code 完全對應，是唯一
     上屏／即時頂實際問的問題，跟上面 longer() 不一樣：longer() 是「還有什麼
     字接得下去」（給候選清單用），這裡問的是「接下去的那個算不算數」
     （給自動上屏的判斷用）。5 碼已滿就不算（沒有 ≤5 的更長路），≥6 碼的
     完整碼（別的字未截斷的完整碼，例如 競 的 IVOJLIVOJL）也不算——那不是
     「這個字還沒打完」，是另一個字的另一條路，不該擋這個字上屏
     （Side B 2026-08-29 修正：兗 IVOJL 曾被 競 擋住；這裡跟著更新）。 */
  function hasLongerCode(code) {
    if (code.length >= 5) return false;
    var r = range(D.keys, code);
    for (var i = r[0]; i < r[1]; i++) {
      var k = D.keys[i];
      if (k !== code && k.length > code.length && k.length <= 5) return true;
    }
    return false;
  }
  function alive(code) {
    var r = range(D.keys, code);
    if (r[1] > r[0]) return true;
    var rs = range(D.shortKeys, code);
    return rs[1] > rs[0];
  }
  // 這串碼現在的候選：打中的（exact）排前面，再來是還沒打完的補全
  function cands(buf) {
    var out = [], i, j;
    if (D.short[buf]) out.push({ ch: D.short[buf], exact: true });
    var hit = D.codes[buf] || '';
    for (i = 0; i < hit.length; i++) out.push({ ch: hit.charAt(i), exact: true });
    var ext = longer(buf);
    for (i = 0; i < ext.length; i++) {
      var chs = D.codes[ext[i]];
      for (j = 0; j < chs.length; j++) out.push({ ch: chs.charAt(j), exact: false });
    }
    return out;
  }
  function typedAs(ch) { return D.short_rev[ch] || D.main[ch]; }

  /* ── 一個字一個字按下去，記下每一鍵發生了什麼 ───────────────────────── */
  function trace(seq) {
    var buf = '', steps = [], i;
    for (i = 0; i < seq.length; i++) {
      var k = seq.charAt(i);
      if (buf && !alive(buf + k)) {
        var top = null, cs = cands(buf);
        for (var t = 0; t < cs.length; t++) if (cs[t].exact) { top = cs[t]; break; }
        if (top) {
          steps.push({ key: k, buf: k, act: 'push', ch: top.ch, dead: buf + k });
          buf = k;
          continue;
        }
      }
      buf += k;
      var now = cands(buf);
      /* 唯一上屏：真正打中的候選只有一個、而且沒有更長的路還在排隊
         （hasLongerCode）。⚠️ 不能只看 now.length===1——cands() 連「還沒打完、
         繼續打下去會通往別的字」的補全（exact:false）也一起列出來，那是給人
         看「還接得下去什麼」的完整清單，跟「這個字還沒打完」是兩件事：
         完整碼一律接受，但不該讓它擋住唯一上屏（見 hasLongerCode 的說明）。 */
      var nowExact = 0, soleNow = null;
      for (var ni = 0; ni < now.length; ni++) if (now[ni].exact) { nowExact++; soleNow = now[ni]; }
      if (nowExact === 1 && !hasLongerCode(buf)) {
        steps.push({ key: k, buf: buf, act: 'sole', ch: soleNow.ch });
        buf = '';
      } else {
        steps.push({ key: k, buf: buf, act: '' });
      }
    }
    return steps;
  }

  function drawTrace(box, seq) {
    var steps = trace(seq);
    box.innerHTML = '';
    var head = el('div', 'ac-row is-head');
    ['按鍵', '碼欄', '結果'].forEach(function (t) { head.appendChild(el('span', null, t)); });
    box.appendChild(head);
    steps.forEach(function (s) {
      var row = el('div', 'ac-row' + (s.act ? ' is-fire' : ''));
      row.appendChild(el('kbd', 'ac-key', s.key.toUpperCase()));
      row.appendChild(el('code', 'ac-buf', s.buf.toUpperCase()));
      var r = el('span', 'ac-act');
      if (s.act === 'sole') {
        r.appendChild(el('i', 'ac-tag is-sole', '唯一上屏'));
        r.appendChild(el('b', null, s.ch));
      } else if (s.act === 'push') {
        r.appendChild(el('i', 'ac-tag is-push', '頂功上屏'));
        r.appendChild(el('b', null, s.ch));
        r.appendChild(el('span', 'ac-why',
          '（' + s.dead.toUpperCase() + ' 接不下去，這一鍵改當下一個字的開頭）'));
      } else {
        r.appendChild(el('span', 'ac-why', '碼還沒打完，等下一鍵'));
      }
      row.appendChild(r);
      box.appendChild(row);
    });
  }

  /* ── 例字：從字頻表現挑，不寫死 ─────────────────────────────────────── */
  // 唯一上屏的例子：碼只屬於它自己、也沒有 ≤5 碼的更長碼接在後面，而且是照主碼打的
  function pickSolo() {
    for (var i = 0; i < D.order.length; i++) {
      var ch = D.order[i], mc = D.main[ch];
      if (!mc || mc.length < 3 || D.short_rev[ch]) continue;
      if (D.codes[mc] === ch && !hasLongerCode(mc)) return ch;
    }
    return null;
  }
  // 即時頂的例子：碼只屬於它自己，卻被 ≤5 碼的更長碼擋著（愈常用愈說明問題）。
  // 展示牌用的是完整的 longer() 清單（給人看「接下去會通往哪些字」），但要不要
  // 算「被擋住」得先用 hasLongerCode 篩過——只挑真的會擋住唯一上屏的例子。
  function pickBlocked() {
    for (var i = 0; i < D.order.length; i++) {
      var ch = D.order[i], mc = D.main[ch];
      if (!mc || D.short_rev[ch]) continue;
      if (D.codes[mc] !== ch || !hasLongerCode(mc)) continue;
      var ext = longer(mc);
      if (ext.length) return { ch: ch, code: mc, ext: ext };
    }
    return null;
  }
  /* 「只剩一個但碼還沒打完」的例子：某個前綴底下只接得出一個字，但那個前綴
     本身還不是任何字的碼 —— 這正是不可以上屏的那一種。 */
  function pickPartial() {
    for (var i = 0; i < D.order.length; i++) {
      var ch = D.order[i], mc = D.main[ch];
      if (!mc || mc.length < 4 || D.short_rev[ch]) continue;
      for (var n = 2; n < mc.length; n++) {
        var p = mc.slice(0, n);
        if (D.codes[p]) continue;                 // 這個前綴本身就是別的字的碼
        var ext = longer(p), only = true, seen = '';
        for (var j = 0; j < ext.length && only; j++) {
          var chs = D.codes[ext[j]];
          for (var k = 0; k < chs.length; k++) {
            if (!seen) seen = chs.charAt(k);
            else if (seen !== chs.charAt(k)) { only = false; break; }
          }
        }
        if (only && seen === ch) return { ch: ch, pre: p, rest: mc.slice(n) };
      }
    }
    return null;
  }

  function drawPair(box, b) {
    box.innerHTML = '';
    function card(ch, code, tag, cls) {
      var c = el('div', 'ac-card ' + cls);
      c.appendChild(el('b', 'ac-card-ch', ch));
      c.appendChild(el('code', 'ac-card-code', code.toUpperCase()));
      c.appendChild(el('span', 'ac-card-tag', tag));
      return c;
    }
    box.appendChild(card(b.ch, b.code, '打中了', 'is-hit'));
    var chs = D.codes[b.ext[0]];
    box.appendChild(card(chs.charAt(0), b.ext[0], '還在排隊，只多 ' +
      (b.ext[0].length - b.code.length) + ' 碼', 'is-wait'));
  }

  var CS = null;

  /* ── 常用字自動上屏率（Wilson 2026-09-04）──────────────────────────────
     「當詞庫中 7000+ 字都在候選池中，但我心中只想打當中的常見繁體字時，自動上屏
     率是多少，vs 把簡體字和生僻字從候選池去掉之後是多少」。

     ⚠️ 兩邊的**分母是同一批字**（已取碼的常用繁體字）。這是整個算法的重點：
     生僻字自己上屏不算分，所以「把生僻字踢出去」不會因為分母變小而虛胖 ——
     多出來的每一個字，都是真的因為不再被自己不會打的字擋著才自己出來的。

     ⚠️ 用「只剩主碼」的碼表算，跟上一句同一個模型。上一句講的就是三簡碼／左簡碼／
     偏旁碼／容錯碼都關掉之後的樣子；一句用全開的碼表、一句用關掉的，兩個百分比
     擺在一起會互相打架。

     ⚠️ 「常用字」的定義不在這裡，也不該在這裡：它是 rime/lua/aiphabi_data.lua 的
     M.common（甲表 ∪ GB 2312 一級 ∪ 異體 ∪ 詞庫用字 ∪ 姓名 ∪ 百家姓 ∪ 粵語 ∪
     手動白名單），由建置時抄進 assets/charset.json。網站不自己推一份。 */
  function commonRate(cs) {
    if (!cs || !cs.common || !cs.simp) return null;
    var common = {}, simp = {}, i, ch;
    for (i = 0; i < cs.common.length; i++) common[cs.common.charAt(i)] = 1;
    for (i = 0; i < cs.simp.length; i++) simp[cs.simp.charAt(i)] = 1;

    var pool = {}, denom = 0;
    for (ch in D.main) {
      if (D.main[ch] && common[ch] === 1 && simp[ch] !== 1) { pool[ch] = 1; denom++; }
    }
    if (!denom) return null;

    // 只剩主碼的碼表；only 給了就順便把候選池縮到那一批字
    function mainMap(only) {
      var m = {}, c, k;
      for (k in D.main) {
        c = D.main[k];
        if (!c || (only && only[k] !== 1)) continue;
        m[c] = (m[c] || '') + k;
      }
      return m;
    }
    // 「打完主碼就自己出字」＝這串碼底下只有它，而且沒有更長的碼還等著
    function soleIn(map) {
      var keys = Object.keys(map).sort();
      return function (one) {
        var c = D.main[one];
        if (map[c] !== one) return false;
        if (c.length >= 5) return true;
        var r = range(keys, c), j, k;
        for (j = r[0]; j < r[1]; j++) {
          k = keys[j];
          if (k !== c && k.length > c.length && k.length <= 5) return false;
        }
        return true;
      };
    }
    var wide = soleIn(mainMap(null)), tight = soleIn(mainMap(pool));
    var a = 0, b = 0;
    for (ch in pool) { if (wide(ch)) a++; if (tight(ch)) b++; }
    return { denom: denom, wide: a, tight: b };
  }

  function paint(d) {
    D = d;
    D.keys = Object.keys(d.codes).sort();
    D.shortKeys = Object.keys(d.short).sort();

    // 統計：打完碼就自己出字的字數
    var solo = 0, all = 0, ch;
    for (ch in D.main) {
      var mc = D.main[ch];
      if (!mc) continue;
      all++;
      if (D.codes[mc] === ch && !hasLongerCode(mc)) solo++;
    }
    put('ac-n-solo', nf(solo));
    put('ac-n-pct', Math.round(solo * 100 / all) + '%');

    var blocked = 0, top = Math.min(COMMON, D.order.length);
    for (var i = 0; i < top; i++) {
      var c = D.order[i], m = D.main[c];
      if (m && D.codes[m] === c && hasLongerCode(m)) blocked++;
    }
    put('ac-n-blocked', nf(blocked));

    /* 〈流暢模式〉那一節要的數字：把三簡碼、左簡碼、偏旁碼、容錯碼都關掉之後，
       有多少字打完主碼就自己出字。上面的 solo 用的是 dict.json 的 codes ——
       那張表另外併了兼容碼與未截斷的完整碼，等於「全開」的情況；這裡另外只用
       main（字 → 主碼）搭一張表重算一次，兩個數字的差就是關掉那些設定換來的。 */
    var mkeys = [], mown = {}, mc2;
    for (ch in D.main) {
      mc2 = D.main[ch];
      if (!mc2) continue;
      if (!(mc2 in mown)) { mown[mc2] = ch; mkeys.push(mc2); }
      else mown[mc2] = null;                  // 主碼撞了，就不是「唯一」
    }
    mkeys.sort();
    var off = 0;
    for (ch in D.main) {
      mc2 = D.main[ch];
      if (!mc2 || mown[mc2] !== ch) continue;
      var rr = range(mkeys, mc2), lone = true;
      for (var z = rr[0]; z < rr[1]; z++) if (mkeys[z] !== mc2) { lone = false; break; }
      if (lone) off++;
    }
    put('ac-off-line', '關掉之後，全部 ' + nf(all) + ' 個已取碼的字裡，有 ' + nf(off) +
        ' 個（' + Math.round(off * 100 / all) + '%）打完主碼就自己出字（上面那個 ' +
        Math.round(solo * 100 / all) + '% 是連兼容碼一起算的）。');

    var cr = commonRate(CS);
    var crNode = document.getElementById('ac-common-line');
    if (crNode) {
      if (cr) {
        crNode.textContent = '如果再打開〈只打常用字〉與〈不打簡體〉，把生僻字與簡體專屬字'
          + '整批移出候選池，那 ' + nf(cr.denom) + ' 個已取碼的常用繁體字裡，打完主碼就'
          + '自己出字的會從 ' + nf(cr.wide) + ' 個（'
          + Math.round(cr.wide * 100 / cr.denom) + '%）增加到 ' + nf(cr.tight) + ' 個（'
          + Math.round(cr.tight * 100 / cr.denom) + '%）——兩邊數的都是同一批字，'
          + '多出來的 ' + nf(cr.tight - cr.wide) + ' 個，是本來被自己根本不會打的字擋著的。';
      } else {
        // 沒有字集資料就整句不出現，不要印一個算不出來的百分比
        crNode.parentNode.removeChild(crNode);
      }
    }

    put('ac-solo-line', '全部 ' + nf(all) + ' 個已取碼的字裡，有 ' + nf(solo) +
        ' 個（' + Math.round(solo * 100 / all) + '%）是這一種——打完就走，一下空白都不必按。');

    var b = pickBlocked();
    if (b) {
      put('ac-block-line', '最常用的 ' + nf(top) + ' 個字裡，有 ' + nf(blocked) +
          ' 個字的碼雖然只屬於它自己，卻被更長的碼擋著——包括最常用的「' + b.ch + '」。');
      var pairBox = document.querySelector('[data-pair="block"]');
      if (pairBox) drawPair(pairBox, b);
    }

    var p = pickPartial();
    if (p) {
      put('ac-partial', '打 ' + p.pre.toUpperCase() + ' 的時候全表只有「' + p.ch +
          '」接得下去，但碼還差 ' + p.rest.toUpperCase());
    }

    var s = pickSolo();
    var soloBox = document.querySelector('[data-tape="solo"]');
    if (s && soloBox) drawTrace(soloBox, D.main[s]);

    /* 混合示範：頭一個字要被即時頂頂出去，第二個字要靠唯一上屏 —— 兩種都出手
       一次，一張表講完整件事。字從字頻表現挑，挑不到就退回只示範第一個字。 */
    var mixBox = document.querySelector('[data-tape="mix"]');
    if (mixBox && b) {
      /* 第二個字要滿足三件事，否則示範不到「兩種上屏各出手一次」：
           · 它的第一鍵要讓前一個字的碼真的死掉（不然頂不出來）
           · 它自己要打得完、而且是靠唯一上屏走的（不然表格結尾掛著一串沒收的碼）
         條件寫成「跑一次 trace 看結果對不對」而不是逐條猜 —— 判斷規則只有一份，
         就是 trace 自己。 */
      var seq = null;
      for (var q = 0; q < D.order.length && !seq; q++) {
        var c2 = D.order[q], m2 = typedAs(c2);
        if (!m2 || m2.length < 2 || alive(b.code + m2.charAt(0))) continue;
        var t2 = trace(b.code + m2), last = t2[t2.length - 1];
        if (t2[b.code.length] && t2[b.code.length].act === 'push' &&
            last && last.act === 'sole' && last.ch === c2) seq = b.code + m2;
      }
      if (seq) drawTrace(mixBox, seq);
      else mixBox.parentNode.hidden = true;    // 挑不到就整塊不出現，不要示範一半
    }
  }

  /* charset.json 是**選配**：抓不到就只少那一句，這一頁其餘的數字照常算
     （它抄自 Side B 的產出，欄位改名的空窗期有可能產不出來）。 */
  Promise.all([
    fetch('assets/dict.json').then(function (r) { return r.json(); }),
    fetch('assets/charset.json').then(function (r) { return r.json(); })
      .catch(function () { return null; })
  ])
    .then(function (v) { CS = v[1]; paint(v[0]); })
    .catch(function () {
      var n = document.getElementById('ac-solo-line');
      if (n) n.textContent = '（碼表載入失敗，這一頁的例字與數字暫時算不出來。）';
    });
})();
