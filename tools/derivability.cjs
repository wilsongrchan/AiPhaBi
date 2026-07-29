/* 可學習度 / 取碼可推導度量測 —— 直接跑真正的預測器（Shape 中線比對 + 幾何搜尋 +
 * componentPredict 部件套用），用 graphics.txt 的中線餵進去，對「第 51–2000 常用字」
 * 逐字預測整碼、跟人手取的碼比對。改了字根表／加了碼之後可重跑，看系統變得更好拆還是更差拆。
 *
 *   用法：node tools/derivability.cjs
 *
 * 已知 componentPredict 的短碼弱點（待補，都是預測器還沒吃到的原則）：
 *   1. 偏旁另有取法：套用部件時用了「單獨成字」的碼，沒改用約定表的 compCode
 *      （江 沿用 工=IJI，應為偏旁碼 I → 應得 EI 卻得 EIJI）。
 *   2. 孤筆略過（首末除外）：補缺口的幾何預測把缺口當獨立一段，中途的孤立橫／豎
 *      被當成首／末筆取碼，沒有略過（同 = UO，卻得 UIO）。
 *   3. 能合不分：部件套用會用子部件把一個整字根拆散（各 的 夂 配到「又」，撇被切出來 → JXO）。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'data'), A = path.join(ROOT, 'assets');
const rd = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const codes = rd('codes.json'), zigen = rd('zigen.json'), rules = rd('rules.json'), learned = rd('learned.json');
const G = {};
for (const line of fs.readFileSync(path.join(D, 'graphics.txt'), 'utf8').split('\n'))
  if (line.trim()) { const g = JSON.parse(line); G[g.character] = { medians: g.medians, strokes: g.strokes }; }
const ids = {};
for (const line of fs.readFileSync(path.join(D, 'dictionary.txt'), 'utf8').split('\n'))
  if (line.trim()) { const d = JSON.parse(line); ids[d.character] = d.decomposition || ''; }

/* 在沙箱裡載入瀏覽器端的 shape.js / zigen.js（strokeVec/dist/predict 都是純數學，不碰畫布）*/
const sb = {}; sb.window = sb; sb.console = console; sb.document = { createElement: () => { throw new Error('nocanvas'); } };
sb.encodeURIComponent = encodeURIComponent; sb.decodeURIComponent = decodeURIComponent;
sb.fetch = url => { const c = decodeURIComponent(url.split('c=')[1]), g = G[c];
  return Promise.resolve({ ok: !!g, json: () => Promise.resolve(g ? { medians: g.medians, strokes: g.strokes } : null) }); };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(A, 'shape.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(A, 'zigen.js'), 'utf8'), sb);
const Shape = sb.Shape, Zigen = sb.Zigen;

const IDS_OPS = '⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻', STROKEISH = new Set([...'丶一丨丿乀乁乚亅㇏丷丶']);
function partsOf(ch, depth = 4, seen = new Set()) {
  const d = ids[ch]; if (!d || depth <= 0) return []; const out = [];
  for (const c of d) { if (IDS_OPS.includes(c) || c === ch || seen.has(c)) continue;
    if (!/[㐀-鿿]/.test(c) || STROKEISH.has(c)) continue; seen.add(c); out.push(c);
    const coded = codes[c] && codes[c].segments && codes[c].segments.length;
    if (!coded) for (const sub of partsOf(c, depth - 1, seen)) out.push(sub); }
  return out;
}
const convOf = ch => { const r = rules.rules.find(x => x.id === 'convention' && x.enabled); if (!r || !r.groups) return null;
  for (const g of r.groups) for (const row of g.chars || []) if (row.c === ch && row.code) return { ...row }; return null; };
const rule = id => { const r = rules.rules.find(x => x.id === id); return r && r.enabled && r.kind === 'enforced' ? r : null; };
const _med = new Map(); for (const ch of Object.keys(codes)) if (G[ch]) _med.set(ch, G[ch].medians);
const glyphCacheMedians = (src, i) => { const g = _med.get(src); return g ? g[i] : null; };
const kindOf = m => Zigen.strokeKind(m, learned.stroke_kinds);
let compIndex = null;
function buildComponentIndex() { const byLen = new Map();
  for (const [ch, rec] of Object.entries(codes)) { if (!rec.segments || !rec.segments.length || rec.notComponent || rec.splits) continue;
    const g = _med.get(ch); if (!g) continue; const n = g.length; if (n < 2 || n > 14) continue;
    const vec = Shape.strokeVec(g); if (!vec) continue; if (!byLen.has(n)) byLen.set(n, []);
    const cv = convOf(ch), asComp = cv && cv.compCode ? cv.compCode : null;
    byLen.get(n).push({ ch, vec, segs: rec.segments, skipped: rec.skipped || [],
      code: asComp || rec.code || rec.segments.map(s => s.letter).join(''), convComp: !!asComp }); }
  compIndex = byLen;
}
function componentPredict(CH, MED, restSet) {
  if (!ids[CH] || !MED || !MED.length || !compIndex) return null;
  const struct = new Set(partsOf(CH, 4)); if (!struct.size) return null;
  const n = MED.length, excluded = new Set((codes[CH] && codes[CH].excludeComp) || []), sk = rule('skip_isolated_hv');
  const lastLetters = sk ? (sk.params.last_stroke_letters || (sk.params.last_stroke_letter ? { '橫': sk.params.last_stroke_letter } : {})) : {};
  const expected = (c, atEnd) => { if (atEnd || c.convComp || !c.segs || !c.segs.length || !sk) return c.code;
    const tail = c.segs[c.segs.length - 1], tn = Math.max(...c.segs.flatMap(s => s.strokes), ...(c.skipped || [])) + 1;
    const tailMed = glyphCacheMedians(c.ch, tn - 1), tailKind = tailMed ? kindOf(tailMed) : null;
    const isLast = tail.strokes.length === 1 && tail.strokes[0] === tn - 1 && tailKind != null && lastLetters[tailKind] === tail.letter;
    return isLast ? c.code.slice(0, -1) : c.code; };
  const used = [], chosen = [], sizes = [...compIndex.keys()].filter(k => k <= n).sort((a, b) => b - a);
  for (const k of sizes) { const list = compIndex.get(k);
    for (let i = 0; i + k <= n; i++) { const idx = [...Array(k)].map((_, j) => i + j);
      if (used.some(r => idx.some(x => r.includes(x)))) continue; if (restSet && idx.some(x => !restSet.has(x))) continue;
      const v = Shape.strokeVec(idx.map(x => MED[x])); if (!v) continue;
      const hit = list.filter(c => c.ch !== CH && !excluded.has(c.ch) && struct.has(c.ch))
        .map(c => ({ c, d: Shape.dist(v, c.vec) })).filter(x => x.d < 0.15).sort((a, b) => a.d - b.d)[0];
      if (!hit) continue; chosen.push({ i, c: hit.c, want: expected(hit.c, idx[idx.length - 1] === n - 1) }); used.push(idx); } }
  if (!chosen.length) return null; const segments = [], skippedOut = [];
  for (const { i, c, want } of chosen) { const dropTail = want !== c.code;
    c.segs.forEach((sg, si) => { if (dropTail && si === c.segs.length - 1) { skippedOut.push(...sg.strokes.map(x => i + x)); return; }
      segments.push({ letter: sg.letter, strokes: sg.strokes.map(x => i + x) }); });
    skippedOut.push(...(c.skipped || []).map(x => i + x)); }
  segments.sort((a, b) => Math.min(...a.strokes) - Math.min(...b.strokes));
  return { segments, skipped: [...new Set(skippedOut)].sort((a, b) => a - b), parts: chosen.map(x => x.c.ch) };
}
const merge = rule('merge_over_split'), sk = rule('skip_isolated_hv'), tp = rule('tier_priority');
const popts = { thr: zigen.meta.merge_threshold || Zigen.SAME_SHAPE, segPenalty: merge ? merge.params.seg_penalty : 0.05,
  skip: sk ? { penalty: sk.params.penalty, allow: sk.params.allow, learned: learned.stroke_kinds,
    lastLetters: sk.params.last_stroke_letters || (sk.params.last_stroke_letter ? { '橫': sk.params.last_stroke_letter } : {}) } : null,
  tierPenalty: tp ? (tp.params?.penalty ?? 0.05) : 0 };
const maxRule = rule('max_code_length');
function fullPredict(ch) { const MED = G[ch] && G[ch].medians; if (!MED || !MED.length) return null;
  const rest = MED.map((_, i) => i), cp = componentPredict(ch, MED, new Set(rest)); let segments = [], skipped = [];
  if (cp && cp.segments.length) { segments = cp.segments; skipped = cp.skipped;
    const covd = new Set([...segments.flatMap(s => s.strokes), ...skipped]), gap = rest.filter(i => !covd.has(i));
    if (gap.length) { const graw = Zigen.predict(gap.map(i => MED[i]), lib, popts);
      if (graw.length) { segments = [...segments, ...graw[0].segments.map(sg => ({ letter: sg.letter, strokes: sg.strokes.map(k => gap[k]) }))];
        skipped = [...skipped, ...(graw[0].skipped || []).map(k => gap[k])]; } } }
  else { const graw = Zigen.predict(MED, lib, popts); if (!graw.length) return null; segments = graw[0].segments; skipped = graw[0].skipped || []; }
  if (segments.reduce((s, sg) => s + sg.strokes.length, 0) + skipped.length < MED.length) return { partial: true };
  const full = [...segments].sort((a, b) => Math.min(...a.strokes) - Math.min(...b.strokes)).map(s => s.letter).join('');
  return { code: Zigen.shorten(full, maxRule) };
}
const lev = (a, b) => { const m = a.length, n = b.length, d = [...Array(m + 1)].map(() => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i; for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
  return d[m][n]; };
let lib;
(async () => {
  lib = await Zigen.buildLibrary(zigen); buildComponentIndex();
  const items = Object.keys(codes).filter(k => k.length === 1 && codes[k] && codes[k].final);
  const pool = items.slice(50, 2000); let tot = 0, cov = 0, exact = 0, w1 = 0; const byL = {};
  for (const ch of pool) { tot++; if (!G[ch]) continue; const r = fullPredict(ch);
    if (!r || r.partial || !r.code) continue; cov++; const act = codes[ch].final, L = act.length;
    byL[L] = byL[L] || [0, 0]; byL[L][1]++; if (r.code === act) { exact++; w1++; byL[L][0]++; } else if (lev(r.code, act) <= 1) w1++; }
  console.log(`pool (chars 51-2000): ${tot}`);
  console.log(`predictable (full code): ${cov}/${tot} = ${(100 * cov / tot).toFixed(0)}%`);
  console.log(`EXACT:    ${exact}/${cov} = ${(100 * exact / cov).toFixed(1)}%`);
  console.log(`within-1: ${w1}/${cov} = ${(100 * w1 / cov).toFixed(1)}%`);
  console.log('exact by code length:');
  for (const L of Object.keys(byL).sort()) console.log(`  ${L}-字根: ${byL[L][0]}/${byL[L][1]} = ${(100 * byL[L][0] / byL[L][1]).toFixed(0)}%`);
})();
