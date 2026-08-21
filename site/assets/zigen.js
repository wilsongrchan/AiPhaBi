/* 字根表 —— 從 assets/zigen.json 畫出 26 個字母的字根表格。
 *
 * 版面參考 zh.wikibooks 的《倉頡輸入法／輔助字形》：一個字母一節，節裡是
 * 「說明（取形意圖）｜字根｜字例」的表格，同一個意圖底下的形狀用 rowspan 併起來。
 * 差別是倉頡表最左邊還有一欄「倉頡字母」（日、月…），因為倉頡要先背 日＝A；
 * 愛發筆沒有那一欄——字母本身就是字根的形狀，這正是它想省掉的學習成本。
 *
 * ⚠️ 例字與取自字一律掛 data-keep，繁簡切換**不能**碰它們。
 * 字根是對「繁體字形的某幾筆」的主張：發 的第 1–2 筆是 A 的字根，但 发 根本不是那個形狀。
 * 讓轉換器把例字轉成簡體，整張表就會開始說謊，而且看起來完全正常。
 */
(function () {
  'use strict';

  var box = document.getElementById('zg-table');
  var jump = document.getElementById('zg-jump');
  var q = document.getElementById('zg-q');
  var status = document.getElementById('zg-status');
  if (!box) return;

  var DATA = null;
  var lastFilter = '';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* 一格漢字：一律 data-keep（見檔頭） */
  function glyph(ch, cls) {
    var s = el('span', cls || 'zg-ch', ch);
    s.setAttribute('data-keep', '');
    return s;
  }

  /* ---------- 把字根畫出來 ----------
   * 做法跟標註工具的 rootIconSvg 一樣：只畫選中的那幾筆，並裁切到它們的範圍，
   * 免得三筆的字根在整個字身框裡變成一個小點。
   * makemeahanzi 的路徑是 y 軸朝上的 1024 em 框，所以要套同一個翻轉。 */
  var SVG_TF = 'scale(1,-1) translate(0,-900)';
  var ROOT_PAD = 40;
  var GLYPHS = null;                  // glyphs.json 較大，延後載入；沒有就維持文字版

  function rootIconSvg(strokes, sel) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    for (var k = 0; k < sel.length; k++) {
      var d = strokes[sel[k]];
      if (!d) continue;
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(d))) {
        var x = +m[1], y = 900 - (+m[2]);      // 還原 y 翻轉
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) return null;

    // viewBox 的**大小固定成整個字身框（1024）**，只移動位置把字根置中。
    // 這樣字根欄的黑色字根，跟字例欄裡同一個形狀的橙色部分是**同一個比例**——
    // 先前是裁切到字根自己的邊界再放大，於是每個字根各自放大不同倍率：
    // 兩筆的字根被撐得很大、六筆的偏小（然 明顯比 月 小就是這樣來的），
    // 而且跟字例欄裡的大小完全對不上。置中則解決「貓 的字根偏在上方」。
    // 字根欄要的是「一排大小一致、看得清楚的形狀」，不是「忠實反映它在字裡佔多大」——
    // 佔比忠實的話 豹 的字根只有 11px、月 有 20px，同一欄裡差快兩倍，看起來就是亂的。
    //
    // 所以把每個字根放大到至少佔框的 85%：實測大小收斂成 21.1–22.9px（1.1 倍極差），
    // 而 月 本來就佔得多，只從 20.3 變 21.1px，跟字例欄裡的橙色 月 仍然一樣大。
    // 框的大小仍以字身框為上限，所以佔滿整個字的字根不會被切掉。
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var span = Math.max(x1 - x0, y1 - y0);
    var BOX = Math.min(1024, span / 0.85) || 1024;
    var paths = '';
    for (var j = 0; j < sel.length; j++) {
      if (strokes[sel[j]]) paths += '<path d="' + strokes[sel[j]] + '"/>';
    }
    return '<svg class="zg-svg" viewBox="' + (cx - BOX / 2) + ' ' + (cy - BOX / 2) +
      ' ' + BOX + ' ' + BOX + '" aria-hidden="true">' +
      '<g transform="' + SVG_TF + '">' + paths + '</g></svg>';
  }

  /* 整個字都畫出來，屬於這個字根的筆畫塗深、其餘塗淺。
   * 這是標註工具 fillExampleCell 的做法，也是「元件分開、上色」的那個效果。
   * 哪幾筆屬於這個字根是**建置時**算好寫在 e.st 裡的（見 build_site_data.py），
   * 因為原本的做法要靠中線做形狀比對，那份資料體積加倍而網站畫圖用不到。 */
  function exampleGlyph(e, filter) {
    var strokes = GLYPHS && GLYPHS[e.c];
    if (!strokes || !e.st || !e.st.length) {
      var plain = glyph(e.c);
      if (e.c === filter) plain.classList.add('is-hit');
      return plain;
    }
    // 同一個字根在一個字裡出現兩次（朋＝月月、夠＝夕夕）時，第二次用深一點的橙色。
    // 兩次都同色會讓人以為「這個字根就是整個朋」，分色才看得出是同一個字根出現兩次。
    var segs = e.segs && e.segs.length ? e.segs : [e.st];
    function shade(i) {
      for (var k = 0; k < segs.length; k++) {
        if (segs[k].indexOf(i) >= 0) return 'on on-' + Math.min(k + 1, 3);
      }
      return null;
    }
    // off 先全部畫完，on 才畫 —— 照筆順混著畫的話，序號較後的未選中筆畫會蓋在
    // 高亮的筆畫上面（例如字根是第 1–4 筆、第 5–8 筆從它上面壓過去）。
    var off = '', on = '';
    for (var i = 0; i < strokes.length; i++) {
      var cls = shade(i);
      if (cls) on += '<path class="' + cls + '" d="' + strokes[i] + '"/>';
      else off += '<path class="off" d="' + strokes[i] + '"/>';
    }
    var paths = off + on;
    var holder = el('span', 'zg-exg' + (e.c === filter ? ' is-hit' : ''));
    holder.title = e.c + '　' + segs.map(function (g) {
      return '第 ' + g.map(function (k) { return k + 1; }).join('、') + ' 筆';
    }).join('、以及 ') + (segs.length > 1 ? '（同一個字根出現 ' + segs.length + ' 次）' : '');
    holder.setAttribute('data-keep', '');
    holder.innerHTML = '<svg class="zg-exsvg" viewBox="0 0 1024 1024" aria-label="' + e.c +
      '"><g transform="' + SVG_TF + '">' + paths + '</g></svg>';
    return holder;
  }

  /* 「正確拆法 vs 錯誤拆法」小圖對照，只有 build_site_data.py 的 WRONG_BREAKDOWN
   * 有指定的少數幾條才會有 it.alt（見那邊的註解）。彩虹色只是要讓「筆畫怎麼分組」
   * 一眼看出來，跟表格其餘地方「同一個字根」用的橙色系不是同一套語言，
   * 所以另外開一組 class，不要混進 exampleGlyph 那一套。
   * 放在「字母」欄、碼底下那一行，小圖示＋打勾／打叉，不佔一整列。
   * 勾／叉是圖示旁邊的字，不疊在圖示上面——疊上去會蓋住角落的筆畫（Wilson）。 */
  var RAINBOW = ['rb-0', 'rb-1', 'rb-2', 'rb-3', 'rb-4', 'rb-5'];

  function altMiniCard(ch, breakdown, ok) {
    var pair = el('span', 'zg-altpair' + (ok ? ' is-ok' : ' is-bad'));
    var icon = el('span', 'zg-altmini');
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
        '<g transform="' + SVG_TF + '">' + paths + '</g></svg>';
    } else {
      icon.appendChild(glyph(ch));
    }
    pair.appendChild(icon);
    var mark = el('span', 'zg-altminimark', ok ? '✓' : '✕');
    mark.setAttribute('aria-hidden', 'true');
    pair.appendChild(mark);
    pair.title = breakdown.code + (ok ? '（正確）' : '（不取，示範用）');
    pair.setAttribute('data-keep', '');
    return pair;
  }

  /* 「取自『名』第 1–3 筆」／「整個『日』字」——有字形資料時前面再加上畫出來的字根 */
  function describeShape(sh) {
    var wrap = el('span', 'zg-shape');

    var drew = false;
    if (GLYPHS && GLYPHS[sh.src] && sh.st && sh.st.length) {
      var svg = rootIconSvg(GLYPHS[sh.src], sh.st);
      if (svg) {
        var holder = el('span', 'zg-icon');
        holder.innerHTML = svg;
        wrap.appendChild(holder);
        drew = true;
      }
    }

    // 畫出來之後，來源字就只是出處，縮小當註記；沒畫出來時它是唯一的線索，維持原樣
    var src = glyph(sh.src, 'zg-src' + (drew ? ' is-ref' : ''));
    wrap.appendChild(src);
    wrap.appendChild(el('span', 'zg-span', sh.span === 'whole' ? '整個字' : '第 ' + sh.span + ' 筆'));
    return wrap;
  }

  /* 一個字母的所有列。字母本身放在最左邊一欄、跨滿該字母的所有列
   * （倉頡的〈輔助字形列表〉也是這樣），不再每個字母上面掛一條標題——
   * 26 條標題各佔一行加留白，是這一頁最浪費的垂直空間。 */
  function letterRows(L, filter) {
    var groups = L.groups;
    if (filter) {
      groups = groups.map(function (g) {
        var shapes = g.shapes.filter(function (s) {
          return s.seen.indexOf(filter) >= 0 || s.src === filter;
        });
        return shapes.length ? { desc: g.desc, tier: g.tier, shapes: shapes, ex: g.ex } : null;
      }).filter(Boolean);
    }
    if (!groups.length) return null;

    var total = groups.reduce(function (a, g) { return a + g.shapes.length; }, 0);
    var rows = [];

    groups.forEach(function (g, gi) {
      g.shapes.forEach(function (sh, i) {
        var tr = el('tr');
        if (gi === 0 && i === 0) {
          tr.id = 'L' + L.letter;
          tr.className = 'is-letter-start';   // 字母之間留一道視覺分隔，見 site.css
          var kd = el('td', 'zg-letterkey');
          kd.rowSpan = total;
          var key = el('span', 'zg-key', L.letter);
          key.setAttribute('data-keep', '');
          kd.appendChild(key);
          kd.appendChild(el('span', 'zg-n', total + ' 個'));
          tr.appendChild(kd);
        }

        if (i === 0) {
          var td = el('td', 'zg-desc');
          td.rowSpan = g.shapes.length;
          // 等級（次等／三等）放在意圖**之前**：它是這一整組的分類標籤，
          // 先看到標籤再讀意圖才順；接在意圖後面會像是意圖的一部分。
          if (g.tier && g.tier !== 'primary') {
            td.appendChild(el('span', 'zg-tier', DATA.tiers[g.tier] || g.tier));
          }
          if (g.desc) td.appendChild(el('span', null, g.desc));
          else td.appendChild(el('span', 'zg-todo', '（取形意圖待補）'));
          // 少數意圖有額外說明（為什麼這一類形狀算是像這個字母），來自
          // site/content/intent_notes.md，顯示在意圖底下
          if (g.note) td.appendChild(el('span', 'zg-note', g.note));
          tr.appendChild(td);
        }

        var sd = el('td', 'zg-shapecell');
        sd.appendChild(describeShape(sh));
        tr.appendChild(sd);

        var ex = el('td', 'zg-ex');
        (sh.ex || []).forEach(function (e) { ex.appendChild(exampleGlyph(e, filter)); });
        tr.appendChild(ex);

        // 每個字根一個 id，讓〈相近字形辨析〉的「字形」欄連得過來
        if (!tr.id) tr.id = 'Z' + L.letter + '-' + (sh.src || '') + '-' + (sh.span || '');
        rows.push(tr);
      });
    });
    return { rows: rows, n: total };
  }

  function render(filter) {
    lastFilter = filter || '';
    box.textContent = '';

    var tw = el('div', 'tablewrap');
    var t = el('table', 'zg-tbl');
    var thead = el('thead'), hr = el('tr');
    ['字母', '取形意圖', '字根', '字例'].forEach(function (label) {
      hr.appendChild(el('th', null, label));
    });
    thead.appendChild(hr);
    t.appendChild(thead);

    var tb = el('tbody');
    var shown = 0, letters = [];
    DATA.letters.forEach(function (L) {
      var r = letterRows(L, filter);
      if (!r) return;
      letters.push(L.letter);
      shown += r.n;
      r.rows.forEach(function (tr) { tb.appendChild(tr); });
    });
    t.appendChild(tb);
    tw.appendChild(t);

    if (!shown) {
      box.appendChild(el('p', 'zg-loading',
        '沒有字根用到「' + filter + '」。可能是這個字還沒取碼，或它不在例字裡。'));
    } else {
      box.appendChild(tw);
    }

    if (status) {
      status.textContent = filter
        ? '「' + filter + '」出現在 ' + shown + ' 個字根的例字裡（' + letters.join('、') + '）'
        : '';
    }

    if (jump) {
      jump.textContent = '';
      DATA.letters.forEach(function (L) {
        var on = letters.indexOf(L.letter) >= 0;
        var a = el(on ? 'a' : 'span', 'zg-jl' + (on ? '' : ' is-off'), L.letter);
        if (on) a.href = '#L' + L.letter;
        jump.appendChild(a);
      });
    }

    if (window.AiPhaBiSite) window.AiPhaBiSite.localize(box);
  }

  /* 把「字形」欄連到它在字根表裡的那一列。
   *
   * 辨析是手寫的，沒有指明對應哪一個字根，所以用**例字重疊**去猜：辨析那一條列的
   * 例字（會、時、的）跟字根表裡某個字根的 seen 重疊最多，就是它。猜不到就不連，
   * 連錯比沒連糟 —— 讀者會跳到一個不相干的字根然後以為自己理解錯了。 */
  /* 直接用「形」欄本身去找字根表那一列 —— 形若寫成「石#1,2」就直接指明了
   * (字母, 來源字, 筆序)，比拿例字去猜可靠得多；形若是單一個字（日、月）則
   * 找該字母底下以那個字為代表字的列。找不到才退回例字重疊的猜法。 */
  function rowByShape(letter, shape) {
    var m = (letter || '').match(/[A-Z]/);
    if (!m || !DATA) return null;
    var L = null;
    for (var i = 0; i < DATA.letters.length; i++) {
      if (DATA.letters[i].letter === m[0]) { L = DATA.letters[i]; break; }
    }
    if (!L) return null;

    var ref = /^(.)#([\d,、\s]+)$/.exec(shape);
    var src = ref ? ref[1] : shape;
    var st = ref ? ref[2].split(/[,、\s]+/).filter(Boolean).map(function (n) { return +n - 1; }) : null;

    var loose = null;
    for (var gi = 0; gi < L.groups.length; gi++) {
      var shapes = L.groups[gi].shapes;
      for (var si = 0; si < shapes.length; si++) {
        var sh = shapes[si];
        var hit = sh.src === src || (sh.src0 && sh.src0 === src);
        if (!hit) continue;
        // 有寫筆序就要對得上；沒寫就取第一個同來源字的
        if (st && sh.st && st.join(',') === sh.st.join(',')) {
          return 'Z' + L.letter + '-' + sh.src + '-' + sh.span;
        }
        if (!loose) loose = 'Z' + L.letter + '-' + sh.src + '-' + sh.span;
      }
    }
    return loose;
  }

  /* 第二順位：特徵文字裡是否含有某個取形意圖的敘述。辨析的特徵常常就是照著
   * 意圖敘述寫的（「不能寫成捺的點劃」），比拿例字去猜準得多。 */
  function rowByTrait(letter, trait) {
    var m = (letter || '').match(/[A-Z]/);
    if (!m || !DATA || !trait) return null;
    var L = null;
    for (var i = 0; i < DATA.letters.length; i++) {
      if (DATA.letters[i].letter === m[0]) { L = DATA.letters[i]; break; }
    }
    if (!L) return null;
    // 比對前先把引號正規化掉：similar.md 是 Wilson 手寫的（用 “”），而 zigen.json
    // 的敘述由 Side A 維護（2026-08-21 起改用 「」）。兩邊講同一件事卻對不上字面，
    // 連結就會無聲消失 —— 七 就是這樣掉的。標點不該影響語意比對。
    var strip = function (t) { return (t || '').replace(/[“”「」『』"'‘’]/g, ''); };
    trait = strip(trait);

    // 兩個方向都比：意圖敘述的開頭出現在特徵裡，或特徵的開頭出現在意圖敘述裡。
    // 乚 的特徵是「豎彎鉤，收筆…」，而 L1 是「豎折、豎彎鉤、或豎提…」——
    // 只比前者的方向會漏掉，因為關鍵詞在敘述的中間。取最長的相符當結果。
    var head = trait.replace(/^[^\u4e00-\u9fff]*/, '').slice(0, 6);
    var best = null, bestLen = 0;
    L.groups.forEach(function (g) {
      var d = strip(g.desc).replace(/[，。]$/, '');
      if (d.length < 3) return;
      for (var n = Math.min(6, d.length); n >= 3; n--) {
        if (trait.indexOf(d.slice(0, n)) >= 0 && n > bestLen) { bestLen = n; best = g; break; }
      }
      for (var k = Math.min(6, head.length); k >= 3; k--) {
        if (d.indexOf(head.slice(0, k)) >= 0 && k > bestLen) { bestLen = k; best = g; break; }
      }
    });
    if (!best) return null;
    var sh = best.shapes[0];
    return 'Z' + L.letter + '-' + sh.src + '-' + sh.span;
  }

  function findZigenRow(letter, examples) {
    // 取碼欄可能是「DI（D）」，取第一個 A–Z 當字母
    var m = (letter || '').match(/[A-Z]/);
    if (!m) return null;
    var L = null;
    for (var i = 0; i < DATA.letters.length; i++) {
      if (DATA.letters[i].letter === m[0]) { L = DATA.letters[i]; break; }
    }
    if (!L || !examples || !examples.length) return null;

    // 比對**取形意圖整組**，不是單一個形狀。辨析講的是一類形狀（「日」字及類似字形），
    // 對應的就是一個意圖組；比單一形狀時，日 會被 提 的第 4–7 筆搶走，因為衍生形
    // 的例字比原形常用。連到組的第一列（原形）才是讀者想看的。
    var best = null, bestScore = 0, tie = false;
    L.groups.forEach(function (g) {
      var score = 0;
      examples.forEach(function (c) {
        for (var i = 0; i < g.shapes.length; i++) {
          if (g.shapes[i].seen.indexOf(c) >= 0) { score++; return; }
        }
      });
      if (score > bestScore) { bestScore = score; best = g; tie = false; }
      else if (score === bestScore && score > 0) { tie = true; }
    });

    // 至少要對到一半的例字，而且不能有並列第一 —— 猜不準就不要連
    if (!best || tie || bestScore * 2 < examples.length) return null;
    var sh = best.shapes[0];
    return 'Z' + L.letter + '-' + (sh.src || '') + '-' + (sh.span || '');
  }

  /* trait／note 裡允許 [文字](連結) —— Wilson 要把「按原則略過」連到取碼原則頁，
   * 但那一頁還沒有。與其我猜一個網址，不如讓他自己在 similar.md 裡寫。 */
  function withLinks(text, into) {
    // 支援兩種內嵌語法：
    //   [文字](連結)   —— 一般連結
    //   {字#筆序}      —— 就地畫出那幾筆的字根（例如 {目#1,2,3,4}）
    // 後者是為了讓說明可以直接指著形狀講，而不是留一對空引號讓人猜。
    var re = /\[([^\]]+)\]\(([^)]+)\)|\{(.)#([\d,、\s]+)\}/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) into.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        var a = el('a', null, m[1]);
        a.href = m[2];
        into.appendChild(a);
      } else {
        var src = m[3];
        var sel = m[4].split(/[,、\s]+/).filter(Boolean).map(function (n) { return +n - 1; });
        var svg = GLYPHS && GLYPHS[src] ? rootIconSvg(GLYPHS[src], sel) : null;
        if (svg) {
          var sp = el('span', 'zg-inline');
          sp.innerHTML = svg;
          sp.title = src + '　第 ' + m[4] + ' 筆';
          sp.setAttribute('data-keep', '');
          into.appendChild(sp);
        } else {
          into.appendChild(document.createTextNode(src + '第' + m[4] + '筆'));
        }
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
    return into;
  }

  /* 相近字形辨析 —— 手寫內容，沒寫就整段不出現（空標題比沒有標題難看） */
  function renderSimilar(groups) {
    var sec = document.getElementById('zg-similar');
    var body = document.getElementById('zg-similar-body');
    if (!sec || !body) return;
    if (!groups || !groups.length) { sec.hidden = true; return; }
    sec.hidden = false;
    body.textContent = '';

    groups.forEach(function (g) {
      // 各組不再顯示標題（Wilson）——表格本身已經說明是在比什麼，
      // 標題只是重複一次字母組合。
      var card = el('div', 'zg-sim');

      var tw = el('div', 'tablewrap');
      var t = el('table', 'zg-simtbl');
      var thead = el('thead'), hr = el('tr');
      // 例字放最右邊（Wilson）：字形 → 取碼 → 說明 → 字例，
      // 讀的順序是「這個形狀、取什麼碼、怎麼分辨」，例字是佐證放在最後。
      // 正確/錯誤拆法的小圖對照（見 it.alt）放在「取碼」欄底下，不另外開一欄——
      // 只有少數列有，獨立一欄大部分是空的，看起來很怪（Wilson）。
      ['字形', '取碼', '說明', '字例'].forEach(function (h) {
        hr.appendChild(el('th', null, h));
      });
      thead.appendChild(hr); t.appendChild(thead);

      var tb = el('tbody');
      g.items.forEach(function (it) {
        var tr = el('tr');
        var c0 = el('td', 'zg-simshape');

        // 有些字根根本打不出來（石的前兩筆、兔的末兩筆），寫成描述又難讀。
        // similar.md 可以寫成「石#1,2」，這裡直接把那幾筆畫出來。
        var sg = null;
        var ref = /^(.)#([\d,、\s]+)$/.exec(it.shape);
        if (ref && GLYPHS && GLYPHS[ref[1]]) {
          var sel = ref[2].split(/[,、\s]+/).filter(Boolean).map(function (n) { return +n - 1; });
          var svg = rootIconSvg(GLYPHS[ref[1]], sel);
          if (svg) {
            sg = el('span', 'zg-icon');
            sg.innerHTML = svg;
            sg.title = ref[1] + '　第 ' + ref[2] + ' 筆';
          }
        } else if (!ref && GLYPHS && GLYPHS[it.shape] && Array.from(it.shape).length === 1) {
          // 形本身就是一個字（日、月、丶、乚…）：也用 makemeahanzi 畫，
          // 不要一半用畫的一半用系統字型 —— 兩種字形混在同一欄很不一致。
          var all = GLYPHS[it.shape].map(function (_, i) { return i; });
          var svg2 = rootIconSvg(GLYPHS[it.shape], all);
          if (svg2) {
            sg = el('span', 'zg-icon');
            sg.innerHTML = svg2;
            sg.title = it.shape;
          }
        }
        if (!sg) {
          // 「丶」「乚」是字，「石字 1、2 筆」是描述——後者放大會撐爆欄寬
          sg = glyph(ref ? ref[1] + ' 第 ' + ref[2] + ' 筆' : it.shape, 'zg-src');
          if (Array.from(sg.textContent).length > 2) sg.classList.add('is-desc');
        }
        // it.ex 是 {c, st} 物件，findZigenRow 比對的是字元 —— 要先取出 c，
        // 不然每次比對都不相等，連結會全部靜靜地失效
        // 先用形本身找（精確），找不到才退回例字重疊的猜法
        // 三段式，依可靠度排序：形本身（精確）→ 特徵文字對意圖敘述 → 例字重疊
        var target = rowByShape(it.letter, it.shape) ||
                     rowByTrait(it.letter, it.trait) ||
                     findZigenRow(it.letter, it.ex.map(function (e) { return e.c; }));
        if (target) {
          var link = el('a', 'zg-simlink');
          link.href = '#' + target;
          link.title = '看它在字根表裡的位置';
          link.appendChild(sg);
          c0.appendChild(link);
        } else {
          c0.appendChild(sg);
        }
        tr.appendChild(c0);

        // <td> 本身保持單純的表格儲存格（不設 display:flex）——直排兩行的 flex
        // 排版放在裡面另包一層 <div>，vertical-align: top 才確定吃得到，不會因為
        // <td> 自己被改了 display 而失效。
        var c1 = el('td', 'zg-codecell');
        var codeWrap = el('div', 'zg-codepair');
        var codeRow = el('div', 'zg-codepair-row');
        // 取碼不一定是單一個字母（目 是 DI（D）），所以鍵帽要能長寬
        var k = el('span', 'zg-key zg-key-sm', it.letter);
        if (Array.from(it.letter).length > 1) k.classList.add('is-wide');
        k.setAttribute('data-keep', '');
        codeRow.appendChild(k);
        // 說明文字裡點名的「不取哪個碼」，淡化＋刪除線放在正確碼旁邊對照
        // （這一欄只認得到 similar.md 的說明有沒有寫「不取 X」，見 build_site_data.py）
        if (it.wrong) {
          var wrong = el('span', 'zg-key-wrong', it.wrong);
          wrong.title = '不取 ' + it.wrong;
          wrong.setAttribute('data-keep', '');
          codeRow.appendChild(wrong);
        }
        codeWrap.appendChild(codeRow);
        // 正確/錯誤拆法小圖對照，只有 it.alt 有資料的列才有，放在碼底下同一欄——
        // 另外開一欄「圖例」在大部分列都是空的，看起來很怪（Wilson）。
        if (it.alt) {
          var iconRow = el('div', 'zg-codepair-row');
          // 兩邊各畫各的字（例：合#1,2,3 這一列，正確畫合、錯誤畫余對照
          // 「根 A 站不站得住」，不是同一個字的兩種拆法）——見 alt.correct/wrong.char
          iconRow.appendChild(altMiniCard(it.alt.correct.char, it.alt.correct, true));
          iconRow.appendChild(altMiniCard(it.alt.wrong.char, it.alt.wrong, false));
          codeWrap.appendChild(iconRow);
        }
        c1.appendChild(codeWrap);
        tr.appendChild(c1);

        // 例字是 {c, st} 物件（st = 該字裡屬於這個字母的筆畫），不是純字串——
        // 交給 exampleGlyph 畫成有高亮的字，跟字根表那邊同一個函式。
        tr.appendChild(withLinks(it.trait, el('td', 'zg-trait')));

        var c2 = el('td', 'zg-ex');
        it.ex.forEach(function (e) { c2.appendChild(exampleGlyph(e, '')); });
        tr.appendChild(c2);
        tb.appendChild(tr);
      });
      t.appendChild(tb); tw.appendChild(t); card.appendChild(tw);

      if (g.note) card.appendChild(withLinks(g.note, el('p', 'zg-simnote')));
      body.appendChild(card);
    });

    if (window.AiPhaBiSite) window.AiPhaBiSite.localize(body);
  }

  /* 字形資料 1.6MB，比字根表本身大得多，所以先把表畫出來（文字版看得懂），
   * 拿到之後再重畫一次補上圖。網路慢或抓不到就一直是文字版，不會空白。 */
  function loadGlyphs() {
    fetch('assets/glyphs.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (g) {
        if (!g || !g.glyphs) return;
        GLYPHS = g.glyphs;
        render(lastFilter);
        // 辨析那一節的「字形」欄也要跟著重畫 —— 它一樣要靠 GLYPHS 才畫得出
        // 「石#1,2」這種打不出來的字根，只重畫表格的話它會永遠停在文字退路上
        renderSimilar(DATA.similar);
        var credit = document.getElementById('zg-credit');
        if (credit) credit.hidden = false;
      })
      .catch(function () { /* 維持文字版 */ });
  }

  // 字級（小／標準／大）現在是全站共用行為，見 site.js —— 那支程式在這支之前載入，
  // 頁面畫出來的時候字級已經套好了，這裡不必再管。

  fetch('assets/zigen.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      renderSimilar(d.similar);
      render('');
      loadGlyphs();
    })
    .catch(function () {
      box.textContent = '';
      box.appendChild(el('p', 'zg-loading',
        '字根表載入失敗。本機預覽請先跑 python3 site/tools/build_site_data.py。'));
    });

  if (q) {
    q.addEventListener('input', function () {
      if (!DATA) return;
      // 只取第一個字元（用 for...of 才不會把非 BMP 罕用字切成兩半）
      var first = '';
      for (var ch of q.value.trim()) { first = ch; break; }
      render(first);
    });
  }
})();
