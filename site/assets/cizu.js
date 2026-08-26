/* 〈詞組〉頁：把 assets/phrases.json 畫成「逐字的碼接起來」的樣子。
 *
 * 這支程式不做任何取碼邏輯——例詞的每一段碼、每一個四碼簽名，都是
 * site/tools/build_site_data.py 在建置時從 data/codes.json 算出來、
 * 再拿實際出貨的碼表（rime/aiphabi.dict.yaml、aiphabi_data.lua 的 M.si4）
 * 對過一次的。這裡只負責上色和排版。
 *
 * 上色的用意是讓「串接」這件事一眼看得出來：同一個字的碼，在分解式裡和在
 * 合起來的總碼裡是同一個顏色，所以不必解釋也看得出哪幾個字母是哪個字貢獻的。 */
(function () {
  'use strict';

  var root = document.getElementById('cz-two');
  if (!root) return;

  /* 用哪幾個分組色、按什麼順序：紅、黃、綠、紫（Wilson 指定，四碼最多四格，
     所以實際只會用到這四個；藍與粉排在後面備用）。色值本身是全站共用的那一組，
     不在這裡改。
     ⚠️ 黃 #ffb732 在淺色主題白底上只有 1.74:1（紅 4.2、綠 2.1、紫 6.6），
     這一頁的碼是 .68–.8rem 的粗體小字，黃那一格在淺色主題下最難讀。深色主題
     反過來（黃 9.5 最亮）。要再好讀就得動色值，那是全站的事，不是這一頁的事。 */
  var RB = ['rb-0', 'rb-1', 'rb-2', 'rb-4', 'rb-3', 'rb-5'];
  function rb(i) { return RB[i % RB.length]; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function code(text, cls) {
    var c = el('code', cls, text);
    c.setAttribute('data-keep', '');
    return c;
  }

  /* 例字的字形（assets/phrases.json 的 glyphs，跟試打頁的田字格同一份來源、
     同一個授權：makemeahanzi／Arphic PL，少數字用教育部標準筆順）。
     座標系跟 try.js 的田字格一樣：graphics.txt 的原點在左下，所以 y 要翻過來，
     位移是 900 不是 1024。這裡不畫格線 —— 要看的是「哪幾筆亮著」，格子是多餘的。 */
  var SVG_TF = 'scale(1,-1) translate(0,-900)';
  var GLYPHS = null;

  /* 一個字一張圖。picks 可以有兩條（劉德華 的 華 同時被取首碼和末碼），
     各自上自己那一位的顏色，其餘筆畫壓成淡灰。 */
  function strokeSvg(ch, picks) {
    var st = GLYPHS && GLYPHS[ch];
    if (!st) return null;
    var lit = {}, any = false;
    for (var i = 0; i < picks.length; i++) {
      var on = picks[i].on || [];
      for (var j = 0; j < on.length; j++) { lit[on[j]] = picks[i].i; any = true; }
    }
    if (!any) return null;
    var paths = '';
    for (var k = 0; k < st.length; k++) {
      var g = lit[k];
      paths += '<path class="' + (g == null ? 'cz-off' : 'cz-lit-' + rb(g).slice(3))
             + '" d="' + st[k] + '"/>';
    }
    var box = el('span', 'cz-glyph');
    box.setAttribute('data-keep', '');
    box.innerHTML = '<svg viewBox="0 0 1024 1024" role="img" aria-label="' + ch + '">'
      + '<g transform="' + SVG_TF + '">' + paths + '</g></svg>';
    return box;
  }

  function glyph(ch) {
    var g = el('span', 'cz-ch', ch);
    g.setAttribute('data-keep', '');
    return g;
  }

  /* 一段「字 ＋ 它貢獻的碼 ＋ 這是哪一種碼」。i 決定顏色。 */
  function partChip(p, i) {
    var box = el('span', 'cz-part');
    box.appendChild(glyph(p.c));
    box.appendChild(code(p.code, rb(i)));
    box.appendChild(el('i', 'cz-kind', p.label));
    return box;
  }

  /* 合起來的總碼，按各字的碼長切段上色——顏色跟上面的分解式對得起來。 */
  function totalCode(parts) {
    var c = el('code', 'cz-total');
    c.setAttribute('data-keep', '');
    parts.forEach(function (p, i) {
      c.appendChild(el('span', rb(i), p.code));
    });
    return c;
  }

  function eqRow(parts, extra) {
    var row = el('div', 'cz-eq');
    parts.forEach(function (p, i) {
      if (i) row.appendChild(el('span', 'cz-op', '＋'));
      row.appendChild(partChip(p, i));
    });
    row.appendChild(el('span', 'cz-op', '＝'));
    row.appendChild(totalCode(parts));
    if (extra) row.appendChild(extra);
    return row;
  }

  function wordHead(w, note) {
    var h = el('p', 'cz-wordhead');
    h.appendChild(glyph(w));
    if (note) h.appendChild(el('span', 'cz-note', note));
    return h;
  }

  function staleTag() {
    var s = el('span', 'cz-stale', '碼表待重建');
    s.title = '這個詞現算出來的碼，跟目前出貨的碼表對不上——'
            + '多半是取碼剛改過、碼表還沒重新產生。';
    return s;
  }

  /* ---------- 兩字詞 ---------- */
  function renderTwo(list) {
    root.textContent = '';
    list.forEach(function (e) {
      var card = el('div', 'cz-card');
      var head = wordHead(e.w, e.note);
      if (!e.ok) head.appendChild(staleTag());
      card.appendChild(head);
      e.rows.forEach(function (r) { card.appendChild(eqRow(r.parts)); });
      card.appendChild(el('p', 'cz-count', '收錄以上 ' + e.rows.length + ' 種連打編碼'));
      root.appendChild(card);
    });
  }

  /* ---------- 三字以上：四式 ---------- */
  function renderMulti(m) {
    var box = document.getElementById('cz-multi');
    box.textContent = '';
    if (!m) { box.appendChild(el('p', 'cz-note', '（例詞暫時算不出來）')); return; }
    var card = el('div', 'cz-card');
    var head = wordHead(m.w, '四式剛好各不相同的一個詞');
    if (!m.ok) head.appendChild(staleTag());
    card.appendChild(head);
    m.modes.forEach(function (mo) {
      var line = el('div', 'cz-mode');
      var tag = el('span', 'cz-modetag', mo.label);
      if (mo.dup) tag.classList.add('is-dup');
      line.appendChild(tag);
      line.appendChild(eqRow(mo.parts,
        mo.dup ? el('span', 'cz-note', '跟上面某一式算出來一樣，只收一條') : null));
      var why = el('p', 'cz-why', mo.why);
      line.appendChild(why);
      card.appendChild(line);
    });
    box.appendChild(card);
  }

  /* ---------- 四碼快打 ---------- */
  /* 一格＝一個字：畫出那個字，取到的字根亮起來、其餘壓暗，底下是它的碼（取到的
     字母上色）。四碼是「每格挑一個字母」，畫成挑字根的樣子比寫規則好懂。
     連著的同一個字合成一格（劉德華 的 華 同時被取首碼和末碼）—— 兩個 華 並排
     會看成「劉德華華」，而首尾兩條字根本來就該在同一張圖上一起看（Wilson）。 */
  function slotCell(s) {
    var cell = el('div', 'cz-slot');
    /* 字形優先：取首碼講的其實是「取第一條字根的字母」，看到那幾筆亮起來才懂
       （Wilson）。沒有字形資料（字形檔沒下載成功）就退回單純的字，其餘照舊。 */
    cell.appendChild(strokeSvg(s.c, s.picks) || glyph(s.c));

    var c = el('code', null);
    c.setAttribute('data-keep', '');
    var letters = s.code.split('');
    var claim = {};                       // 第幾個字母 → 認領它的那幾位（照四碼的位次）
    s.picks.forEach(function (p) {
      var j = p.last ? letters.length - 1 : 0;
      (claim[j] || (claim[j] = [])).push(p.i);
    });
    letters.forEach(function (ch, j) {
      var cs = claim[j];
      if (!cs) { c.appendChild(el('span', 'off', ch)); return; }
      /* 首碼跟末碼撞在同一個字母上（長白山 的 山＝W，整個字只有一碼）：那個
         字母**印兩次**，各上自己那一位的顏色（Wilson）。印一個會看不出末碼
         那一位也是它，而四碼結尾真的是 WW —— 少印一個等於把碼講錯。 */
      cs.forEach(function (i) { c.appendChild(el('span', rb(i), ch)); });
    });
    cell.appendChild(c);
    cell.appendChild(el('i', 'cz-kind',
      s.picks.map(function (p) { return p.last ? '末碼' : '首碼'; }).join('＋')));
    return cell;
  }

  function si4Row(slots, out, label) {
    var row = el('div', 'cz-eq cz-si4row');
    if (label) row.appendChild(el('span', 'cz-modetag', label));
    slots.forEach(function (s, i) {
      if (i) row.appendChild(el('span', 'cz-op', '＋'));
      row.appendChild(slotCell(s));
    });
    row.appendChild(el('span', 'cz-op', '＝'));
    var total = el('code', 'cz-total');
    total.setAttribute('data-keep', '');
    out.split('').forEach(function (ch, i) {
      total.appendChild(el('span', rb(i), ch));
    });
    row.appendChild(total);
    return row;
  }

  function renderSi4(list) {
    var box = document.getElementById('cz-si4');
    box.textContent = '';
    list.forEach(function (e) {
      var card = el('div', 'cz-card');
      var head = wordHead(e.w, e.n + ' 字　' + e.note);
      if (!e.ok) head.appendChild(staleTag());
      card.appendChild(head);
      /* 標籤講的是那一式**取哪幾個字**，不是「第幾式」（Wilson）——「第一式／
         第二式」要回頭去對規則才知道是哪一種，寫成取法本身就不用對。 */
      card.appendChild(si4Row(e.slots, e.code, e.slots2 ? '前四字' : null));
      if (e.slots2) card.appendChild(si4Row(e.slots2, e.code2, '前三加末字'));

      var foot = el('p', 'cz-count');
      if (e.full) {
        foot.appendChild(document.createTextNode('照一般規則打是 '));
        foot.appendChild(code(e.full));
        foot.appendChild(document.createTextNode(
          '（' + e.full.length + ' 碼），四碼省下 ' + (e.full.length - 4) + ' 下。'));
      }
      // 兼容碼生出來的額外簽名。五字以上也要講 —— 那邊 more 是「某一格的字有
      // 兼容碼」，跟第二式是兩回事，早先漏掉了（聯合國教科文組織 的 教 → NAOF）。
      if (e.more && e.more.length) {
        foot.appendChild(document.createTextNode('　兼容碼另外生出 '));
        e.more.forEach(function (m, i) {
          if (i) foot.appendChild(document.createTextNode('、'));
          foot.appendChild(code(m));
        });
        foot.appendChild(document.createTextNode(' 一樣打得到。'));
      }
      if (foot.childNodes.length) card.appendChild(foot);
      box.appendChild(card);
    });
  }

  /* ---------- 智能分詞 ---------- */
  function renderSentence(s) {
    var box = document.getElementById('cz-sentence');
    box.textContent = '';
    if (!s) return;
    var card = el('div', 'cz-card');

    var line = el('div', 'cz-eq');
    line.appendChild(el('span', 'cz-op', '打'));
    var whole = el('code', 'cz-total');
    whole.setAttribute('data-keep', '');
    whole.appendChild(el('span', 'rb-0', s.headCode));
    whole.appendChild(el('span', 'off', s.tailCode));
    line.appendChild(whole);
    card.appendChild(line);

    var p = el('p', 'cz-count');
    p.appendChild(document.createTextNode('「'));
    p.appendChild(glyph(s.whole));
    p.appendChild(document.createTextNode('」不是收錄詞組，但前面的「'));
    p.appendChild(glyph(s.head));
    p.appendChild(document.createTextNode('」是——選字列會把它留在首位，一擊空格先打出來，'));
    p.appendChild(document.createTextNode('剩下的 '));
    p.appendChild(code(s.tailCode));
    /* 後半段本身是不是收錄詞組，由建置時查出貨碼表決定（tailListed）。
       兩種情況要講的話不一樣，而且會變 —— 「新界」原本不是詞組，Side B 補進
       港澳分區之後就是了（2026-08-26）。寫死其中一種，遲早會變成謊話。 */
    if (s.tailListed) {
      p.appendChild(document.createTextNode('也是收錄詞組「'));
      p.appendChild(glyph(s.tail));
      p.appendChild(document.createTextNode('」，再一擊空格就好，不必整串刪掉重打。'));
    } else {
      p.appendChild(document.createTextNode('（'));
      p.appendChild(glyph(s.tail));
      p.appendChild(document.createTextNode('）接著打就好，不必整串刪掉重打。'));
    }
    card.appendChild(p);

    box.appendChild(card);
  }

  /* ---------- 詞庫收錄了什麼 ---------- */
  /* 每一組一張卡：組名、幾個詞、幾個例。例詞旁邊掛它的碼（詞組連打那條），
     有四碼的再多掛一個 —— 這一段是「詞庫有什麼」，不是碼表，所以碼只當佐證，
     不佔版面（.cz-w code 是小字）。 */
  function renderCorpus(c) {
    var box = document.getElementById('cz-corpus');
    box.textContent = '';
    if (!c) return;
    c.groups.forEach(function (g) {
      var card = el('div', 'cz-card cz-cat');
      var head = el('p', 'cz-cathead');
      head.appendChild(el('b', null, g.name));
      head.appendChild(el('span', 'cz-note',
        g.n.toLocaleString('en-US') + ' 個詞' + (g.src ? '　' + g.src : '')));
      card.appendChild(head);
      var list = el('div', 'cz-words');
      g.picks.forEach(function (p) {
        var one = el('span', 'cz-w');
        one.appendChild(glyph(p.w));
        /* 一個詞只掛一條碼：有四碼就掛四碼，沒有才掛詞組碼。兩條都掛的話，
           長詞會被自己的詞組碼淹沒（斯堪地那維亞 的詞組碼有 17 個字母），
           而這一段要講的是「詞庫收了什麼」，碼只是佐證。 */
        one.appendChild(p.si4 ? code(p.si4, 'is-si4') : code(p.code));
        list.appendChild(one);
      });
      card.appendChild(list);
      box.appendChild(card);
    });
  }

  function num(id, v) {
    var n = document.getElementById(id);
    if (n && v != null) n.textContent = v.toLocaleString('en-US');
  }

  fetch('assets/phrases.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      num('cz-n-words', d.stats.words);
      num('cz-n-entries', d.stats.entries);
      num('cz-n-si4', d.stats.si4Words);
      GLYPHS = d.glyphs || null;
      renderTwo(d.two || []);
      renderMulti(d.multi);
      renderSi4(d.si4 || []);
      renderSentence(d.sentence);
      renderCorpus(d.corpus);
      /* 四碼快打那段開場白裡的「照規則接要打幾碼」——拿最長的那個例詞現算，
         不要寫死在 HTML 裡（取碼一改就過期，而過期的數字沒人會發現）。 */
      var lng = (d.si4 || []).slice().sort(function (a, b) {
        return (b.full || '').length - (a.full || '').length;
      })[0];
      if (lng) {
        var wEl = document.getElementById('cz-long-w');
        var nEl = document.getElementById('cz-long-n');
        if (wEl) { wEl.textContent = lng.w; wEl.setAttribute('data-keep', ''); }
        if (nEl) nEl.textContent = lng.full.length;
      }
      if (window.AiPhaBiSite) window.AiPhaBiSite.localize(document.querySelector('main'));
    })
    .catch(function () {
      document.querySelectorAll('.cz-loading').forEach(function (p) {
        p.textContent = '詞組資料載入失敗，請重新整理。';
      });
    });
})();
