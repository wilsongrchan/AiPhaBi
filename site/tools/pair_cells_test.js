/* 兩字詞那三格的單元測試：node site/tools/pair_cells_test.js
 *
 * 測的是 try.js 的 drawPair／doneColours／flipFrom —— 主格子上面那一排小格：
 * 右上角是等一下要打的字（黑的），打完前一個字它放大成主格子、剛打完的縮到
 * 左上角並留著顏色。跟 si4_cells_test.js 同一個理由用切原始碼的方式測：試打頁
 * 要抓 3MB 詞庫，無頭瀏覽器在這台機器上會卡住不回來（見
 * memory/verify-against-shipped-artifacts）。
 *
 * ⚠️ 切的是 try.js 本尊，不是抄一份（見 cut_fn.js）。
 */
const cut = require('./cut_fn').loadTry(process.argv[2]);

/* ── 替身 ───────────────────────────────────────────────────────────── */
const GRID = '<grid/>', SVG_TF = 'tf';
// 量到的位置：主格子在下面、比較大；右上角那一小格在右上、比較小。
// flipFrom 只吃 left/top/width，所以這三個值就夠。
const RECT = {
  '.tz-pmain': { left: 0, top: 60, width: 200 },
  '.tz-pnext': { left: 146, top: 0, width: 54 },
  '.tz-ppast': { left: 0, top: 0, width: 54 },
};

function fakeNode(cls) {
  return {
    cls, innerHTML: '', style: {}, attrs: {}, offsetWidth: 0,
    setAttribute(k, v) { this.attrs[k] = v; },
    getBoundingClientRect() {
      for (const c of cls.split(/\s+/)) if (RECT['.' + c]) return RECT['.' + c];
      return { left: 0, top: 0, width: 0 };
    },
  };
}
function fakeCell() {
  let nodes = {}, html = '';
  return {
    set innerHTML(h) {
      html = h; nodes = {};
      for (const m of h.matchAll(/class="([^"]+)"/g)) {
        const n = fakeNode(m[1]);
        for (const c of m[1].split(/\s+/)) nodes['.' + c] = n;
      }
    },
    get innerHTML() { return html; },
    querySelector(sel) { return nodes[sel] || null; },
  };
}

// 白 = J A(兩筆) X（主碼 jax）；日 = B X（主碼 bx）；為 有簡碼 il（頭一碼＋末一碼）
const SEGS = {
  白: [{ L: 'J', st: [0] }, { L: 'A', st: [1, 2] }, { L: 'X', st: [3] }],
  日: [{ L: 'B', st: [0] }, { L: 'X', st: [1] }],
  為: [{ L: 'I', st: [0] }, { L: 'V', st: [1] }, { L: 'T', st: [2] },
       { L: 'D', st: [3] }, { L: 'L', st: [4] }],
  教: [{ L: 'T', st: [0, 1] }, { L: 'X', st: [2] }, { L: 'P', st: [3] }, { L: 'X', st: [4] }],
};
// 教 的兼容碼 FJPX 是**另一套**分段：F 併掉頭三筆，J 只有第四筆
const ALTS = {
  教: [[{ L: 'F', st: [0, 1, 2] }, { L: 'J', st: [3] }, { L: 'P', st: [4] }]],
};
const SHORT = { 為: { code: 'il', order: [0, 4] } };

function segsOf(ch) { return SEGS[ch] || null; }
function shortPlan(ch) { return SHORT[ch] || null; }
function pathsOf(ch) {
  const out = [];
  if (SEGS[ch]) out.push({ segs: SEGS[ch], isMain: true });
  for (const a of ALTS[ch] || []) out.push({ segs: a, isMain: false });
  return out;
}
let MAIN_COLOURS = { 0: 0 };
function strokeColours() { return MAIN_COLOURS; }

const window = { matchMedia: () => ({ matches: false }) };
const P = { unit: '', uix: 0, ucodes: [], glyphs: {}, cell: fakeCell(), pshown: null };
// 假筆畫：一個字幾筆要跟它的分段對得起來，不然「哪幾筆上了色」就測不準
const NSTROKE = { 白: 4, 日: 2, 為: 5, 教: 5 };
for (const ch of Object.keys(SEGS)) {
  P.glyphs[ch] = Array.from({ length: NSTROKE[ch] }, (_, i) => ch + i);
}

eval(cut('codeOfSegs'));
eval(cut('paintGlyph'));
eval(cut('doneColours'));
eval(cut('flipFrom'));
eval(cut('reduceMotion'));
eval(cut('drawPair'));

