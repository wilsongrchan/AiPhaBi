/* 〈約定字〉頁：把 assets/conventional.json 的約定字表畫成一組一組的表格。
 * 資料由 site/tools/build_site_data.py 的 build_conventional() 從
 * data/rules.json（約定原則的組別／字表）＋data/codes.json（現查每個字的真碼、
 * 逐筆的 segments）產生，這支程式只負責畫表。表格樣式沿用 jianma.js 那一套
 * （.jm-tbl／.jm-char），兩頁看起來一致，也不用另外重寫一份 CSS。
 *
 * 字形顏色開關：圖示欄和「單獨成字」碼的逐字上色是同一個開關（#cv-groups 有沒有
 * .cv-color 這個 class），CSS 選擇器見 site.css——不是兩個獨立控制項，開了兩個一起
 * 出現，關了兩個一起消失（Wilson）。 */
(function () {
  'use strict';

  var root = document.getElementById('cv-groups');
  if (!root) return;

  var RAINBOW = ['rb-0', 'rb-1', 'rb-2', 'rb-3', 'rb-4', 'rb-5'];
  var GLYPHS = null;
  var DATA = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function groupOf(idx, groups) {
    for (var k = 0; k < groups.length; k++) {
      if (groups[k].indexOf(idx) >= 0) return k;
    }
    return -1;
  }

  // 逐字上色的 <code>：第 i 個字母對應 codeGroups[i]（groups 裡第幾段）——**不能**用
  // groupOf(i, groups)：那是拿字母的「位置」去查「筆畫索引」的清單，位置剛好也是數字，
  // 兩種索引長得一樣但意義完全不同，查到的段會是錯的（例：TJR 的第 2 個字母 J 位置是
  // 1，如果拿 1 去查 groups，會查到「T」那一段 [0,1] 裡有沒有 1——當然有，J 就被誤塗
  // 成 T 的顏色）。碼沒被砍過時 codeGroups 就是 [0,1,2,…]，效果等於直接用位置；
  // 「裊」這種碼被砍過的字，codeGroups 會跳過被砍掉的那一段（見 _code_groups()）。
  function codedText(text, groups, codeGroups) {
    var c = el('code');
    c.setAttribute('data-keep', '');
    for (var i = 0; i < text.length; i++) {
      var gi = codeGroups ? codeGroups[i] : i;
      var letter = el('span', gi != null && gi < groups.length ? RAINBOW[gi % RAINBOW.length] : 'off');
      letter.textContent = text[i];
      c.appendChild(letter);
    }
    return c;
  }

  function icon(ch, groups) {
    var wrap = el('span', 'cv-icon');
    var strokes = GLYPHS && GLYPHS[ch];
    if (strokes) {
      var paths = '';
      for (var i = 0; i < strokes.length; i++) {
        var gi = groupOf(i, groups);
        var cls = gi >= 0 ? RAINBOW[gi % RAINBOW.length] : 'off';
        paths += '<path class="' + cls + '" d="' + strokes[i] + '"/>';
      }
      wrap.innerHTML = '<svg class="zg-altsvg" viewBox="0 0 1024 1024" aria-hidden="true">' +
        '<g transform="scale(1,-1) translate(0,-900)">' + paths + '</g></svg>';
    } else {
      wrap.textContent = ch;
      wrap.setAttribute('data-keep', '');
    }
    return wrap;
  }

  function charRow(c) {
    var tr = el('tr');
    var tdc = el('td');
    tdc.appendChild(el('span', 'jm-char', c.c));
    tdc.lastChild.setAttribute('data-keep', '');
    tr.appendChild(tdc);

    var tdIcon = el('td', 'cv-icon-col');
    tdIcon.appendChild(icon(c.c, c.groups || []));
    tr.appendChild(tdIcon);

    var tdCode = el('td'); tdCode.appendChild(codedText(c.code, c.groups || [], c.codeGroups));
    tr.appendChild(tdCode);

    var tdComp = el('td');
    if (c.comp) {
      var compCode = el('code', null, c.comp);
      compCode.setAttribute('data-keep', '');
      tdComp.appendChild(compCode);
    } else {
      var same = el('span', 'jm-same', '同');
      same.title = '作為偏旁時取碼不變';
      tdComp.appendChild(same);
    }
    tr.appendChild(tdComp);

    return tr;
  }

  function table(cls) {
    var t = el('table', 'jm-tbl jm-compact cv-tbl' + (cls ? ' ' + cls : ''));
    var thead = el('thead');
    var htr = el('tr');
    ['字', '字形', '單獨成字', '作為偏旁'].forEach(function (h) {
      var th = el('th', h === '字形' ? 'cv-icon-col' : null, h);
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    t.appendChild(thead);
    t.appendChild(el('tbody'));
    return t;
  }

  // 字數多的組（數字／木／土字類）拆兩欄，跟〈簡碼〉頁約定簡碼表同一招——減少捲動，
  // 兩欄各自完整連續（不是逐行交錯）。字數少的組（4～6 字）一欄就夠，硬拆兩欄反而
  // 兩邊都稀稀落落。閾值抓 8：剛好卡在「土字類」8 字跟「甲字類」6 字之間。
  var TWO_COL_MIN = 8;

  function groupTables(chars) {
    if (chars.length < TWO_COL_MIN) {
      var t = table();
      var tbody = t.querySelector('tbody');
      chars.forEach(function (c) { tbody.appendChild(charRow(c)); });
      var wrap1 = el('div', 'tablewrap');
      wrap1.appendChild(t);
      return wrap1;
    }
    var cols = el('div', 'jm-cols');
    var tA = table(), tB = table();
    var half = Math.ceil(chars.length / 2);
    var bodyA = tA.querySelector('tbody'), bodyB = tB.querySelector('tbody');
    chars.slice(0, half).forEach(function (c) { bodyA.appendChild(charRow(c)); });
    chars.slice(half).forEach(function (c) { bodyB.appendChild(charRow(c)); });
    cols.appendChild(tA);
    cols.appendChild(tB);
    return cols;
  }

  function groupBlock(g, i) {
    var wrap = el('div');
    var h2 = el('h2', null, g.name);
    h2.id = 'cv-' + (i + 1);
    h2.appendChild(el('span', 'jm-groupcount', '（' + g.chars.length + ' 字）'));
    wrap.appendChild(h2);
    wrap.appendChild(groupTables(g.chars));
    return wrap;
  }

  // 數字／木／土字類（3 組）字數多，各自獨立整條寬度顯示；剩下四組（大／甲／馬／己
  // 字類）都只有 4～6 字，兩兩並排比較省空間——大配甲、馬配己，順序照
  // CONVENTIONAL_GROUP_ORDER（build_site_data.py）排好，這裡直接寫死索引對
  // （Wilson 2026-08-21：明確要「大甲」「馬己」這樣配，不是隨便兩兩湊）。
  var SIDE_BY_SIDE_PAIRS = [[3, 4], [5, 6]];

  function render() {
    if (!DATA) return;
    root.textContent = '';
    var groups = DATA.groups || [];
    var paired = {};
    SIDE_BY_SIDE_PAIRS.forEach(function (pair) { paired[pair[0]] = pair[1]; paired[pair[1]] = true; });
    groups.forEach(function (g, i) {
      if (paired[i] === true) return;               // 已經在配對的另一半畫過了
      if (typeof paired[i] === 'number') {
        var j = paired[i];
        var row = el('div', 'cv-grouppair');
        row.appendChild(groupBlock(g, i));
        row.appendChild(groupBlock(groups[j], j));
        root.appendChild(row);
        return;
      }
      root.appendChild(groupBlock(g, i));
    });
  }

  var colorBtns = document.querySelectorAll('[data-cv-color]');
  colorBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var on = btn.dataset.cvColor === 'on';
      root.classList.toggle('cv-color', on);
      colorBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
    });
  });

  fetch('assets/conventional.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      render();               // 文字先畫出來，筆畫資料還沒到就先顯示純文字退路
      return fetch('assets/glyphs.json');
    })
    .then(function (r) { return r.json(); })
    .then(function (g) {
      GLYPHS = g.glyphs;
      render();                // 拿到筆畫資料後重畫一次，補上圖示與逐字上色
    })
    .catch(function () {
      if (!DATA) root.textContent = '約定字表載入失敗，請重新整理。';
    });
})();
