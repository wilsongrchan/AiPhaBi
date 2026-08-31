/* 自動上屏（唯一上屏＋即時頂）的單元測試：node site/tools/autocommit_test.js
 *
 * 測的是 try.js 的 autoType／codeAlive／firstComplete —— 從 try.js 本尊切出來跑
 * （見 cut_fn.js）。行為要跟 rime/lua/aiphabi_autocommit.lua 對得起來：
 *   唯一上屏 —— 收下這一鍵之後只剩一個候選，而且那個候選的碼本身打完了 → 出字
 *   即時頂   —— 這一鍵會把碼打死 → 先把候選欄第一個「打完了」的頂上屏，
 *               這一鍵重新當下一個字的開頭
 */
const cut = require('./cut_fn').loadTry(process.argv[2]);

/* ── 假碼表 ─────────────────────────────────────────────────────────────
   yt 午 / yta 某   —— 打 yt 時「午」打中了，但「某」還在後面排隊 → 不上屏
   zz 嗎            —— 打 z 只有補全（沒打完），打到 zz 才只剩一個且打完
   pp 開 / ppin 闞  —— 即時頂的主角：打 pp 之後按一個接不下去的鍵就頂
   iz 這（約定簡碼，不是任何真碼的前綴）—— 簡碼開著時 z 不算把碼打死       */
const CODES = { yt: ['午'], yta: ['某'], zz: ['嗎'], pp: ['開'], ppin: ['闞'] };
const SHORT = { iz: '這' };
const S3 = { ytx: ['某'] };
const KEYS = Object.keys(CODES).sort();
const WILD = '`';
let SHORT_ON = true, SHORT3_ON = false, AUTO_ON = true;

const state = { data: { keys: KEYS, short: SHORT, short3: S3 }, buf: '', cands: [] };
// codeAlive 的排序快取（try.js 那邊是 module 內的 var）。每次改開關都要清掉，
// 不然「簡碼關著」那幾條會吃到上一輪建好的表。
let _alive = { short: null, short3: null };
let committed = [];

function lookup(buf) {
  const out = [];
  if (!buf) return out;
  if (SHORT_ON && SHORT[buf]) out.push({ ch: SHORT[buf], exact: true });
  for (const c of CODES[buf] || []) out.push({ ch: c, exact: true });
  for (const k of KEYS) {
    if (k !== buf && k.indexOf(buf) === 0) for (const c of CODES[k]) out.push({ ch: c, exact: false });
  }
  return out;
}
function setBuf(b) { state.buf = b; state.cands = lookup(b); }
function commit(t) { committed.push(t); state.buf = ''; state.cands = []; }

eval(cut('lowerBound'));
eval(cut('prefixRange'));
eval(cut('firstComplete'));
eval(cut('codeAlive'));
// autoType 從 a06f28d 起會呼叫 hasLongerCode（唯一上屏：碼還能接出更長的字就先別收）
eval(cut('hasLongerCode'));
eval(cut('autoType'));

/* 打一串字母進去，回傳 [上屏了什麼, 還留在碼欄裡的碼] */
function type(str) {
  committed = []; setBuf(''); _alive = { short: null, short3: null };
  for (const k of str) if (!autoType(k)) setBuf(state.buf + k);
  return [committed.join(''), state.buf];
}

let fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want), ok = g === w;
  if (!ok) fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label);
  if (!ok) console.log('        got  ' + g + '\n        want ' + w);
}

console.log('唯一上屏');
check('zz：只剩一個而且打完了 → 出字', type('zz'), ['嗎', '']);
check('z：只有補全，沒打完 → 不出字', type('z'), ['', 'z']);
check('yt：午打中了，但某還排隊 → 不出字', type('yt'), ['', 'yt']);
check('yta：某打完、只剩它 → 出字', type('yta'), ['某', '']);

console.log('即時頂');
check('ppz：z 把碼打死 → 開先上屏，z 重新起頭', type('ppz'), ['開', 'z']);
check('ppin：還接得上闞 → 不頂，打完就唯一上屏', type('ppin'), ['闞', '']);
check('zx：候選裡沒有打完的可頂 → 不頂，碼留著', type('zx'), ['', 'zx']);
check('頂完那一鍵照樣能再唯一上屏', type('ppzz'), ['開嗎', '']);

