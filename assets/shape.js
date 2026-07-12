/* 形狀比對 — 供「字根表」手寫辨認與「逐字取碼」字根建議共用。
   把任何墨跡（手寫筆跡／字形／筆畫子集）正規化成一個模糊化的向量，
   再以歐氏距離比對。保留長寬比，所以「一」與「丨」不會混同。       */
(function (global) {
  const GRID = 16, N = 64;
  /* makemeahanzi 的路徑在 y 向上的 1024 em 方格內 */
  const SVG_TF = 'scale(1,-1) translate(0,-900)';

  /* 部件在不同字裡會被壓扁、拉長（明裡的「月」比朋裡的窄），所以把墨跡的
     外框「撐滿」正方形再比對，形狀本身才是主角；長寬比另外用少量維度表示，
     好讓「一」與「丨」仍然分得開。縮放交給 canvas 內插，避免點取樣造成的鋸齒
     ——那正是同一個「月」曾經算出 0.54 距離的原因。 */
  const ASPECT_W = 0.35;

  function featurize(img) {
    const { data: px, width: W, height: H } = img;
    const a = (x, y) => px[(y * W + x) * 4 + 3];
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (a(x, y) > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;

    /* 把 bbox 內的墨跡等比拉伸填滿 N×N（有內插） */
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    src.getContext('2d').putImageData(img, 0, 0);
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    const pad = 3;
    c.drawImage(src, x0, y0, w, h, pad, pad, N - pad * 2, N - pad * 2);

    const d = c.getImageData(0, 0, N, N).data;
    const buf = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) buf[i] = d[i * 4 + 3] / 255;
    blur(buf); blur(buf);

    const cell = N / GRID, vec = new Float32Array(GRID * GRID + 2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      vec[((y / cell) | 0) * GRID + ((x / cell) | 0)] += buf[y * N + x];
    let n = 0; for (let i = 0; i < GRID * GRID; i++) n += vec[i] * vec[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < GRID * GRID; i++) vec[i] /= n;

    /* 長寬比：把 log(w/h) 壓進 [-1,1]，權重小但足以分開「一」與「丨」 */
    const ar = Math.max(-1, Math.min(1, Math.log(w / h) / Math.log(8)));
    vec[GRID * GRID] = ar * ASPECT_W;
    vec[GRID * GRID + 1] = (1 - Math.abs(ar)) * ASPECT_W;
    return vec;
  }

  function blur(b) {
    const o = Float32Array.from(b);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < N && xx >= 0 && xx < N) { s += o[yy * N + xx]; c++; }
      }
      b[y * N + x] = s / c;
    }
  }

  const dist = (a, b) => {
    let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return s;
  };

  const scratch = () => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    return cv.getContext('2d', { willReadFrequently: true });
  };

  /* 從字型算出某 Unicode 字形的向量（字型沒有的字回傳 null） */
  function fromChar(ch, ctx = scratch()) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#000';
    ctx.font = '96px "PingFang TC","Songti TC","Heiti TC",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, 64, 64);
    return featurize(ctx.getImageData(0, 0, 128, 128));
  }

  /* 從 makemeahanzi 的 SVG 路徑（筆畫子集）算出向量 */
  function fromPaths(paths, ctx = scratch()) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.save();
    ctx.scale(128 / 1024, 128 / 1024);
    ctx.transform(1, 0, 0, -1, 0, 900);      /* 與 SVG_TF 相同的 y 翻轉 */
    ctx.fillStyle = '#000';
    for (const d of paths) ctx.fill(new Path2D(d));
    ctx.restore();
    return featurize(ctx.getImageData(0, 0, 128, 128));
  }

  /* 只有一個字形，用來判斷字型是否缺字（缺字會畫成豆腐框） */
  function tofuVec(ctx = scratch()) { return fromChar('\u{10FFFF}', ctx); }

  const topMatches = (vec, lib, n = 5) => lib
    .map(e => ({ ...e, d: dist(vec, e.vec) }))
    .sort((a, b) => a.d - b.d).slice(0, n);

  /* ============ 字根比對：用筆畫中線，不用點陣圖 ============
     一個部件在不同字裡會被壓扁拉長，點陣圖比對因此很不穩（同一個「月」曾算出
     0.5 以上的距離）。改用每一筆的中線：把整組筆畫的外框正規化成單位方格，
     每一筆取起點、四分點、中點、四分之三點、終點，串成向量。筆順是固定的，
     所以兩組同筆數的字根可以逐筆對齊比較。                                   */
  const SAMPLES = [0, 0.25, 0.5, 0.75, 1];

  function resample(median, t) {
    if (median.length === 1) return median[0];
    const seg = [];
    let total = 0;
    for (let i = 1; i < median.length; i++) {
      const dx = median[i][0] - median[i - 1][0], dy = median[i][1] - median[i - 1][1];
      const len = Math.hypot(dx, dy);
      seg.push(len); total += len;
    }
    if (!total) return median[0];
    let want = t * total;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i] || i === seg.length - 1) {
        const f = seg[i] ? want / seg[i] : 0;
        return [median[i][0] + (median[i + 1][0] - median[i][0]) * f,
                median[i][1] + (median[i + 1][1] - median[i][1]) * f];
      }
      want -= seg[i];
    }
    return median[median.length - 1];
  }

  /* medians: 該字根所含各筆的中線（依筆順）。回傳的向量只能與同筆數者比較。 */
  function strokeVec(medians) {
    if (!medians.length) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const m of medians) for (const [x, y] of m) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
    /* 單筆的「一」「丨」沒有面積，用較長邊當基準免得除以零把形狀炸開 */
    const sx = Math.max(w, h * 0.08), sy = Math.max(h, w * 0.08);
    const vec = [];
    for (const m of medians) for (const t of SAMPLES) {
      const [x, y] = resample(m, t);
      vec.push((x - x0) / sx, (y - y0) / sy);
    }
    const ar = Math.max(-1, Math.min(1, Math.log(w / h) / Math.log(8)));
    vec.push(ar * 0.6);
    const v = Float32Array.from(vec);
    /* 除以筆數，讓距離不隨字根大小膨脹 */
    const k = Math.sqrt(medians.length);
    for (let i = 0; i < v.length; i++) v[i] /= k;
    return v;
  }

  global.Shape = { GRID, SVG_TF, featurize, dist, scratch, fromChar, fromPaths, tofuVec,
                   topMatches, strokeVec };
})(window);