/* ── 讀畫面 ─────────────────────────────────────────────────────────── */
function slot(sel) {
  const n = P.cell.querySelector(sel);
  return {
    hidden: /is-blank/.test(n.cls),
    label: (n.innerHTML.match(/aria-label="([^"]*)"/) || [, ''])[1],
    // 每一筆的 class，照筆順：tz-ink 是黑的，tz-zN 是第 N 條字根的顏色
    strokes: [...n.innerHTML.matchAll(/<path class="(tz-[^"]+)"/g)].map(m => m[1].slice(3)),
    aria: n.attrs['aria-hidden'] || null,
    moved: !!n.style.transition,
  };
}
function draw(unit, uix, ucodes) {
  P.unit = unit; P.uix = uix; P.ucodes = ucodes || [];
  drawPair();
  return { past: slot('.tz-ppast'), next: slot('.tz-pnext'), main: slot('.tz-pmain') };
}

let fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want), ok = g === w;
  if (!ok) fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label);
  if (!ok) console.log('        got  ' + g + '\n        want ' + w);
}

/* ── 1. 還在打第一個字：右上角有下一個字，左上角空著 ───────────────── */
P.pshown = null;
MAIN_COLOURS = { 0: 0 };
let v = draw('白日', 0);
check('左上角空著（佔位但看不見）', [v.past.hidden, v.past.aria], [true, 'true']);
check('右上角是「日」，整個黑的', [v.next.label, v.next.strokes], ['日', ['ink', 'ink']]);
check('主格子是「白」，照打到哪上色', [v.main.label, v.main.strokes.slice(0, 4)],
      ['白', ['z0', 'ink', 'ink', 'ink']]);
check('第一格不做動畫', [v.past.moved, v.main.moved], [false, false]);

/* ── 2. 打完第一個字：縮到左上角、顏色留著；右上角那格放大成主格子 ─── */
MAIN_COLOURS = { 0: 0 };
v = draw('白日', 1, ['jax']);
check('左上角是打完的「白」，整個字上色', [v.past.label, v.past.strokes],
      ['白', ['z0', 'z1', 'z1', 'z2']]);
check('右上角空掉', [v.next.hidden, v.next.aria], [true, 'true']);
check('主格子換成「日」', [v.main.label, v.main.strokes], ['日', ['z0', 'ink']]);
check('兩格都動了（FLIP）', [v.past.moved, v.main.moved], [true, true]);
check('動完 transform 放掉，停在自己的位置上',
      [P.cell.querySelector('.tz-ppast').style.transform,
       P.cell.querySelector('.tz-pmain').style.transform], ['', '']);

/* ── 2b. 同一個字再畫一次：小格原封不動 ────────────────────────────────
   一次按鍵會走到 renderCell 好幾趟（setBuf 裡 render／renderPractice／renderCell
   各一）。整塊重建會把上一趟才剛開始跑的縮放動畫砍掉，看起來就是沒有動畫。 */
const nodeA = P.cell.querySelector('.tz-ppast');
MAIN_COLOURS = { 0: 0, 1: 1 };
const again = draw('白日', 1, ['jax']);
check('小格是同一個節點，動畫沒被砍掉',
      [P.cell.querySelector('.tz-ppast') === nodeA, again.past.moved], [true, true]);
check('主格子照新的進度重上色', again.main.strokes, ['z0', 'z1']);

/* ── 3. 換一個詞：沒有可以動過去的東西，直接畫定格 ─────────────────── */
v = draw('教授', 0);
check('換詞不做動畫', [v.past.moved, v.main.moved], [false, false]);
// 退格退回第一個字也一樣（uix 往回走）
v = draw('白日', 1, ['jax']);
v = draw('白日', 0);
check('退格回第一個字不做動畫', [v.past.moved, v.main.moved], [false, false]);

/* ── 4. 上色照**當初實際吃掉的那條碼**算，不是一律照主碼 ───────────── */
check('簡碼過關：只亮簡碼用到的那兩條', doneColours('為', 'il'), { 0: 0, 4: 4 });
check('兼容碼過關：照兼容碼那一套分段', doneColours('教', 'fjp'), { 0: 0, 1: 0, 2: 0, 3: 1, 4: 2 });
check('主碼過關：整個字亮', doneColours('教', 'txpx'), { 0: 0, 1: 0, 2: 1, 3: 2, 4: 3 });
check('對不上任何一條（例：三簡碼）就退回主碼整字亮',
      doneColours('教', 'txx'), { 0: 0, 1: 0, 2: 1, 3: 2, 4: 3 });
check('沒有字根分段的字：不上色，不是畫一半', doneColours('〇', 'ab'), null);

/* ── 5. 系統設了「減少動態效果」就不動 ─────────────────────────────── */
window.matchMedia = () => ({ matches: true });
draw('白日', 0);
v = draw('白日', 1, ['jax']);
check('prefers-reduced-motion 直接畫定格', [v.past.moved, v.main.moved], [false, false]);
window.matchMedia = () => ({ matches: false });

process.exit(fail ? 1 : 0);
