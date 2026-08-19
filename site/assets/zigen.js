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

  /* 字級（小／標準／大）。表格裡的字與例字 SVG 由 CSS 的 --zg-scale 處理，
   * 但字根圖示的尺寸是這支程式逐個算出來寫進 width/height 屬性的，CSS 管不到，
   * 所以這裡也要乘一次，並在切換時重畫。 */
  var SIZE_KEY = 'aiphabi-zigen-size';
  var SCALE = { small: 0.86, normal: 1, large: 1.2 };
  var sizeName = 'normal';

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
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var s = Math.max(x1 - x0, y1 - y0) + ROOT_PAD * 2;
    var paths = '';
    for (var j = 0; j < sel.length; j++) {
      if (strokes[sel[j]]) paths += '<path d="' + strokes[sel[j]] + '"/>';
    }
    // 顯示尺寸取 bbox 的平方根，不是固定值也不是線性：viewBox 已經裁到字根本身，
    // 固定 2rem 會把一筆的「點」撐得又大又粗、把六筆的部件縮得又小又細。線性縮放
    // 則會讓兩者差到三倍。開根號把差距壓到肉眼可接受，又保留「筆畫多的略大」。
    // 尺寸區間跟著整體密度一起縮（原本 16–40）——列高是這一頁最貴的東西，
    // 倉頡的〈輔助字形列表〉同樣高度可以放 20 列，我們原本只放得下 12 列。
    var px = Math.max(13, Math.min(28, Math.round(1 + 0.78 * Math.sqrt(s))));
    px = Math.round(px * (SCALE[sizeName] || 1));
    return '<svg class="zg-svg" viewBox="' + (cx - s / 2) + ' ' + (cy - s / 2) + ' ' + s + ' ' + s +
      '" width="' + px + '" height="' + px + '" aria-hidden="true">' +
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
          if (g.desc) td.appendChild(el('span', null, g.desc));
          else td.appendChild(el('span', 'zg-todo', '（取形意圖待補）'));
          if (g.tier && g.tier !== 'primary') {
            td.appendChild(el('span', 'zg-tier', DATA.tiers[g.tier] || g.tier));
          }
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
    var re = /\[([^\]]+)\]\(([^)]+)\)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) into.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el('a', null, m[1]);
      a.href = m[2];
      into.appendChild(a);
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
      var card = el('div', 'zg-sim');
      card.appendChild(el('h3', null, g.title));

      var tw = el('div', 'tablewrap');
      var t = el('table', 'zg-simtbl');
      var thead = el('thead'), hr = el('tr');
      ['形', '字母', '例字', '特徵'].forEach(function (h) {
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
        }
        if (!sg) {
          // 「丶」「乚」是字，「石字 1、2 筆」是描述——後者放大會撐爆欄寬
          sg = glyph(ref ? ref[1] + ' 第 ' + ref[2] + ' 筆' : it.shape, 'zg-src');
          if (Array.from(sg.textContent).length > 2) sg.classList.add('is-desc');
        }
        // it.ex 是 {c, st} 物件，findZigenRow 比對的是字元 —— 要先取出 c，
        // 不然每次比對都不相等，連結會全部靜靜地失效
        var target = findZigenRow(it.letter, it.ex.map(function (e) { return e.c; }));
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

        var c1 = el('td');
        // 取碼不一定是單一個字母（目 是 DI（D）），所以鍵帽要能長寬
        var k = el('span', 'zg-key zg-key-sm', it.letter);
        if (Array.from(it.letter).length > 1) k.classList.add('is-wide');
        k.setAttribute('data-keep', '');
        c1.appendChild(k);
        tr.appendChild(c1);

        // 例字是 {c, st} 物件（st = 該字裡屬於這個字母的筆畫），不是純字串——
        // 交給 exampleGlyph 畫成有高亮的字，跟字根表那邊同一個函式。
        var c2 = el('td', 'zg-ex');
        it.ex.forEach(function (e) { c2.appendChild(exampleGlyph(e, '')); });
        tr.appendChild(c2);

        tr.appendChild(withLinks(it.trait, el('td', 'zg-trait')));
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

  /* ---------- 字級 ---------- */
  function applySize(name, redraw) {
    sizeName = SCALE[name] ? name : 'normal';
    document.documentElement.setAttribute('data-zg-size', sizeName);
    document.querySelectorAll('.zg-size button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.size === sizeName));
    });
    try { localStorage.setItem(SIZE_KEY, sizeName); } catch (e) { /* 無痕模式 */ }
    // 字根圖示的尺寸寫在屬性上，只有重畫才會跟著變
    if (redraw && DATA) { render(lastFilter); renderSimilar(DATA.similar); }
  }

  document.querySelectorAll('.zg-size button').forEach(function (b) {
    b.addEventListener('click', function () { applySize(b.dataset.size, true); });
  });

  // 先套用（不重畫，因為資料還沒到），這樣第一次繪製就是正確的字級
  try { applySize(localStorage.getItem(SIZE_KEY) || 'normal', false); }
  catch (e) { applySize('normal', false); }

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
