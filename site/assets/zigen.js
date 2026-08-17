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

  /* 「取自『名』第 1–3 筆」／「整個『日』字」 */
  function describeShape(sh) {
    var wrap = el('span', 'zg-shape');
    wrap.appendChild(glyph(sh.src, 'zg-src'));
    var note = sh.span === 'whole'
      ? '整個字'
      : '第 ' + sh.span + ' 筆';
    wrap.appendChild(el('span', 'zg-span', note));
    return wrap;
  }

  function renderLetter(L, filter) {
    var groups = L.groups;
    if (filter) {
      groups = groups.map(function (g) {
        var shapes = g.shapes.filter(function (s) {
          return s.seen.indexOf(filter) >= 0 || s.src === filter;
        });
        return shapes.length ? { desc: g.desc, tier: g.tier, shapes: shapes } : null;
      }).filter(Boolean);
    }
    if (!groups.length) return null;

    var sec = el('section', 'zg-letter');
    sec.id = 'L' + L.letter;

    var h = el('h2', 'zg-h');
    var key = el('span', 'zg-key', L.letter);
    key.setAttribute('data-keep', '');
    h.appendChild(key);
    var n = groups.reduce(function (a, g) { return a + g.shapes.length; }, 0);
    h.appendChild(el('span', 'zg-n', n + ' 個字根'));
    sec.appendChild(h);

    var tw = el('div', 'tablewrap');
    var t = el('table', 'zg-tbl');
    var thead = el('thead');
    var hr = el('tr');
    ['取形意圖', '字根', '字例'].forEach(function (label) {
      hr.appendChild(el('th', null, label));
    });
    thead.appendChild(hr);
    t.appendChild(thead);

    var tb = el('tbody');
    groups.forEach(function (g) {
      g.shapes.forEach(function (sh, i) {
        var tr = el('tr');
        if (i === 0) {
          // 同一個取形意圖底下的所有形狀共用一格說明
          var td = el('td', 'zg-desc');
          td.rowSpan = g.shapes.length;
          if (g.desc) {
            td.appendChild(el('span', null, g.desc));
          } else {
            // 8 組還沒寫。留白比編一個說法好——這是 Side A 要補的內容。
            var m = el('span', 'zg-todo', '（取形意圖待補）');
            td.appendChild(m);
          }
          if (g.tier && g.tier !== 'primary') {
            var tag = DATA.tiers[g.tier] || g.tier;
            td.appendChild(el('span', 'zg-tier', tag));
          }
          tr.appendChild(td);
        }

        // 每個字根一個 id，讓〈相近字形辨析〉的「字形」欄連得過來
        tr.id = 'Z' + L.letter + '-' + (sh.src || '') + '-' + (sh.span || '');
        var sd = el('td', 'zg-shapecell');
        sd.appendChild(describeShape(sh));
        tr.appendChild(sd);

        var ex = el('td', 'zg-ex');
        sh.seen.slice(0, 12).forEach(function (c) {
          var g2 = glyph(c);
          if (c === filter) g2.classList.add('is-hit');
          ex.appendChild(g2);
        });
        if (sh.seen.length > 12) {
          ex.appendChild(el('span', 'zg-more', '＋' + (sh.seen.length - 12)));
        }
        tr.appendChild(ex);
        tb.appendChild(tr);
      });
    });
    t.appendChild(tb);
    tw.appendChild(t);
    sec.appendChild(tw);
    return sec;
  }

  function render(filter) {
    box.textContent = '';
    var shown = 0, letters = [];
    DATA.letters.forEach(function (L) {
      var sec = renderLetter(L, filter);
      if (sec) {
        box.appendChild(sec);
        letters.push(L.letter);
        shown += sec.querySelectorAll('tbody tr').length;
      }
    });

    if (!shown) {
      box.appendChild(el('p', 'zg-loading',
        '沒有字根用到「' + filter + '」。可能是這個字還沒取碼，或它不在例字裡。'));
    }

    if (status) {
      status.textContent = filter
        ? '「' + filter + '」出現在 ' + shown + ' 個字根的例字裡（' + letters.join('、') + '）'
        : '';
    }

    // 跳轉列只點得到有內容的字母
    if (jump) {
      jump.textContent = '';
      DATA.letters.forEach(function (L) {
        var on = letters.indexOf(L.letter) >= 0;
        var a = el(on ? 'a' : 'span', 'zg-jl' + (on ? '' : ' is-off'), L.letter);
        if (on) a.href = '#L' + L.letter;
        jump.appendChild(a);
      });
    }

    // 新畫上去的內容要跟著目前的繁簡設定走（例字有 data-keep，不會被轉）
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
        // 「丶」「乚」是字，「石字 1、2 筆」是描述——後者放大會撐爆欄寬
        var sg = glyph(it.shape, 'zg-src');
        if (Array.from(it.shape).length > 2) sg.classList.add('is-desc');
        var target = findZigenRow(it.letter, it.ex);
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

        var c2 = el('td', 'zg-ex');
        it.ex.forEach(function (ch) { c2.appendChild(glyph(ch)); });
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

  fetch('assets/zigen.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      renderSimilar(d.similar);
      render('');
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
