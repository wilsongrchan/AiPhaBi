/* 線上試打 —— 直接查 assets/dict.json，那份是從 data/codes.json 產生的，
 * 所以這裡打得出來的字跟真正的輸入法一致（每次網站部署時重新產生）。
 *
 * 這是「夠真實可以體會設計」的版本，不是完整模擬。目前有：
 *   主碼／完整碼／兼容碼查詢、前綴補全、字頻排序、約定簡碼（含提示，可關）、
 *   三簡碼（可開，預設關——用剩法查很容易誤觸，Wilson 決定跟真正輸入法一樣預設關）、
 *   詞組連打＋四碼快打（可開，預設關，詞庫另外抓，見 PHRASE_ON）、
 *   萬用鍵、正體標點。
 * 還沒有（真正的輸入法有）：左簡碼、輸入容錯、同類字、偏旁碼、智能分詞。
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

  /* 詞組**補全**（打的是某個詞的前綴）最多佔幾格。九格全給它會很難看：候選列
     是一條橫捲的窄條，而詞比字長 —— 打 JTBWHZ 會排出 香港理工、香港城市大學、
     香港警務處…，一眼只看得到三個，真正打中的「香港」被推得看不出來。
     打中的詞不受這個上限管，那是使用者要的東西。 */
  var MAX_PHRASE_COMPLETE = 3;

  /* 跟著打的時候，「一格」最多幾個字。詞組開著、而且文章接下來剛好是收錄詞，
     整個詞算一格：亮起來的是「白日」不是「白」，提示教的也是兩個字連起來的
     那一串 —— 詞組連打要練的正是這個（Wilson）。
     上限 4：essay 那批常用詞本來就只收 2–4 字（build_rime.py 的 PHRASE_TOPN
     那段），而 3 字以上才練得到四碼快打。精選詞庫裡的長詞（中華人民共和國）
     當成一格會是一面牆，練不起來，所以不讓它整串進來。 */
  var UNIT_MAX = 4;

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
  /* 詞組連打。四碼快打**沒有自己的開關**，跟著它走 —— 真正的輸入法就是這樣接的
     （rime/lua/aiphabi_hint.lua:89 的 si4_on 直接 and phrase_on），這裡照抄，
     不要好心多給一個開關，那會變成網站在描述一個不存在的設定。
     預設關，跟 IME 一致；而且詞庫有 3MB，關著的時候一個位元組都不抓。 */
  var PHRASE_KEY = 'aiphabi_try_phrase';
  var PHRASE_ON = false;
  var PD = null;              // 詞庫（assets/phrase_dict.json），載入後才有
  var PD_STATE = 'idle';      // idle | loading | ready | fail

  try {
    var savedShort = localStorage.getItem(SHORT_KEY);
    if (savedShort != null) SHORT_ON = savedShort === '1';
    var savedShort3 = localStorage.getItem(SHORT3_KEY);
    if (savedShort3 != null) SHORT3_ON = savedShort3 === '1';
    PHRASE_ON = localStorage.getItem(PHRASE_KEY) === '1';
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

  /* 詞庫另外抓，而且只在使用者第一次打開詞組開關時才抓。3MB 是給願意試詞組的人
     付的，不該讓只想打幾個字的人先等它。抓失敗不影響其他功能 —— 開關旁邊會說一句，
     其餘照常打。 */
  function loadPhraseDict() {
    if (PD_STATE === 'loading' || PD_STATE === 'ready') return;
    PD_STATE = 'loading';
    paintPhraseNote();
    fetch('assets/phrase_dict.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // 碼排序一次，之後補全就能跟單字那邊一樣二分找前綴區間（10 萬個碼，
        // 每按一鍵掃全表太慢，這是唯一一次排序）。
        d.keys = Object.keys(d.codes).sort();
        d.si4keys = Object.keys(d.si4).sort();
        /* 反查：詞 → 它最短的那條詞組碼。跟著打要用它兩件事 ——「文章接下來
           這幾個字算不算一個詞」，以及提示要教哪一條。不從建置那邊多輸出一份
           （那要多 1MB），現場掃一次 10 萬個碼就有，實測 40ms。
           每個碼只留 9 個詞（PDICT_PER_CODE），理論上有詞可能每一條碼都被擠掉
           而完全查不到；實測是 0 個（42,676 個詞全部至少在一條碼裡找得到），
           建置那邊也印得出這個數，真的變成非 0 再說。 */
        d.word = {};
        for (var c in d.codes) {
          var ws = d.codes[c];
          for (var i = 0; i < ws.length; i++) {
            if (!d.word[ws[i]] || c.length < d.word[ws[i]].length) d.word[ws[i]] = c;
          }
        }
        /* 詞 → 它的四碼簽名（可能不只一條：兼容碼會多換出幾條，五字以上還有
           兩式）。跟著打要拿它判斷「這一串是不是正在打四碼快打」，沒有它就會
           把打對的四碼當成打歪的字碼標紅（Wilson 2026-08-26 回報）。
           14,542 條，掃一次幾毫秒。 */
        d.wsi4 = {};
        for (var q in d.si4) {
          var qs = d.si4[q];
          for (var j = 0; j < qs.length; j++) {
            (d.wsi4[qs[j]] || (d.wsi4[qs[j]] = [])).push(q);
          }
        }
        PD = d;
        PD_STATE = 'ready';
        paintPhraseNote();
        // 載入前這一格只能是單字，載入後才成得了詞 —— 文章要跟著重畫
        setBuf(state.buf);
        if (P.on) renderPractice();
      })
      .catch(function () { PD_STATE = 'fail'; paintPhraseNote(); });
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

    /* 詞組連打：詞的碼＝各字的碼串接（規則見 cizu.html）。打中的詞跟打中的字
       同一級，排在單字後面。順序幾乎不影響任何人 —— 實測前 2000 個常用詞的
       5269 條詞碼裡，只有 17 條（0.3%）跟某個單字的碼相撞，而且撞的多半正好是
       那個詞的合體字（一個/吞、不好/孬、不用/甭、兩人/眾），兩個都給就好。 */
    if (PHRASE_ON && PD) {
      var pw = PD.codes[buf];
      if (pw) for (var pi = 0; pi < pw.length && list.length < MAX_CANDS; pi++) {
        push(pw[pi], { tag: '詞組', exact: true });
      }
      // 四碼快打：打滿四碼算「打中」（IME 那邊標 ap_si4，跟 exact 同級）
      if (buf.length === 4) {
        var s4 = PD.si4[buf];
        if (s4) for (var qi = 0; qi < s4.length && list.length < MAX_CANDS; qi++) {
          push(s4[qi], { tag: '四碼', exact: true });
        }
      }
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
    /* 詞組的補全：打的是某個詞的前綴，還沒打完。排在單字補全與三簡碼後面 ——
       詞比字長，前綴撞得多，讓它搶前面會把正在打單字的人擠掉。碼表按碼的字母序
       排，所以短碼時前幾個會是冷門詞；但短碼時單字早就把九格佔滿了，實際看得到
       詞組補全的時候碼都已經夠長、範圍夠窄。 */
    if (PHRASE_ON && PD && list.length < MAX_CANDS) {
      /* 跟著打的時候，正在打的那個詞先進來 —— 補全是照碼的字母序掃的，只留三格，
         很容易把它擠掉（打 HUVW 時 黃浦／黃酒／黃沙 都排在 黃河 前面），
         那會讓人以為自己打錯了。只是**列進去**，不是排第一：還沒打完的碼不該
         按空白就過關，那條規矩跟單字那邊一樣。 */
      if (P.on && P.unit.length > 1) {
        var uc = PD.word[P.unit];
        if (uc && uc !== buf && uc.indexOf(buf) === 0) {
          push(P.unit, { tag: '詞組', code: '- ' + uc.slice(buf.length).toUpperCase() });
        }
      }
      var pr = prefixRange(PD.keys, buf), pcap = list.length + MAX_PHRASE_COMPLETE;
      for (var k2 = pr[0]; k2 < pr[1] && list.length < MAX_CANDS && list.length < pcap; k2++) {
        if (PD.keys[k2] === buf) continue;
        var ws = PD.codes[PD.keys[k2]];
        for (var wi = 0; wi < ws.length && list.length < MAX_CANDS && list.length < pcap; wi++) {
          push(ws[wi], { tag: '詞組',
                         code: '- ' + PD.keys[k2].slice(buf.length).toUpperCase() });
        }
      }
    }

    // 四碼快打打到第三碼：先把符合的詞補出來，墊底 —— 跟 aiphabi_hint.lua 一樣，
    // 三碼是「四碼的前綴」（ap_pool），不是打中，不該擠掉真的打中的候選。
    if (PHRASE_ON && PD && buf.length === 3 && list.length < MAX_CANDS) {
      var qr = prefixRange(PD.si4keys, buf), qcap = list.length + MAX_PHRASE_COMPLETE;
      for (var k3 = qr[0]; k3 < qr[1] && list.length < MAX_CANDS && list.length < qcap; k3++) {
        var qs = PD.si4[PD.si4keys[k3]];
        for (var qj = 0; qj < qs.length && list.length < MAX_CANDS && list.length < qcap; qj++) {
          push(qs[qj], { tag: '四碼',
                         code: '- ' + PD.si4keys[k3].slice(3).toUpperCase() });
        }
      }
    }

    /* 跟著打的時候，文章裡的那個字排第一 —— 打完它的碼卻還要按 2 才選得到，
       練起來很卡（Wilson）。兩個限制：
         · 只在跟著打模式動手腳。自由試打那邊照真正的輸入法的字頻順序排，
           那裡本來就是在示範輸入法的行為，插隊會變成騙人。
         · 只有**真的打中**（打的碼就是它的碼）才插隊；還沒打完的補全不插隊，
           否則碼打一半就能按空白過關，等於不必學會拆碼。
       實測四篇文章 573 個已取碼的字，打完該打的碼之後有 12 個排不到第一
       （名/合、什/午、引/乃、丹/曰…），而沒有任何一個字是根本不在候選列裡的
       —— 所以「在列表裡就往前挪」已經涵蓋全部情況，不必再去撈第 10 名以後的。 */
    if (P.on && P.pos < P.chars.length) {
      var tgt = P.chars[P.pos], up = -1;
      /* 詞組先看：候選裡有哪個詞剛好就是文章接下來的那幾個字，它排第一。
         同一個道理（打完該打的碼還要按 2 很卡），而且命中的詞比只命中第一個字的
         單字更貼近意圖 —— 打詞組碼的人要的本來就是那整個詞。 */
      if (PHRASE_ON && PD) {
        for (var t0 = 0; t0 < list.length; t0++) {
          if (list[t0].ch.length > 1 && list[t0].exact && aheadIs(list[t0].ch)) {
            up = t0;
            break;
          }
        }
      }
      if (up < 0) {
        for (var t = 0; t < list.length; t++) {
          if (list[t].ch === tgt && (list[t].exact || list[t].tag === '三簡')) {
            up = t;
            break;
          }
        }
      }
      if (up > 0) list.unshift(list.splice(up, 1)[0]);
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
    /* 詞組打完了，而它其實有更短的四碼可用 —— 跟簡碼同一套「教你少打幾碼」
       （IME 那邊是 aiphabi_hint.lua 的 si4_rev，一樣只在真的比較短時才提）。 */
    if (top.length > 1) {
      if (!PHRASE_ON || !PD) return '';
      var q = PD.rev[top];
      return q && q.length < buf.length ? '四碼 ' + q.toUpperCase() : '';
    }
    if (!SHORT_ON) return '';
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
      var tgt = curChar(), ap = activePath(tgt), tsegs = ap && ap.segs;
      if (tsegs && tsegs.length) {
        var mm = typedMatch(tgt, tsegs);
        /* 從「還有機會變成這個字」的地方斷，不是從主碼比到哪斷 —— 走兼容碼的人
           前幾碼跟主碼對不上，拿主碼比會把他打對的那幾碼也標紅。
           打詞的時候，前面幾個字已經吃掉的那幾碼（P.uoff）當然不算打歪，所以
           斷點要從那裡往後算 —— 詞組關著時 uoff 是 0，跟以前完全一樣。 */
        if (mm.bad) {
          split = P.uoff + reachLen(tgt, curBuf());
          var q4 = si4Reach(state.buf);          // 四碼比的是整串，不是某個字那一截
          if (q4 > split) split = q4;
          if (split >= state.buf.length) split = null;
        }
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
    // 按一次 = 往前一步，走完一個字根就換下一個。字換了就整個歸零。
    // hov = 有簡碼的字，第一步的「簡碼總覽」給過了沒有（見 hintStep）。
    // hpath = 上一次算出來「現在走的是哪一套拆法」的碼（見 setBuf）。
    hseg: 0, hstep: 0, hov: 0, hpath: null, qstep: 0,
    /* 「這一格」＝ unit。詞組關著時它就是一個字，行為跟以前一模一樣；
       開著而且文章接下來剛好成詞，它就是那個詞（見 unitAt）。
         uix  = 現在打到這個詞的第幾個字（田字格、提示都看它）
         uoff = 前面那幾個字用掉了 buf 的前幾碼（提示要看的是剩下那一截）
         ucodes = 前面那幾個字**各自**被吃掉的那條碼（主碼／簡碼／兼容碼都可能）。
                  兩字詞縮到左上角那一小格要照這條碼上色 —— 打簡碼過關的字只該
                  亮簡碼用到的那幾條，照主碼全部亮起來等於說了一句他沒打的話。
         pshown = 上一次 drawPair 畫的是哪個詞的第幾個字（換字的縮放動畫看它） */
    unit: '', uix: 0, uoff: 0, ucodes: [], pshown: null
  };

  /* 這個字打得出來的所有碼，含約定簡碼／三簡碼 —— 切詞用。codePaths 是碼表裡
     查得到的（主碼／完整碼／兼容碼），簡碼另外一張表，三簡碼是現算的。 */
  function unitCodesOf(ch) {
    var d = state.data, list = codePaths(ch).slice();
    if (d && SHORT_ON && d.short_rev[ch]) list.push(d.short_rev[ch]);
    var mc = d && P.main ? P.main[ch] : null;
    if (mc && mc.length >= 4) list.push(mc.charAt(0) + mc.charAt(1) + mc.charAt(mc.length - 1));
    return list;
  }

  /* 文章接下來該打的一格。詞組開著就找最長的收錄詞（上限 UNIT_MAX），
     找不到就退回一個字 —— 那正是詞組關著時的行為，兩條路合成同一條。 */
  function unitAt() {
    if (!P.on || P.pos >= P.chars.length) return '';
    var ahead = '';
    for (var i = P.pos; i < P.chars.length && ahead.length < UNIT_MAX; i++) {
      if (P.chars[i] !== '\n') ahead += P.chars[i];
    }
    if (PHRASE_ON && PD && PD.word) {
      for (var n = ahead.length; n >= 2; n--) {
        if (PD.word[ahead.slice(0, n)]) return ahead.slice(0, n);
      }
    }
    return ahead.charAt(0);
  }

  /* 打到這個詞的第幾個字了：拿 buf 逐字啃掉每個字的碼。啃不動就停在那個字上
     —— 那表示它還沒打完（或打歪了），提示本來就該講它。 */
  function syncUnit() {
    if (!P.on) { P.unit = ''; P.uix = 0; P.uoff = 0; return; }
    var was = P.unit, wasIx = P.uix;
    P.unit = unitAt();
    P.uix = 0;
    P.uoff = 0;
    P.ucodes = [];
    var rest = state.buf;
    while (P.uix < P.unit.length - 1 && rest) {
      var codes = unitCodesOf(P.unit.charAt(P.uix)), best = '';
      for (var i = 0; i < codes.length; i++) {
        if (rest.indexOf(codes[i]) === 0 && codes[i].length > best.length) best = codes[i];
      }
      if (!best) break;                 // 這個字還沒打完 —— 停在它身上
      P.ucodes.push(best);
      P.uoff += best.length;
      rest = rest.slice(best.length);
      P.uix++;
    }
    // 換字了（跨過詞裡的字界，或整格換了）就把提示鏈歸零：段號只在某一個字的
    // 某一套拆法裡有意義，沿用會亮在別的字的筆畫上。
    var moved = P.unit !== was || P.uix !== wasIx;
    if (moved) resetHint();
    return moved;
  }

  /* 現在提示與田字格講的是哪個字、以及屬於它的那一截 buf。詞組關著時
     unit 只有一個字、uoff 是 0，兩個都退化成原本的行為。 */
  function curChar() { return P.unit ? P.unit.charAt(P.uix) : P.chars[P.pos]; }
  function curBuf() { return state.buf.slice(P.uoff); }

  /* 提示鏈歸零。hseg 是段號，而段號只在**某一套拆法**裡有意義 —— 換字、換篇、
     換打法（主碼↔兼容碼）都得歸零，留著會亮在錯的筆畫上。 */
  function resetHint(path) {
    P.hseg = 0; P.hstep = 0; P.hov = 0; P.hpath = path || null;
    P.qstep = 0;                        // 四碼快打那四格也一起收回去
  }

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
  function segsOfEntry(e) {
    if (!e || !e.s || !e.s.length) return null;
    var list = [];
    for (var i = 0; i < e.c.length; i++) if (e.s[e.c[i]]) list.push(e.s[e.c[i]]);
    return list.length ? list : null;
  }
  function segsFrom(table, ch) { return segsOfEntry(table && table[ch]); }
  function segsOf(ch) { return segsFrom(P.segs, ch); }

  function codeOfSegs(segs) {
    var s = '';
    for (var i = 0; i < segs.length; i++) s += segs[i].L.toLowerCase();
    return s;
  }

  /* 這個字有幾套拆法：主碼一套，每條兼容碼各一套（practice.json 的 a[]）。
     兼容碼是**另一套拆法**，段跟主碼對不上 —— 教 主碼是 T[0,1] X[2,3] P[4,5] X[7…]，
     兼容碼 FJPX 卻是 F[0,1,2] J[3] P[4,5] X[7…]。所以上色、字母格、提示都得先認
     清楚現在走的是哪一套，不然打兼容碼要嘛沒回饋、要嘛亮在錯的筆畫上。 */
  function pathsOf(ch) {
    var e = P.segs && P.segs[ch], out = [], s = segsOfEntry(e);
    if (!e) return out;
    if (s) out.push({ segs: s, isMain: true });
    for (var i = 0; e.a && i < e.a.length; i++) {
      var a = segsOfEntry(e.a[i]);
      if (a) out.push({ segs: a, isMain: false });
    }
    return out;
  }

  /* 現在打的是哪一套：拿 buf 跟每一套的碼比前綴，最長的那套贏。平手算主碼 ——
     還沒打字、或前幾碼兩套一樣的時候，該教的是主碼那一套。 */
  function activePath(ch) {
    var list = pathsOf(ch);
    if (!list.length) return null;
    var buf = curBuf(), best = list[0], bn = -1;
    for (var i = 0; i < list.length; i++) {
      var p = codeOfSegs(list[i].segs), n = 0;
      while (n < buf.length && n < p.length && buf.charAt(n) === p.charAt(n)) n++;
      if (n > bn) { bn = n; best = list[i]; }
    }
    return best;
  }

  /* 這個字現在有沒有可用的簡碼提示 —— 「有簡碼」那個標籤跟 = 的第一步都看它，
     標了卻按不出東西（為／爲 沒有字根分段）就成了空頭支票。 */
  function shortPlanOf(ch) {
    var segs = segsOf(ch);
    return segs ? shortPlan(ch, segs) : null;
  }

  /* 這個字打得出來的**所有**碼：主碼、完整碼、兼容碼都在 dict.json 的碼表裡
     （教 → txpx 與 fjpx；親 → ivtdl 與 ivtdjl），直接掃那一份就好，不必另外
     從 codes.json 把 alts 抄一份出來 —— 抄了就會有第二份跟碼表不同步的資料，
     而「網站跟輸入法不一樣」是最難發現的那種錯。
     ⚠️ 約定簡碼**不在**這裡面：簡碼表是另一張（d.short），而且簡碼字串常常
     是別的字的主碼（的 的簡碼 JA 就是 歹 的主碼），照 codes 查會查到別人身上。
     8000 多個碼掃一遍不到 1ms，而且只在換字時掃一次，所以照字快取起來。 */
  var _paths = { ch: null, list: null };
  function codePaths(ch) {
    var d = state.data;
    if (!d || !d.keys) return [];
    if (_paths.ch === ch) return _paths.list;
    var list = [];
    for (var i = 0; i < d.keys.length; i++) {
      if (d.codes[d.keys[i]].indexOf(ch) >= 0) list.push(d.keys[i]);
    }
    _paths.ch = ch; _paths.list = list;
    return list;
  }

  /* 打到第幾碼為止，還有機會變成這個字 —— 拿 buf 去跟每一條碼比前綴，取最長的。
     等於 buf.length 就表示還在路上（不標紅）；比它短，短的那一截就是打歪的地方。
     走兼容碼的人前幾碼跟主碼完全不一樣（教 的 FJPX 跟 TXPX 第一碼就分家），
     以前一律當打錯，連打對的那幾碼也一起標紅（Wilson 2026-08-24）。 */
  function reachLen(ch, buf) {
    var d = state.data, best = 0;
    if (!d || !buf) return 0;
    function lcp(p) {
      var n = 0;
      while (n < buf.length && n < p.length && buf.charAt(n) === p.charAt(n)) n++;
      return n;
    }
    if (SHORT_ON && d.short_rev[ch]) best = lcp(d.short_rev[ch]);
    /* 三簡碼（頭兩碼＋末一碼）也是一條打得出這個字的路 —— 漏了它，開著三簡碼
       打三簡碼會被整串標紅、還被說「再試一次」（Wilson 2026-08-26 回報）。
       跟 unitCodesOf 同一條算法，開關關著時不算：畫面上打不出來的不該說對。 */
    var mc3 = SHORT3_ON && P.main ? P.main[ch] : null;
    if (mc3 && mc3.length >= 4) {
      var n3 = lcp(mc3.charAt(0) + mc3.charAt(1) + mc3.charAt(mc3.length - 1));
      if (n3 > best) best = n3;
    }
    var list = codePaths(ch);
    for (var i = 0; i < list.length && best < buf.length; i++) {
      var n = lcp(list[i]);
      if (n > best) best = n;
    }
    return best;
  }

  /* 這一串還有沒有機會變成「整格那個詞的四碼快打」。跟 reachLen 不同的是它
     比的是**整串** buf、從第一碼起算 —— 四碼是給整個詞的，不屬於任何單一個字。
     只在 uoff 為 0（前面沒有字被逐字吃掉）時才算：一旦逐字打起來了，走的就是
     詞組連打那條路，那條路要照字比。 */
  function si4Reach(buf) {
    if (!PHRASE_ON || !PD || !PD.wsi4 || P.uoff || !buf) return 0;
    var arr = PD.wsi4[P.unit];
    if (!arr) return 0;
    var best = 0;
    for (var i = 0; i < arr.length; i++) {
      var n = 0;
      while (n < buf.length && n < arr[i].length && buf.charAt(n) === arr[i].charAt(n)) n++;
      if (n > best) best = n;
    }
    return best;
  }

  function typedMatch(ch, segs) {
    var buf = curBuf(), d = state.data, none = { ok: 0, bad: false };
    if (!buf || !segs.length) return none;
    // 走別條路也算全對：主碼打完（可能被「頭四尾一」截短）、約定簡碼、兼容碼、完整碼
    if ((P.main && buf === P.main[ch]) ||
        (d && ((d.codes[buf] && d.codes[buf].indexOf(ch) >= 0) ||
               (SHORT_ON && d.short[buf] === ch)))) {
      return { ok: segs.length, bad: false };
    }
    var main = '';
    for (var i = 0; i < segs.length; i++) main += segs[i].L.toLowerCase();
    var k = 0;
    while (k < buf.length && k < main.length && buf[k] === main[k]) k++;
    /* 上色只照主碼那幾段算（k）—— 兼容碼是另一套拆法（教 的 FJPX 是
       F[0,1,2] J[3] P[4,5] X[7…]，跟主碼的 T[0,1] X[2,3] 分段不同），
       照主碼的段上色會亮在錯的筆畫上。所以走兼容碼時不給進度色，只是不標紅。 */
    var bad = buf.length > k && reachLen(ch, buf) < buf.length &&
              si4Reach(buf) < buf.length;
    return { ok: k, bad: bad };
  }

  /* 這個字有沒有約定簡碼、簡碼用到哪幾條字根。
     63 個約定簡碼全部是「頭幾碼＋末一碼」（2026-08-24 實測 dict.json：54 個兩碼、
     9 個三碼，沒有例外），所以對得回段號 —— 但還是逐碼核對過才回傳，對不上就回
     null，寧可退回原本的整字提示，也不要把簡碼標在錯的筆畫上。
     簡碼開關關掉的時候也回 null：畫面上打不出來的東西不該教（跟 lookup() 一樣
     現查 SHORT_ON，切換馬上生效）。 */
  function shortPlan(ch, segs) {
    var d = state.data;
    if (!SHORT_ON || !d || !d.short_rev) return null;
    var s = d.short_rev[ch];
    if (!s || s.length >= segs.length) return null;
    var head = s.length - 1;                       // 前面幾碼照抄主碼，最後一碼是主碼的末碼
    for (var i = 0; i < head; i++) {
      if (segs[i].L.toLowerCase() !== s.charAt(i)) return null;
    }
    if (segs[segs.length - 1].L.toLowerCase() !== s.charAt(head)) return null;
    var order = [];
    for (var j = 0; j < head; j++) order.push(j);
    order.push(segs.length - 1);
    return { code: s, order: order };
  }

  /* 提示現在講到哪 —— 上色、字母格、說明文字全部看這一份，三邊才不會各算各的。
       order  提示要走的字根順序。一般照主碼一條一條走；這個字有簡碼（而且簡碼開著）
              就只走簡碼用到的那幾條 —— 學的人真正該打的是那幾碼，講完整主碼等於
              教一串他不必打的東西。
       shown  已經標出筆畫的段號（上色看這個）
       known  連字母都揭曉了的段號（字母格看這個，其餘顯示問號）
     自己打對的碼永遠算「已知」，跟提示走到哪取聯集而不是二選一 —— 有簡碼的字照樣
     可以一路打完整的主碼，那時中間那幾條也該跟著亮起來。 */
  function hintModel(ch) {
    var ap = activePath(ch);
    if (!ap) return null;
    var segs = ap.segs;
    // 簡碼是主碼那一套的捷徑，兼容碼沒有簡碼 —— 走兼容碼時不談簡碼
    var plan = ap.isMain ? shortPlan(ch, segs) : null;
    var order = [];
    if (plan) order = plan.order;
    else for (var i = 0; i < segs.length; i++) order.push(i);

    var m = typedMatch(ch, segs);
    var pos = -1;                                  // 提示走到 order 的第幾格
    if (P.hstep) for (var j = 0; j < order.length; j++) if (order[j] === P.hseg) pos = j;

    var shown = {}, known = {}, any = false;
    if (plan && curBuf() === plan.code) {
      // 打的是簡碼：只亮簡碼用到的那幾條。typedMatch 走簡碼那條路時回傳「全對」，
      // 照它上色會把中間那幾條沒打的也標起來，等於自己打臉剛講過的「只要打這兩條」。
      for (var c = 0; c < order.length; c++) { shown[order[c]] = 1; known[order[c]] = 1; any = true; }
    } else {
      for (var k = 0; k < m.ok && k < segs.length; k++) { shown[k] = 1; known[k] = 1; any = true; }
    }
    if (plan && P.hov) for (var a = 0; a < order.length; a++) { shown[order[a]] = 1; any = true; }
    for (var b = 0; b <= pos; b++) {
      shown[order[b]] = 1; any = true;
      if (b < pos || P.hstep >= 3) known[order[b]] = 1;
    }
    return { segs: segs, order: order, plan: plan, m: m,
             pos: pos, shown: shown, known: known, any: any };
  }

  /* 預設整個字都是黑的 —— 這裡講的是「這個字長這樣」，不是在講字根，
     上色會讓人以為顏色有意思。被提示到、或自己打對的那幾條字根才上色，
     用的是取碼原則頁那一套彩虹分組色（同一條字根同一個顏色）。 */
  function strokeColours(ch) {
    var mo = hintModel(ch);
    if (!mo || !mo.any) return null;
    var map = {};
    for (var i = 0; i < mo.segs.length; i++) {
      if (!mo.shown[i]) continue;
      for (var k = 0; k < mo.segs[i].st.length; k++) map[mo.segs[i].st[k]] = i;
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

  /* ── 四碼快打：一格是三字以上的詞時，田字格切成四小格 ────────────────
     一小格一碼，照四碼的順序排（左上→右上→左下→右下），每格只把貢獻那一碼的
     那條字根標色，其餘筆畫留黑。四個字母連起來就是要打的四碼。

     為什麼不沿用原本那一個大格子：三字以上的詞照 build_rime.py 的規則逐字接
     碼會很長（悲歡離合 連打是 11 碼），真正該學的是四碼那條路，而四碼講的是
     「每個字取一個字母」——那件事非得四個字擺在一起才看得出來（Wilson）。

     取哪一碼跟 _PhraseCoder.si4_forms（site/tools/build_site_data.py，移植自
     build_rime.py）同一條規則：四字詞取四個首碼；三字詞取首首首末 —— 第四碼是
     第三個字的末碼，畫在**同一格**裡（三格，不是四格），首碼末碼各一個顏色。
     這裡的「首碼／末碼」指的是
     segsOf() 那一份（已經套過「頭四尾一」）的第一段與最後一段 —— 跟碼表那邊
     取 char2code 的頭尾字母是同一件事，不然標色會標在被截掉的那幾段上。
     兼容碼換出來的那些簽名不畫：一格只講一條路，那是碼表那邊的事。 */
  var QZ = [0, 1, 2, 4];          // 紅黃綠紫，跟〈詞組〉頁的四碼卡同一個順序

  function si4Cells(unit) {
    if (!unit || unit.length < 3) return null;
    var segs = [], i;
    for (i = 0; i < unit.length; i++) {
      var one = segsOf(unit.charAt(i));
      if (!one || !one.length) return null;      // 有字沒分段就整個不畫，別畫半套
      segs.push(one);
    }
    var out = [];
    for (i = 0; i < unit.length && i < 4; i++) {
      out.push({ ch: unit.charAt(i), picks: [{ seg: segs[i][0], i: i, last: false }] });
    }
    if (unit.length === 3) {
      /* 三字詞是首首首末：第四碼是第三個字的末碼。畫成第四格會讓第三個字出現
         兩次，看起來像畫錯了 —— 改成留在同一格裡，首碼與末碼各上自己那一位的
         顏色（Wilson）。字母也是兩個，末碼那個標一個「末」。
         碼只有一段的字（人 Y、山 W）首碼就是末碼，兩條 pick 指到同一段：顏色
         只上得了一次（後面那條蓋掉前面），但字母照樣印兩個 —— 四碼真的是
         Y…Y，印一個反而是騙人。 */
      var third = segs[2];
      out[2].picks.push({ seg: third[third.length - 1], i: 3, last: true });
    }
    return out;
  }

  function drawQuad(cells) {
    var html = '';
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], strokes = P.glyphs ? P.glyphs[c.ch] : null, paths = '', j, k;
      if (strokes) {
        var lit = {}, any = false;
        for (j = 0; j < c.picks.length; j++) {
          if (c.picks[j].i >= P.qstep) continue;          // 還沒按到這一碼
          any = true;
          for (k = 0; k < c.picks[j].seg.st.length; k++) lit[c.picks[j].seg.st[k]] = c.picks[j].i;
        }
        /* 這一格已經揭了碼，其餘筆畫就壓成淡灰（跟〈詞組〉頁的 cz-off 同一個
           --zg-off）—— 留成近黑的話紫色那一條跟旁邊分不開（Wilson）。實測白底：
           紫對近黑只有 2.41，對淡灰是 3.80。反直覺的是往「深灰」壓會更糟（1.19）：
           紫本身就深，把其餘筆畫也挪向深色只是靠得更近。
           還沒揭任何碼的格子維持近黑 —— 那時候格子的用途是「這是哪個字」，整格
           淡灰只會變得難認。 */
        for (j = 0; j < strokes.length; j++) {
          var g = lit[j];
          paths += '<path class="' + (g != null ? 'tz-z' + QZ[g] : any ? 'tz-off' : 'tz-ink') +
                   '" d="' + strokes[j] + '"/>';
        }
      }
      /* 字母跟顏色一樣，按一次 = 才出來一個。沒出來的留一個小點佔位：留白會讓
         那一行塌掉、字母冒出來時整塊跳一下，而點的個數正好說明這一格有幾碼。 */
      /* 字母用跟單字提示同一種反白小方塊（.tz-chip）：底色是那條字根的顏色、
         字反白（Wilson）。一格有兩碼時（三字詞的第三格）光靠位置分不出哪個字母
         是哪一條，靠底色才對得起來。還沒揭的留一個 ？ 的虛線方塊 —— 個數說明
         這一格有幾碼，但不透露是哪個顏色（透露了等於先講一半答案）。 */
      var caps = '';
      for (j = 0; j < c.picks.length; j++) {
        if (c.picks[j].i < P.qstep) {
          caps += '<span class="tz-chip z' + QZ[c.picks[j].i] + '">' +
                  c.picks[j].seg.L.toUpperCase() + '</span>' +
                  (c.picks[j].last ? '<i class="tz-qtag">末</i>' : '');
        } else {
          caps += '<span class="tz-chip is-blank">？</span>';
        }
      }
      html += '<div class="tz-q">' +
        '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + c.ch + '">' + GRID +
        '<g transform="' + SVG_TF + '">' + paths + '</g></svg>' +
        (strokes ? '' : '<span class="tz-fallback">' + c.ch + '</span>') +
        '<span class="tz-qcode">' + caps + '</span>' +
        '</div>';
    }
    // 三字詞只有三格，最後一格橫跨底下兩欄再置中 —— 2×2 缺一角比置中難看
    P.cell.innerHTML = '<div class="tz-quad' + (cells.length === 3 ? ' is-three' : '') +
                       '">' + html + '</div>';
  }


  /* ── 兩字詞：主格子上面多一排小格 ────────────────────────────────────
     右上角那一小格是「等一下要打的那個字」，一直是黑的 —— 兩字詞是一口氣打完
     的，第二個字在打第一個字的時候就該看得見，不然打完第一個字才發現還有一個
     （Wilson）。打完前一個字，它會放大成主格子，剛打完的那個字縮到左上角、顏色
     留著。三字以上不走這裡：那邊是四碼快打，四小格自己講一套（見 drawQuad）。

     為什麼要縮放而不是直接換掉：換掉的話兩格看起來只是「閃了一下」，看不出是
     同一個字移過去。位移跟縮放照實際量到的位置算（見 flipFrom），排版怎麼變都對。 */

  /* 已經打完的那個字要上的色。跟 strokeColours 不同的是它不看現在的 buf ——
     buf 早就切給下一個字了（curBuf 是從 uoff 起算的）——而是看**當初實際吃掉的
     那條碼**：兼容碼有自己一套分段，簡碼只用到其中幾條，照主碼全部亮起來會亮在
     錯的筆畫上、或者亮出他根本沒打的碼。對不上任何一條就退回主碼整字亮。 */
  function doneColours(ch, code) {
    var list = pathsOf(ch), segs = null, idx = null, i, k;
    for (i = 0; i < list.length; i++) {
      if (codeOfSegs(list[i].segs) === code) { segs = list[i].segs; break; }
    }
    if (!segs) {
      segs = segsOf(ch);
      if (!segs) return null;
      var plan = code ? shortPlan(ch, segs) : null;
      if (plan && plan.code === code) idx = plan.order;   // 簡碼只亮它用到的那幾條
    }
    if (!idx) { idx = []; for (i = 0; i < segs.length; i++) idx.push(i); }
    var map = {};
    for (i = 0; i < idx.length; i++) {
      for (k = 0; k < segs[idx[i]].st.length; k++) map[segs[idx[i]].st[k]] = idx[i];
    }
    return map;
  }

  /* FLIP：元素已經在新位置上了，先用 transform 把它推回舊位置、逼一次回流，
     再放掉 —— 瀏覽器就會從舊位置動到新位置。這樣不必把兩格的座標寫死在 CSS 裡
     （13rem／窄螢幕 10rem 是兩組數字，寫死就會有一組是錯的）。 */
  function flipFrom(node, from) {
    var to = node.getBoundingClientRect();
    if (!from.width || !to.width) return;
    var sc = from.width / to.width;
    node.style.transformOrigin = 'top left';
    node.style.transition = 'none';
    node.style.transform = 'translate(' + (from.left - to.left).toFixed(1) + 'px,' +
                           (from.top - to.top).toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')';
    void node.offsetWidth;               // 逼回流：少了這一行兩次賦值會被合併，等於沒動
    node.style.transition = 'transform .34s cubic-bezier(.4, 0, .2, 1)';
    node.style.transform = '';
  }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function drawPair() {
    var unit = P.unit, uix = P.uix, prev = P.pshown, from = null,
        ready = !!P.glyphs, now = unit.charAt(uix);
    /* 同一個詞的同一個字：只把主格子重畫一次（打了幾碼就亮幾條字根），上下兩排
       小格原封不動。⚠️ 這不是省事而已 —— 一次按鍵會走到 renderCell 兩三趟
       （setBuf 裡 render／renderPractice／renderCell 各一），整塊重建會把上一趟
       才剛開始跑的縮放動畫直接砍掉，看起來就是「沒有動畫」。 */
    if (prev && prev.unit === unit && prev.uix === uix && prev.ready === ready) {
      var keep = P.cell.querySelector('.tz-pmain');
      if (keep) {
        paintGlyph(keep, now, P.glyphs ? P.glyphs[now] : null, strokeColours(now));
        return;
      }
    }
    /* 只有「同一個詞、剛好往前一個字」才動畫。倒退（打錯退格）、換詞、剛載入
       都直接畫定格 —— 那幾種情況下畫面上本來就沒有可以動過去的東西。 */
    if (prev && prev.unit === unit && prev.uix === uix - 1 && !reduceMotion()) {
      var oldMain = P.cell.querySelector('.tz-pmain'),
          oldNext = P.cell.querySelector('.tz-pnext');
      if (oldMain && oldNext) {
        from = { main: oldMain.getBoundingClientRect(), next: oldNext.getBoundingClientRect() };
      }
    }
    var hasPast = uix > 0, hasNext = uix < unit.length - 1;
    /* 兩邊的小格一直都在（空的那邊 visibility:hidden）：拿掉會讓整塊在換字時
       左右跳一下，而它下面就是提示區。 */
    P.cell.innerHTML =
      '<div class="tz-prow">' +
        '<div class="tz-mini tz-ppast' + (hasPast ? '' : ' is-blank') + '"></div>' +
        '<div class="tz-mini tz-pnext' + (hasNext ? '' : ' is-blank') + '"></div>' +
      '</div>' +
      '<div class="tz-pmain"></div>';
    var eP = P.cell.querySelector('.tz-ppast'),
        eN = P.cell.querySelector('.tz-pnext'),
        eM = P.cell.querySelector('.tz-pmain'),
        pch = hasPast ? unit.charAt(uix - 1) : '',
        nch = hasNext ? unit.charAt(uix + 1) : '';
    paintGlyph(eP, pch, pch && P.glyphs ? P.glyphs[pch] : null,
               hasPast ? doneColours(pch, P.ucodes[uix - 1]) : null);
    paintGlyph(eN, nch, nch && P.glyphs ? P.glyphs[nch] : null, null);
    paintGlyph(eM, now, P.glyphs ? P.glyphs[now] : null, strokeColours(now));
    if (!hasPast) eP.setAttribute('aria-hidden', 'true');
    if (!hasNext) eN.setAttribute('aria-hidden', 'true');
    if (from) { flipFrom(eP, from.main); flipFrom(eM, from.next); }
    P.pshown = { unit: unit, uix: uix, ready: ready };
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
    var now = curChar();
    var done = P.pos >= P.chars.length;
    // 三字以上的詞：四小格講四碼快打；其餘照舊，一個大格子逐碼上色
    var quad = done ? null : si4Cells(P.unit);
    // 兩字詞：主格子＋左上／右上兩小格（見 drawPair）
    var pair = !done && !quad && P.unit.length === 2;
    if (done) celebrateCell();
    else if (quad) drawQuad(quad);
    else if (pair) drawPair();
    else drawCell(now === '\n' ? '' : now);
    // 離開兩字詞就把上一次畫的狀態忘掉，不然回頭時會從一個早就不在的位置動過來
    if (!pair) P.pshown = null;

    var uncoded = now && isHan(now) && P.main && !P.main[now];
    P.next.innerHTML = '';
    if (done) {
      P.next.appendChild(el('span', 'ok', '恭喜你完成試打練習！'));
    } else if (uncoded) {
      P.next.appendChild(el('b', null, now));
      P.next.appendChild(el('span', 'warn', '尚未取碼，按「跳過這個字」'));
    } else if (now) {
      // 有簡碼的字先標一句 —— 不寫是哪幾碼，只讓人知道「這個字有捷徑，按 = 會講」。
      // 簡碼關掉的時候不標：畫面上打不出來的東西不該教（跟 shortPlan 同一個判斷）。
      // 放在字的**左邊**（Wilson）：它是講後面那個字的，擺右邊會先讀成「下一個」的修飾語。
      if (shortPlanOf(now)) {
        P.next.appendChild(el('span', 'short-badge', '有簡碼'));
      }
      /* 這一格是一個詞的時候，整個詞都秀出來，正在打的那個字用主色標出來
         ——「白日」一起打是這一格的目標，只秀「白」會讓人以為打完就過關了
         （Wilson）。詞組關著時 unit 只有一個字，這裡就跟以前一模一樣。 */
      if (P.unit.length > 1) {
        var wb = el('b', 'tz-unit');
        for (var u = 0; u < P.unit.length; u++) {
          wb.appendChild(el('span', u === P.uix ? 'is-now' : (u < P.uix ? 'is-done' : ''),
                            P.unit.charAt(u)));
        }
        P.next.appendChild(el('span', 'word-badge', '詞組'));
        P.next.appendChild(wb);
      } else {
        P.next.appendChild(el('b', null, now === '\n' ? '↵' : now));
      }
      // 約定字：不是照筆畫拆的，整字背下來——標出來，不然學的人會以為
      // 自己看不出字根，其實這個字本來就不歸那套推理管（Wilson）。
      if (P.conv && P.conv.has(now)) P.next.appendChild(el('span', 'conv-badge', '約定字'));
      P.next.appendChild(el('span', null, '下一個'));
    }
    renderHint(now);
  }

  function renderPractice() {
    if (!P.on) return;
    /* 這一格是詞還是單字，畫之前先算 —— 換篇、點字跳位、剛載入都會走到這裡，
       而那幾條路都沒有經過 setBuf。少了這一句，剛開頁面時整篇沒有一個字亮著。 */
    syncUnit();
    var frag = document.createDocumentFragment();
    /* 亮起來的是**整一格**，不只是下一個字：詞組開著時一格可能是「白日」，
       兩個字要一起打，只亮「白」會讓人打完就停（Wilson）。
       uend 是這一格結束後的字元位置 —— 換行不佔格子，所以要跳過它們數。 */
    var uend = P.pos;
    for (var n = 0; n < P.unit.length && uend < P.chars.length; n++) {
      while (P.chars[uend] === '\n') uend++;
      uend++;
    }
    for (var i = 0; i < P.chars.length; i++) {
      var c = P.chars[i];
      if (c === '\n') { frag.appendChild(document.createElement('br')); continue; }
      var cls;
      if (i < P.pos) cls = 'pc is-done';
      else if (i >= uend) cls = 'pc';
      else {
        /* 一格是一個詞的時候，整個詞是**一個**連續的色塊。每個字各自收圓角會
           在字與字之間切出兩道缺口，讀起來像兩格（Wilson）——所以圓角只給
           兩端，中間切平。換行會把色塊斷開，斷點兩邊各自算一次端點。 */
        cls = 'pc is-now';
        if (i === P.pos || P.chars[i - 1] === '\n') cls += ' is-wl';
        if (i === uend - 1 || P.chars[i + 1] === '\n') cls += ' is-wr';
      }
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

  /* 文章接下來要打的（跳過換行）剛好就是這個詞嗎？跟著打模式下，詞組要不要
     插隊、碼要不要標紅，兩件事都問這一句。 */
  function aheadIs(w) {
    if (!P.on) return false;
    var i = P.pos;
    for (var k = 0; k < w.length; k++) {
      while (P.chars[i] === '\n') i++;
      if (P.chars[i] !== w.charAt(k)) return false;
      i++;
    }
    return true;
  }

  /* 打出來的字跟目前這一格一樣就往前走。不一樣不做事 —— 字照樣進了試打框
     （那是使用者自己打的東西，不該被吃掉），只是進度不動。 */
  function advance(ch) {
    if (!P.on || P.pos >= P.chars.length) return;
    while (P.chars[P.pos] === '\n') P.pos++;      // 換行不用打
    if (P.chars[P.pos] !== ch) return;
    P.pos++;
    while (P.chars[P.pos] === '\n') P.pos++;
    resetHint();          // 換字了，提示從頭來
    syncUnit();           // 換格了，這一格是詞還是單字要重算
    renderPractice();
    render();
  }


  /* 提示的文字放在田字格底下 —— 講的是格子裡那個字的哪幾筆，就該貼著那個字
     （Wilson）。候選列那一行只留一句「想不出來就按 = 給提示」當入口，
     真正給出來的提示不放那裡。沒按過 / 就整塊不出現。 */
  var CN_NUM = ['', '一', '兩', '三', '四', '五'];

  function renderHint(ch) {
    var box = P.hintbox;
    box.innerHTML = '';
    /* 這一格是四碼快打（四小格那個畫面）：底下不再講逐條字根。= 已經整個交給
       四格了，留著「再按 = 給更多提示」會指向一條 = 根本推不動的鏈；而且打四碼
       時第一碼常常剛好等於首字的第一條字根（禍不單行 打 Q，禍 的第一碼也是 Q），
       那會亮出一格「進度」，看起來像在教一件他沒有在做的事。 */
    if (si4Cells(P.unit)) return;
    var mo = hintModel(ch);
    if (!mo) return;
    var segs = mo.segs, order = mo.order;

    /* 打歪了：前面對的那幾條字根照樣留著顏色（不要整個字變回黑的，那等於
       把好不容易打對的進度也一起收掉），這裡只講「這一碼應該是哪一條字根」。
       講的是取形意圖，不是字母 —— 直接給字母就沒得練了。
       「下一條」照 order 算，不是照主碼的下一段：的 拆成 J·B·A、簡碼是 JA，
       打完 J 之後該打的是 A 而不是 B。 */
    if (mo.m.bad) {
      /* 「應該是」只在打歪的地方**落在主碼上**時才給：走兼容碼走到一半才錯的人
         （教 打 FJPQ），拿主碼的第 n 段去講他的第 n 碼會講到別的筆畫上，那比
         不講還糟。這種時候就只說一句「再試一次」。 */
      var reach = reachLen(ch, curBuf());
      var wi = -1;
      for (var q = 0; q < order.length; q++) if (order[q] >= mo.m.ok) { wi = order[q]; break; }
      var want = reach === mo.m.ok && wi >= 0 ? segs[wi] : null;
      /* 被孤筆略過原則絆到：下一段前面有一筆被略過（建置時標的 k），而打錯的那一碼
         正好是 I 或 J —— 也就是把那一筆當字根取了碼。教 ＝ TXPX，很多人打成 TXPIX
         （Wilson）。這種錯有話可說，就別只丟一句「再試一次」。
         只在真的還有下一段要打的時候才講：主碼已經打完、後面多敲一個 I，那不是
         孤筆的問題。 */
      var slip = curBuf().charAt(mo.m.ok);
      var trap = want && want.k && (slip === 'i' || slip === 'j');
      box.appendChild(el('span', 'tz-wrong', trap ? '注意要略過孤立的橫劃或豎劃' : '再試一次'));
      if (want && want.d) box.appendChild(el('span', 'tz-intent', '應該是：' + want.d));
      return;
    }

    /* 沒按過 = 也要給正回饋：自己打對 JK，格子底下就該出現紅 J、黃 K，
       顏色跟剛剛亮起來的筆畫對得上（Wilson）。所以只要有打對的碼就顯示。 */
    if (!mo.any) return;

    /* 有簡碼的字，第一步講的是簡碼本身：格子裡只亮簡碼用到的那幾條字根，這裡說
       「只要打這幾條」。不寫出是哪幾個字母 —— 寫了就沒得練了，字母照樣一條一條給。
       只在這一步出現：往下走之後，這句話跟三行的取形意圖疊起來會超出留給提示的
       高度（實測 143px > 120px），整個試打框就會被往下推。「這個字有簡碼」那件事
       由〈下一個〉那行的標籤一直掛著，不靠這句話撐。 */
    if (mo.plan && P.hov && !P.hstep) {
      box.appendChild(el('span', 'tz-short',
        '這個字有簡碼，只要打這' + (CN_NUM[order.length] || order.length) + '條字根'));
    }

    /* 自己打對的那幾條也要翻牌 —— 提示亮出筆畫、人看懂了、打對了，那一格就該
       從「？」變成字母（顏色跟格子裡那幾筆一樣），才有「猜中了」的回饋（Wilson）。
       所以「已知」有三種來源：提示已經走過去的、提示走到第三步給了字母的、
       還有自己打對的（見 hintModel）。 */
    var row = el('span', 'tz-hintcodes'), any = false;
    for (var i = 0; i < segs.length; i++) {
      if (!mo.shown[i]) continue;
      any = true;
      var known = !!mo.known[i];
      row.appendChild(el('span', 'tz-chip z' + (i % 6) + (known ? '' : ' is-blank'),
                         known ? segs[i].L : '？'));
    }
    if (any) box.appendChild(row);

    var cur = mo.pos >= 0 ? segs[order[mo.pos]] : null;
    if (P.hstep >= 2 && cur && cur.d) box.appendChild(el('span', 'tz-intent', cur.d));

    if (mo.m.ok >= segs.length) {
      box.appendChild(el('span', 'tz-more', '打字成功！'));
    } else {
      var more = mo.pos < order.length - 1 || P.hstep < 3;
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
    /* 這一格是四碼快打（三字以上的詞）：= 一次揭一碼，四格從左上按順序亮。
       預設四個格子都是黑的、沒有字母 —— 光是「變成四格」就已經說明這是一個
       四碼詞了，答案要自己先想（Wilson）。三字詞的第三格有兩碼，所以最後
       兩次 = 都落在同一格：先亮首碼，再亮末碼。
       這幾格不走逐條字根那一套，= 整個交給它 —— 一格講兩件事會兩件都講不清。 */
    var qc = si4Cells(P.unit);
    if (qc) {
      var total = 0;
      for (var q = 0; q < qc.length; q++) total += qc[q].picks.length;
      if (P.qstep < total) { P.qstep++; renderPractice(); }
      return;
    }
    var ch = P.chars[P.pos];
    var mo = hintModel(ch);
    if (!mo) return;
    var segs = mo.segs, order = mo.order;

    /* 有簡碼的字，第一步先講簡碼：把簡碼用到的那幾條字根一次全標出來（Wilson）。
       兩碼的簡碼就是頭一條跟末一條，中間那幾條不用打——一次看到全貌，才知道
       接下來要練的是哪兩條，而不是傻傻地一路拆到底。
       筆畫既然已經在這一步標完了，後面每一條就直接從「說取形意圖」開始，
       不必再有一步只是把同一批筆畫再標一次。 */
    if (mo.plan && !P.hov) { P.hov = 1; renderPractice(); return; }

    var typed = mo.m.ok - 1;                // 自己打對到第幾條（-1 = 還沒打）
    var pos = mo.pos;
    var min = 0;                            // order 裡第一條還沒被打過去的
    while (min < order.length && order[min] <= typed) min++;
    if (pos < 0 || pos < min) {
      // 提示落後於實際進度：跳到還沒打的第一條
      pos = Math.min(min, order.length - 1);
      P.hseg = order[pos];
      P.hstep = min > order.length - 1 ? 3 : (P.hov ? 2 : 1);
    } else if (P.hstep < 3) {
      P.hstep++;
    } else if (pos < order.length - 1) {
      pos++;
      P.hseg = order[pos];
      P.hstep = P.hov ? 2 : 1;
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
    P.pos = 0; resetHint();
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
      resetHint();
      setBuf('');
      renderPractice();
      out.focus();
    });

    document.getElementById('practice-skip').addEventListener('click', function () {
      if (P.pos < P.chars.length) { P.pos++; while (P.chars[P.pos] === '\n') P.pos++; }
      resetHint();
      renderPractice(); render(); out.focus();
    });
    document.getElementById('practice-reset').addEventListener('click', function () {
      P.pos = 0; resetHint(); renderPractice(); render(); out.focus();
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
  var PY = { data: null, conv: null, cands: [], sel: null, input: null, candsBox: null,
             cell: null, hintBox: null, heavy: null };

  /* 拆碼圖與字形（pinyin_glyphs.json，約 8MB）等使用者真的要用查字才抓 —— 併在
     pinyin.json 裡的話，每個開這一頁的人都得先下載 8MB 才能開始打字，而絕大多數
     人根本不會用到查字（Wilson 2026-08-24）。
     在它到之前查字照樣能用：查得到的字、以及每個字的碼（碼在 dict.json 的 main
     裡，本來就載好了）都不靠這一份，只有田字格的筆畫和上色要等它。
     抓失敗就把旗標清掉，下次進查字框會再試一次。 */
  function loadPyqGlyphs() {
    if (PY.heavy) return;                  // 只抓一次（'loading' 或 'ready' 都不再抓）
    PY.heavy = 'loading';
    fetch('assets/pinyin_glyphs.json')
      .then(function (r) { return r.json(); })
      .then(function (g) {
        PY.heavy = 'ready';
        PY.data.segs = g.segs;
        PY.data.glyphs = g.glyphs;
        if (PY.sel) selectPyq(PY.sel);     // 已經選了字，補畫上去
      })
      .catch(function () { PY.heavy = null; });
  }

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
    // 一點進查字框就開始抓重的那一份，使用者還在打拼音、挑字的時候它就在路上了
    PY.input.addEventListener('focus', loadPyqGlyphs);
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

  /* 選中的候選可能是一個詞（詞組連打／四碼快打）。整串一次進試打框，進度則
     逐字往前走 —— advance() 一次只認一個字，而且它本來就會在對不上時停住，
     所以詞只對到前半段（例如文章是「香港人」而你選了「香港島」）不會走過頭。 */
  function commit(text) {
    insert(text);
    state.buf = '';
    state.cands = [];
    render();
    for (var i = 0; i < text.length; i++) advance(text.charAt(i));
    renderCell();          // 打錯的時候 advance 不會動，格子的顏色要自己收掉
  }

  function setBuf(b) {
    state.buf = b;
    state.cands = lookup(b);
    // 打到詞裡的第幾個字了，要在畫面之前算好 —— 田字格、提示、標紅都看它。
    // 跨過詞裡的字界（黃的碼打完、換打河）文章那邊的底線也要跟著移，所以重畫。
    var moved = syncUnit();
    /* 打著打著換了一套拆法（開始打兼容碼）就把提示鏈歸零：兩套的段號指的不是
       同一批筆畫，沿用會亮在錯的地方。要在 render() 之前判斷，這一次的畫面才
       是新的那一套。 */
    if (P.on && P.pos < P.chars.length) {
      var ap = activePath(P.chars[P.pos]);
      var id = ap ? codeOfSegs(ap.segs) : null;
      // null＝這個字還沒認過打法（剛換字），認下來就好，不要把剛按出來的提示洗掉
      if (P.hpath === null) P.hpath = id;
      else if (id !== P.hpath) resetHint(id);
    }
    render();
    if (moved && P.on) renderPractice();
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

  /* 詞組開關旁邊那句話。四個狀態都要說得出來，因為這是唯一一個「打開之後要等」
     的開關 —— 沒有回饋的話，打開了卻還沒有詞候選，看起來就像壞掉。 */
  var phraseNote = document.getElementById('phrase-note');
  function paintPhraseNote() {
    if (!phraseNote) return;
    var t = '';
    if (!PHRASE_ON) t = '';
    else if (PD_STATE === 'loading') t = '詞庫載入中…';
    else if (PD_STATE === 'fail') t = '詞庫載入失敗，重新整理再試';
    else if (PD_STATE === 'ready' && PD) t = '收錄 ' + PD.stats.words.toLocaleString('en-US') + ' 個詞';
    phraseNote.textContent = t;
    phraseNote.classList.toggle('is-bad', PD_STATE === 'fail' && PHRASE_ON);
  }

  var phraseBox = document.querySelector('[data-phrase]');
  if (phraseBox) {
    phraseBox.checked = PHRASE_ON;
    phraseBox.addEventListener('change', function () {
      PHRASE_ON = phraseBox.checked;
      try { localStorage.setItem(PHRASE_KEY, PHRASE_ON ? '1' : '0'); } catch (e) {}
      if (PHRASE_ON) loadPhraseDict();
      paintPhraseNote();
      // 一格的範圍會跟著變（白 ↔ 白日），提示鏈歸零、文章重畫
      resetHint();
      setBuf(state.buf);
      if (P.on) renderPractice();
      out.focus();
    });
    // 上次開著就先抓 —— 使用者已經表達過要用它了，不必再等他按一次
    if (PHRASE_ON) loadPhraseDict();
    paintPhraseNote();
  }

  // 簡碼／三簡碼開關：checkbox 本身不等資料載入就能綁定，反正 lookup() 每次
  // 都是現查 SHORT_ON／SHORT3_ON，切換後重算一次目前的 buf 就會反映出來。
  [].forEach.call(document.querySelectorAll('[data-short]'), function (b) {
    var is3 = b.dataset.short === 'short3';
    var key = is3 ? SHORT3_KEY : SHORT_KEY;
    b.checked = is3 ? SHORT3_ON : SHORT_ON;
    b.addEventListener('change', function () {
      if (is3) SHORT3_ON = b.checked; else SHORT_ON = b.checked;
      try { localStorage.setItem(key, b.checked ? '1' : '0'); } catch (e) {}
      // 約定簡碼開關改的正是提示要教哪幾條字根，目前這個字的提示鏈從頭來一次，
      // 不然會留下一個照舊制走到一半、跟新開關對不上的狀態。
      if (!is3) { resetHint(); if (P.on) renderPractice(); }
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