console.log('約定簡碼不可以被即時頂打斷（IME 那邊 fd8649f 補上同一批表）');
check('簡碼開著：iz 打得出「這」', type('iz'), ['這', '']);
SHORT_ON = false;
check('簡碼關著：iz 的 z 就是死路，i 也頂不出東西', type('iz'), ['', 'iz']);
SHORT_ON = true;

console.log('三簡碼');
check('三簡碼關著：ytx 的 x 是死路 → 午先上屏', type('ytx'), ['午', 'x']);
SHORT3_ON = true;
check('三簡碼開著：ytx 接得上，不頂', type('ytx'), ['', 'ytx']);
SHORT3_ON = false;

/* ── flowState：碼打完之後，接下來會自己上屏還是得按空白 ─────────────────
   跟著打＋單字上屏才有。判斷靠的是「文章接下來那個字的第一碼會不會把這串碼打死」
   —— 會，即時頂就會替他上屏（'auto'）；不會，就只能自己按空白（'space'）。 */
// 假的跟著打狀態。碼沿用上面那張假碼表：白=YT 日=ZZ 依=PP
const P = { on: true, pos: 0, chars: [], unit: '', uix: 0, uoff: 0,
            main: { '白': 'yt', '日': 'zz', '依': 'pp' } };
const PUNCT_CH = { '，': ',', '。': '.' };   // 文章裡的標點打不打得出來
function curChar() { return P.unit ? P.unit.charAt(P.uix) : P.chars[P.pos]; }
function curBuf() { return state.buf.slice(P.uoff); }
function unitCodesOf(ch) { return [P.main[ch]]; }
eval(cut('nextTypedChar'));
eval(cut('flowState'));

function flow(text, pos, buf) {
  P.chars = text.split(''); P.pos = pos; P.unit = P.chars[pos] || '';
  state.buf = buf; _alive = { short: null, short3: null };
  return flowState();
}
console.log('flowState');
// 白 YT 打完，下一個字 日 的第一碼 Z：YTZ 死路 → 即時頂會收，不必按空白
check('下一鍵會把碼打死 → 自己上屏', flow('白日依', 0, 'yt'), 'auto');
// 日 ZZ 打完，下一個字 依 的第一碼 P：ZZP 也是死路 → 一樣自己上屏
check('同上，換一個字', flow('白日依', 1, 'zz'), 'auto');
// 依 PP 打完，但它是文章最後一個字 → 沒有下一鍵可以頂它，只能按空白
check('文章最後一個字 → 要按空白', flow('白日依', 2, 'pp'), 'space');
// 碼還沒打完 → 什麼都不說
check('碼還沒打完 → 不出聲', flow('白日依', 0, 'y'), null);
check('沒打字 → 不出聲', flow('白日依', 0, ''), null);
// 換行不佔格子：算「下一個字」時要跳過
check('下一個字隔著換行也算得到', flow('白\n日依', 0, 'yt'), 'auto');
// 標點自己會把打好的碼頂上屏，所以碼後面接標點時不必按空白（Wilson）
check('下一個是標點 → 標點會頂掉它', flow('白日依。', 2, 'pp'), 'auto');
check('標點在句中也一樣', flow('白，日依', 0, 'yt'), 'auto');
AUTO_ON = false;
check('不是單字上屏 → 不出聲', flow('白日依', 0, 'yt'), null);
AUTO_ON = true;
P.on = false;
check('自由試打 → 不出聲（那裡沒有「接下來要打哪個字」）', flow('白日依', 0, 'yt'), null);
P.on = true;

console.log('關掉開關／萬用鍵');
AUTO_ON = false;
check('關掉自動上屏：一鍵都不自己收', type('zz'), ['', 'zz']);
AUTO_ON = true;
check('萬用鍵在碼裡就不走自動上屏', type('z' + WILD + 'z'), ['', 'z`z']);

process.exit(fail ? 1 : 0);
