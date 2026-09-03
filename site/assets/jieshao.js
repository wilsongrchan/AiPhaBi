/* 〈簡介〉九大特點：手機上改成可以左右滑的卡片（Wilson 2026-09-03）

   「for the mobile site intro page, the 9 points instead of a long list, maybe
   show like first point in like a floating panel, with the title of the point
   in green, and then you can swipe right to the 2nd point, etc etc, like a card
   deck almost. and on these cards, it should be 一句一分一段」

   ⚠️ 這支只在**窄螢幕**動手，而且動完可以整個還原：桌面版那一長串是原本的樣子，
   不能被改到。作法是把 <ol> 原始的 innerHTML 收起來，轉寬螢幕時貼回去 ——
   位元組級的還原，不是「再排回去看起來很像」。

   ⚠️ 斷句要走 DOM，不能對 innerHTML 做字串切割：每一段裡面都夾著 <code>、
   <kbd>、<a>、<span data-stat> 這些行內元素，字串切一刀就會切出沒有閉合的標籤。
   這裡逐一走過子節點，只切文字節點，元素整顆搬過去。

   ⚠️ 「。」後面常常還黏著收尾的引號或括號（例：「…見詞組連打。）」），斷在
   句號正後方會把「）」丟到下一段的開頭。所以句號後面連著的收尾標點一起帶走。 */
(function () {
  var ol = document.querySelector('.points');
  if (!ol) return;

  var Q = window.matchMedia('(max-width: 52rem)');
  var RAW = ol.innerHTML;   // 桌面版原封不動的那一份
  var built = false;
  var dots = null;
  var onScroll = null;

  /* 句號後面可以黏著的收尾標點 */
  var TAIL = /^[」』】》〉）〕”’]+/;

  function splitSentences(p) {
    var out = [], cur = [];
    [].slice.call(p.childNodes).forEach(function (n) {
      if (n.nodeType !== 3) { cur.push(n); return; }
      var t = n.nodeValue, i = 0;
      while (i < t.length) {
        var j = t.indexOf('。', i);
        if (j < 0) { cur.push(document.createTextNode(t.slice(i))); break; }
        var end = j + 1;
        var m = TAIL.exec(t.slice(end));
        if (m) end += m[0].length;
        cur.push(document.createTextNode(t.slice(i, end)));
        out.push(cur);
        cur = [];
        i = end;
      }
    });
    if (cur.length) out.push(cur);
    return out.filter(function (nodes) {
      return nodes.some(function (n) { return (n.textContent || '').trim(); });
    });
  }

  function cardIndex() {
    /* 目前停在第幾張：用卡片中心離視窗中心最近的那一張，不用 scrollLeft 除以
       卡寬 —— 卡片有間隔、又有左右內距，除出來會在邊界上跳。 */
    var mid = ol.scrollLeft + ol.clientWidth / 2;
    var best = 0, bestD = Infinity;
    [].forEach.call(ol.children, function (li, i) {
      var d = Math.abs(li.offsetLeft + li.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function paintDots() {
    if (!dots) return;
    var at = cardIndex();
    [].forEach.call(dots.children, function (b, i) {
      b.setAttribute('aria-current', i === at ? 'true' : 'false');
    });
  }

  function build() {
    if (built) return;
    built = true;

    [].forEach.call(ol.querySelectorAll('li > p'), function (p) {
      var parts = splitSentences(p);
      if (parts.length < 2) return;
      var frag = document.createDocumentFragment();
      parts.forEach(function (nodes) {
        var np = document.createElement('p');
        nodes.forEach(function (n) { np.appendChild(n); });
        frag.appendChild(np);
      });
      p.parentNode.replaceChild(frag, p);
    });

    /* 圓點：一來告訴人「後面還有」，二來點得動。⚠️ 一定要有這個提示 ——
       只有一張卡露在畫面上的話，沒有任何線索說明可以滑。 */
    dots = document.createElement('div');
    dots.className = 'points-dots';
    dots.setAttribute('role', 'tablist');
    dots.setAttribute('aria-label', '九大特點');
    [].forEach.call(ol.children, function (li, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', '第 ' + (i + 1) + ' 點');
      b.addEventListener('click', function () {
        ol.scrollTo({ left: li.offsetLeft - ol.offsetLeft, behavior: 'smooth' });
      });
      dots.appendChild(b);
    });
    ol.parentNode.insertBefore(dots, ol.nextSibling);

    var raf = 0;
    onScroll = function () {
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; paintDots(); });
    };
    ol.addEventListener('scroll', onScroll, { passive: true });
    paintDots();

    /* 剛切出來的段落沒經過繁簡轉換 */
    if (window.AiPhaBiSite) window.AiPhaBiSite.localize(ol);
  }

  function drop() {
    if (!built) return;
    built = false;
    if (onScroll) ol.removeEventListener('scroll', onScroll);
    onScroll = null;
    if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
    dots = null;
    ol.innerHTML = RAW;
    if (window.AiPhaBiSite) window.AiPhaBiSite.localize(ol);
  }

  function sync() { Q.matches ? build() : drop(); }
  sync();
  if (Q.addEventListener) Q.addEventListener('change', sync);
  else if (Q.addListener) Q.addListener(sync);
})();
