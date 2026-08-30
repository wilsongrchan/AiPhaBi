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

  /* ── 上屏補碼：自動上屏的固定長度版 ──────────────────────────────────
     規則移植自 rime/lua/aiphabi_supp.lua（M.suppcode 的產生規則，不是照抄
     那張表本身——這裡跟主碼一樣現算，理由同檔頭）：
       1 碼字 —— 不補，一律按空白／數字選字（全表僅有的例外）。
       2、3 碼字 —— 補兩個 U。
       4 碼字 —— 補一個 U。
       5 碼字 —— 不變（主碼本來就是固定長度）。
     少數 2 碼字的補完碼（4 碼）剛好是某個 5 碼補完碼的前綴（例：女 LJUU 是
     姍 LJUUI 的前綴）——這種字**不是**退回按空白，是併進「撞碼」那條路走
     即時頂：候選欄照樣先出現這個字，繼續打下一個字的第一鍵，沒接成那個
     更長的碼，就把它頂上屏（Side B 2026-08-29 second correction：一開始
     以為這批字要排除，其實跟真正的重碼是同一種收法）。 */
  function suppPad(mc) {
    if (!mc) return null;
    if (mc.length === 1) return null;             // 字根，不補
    if (mc.length === 2 || mc.length === 3) return mc + 'uu';
    if (mc.length === 4) return mc + 'u';
    return mc;                                    // 5 碼，不變
  }

  var SUPP = null;   // { table: 補完碼→[字，依字頻排]，committed: Set(打滿就對) }
  function buildSupp() {
    var raw = {}, ch, mc, pc;
    for (ch in D.main) {
      mc = D.main[ch];
      pc = suppPad(mc);
      if (!pc) continue;
      (raw[pc] || (raw[pc] = [])).push(ch);
    }
    var keys = Object.keys(raw).sort();
    // 這個補完碼後面還有沒有更長的補完碼掛著（跟自動上屏的 hasLongerCode
    // 同一種問法，但問的是補完碼的世界——只有 4 碼的補完碼可能撞到，因為
    // 這套規則裡沒有比 5 碼更長的補完碼）。
    function hasLongerSupp(k) {
      var lo = lowerBound(keys, k, 0), hi = keys.length;
      for (var i = lo; i < hi; i++) {
        if (keys[i].indexOf(k) !== 0) break;
        if (keys[i] !== k) return true;
      }
      return false;
    }
    // 各碼底下依字頻排（跟真正的即時頂一致：撞碼時頂最常用的那個）
    var rank = {};
    for (var i = 0; i < D.order.length; i++) rank[D.order[i]] = i;
    var far = D.order.length + 1;
    keys.forEach(function (k) {
      raw[k].sort(function (a, b) { return (rank[a] == null ? far : rank[a]) - (rank[b] == null ? far : rank[b]); });
    });
    // 打滿就對＝這個補完碼只對到一個字，而且後面沒有更長的補完碼在排隊；
    // 其餘（真的撞碼、或雖然目前只有一個字但還有更長的碼可能接下去）都算
    // 「靠即時頂決定」。
    var committed = {};
    keys.forEach(function (k) {
      if (raw[k].length === 1 && !hasLongerSupp(k)) committed[raw[k][0]] = true;
    });
    return { table: raw, committed: committed };
  }

  // 補完碼打滿就對的例子（示範用，挑常用、2 或 3 碼的字）
  function pickSuppExample() {
    for (var i = 0; i < D.order.length; i++) {
      var ch = D.order[i], mc = D.main[ch];
      if (!mc || (mc.length !== 2 && mc.length !== 3) || !SUPP.committed[ch]) continue;
      return { ch: ch, mc: mc, pc: suppPad(mc) };
    }
    return null;
  }
  // 補完碼要靠即時頂決定的例子——優先找「補完碼本身只對到一個字，但還有
  // 更長的補完碼接下去」這種（女／姍那種），比單純的撞碼更能說明「即時頂
  // 不是只有重碼才用得到」。找不到就退回一般的撞碼例子。
  function pickSuppClash() {
    var fallback = null;
    for (var i = 0; i < D.order.length; i++) {
      var ch = D.order[i], mc = D.main[ch];
      if (!mc || SUPP.committed[ch]) continue;
      var pc = suppPad(mc);
      if (!pc) continue;
      var bucket = SUPP.table[pc];
      if (!bucket || bucket[0] !== ch) continue;   // 只挑「即時頂會頂到它」的那個
      if (bucket.length === 1) return { ch: ch, mc: mc, pc: pc, clash: bucket, longer: true };
      if (!fallback) fallback = { ch: ch, mc: mc, pc: pc, clash: bucket, longer: false };
    }
    return fallback;
  }

  /* 補碼demo 是純線性的：一路打到補完碼的最後一碼才上屏，中間沒有分支——
     不必比照 trace() 那套判斷引擎，直接把每一步的動作排出來就好。 */
  function drawSuppTape(box, ex) {
    box.innerHTML = '';
    var head = el('div', 'ac-row is-head');
    ['按鍵', '碼欄', '結果'].forEach(function (t) { head.appendChild(el('span', null, t)); });
    box.appendChild(head);
    var buf = '';
    for (var i = 0; i < ex.pc.length; i++) {
      var k = ex.pc.charAt(i);
      buf += k;
      var last = i === ex.pc.length - 1;
      var row = el('div', 'ac-row' + (last ? ' is-fire' : ''));
      row.appendChild(el('kbd', 'ac-key', k.toUpperCase()));
      row.appendChild(el('code', 'ac-buf', buf.toUpperCase()));
      var r = el('span', 'ac-act');
      if (last) {
        r.appendChild(el('i', 'ac-tag is-sole', '補完上屏'));
        r.appendChild(el('b', null, ex.ch));
      } else {
        r.appendChild(el('span', 'ac-why', i < ex.mc.length ? '主碼還沒打完' : '補碼還沒補完，等下一鍵'));
      }
      row.appendChild(r);
      box.appendChild(row);
    }
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

    /* 上屏補碼：獨立算一次，跟自動上屏的統計不共用（規則完全不同——這裡是
       固定長度，不是「還有沒有更長的路」）。百分比一律除以全部已取碼的字數
       （all），不是只除以「有補完碼」的那一部分——這樣三個數字加起來才會
       是全部。 */
    SUPP = buildSupp();
    var singleN = 0;
    for (ch in D.main) { if (D.main[ch] && D.main[ch].length === 1) singleN++; }
    var committedN = Object.keys(SUPP.committed).length;
    var resolvedN = all - singleN - committedN;
    var committedPct = Math.round(committedN * 100 / all);
    var resolvedPct = Math.round(resolvedN * 100 / all);
    var singlePct = Math.round(singleN * 100 / all * 10) / 10;   // 0.7% 這種小數，四捨五入到一位

    // U 當末碼有多罕見：掃一遍全部主碼，數末字母是 u 的有幾個（不分大小寫，
    // 主碼本來就存小寫）。這是「為什麼選 U 來補」的證據，跟補碼規則本身
    // 是兩件事——U 罕見是因，補碼用它是果。
    var uFinal = 0;
    for (ch in D.main) {
      mc = D.main[ch];
      if (mc && mc.charAt(mc.length - 1) === 'u') uFinal++;
    }

    put('supp-n-total', nf(committedN));
    put('supp-n-pct', committedPct + '%');
    put('supp-single-n', nf(singleN));
    put('supp-u-n', nf(uFinal));

    put('supp-rule-line', '全部 ' + nf(all) + ' 個已取碼的字裡，除了 ' + nf(singleN) +
        ' 個一碼字根（' + singlePct + '%，只能按空白或數字選）以外都有補完碼；其中 ' +
        nf(committedN) + ' 個（' + committedPct + '%）補完碼獨一無二、後面也沒有更長的補完碼' +
        '在排隊，打滿就對；其餘 ' + nf(resolvedN) + ' 個（' + resolvedPct +
        '%）——真的撞到別的字，或者雖然目前只有它、但還有更長的補完碼可能接下去——' +
        '都靠即時頂決定先上哪一個，跟自動上屏的頂功上屏是同一招。');

    var ex = pickSuppExample();
    if (ex) {
      put('supp-example-line', '譬如「' + ex.ch + '」（' + ex.mc.toUpperCase() + '）補完碼是 ' +
          ex.pc.toUpperCase() + '。');
      var suppBox = document.querySelector('[data-tape="supp"]');
      if (suppBox) drawSuppTape(suppBox, ex);
    }

    var cl = pickSuppClash();
    if (cl) {
      if (cl.longer) {
        put('supp-clash-line', '譬如「' + cl.ch + '」（' + cl.mc.toUpperCase() + '）補完碼 ' +
            cl.pc.toUpperCase() + ' 本身只對到它，但後面還接得出更長的碼（例如再多打一鍵接成' +
            '別的字）——所以不直接打滿就收，一樣靠下一鍵的即時頂決定。');
      } else {
        put('supp-clash-line', '譬如「' + cl.mc.toUpperCase() + '」的補完碼 ' + cl.pc.toUpperCase() +
            '，同時是「' + cl.clash.join('、') + '」共 ' + nf(cl.clash.length) +
            ' 個字的碼——先上字頻最高的「' + cl.clash[0] + '」。');
      }
    }

    put('supp-except-line', '只有這 ' + nf(singleN) + ' 個一碼字根不補碼，因為已經是最短的碼，' +
        '沒有再補的空間——一律按空白或數字選字，跟開不開這個模式無關。');
  }

  fetch('assets/dict.json')
    .then(function (r) { return r.json(); })
    .then(paint)
    .catch(function () {
      var n = document.getElementById('ac-solo-line');
      if (n) n.textContent = '（碼表載入失敗，這一頁的例字與數字暫時算不出來。）';
    });
})();
