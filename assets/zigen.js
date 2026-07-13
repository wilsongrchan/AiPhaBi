/* 字根學習引擎 — 兩頁共用。
 *
 *  字根表不再手工填寫，而是從「逐字取碼」學回來：
 *    在某字上把一組筆畫指派給字母 L  →  merge() 把該形狀併入字母 L 之下
 *    （同形自動合併、計次、記錄例字；不同形則新增一條字根）
 *
 *  反過來，累積的字根又餵給 predict()，替未取碼的字提出整字拆解。
 *  兩頁共用 data/zigen.json，任何一邊的改動都會即時影響另一邊。
 *
 *  形狀比對用 Shape.strokeVec（筆畫中線），不用點陣圖：部件在不同字裡會被
 *  壓扁拉長，點陣圖比對分不開（實測同一個「月」距離 0.5，比某些不同字根還遠）；
 *  中線比對實測同字根 0.01–0.17、不同字根 0.49 以上。
 */
(function (global) {
  const SAME_SHAPE = 0.25;      // 形狀距離門檻（落在上述兩群中間）

  const cache = new Map();
  function getGlyph(c) {
    if (!cache.has(c)) cache.set(c, fetch('/api/glyph?c=' + encodeURIComponent(c))
      .then(r => (r.ok ? r.json() : null)));
    return cache.get(c);
  }

  const TIERS = ['primary', 'secondary', 'tertiary'];
  const tierOf = it => it.tier || 'primary';
  const shapesOf = L => L.intentions.map(i => i.shapes);
  const allShapes = z => z.letters.flatMap(L =>
    L.intentions.flatMap(it => it.shapes.map(
      s => ({ letter: L.letter, shape: s, tier: tierOf(it), intention: it }))));

  /* 把字根表算成向量庫；只認 glyph（筆畫式）字根，Unicode 字根沒有筆畫資料 */
  async function buildLibrary(z) {
    const lib = [];
    const srcs = [...new Set(allShapes(z).filter(x => x.shape.glyph)
      .flatMap(x => [x.shape.glyph.src, ...(x.shape.alts || []).map(a => a.src)]))];
    await Promise.all(srcs.map(getGlyph));      /* 一次併發抓完，別逐個 await */
    for (const { letter, shape, tier } of allShapes(z)) {
      if (!shape.glyph) continue;
      /* 合併過的字根有多個變體（alts）：每個變體都要能比對得上 */
      for (const form of [shape.glyph, ...(shape.alts || [])]) {
        const g = await getGlyph(form.src);
        if (!g) continue;
        const med = form.strokes.map(i => g.medians[i]);
        if (med.some(m => !m)) continue;
        const vec = Shape.strokeVec(med);
        if (!vec) continue;
        /* 這個字根自己的定義是連續筆畫，還是「跳筆」（包圍結構的收口筆，
           例：囗＝第 1、2 筆 + 最後一筆）？只有跳筆的字根，才准許在別的字裡
           也用跳筆的方式配對。 */
        const st = [...form.strokes].sort((a, b) => a - b);
        let head = 1;
        while (head < st.length && st[head] === st[head - 1] + 1) head++;
        const gapped = head < st.length;
        lib.push({ letter, shape, vec, tier, n: med.length, gapped,
                   head, tail: st.length - head,
                   label: `${form.src}[${form.strokes.map(i => i + 1).join('')}]` });
      }
    }
    return lib;
  }

  /* 學習：把一個已確認的筆畫組合併入字根表。
     同字母 + 同筆數 + 形狀夠近 → 同一字根（計次、記例字）；否則新增。 */
  function merge(z, lib, seg, thr = z.meta.merge_threshold || SAME_SHAPE) {
    const { letter, char, strokeIdx, vec } = seg;
    const n = strokeIdx.length;
    let best = null;
    for (const e of lib) {
      if (e.letter !== letter || e.n !== n) continue;
      const d = Shape.dist(vec, e.vec);
      if (!best || d < best.d) best = { e, d };
    }
    if (best && best.d < thr) {
      const s = best.e.shape;
      s.count = (s.count || 1) + 1;
      s.seen = [...new Set([...(s.seen || []), char])].slice(0, 24);
      return { merged: true, shape: s, d: best.d };
    }
    const shape = {
      glyph: { src: char, strokes: [...strokeIdx] },
      ex: char, count: 1, seen: [char], learned: true,
    };
    const L = z.letters.find(x => x.letter === letter);
    let bucket = L.intentions.find(i => i.auto && tierOf(i) === 'primary');
    if (!bucket) {
      bucket = { desc: '', auto: true, tier: 'primary', shapes: [] };
      L.intentions.push(bucket);
    }
    bucket.shapes.push(shape);
    lib.push({ letter, shape, vec, tier: 'primary', n,
               label: `${char}[${strokeIdx.map(i => i + 1).join('')}]` });
    return { merged: false, shape };
  }

  /* ================= 整字拆解預測 =================
     候選字根 = 筆順上連續的一段筆畫，或「一段 + 後面補一筆」（包圍結構的收口筆，
     例：囗 = 第 1,2 筆 + 最後一筆）。再搜出成本最低、且覆蓋全部筆畫的拆法。   */
  function candidates(medians, lib, thr, tierPenalty = 0) {
    const n = medians.length, out = [], seen = new Set();

    /* isGapped 的候選只跟 gapped 的字根比、連續的只跟連續的字根比 —— 
       否則「第 1、2、5 筆」這種跳著取的組合，會去配一個本來筆畫相連的字根，
       等於憑空多出一條包圍原則。 */
    const consider = (idx, isGapped) => {
      const key = idx.join(',');
      if (seen.has(key)) return;
      seen.add(key);
      const vec = Shape.strokeVec(idx.map(i => medians[i]));
      if (!vec) return;
      let best = null;
      for (const e of lib) {
        if (e.n !== idx.length || !!e.gapped !== isGapped) continue;
        const d = Shape.dist(vec, e.vec);
        if (d >= thr) continue;
        /* 優次等原則：同樣配得上，優等的成本較低 */
        const cost = d + tierPenalty * TIERS.indexOf(e.tier || 'primary');
        if (!best || cost < best.cost)
          best = { d, cost, letter: e.letter, label: e.label, tier: e.tier || 'primary' };
      }
      if (best)
        out.push({ idx, mask: idx.reduce((m, i) => m | (1 << i), 0), gapped: isGapped, ...best });
    };

    /* 連續的一段筆畫 */
    const plain = [...new Set(lib.filter(e => !e.gapped).map(e => e.n))]
      .filter(k => k > 0 && k <= n);
    for (const k of plain)
      for (let i = 0; i + k <= n; i++) consider([...Array(k)].map((_, j) => i + j), false);

    /* 跳筆：照該字根自己的頭尾結構（前 head 筆連續，之後再補 tail 筆）*/
    const shapes = [...new Set(lib.filter(e => e.gapped).map(e => `${e.head},${e.tail}`))];
    for (const sig of shapes) {
      const [head, tail] = sig.split(',').map(Number);
      for (let i = 0; i + head <= n; i++) {
        const run = [...Array(head)].map((_, j) => i + j);
        for (let j = i + head; j + tail <= n; j++) {
          const rest = [...Array(tail)].map((_, k) => j + k);
          consider([...run, ...rest], true);
        }
      }
    }
    return out.sort((a, b) => (a.cost ?? a.d) - (b.cost ?? b.d));
  }

  /* 一筆的走向：橫、豎，或其他（撇、捺、折…）。孤筆略過原則只放行橫與豎。 */
  function strokeKind(m) {
    if (!m || m.length < 2) return '點';
    const [x0, y0] = m[0], [x1, y1] = m[m.length - 1];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    /* 折筆（如「𠃍」）起訖點會像橫，用折線總長與直線距離的比值排除 */
    let path = 0;
    for (let i = 1; i < m.length; i++) path += Math.hypot(m[i][0] - m[i-1][0], m[i][1] - m[i-1][1]);
    const straight = Math.hypot(x1 - x0, y1 - y0);
    if (straight < 1 || path / straight > 1.35) return '折';
    if (dx > dy * 3) return '橫';
    if (dy > dx * 3) return '豎';
    return '斜';
  }

  function predict(medians, lib, opts = {}) {
    const thr = opts.thr || SAME_SHAPE;
    const segPenalty = opts.segPenalty ?? 0.05;   /* 「能合不分」：字根愈少愈好 */
    const skip = opts.skip || null;               /* 孤筆略過原則：{penalty, allow:['橫','豎']} */
    const tierPenalty = opts.tierPenalty ?? 0;   /* 優次等原則 */
    const maxNodes = opts.maxNodes || 60000;
    const n = medians.length;
    if (!lib.length || !n) return [];
    const cand = candidates(medians, lib, thr, tierPenalty);
    if (!cand.length) return [];
    const FULL = n === 31 ? 0x7fffffff : (1 << n) - 1;

    const byLowest = Array.from({ length: n }, () => []);
    for (const c of cand) byLowest[c.idx[0]].push(c);

    /* 孤筆略過原則：讓落單的橫／豎可以不被任何字根覆蓋，代價是一點成本。
       例外：最後一筆若是孤立的橫，不略過，取指定的字母（lastLetter，預設「I」）。 */
    if (skip) medians.forEach((m, i) => {
      const kind = strokeKind(m);
      if (!skip.allow.includes(kind)) return;
      if (kind === '橫' && i === n - 1 && skip.lastLetter) {
        byLowest[i].push({ idx: [i], mask: 1 << i, d: skip.penalty,
                           letter: skip.lastLetter.toUpperCase(),
                           label: `末筆橫 → ${skip.lastLetter.toUpperCase()}` });
        return;
      }
      byLowest[i].push({ idx: [i], mask: 1 << i, d: skip.penalty, skip: true,
                         letter: '', label: `略過（${kind}）` });
    });

    const results = [], visited = new Map();
    let heap = [{ mask: 0, cost: 0, segs: [] }], nodes = 0;
    while (heap.length && nodes < maxNodes && results.length < 3) {
      heap.sort((a, b) => a.cost - b.cost);
      const cur = heap.shift();
      nodes++;
      if (cur.mask === FULL) { results.push(cur); continue; }
      const prev = visited.get(cur.mask);
      if (prev !== undefined && prev <= cur.cost + 1e-9) continue;
      visited.set(cur.mask, cur.cost);

      let low = 0;
      while (cur.mask & (1 << low)) low++;          /* 最低的未覆蓋筆畫 */
      for (const c of byLowest[low]) {
        if (cur.mask & c.mask) continue;
        heap.push({ mask: cur.mask | c.mask,
                    cost: cur.cost + (c.cost ?? c.d) + segPenalty,
                    segs: [...cur.segs, c] });
      }
      if (heap.length > 5000) heap = heap.slice(0, 2500);
    }
    const fmt = (all, cost) => {
      const segs = all.filter(s => !s.skip);
      const skipped = all.filter(s => s.skip).flatMap(s => s.idx);
      return {
        cost, skipped,
        covered: all.reduce((k, s) => k + s.idx.length, 0),
        total: n,
        /* 筆順原則：按各字根的首筆先後排序 */
        segments: [...segs].sort((a, b) => a.idx[0] - b.idx[0])
          .map(s => ({ strokes: s.idx, letter: s.letter, label: s.label, d: s.d, tier: s.tier })),
      };
    };
    if (results.length) return results.map(r => fmt(r.segs, r.cost));

    /* 蓋不滿全字時（字根表還小，這是常態）給出最好的「部分拆解」：
       貪心取互不重疊、最相似的字根，其餘筆畫留給使用者指派。 */
    const taken = [];
    let mask = 0, cost = 0;
    for (const c of cand) {
      if (mask & c.mask) continue;
      mask |= c.mask; taken.push(c); cost += c.cost ?? c.d;
    }
    if (!taken.length) return [];
    return [fmt(taken, cost)];
  }

  /* 碼長上限：超過就取前 head 碼 + 後 tail 碼（例：QFJJQXLQ → QFJQ）。
     完整碼仍保留在資料裡，但打字、統計、重碼都以縮短後的碼為準。 */
  function shorten(code, rule) {
    const max = rule?.params?.max ?? 4;
    const head = rule?.params?.head ?? 3;
    const tail = rule?.params?.tail ?? 1;
    if (!code || code.length <= max) return code;
    return code.slice(0, head) + (tail ? code.slice(-tail) : '');
  }

  global.Zigen = { SAME_SHAPE, TIERS, tierOf, getGlyph, allShapes, shapesOf, buildLibrary,
                   merge, predict, strokeKind, shorten };
})(window);
