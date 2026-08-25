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

  /* 用哪幾個分組色、按什麼順序。不是 0,1,2,3… 順著用 —— 淺色主題下六色的
     對比差很多（白底：紫 6.6、紅 4.2、藍 3.1、粉 2.6、綠 2.1、黃 1.7），
     而這一頁的碼是小字粗體，黃和綠讀不出來。這裡按對比重排，一個詞最多用到
     四格（四碼快打），所以實際只會出現前四個：紅、藍、紫、綠，黃跟粉排在後面
     等於不會用到。色值本身不動 —— 那是全站共用的（Wilson 指定）。 */
  var RB = ['rb-0', 'rb-3', 'rb-4', 'rb-2', 'rb-5', 'rb-1'];
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
      card.appendChild(el('p', 'cz-count', e.rows.length + ' 種打法都收，打哪一種都選得到'));
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
  /* 一個字的碼，取到的那個字母亮起來、其餘壓暗——四碼是「每格挑一個字母」，
     畫成挑字母的樣子比寫規則好懂。同一個字在兩格被取到（三字詞的末字取首和末）
     時會出現兩次，各自亮各自那一個字母。 */
  function slotCell(s, i) {
    var cell = el('div', 'cz-slot');
    cell.appendChild(glyph(s.c));
    var c = el('code', null);
    c.setAttribute('data-keep', '');
    var letters = s.code.split('');
    var pick = s.last ? letters.length - 1 : 0;
    letters.forEach(function (ch, j) {
      c.appendChild(el('span', j === pick ? rb(i) : 'off', ch));
    });
    cell.appendChild(c);
    cell.appendChild(el('i', 'cz-kind', s.last ? '末碼' : '首碼'));
    return cell;
  }

  function si4Row(slots, out, label) {
    var row = el('div', 'cz-eq cz-si4row');
    if (label) row.appendChild(el('span', 'cz-modetag', label));
    slots.forEach(function (s, i) {
      if (i) row.appendChild(el('span', 'cz-op', '＋'));
      row.appendChild(slotCell(s, i));
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
      card.appendChild(si4Row(e.slots, e.code, e.slots2 ? '第一式' : null));
      if (e.slots2) card.appendChild(si4Row(e.slots2, e.code2, '第二式'));

      var foot = el('p', 'cz-count');
      if (e.full) {
        foot.appendChild(document.createTextNode('照一般規則打是 '));
        foot.appendChild(code(e.full));
        foot.appendChild(document.createTextNode(
          '（' + e.full.length + ' 碼），四碼省下 ' + (e.full.length - 4) + ' 下。'));
      }
      if (e.more && e.more.length && !e.slots2) {
        foot.appendChild(document.createTextNode('　兼容碼另外生出 '));
        e.more.forEach(function (m, i) {
          if (i) foot.appendChild(document.createTextNode('、'));
          foot.appendChild(code(m));
        });
        foot.appendChild(document.createTextNode(' 一樣打得到。'));
      }
      if (e.share && e.share.length) {
        foot.appendChild(document.createTextNode('　同碼的還有 '));
        var sp = el('span', null, e.share.join('、'));
        sp.setAttribute('data-keep', '');
        foot.appendChild(sp);
        foot.appendChild(document.createTextNode('，按詞頻排。'));
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
    p.appendChild(document.createTextNode('（'));
    p.appendChild(glyph(s.tail));
    p.appendChild(document.createTextNode('）接著打就好，不必整串刪掉重打。'));
    card.appendChild(p);

    box.appendChild(card);
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
      renderTwo(d.two || []);
      renderMulti(d.multi);
      renderSi4(d.si4 || []);
      renderSentence(d.sentence);
      if (window.AiPhaBiSite) window.AiPhaBiSite.localize(document.querySelector('main'));
    })
    .catch(function () {
      document.querySelectorAll('.cz-loading').forEach(function (p) {
        p.textContent = '詞組資料載入失敗，請重新整理。';
      });
    });
})();
