/* 例字編輯頁 —— 跟〈字根表〉同一個外觀，但字例欄可以直接改。
 * 資料來自 data.json（本機產生，含全部已取碼字的字形，因為使用者可能打任何字）。
 * 改動存在 localStorage，並即時產生 examples.md 的內容。 */
(function () {
  'use strict';
  var SVG_TF = 'scale(1,-1) translate(0,-900)';
  var KEY = 'aiphabi-review-examples';
  var D = null, edits = {};
  try { edits = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { edits = {}; }

  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function key(r) { return r.L + ' ' + r.src + '#' + r.st.map(function (i) { return i + 1; }).join(','); }

  /* 這個字裡哪幾段屬於**這一列的**字根。跟 build_site_data.py 同一套消歧規則：
   *   1. 打的字就是這一列的來源字 → 直接用這一列自己的筆序
   *   2. 否則扣掉「別的字根以這個字為來源字」認領走的段
   * 兜 = C(1,2) … C(8,9)，兩段都是 2 筆的 C 但屬於不同取形意圖；
   * 沒有這兩條規則就會兩段一起亮，等於宣稱這一列的字根也包含另一段。 */
  function hit(ch, r) {
    var letter = r.L, n = r.st.length;
    if (ch === r.src) return [r.st];                       // 規則 1

    var cand = [];
    var segs = D.segs[ch] || [];
    for (var i = 0; i < segs.length; i++) {
      if (segs[i][0] === letter && segs[i][1].length === n) cand.push(segs[i][1]);
    }
    if (cand.length < 2) return cand;

    var taken = ((D.claims[letter] || {})[ch] || []).map(function (a) { return a.join(','); });
    var rest = cand.filter(function (t) { return taken.indexOf(t.join(',')) < 0; });  // 規則 2
    var out = rest.length ? rest : cand;
    // 扣完還是不只一段，或本來就分不出是哪一段：標記「這一段是推的」。
    // 沒有中線幾何就只能推到這裡 —— 與其假裝確定，不如講出來讓人自己看一眼。
    if (out.length > 1 || cand.length > 1) out.guess = true;
    return out;
  }

  function glyphSvg(ch, segs, size) {
    var st = D.glyphs[ch];
    if (!st) return null;
    var off = '', on = '';
    for (var i = 0; i < st.length; i++) {
      var k = -1;
      for (var j = 0; j < segs.length; j++) if (segs[j].indexOf(i) >= 0) { k = j; break; }
      if (k >= 0) on += '<path class="on on-' + Math.min(k + 1, 3) + '" d="' + st[i] + '"/>';
      else off += '<path class="off" d="' + st[i] + '"/>';
    }
    return '<svg class="zg-exsvg" style="width:' + size + ';height:' + size +
      '" viewBox="0 0 1024 1024"><g transform="' + SVG_TF + '">' + off + on + '</g></svg>';
  }

  function rootSvg(r) {
    var st = D.glyphs[r.src];
    if (!st) return '';
    var xs = [], ys = [], re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    r.st.forEach(function (i) {
      var d = st[i]; if (!d) return;
      var m; re.lastIndex = 0;
      while ((m = re.exec(d))) { xs.push(+m[1]); ys.push(900 - (+m[2])); }
    });
    if (!xs.length) return '';
    var cx = (Math.min.apply(0, xs) + Math.max.apply(0, xs)) / 2;
    var cy = (Math.min.apply(0, ys) + Math.max.apply(0, ys)) / 2;
    var sp = Math.max(Math.max.apply(0, xs) - Math.min.apply(0, xs),
                      Math.max.apply(0, ys) - Math.min.apply(0, ys));
    var box = Math.min(1024, sp / 0.85) || 1024;
    var paths = r.st.map(function (i) { return st[i] ? '<path d="' + st[i] + '"/>' : ''; }).join('');
    return '<svg class="zg-svg" style="width:1.55rem;height:1.55rem" viewBox="' +
      (cx - box / 2) + ' ' + (cy - box / 2) + ' ' + box + ' ' + box + '"><g transform="' +
      SVG_TF + '">' + paths + '</g></svg>';
  }

  function paintCell(td, r) {
    var k = key(r);
    var chars = edits[k] !== undefined ? edits[k] : r.ex.join(' ');
    td.textContent = '';
    var wrap = el('span');
    var bad = [];
    chars.split(/\s+/).filter(Boolean).forEach(function (c) {
      var segs = hit(c, r);
      var svg = segs.length ? glyphSvg(c, segs, '1.55rem') : null;
      if (svg) {
        var s = el('span', 'zg-exg' + (segs.guess ? ' guess' : ''));
        s.innerHTML = svg;
        s.title = segs.guess
          ? c + '：這個字裡有不只一段同字母同筆數的形狀，標出來的是推測的那一段，請自己確認'
          : c;
        wrap.appendChild(s);
      } else {
        bad.push(c);
        wrap.appendChild(el('span', 'zg-ch', c));
      }
    });
    td.appendChild(wrap);
    if (bad.length) td.appendChild(el('span', 'bad', '✗ ' + bad.join('') + ' 沒用到這個字根'));
  }

  function render() {
    var box = document.getElementById('t');
    box.textContent = '';
    var t = el('table', 'zg-tbl');
    var th = el('thead'), hr = el('tr');
    ['字母', '取形意圖', '字根', '字例（可直接改）'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');

    var prev = null;
    D.rows.forEach(function (r) {
      var tr = el('tr');
      if (r.L !== prev) { tr.className = 'is-letter-start'; prev = r.L; }
      tr.appendChild(el('td', 'key', r.L));
      tr.appendChild(el('td', 'zg-desc', r.desc || '（待補）'));

      var sd = el('td', 'zg-shapecell');
      var w = el('span', 'zg-shape');
      var ic = el('span', 'zg-icon'); ic.innerHTML = rootSvg(r); w.appendChild(ic);
      w.appendChild(el('span', 'zg-span',
        (r.span === 'whole' ? '整個字' : '第 ' + r.span + ' 筆') + '（' + r.src + '）'));
      sd.appendChild(w); tr.appendChild(sd);

      var ed = el('td', 'zg-ex ed');
      ed.contentEditable = 'true';
      ed.spellcheck = false;
      ed.dataset.k = key(r);
      if (edits[key(r)] !== undefined) ed.dataset.dirty = '1';
      paintCell(ed, r);

      ed.addEventListener('focus', function () {
        ed.textContent = edits[key(r)] !== undefined ? edits[key(r)] : r.ex.join(' ');
      });
      ed.addEventListener('blur', function () {
        var v = ed.textContent.replace(/\s+/g, ' ').trim();
        if (v === r.ex.join(' ')) { delete edits[key(r)]; delete ed.dataset.dirty; }
        else { edits[key(r)] = v; ed.dataset.dirty = '1'; }
        save(); paintCell(ed, r);
      });
      tr.appendChild(ed);
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.appendChild(t);
    save();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(edits)); } catch (e) {}
    var lines = [];
    D.rows.forEach(function (r) {
      var k = key(r);
      if (edits[k] === undefined) return;
      // 同一字母下來源字唯一時就不用寫筆序，跟 examples.md 的格式一致
      var same = D.rows.filter(function (o) { return o.L === r.L && o.src === r.src; });
      lines.push((same.length > 1 ? k : r.L + ' ' + r.src) + ' = ' + edits[k]);
    });
    document.getElementById('out').value = lines.join('\n');
    document.getElementById('cnt').textContent = lines.length ? lines.length + ' 列已改' : '還沒有改動';
  }

  /* 儲存：直接 POST 回本機的 preview.py，由它寫進 site/content/examples.md。
   * 瀏覽器不能寫檔，但那台伺服器可以 —— 省掉「複製再貼回檔案」那一步。 */
  document.getElementById('save').addEventListener('click', function () {
    var b = this, body = document.getElementById('out').value;
    b.textContent = '儲存中…';
    fetch('/_review/save', { method: 'POST', body: body })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(function () {
        b.textContent = '已儲存 ✓';
        setTimeout(function () { b.textContent = '儲存到 examples.md'; }, 1800);
      })
      .catch(function () {
        b.textContent = '儲存失敗（是用 preview.py 開的嗎？）';
        setTimeout(function () { b.textContent = '儲存到 examples.md'; }, 2600);
      });
  });

  document.getElementById('copy').addEventListener('click', function () {
    var ta = document.getElementById('out');
    ta.select(); document.execCommand('copy');
    this.textContent = '已複製';
    var b = this; setTimeout(function () { b.textContent = '複製'; }, 1200);
  });
  document.getElementById('reset').addEventListener('click', function () {
    if (!confirm('把所有改動還原？')) return;
    edits = {}; render();
  });

  fetch('data.json').then(function (r) { return r.json(); })
    .then(function (d) { D = d; render(); })
    .catch(function () {
      document.getElementById('t').textContent = '載入失敗 —— 先跑 python3 site/tools/review_examples.py';
    });
})();
