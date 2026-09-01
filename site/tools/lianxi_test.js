/* 〈字根練習〉出題邏輯的單元測試：node site/tools/lianxi_test.js
 *
 * 測的是 lianxi.js 的 keyOf／pickQuestion／spanText —— 「下一題該問哪一題」跟
 * 「取自『會』第 1–3 筆」那句話怎麼寫出來。畫面的部分（田字格、字母疊上去、
 * 猜錯變紅、三次自動揭曉）用無頭瀏覽器看得出來，這幾支看不出來：它們是機率性
 * 或純字串的，跑一次正確不代表下一次正確。
 *
 * ⚠️ 切的是 lianxi.js 本尊，不是抄一份（見 cut_fn.js）。抄一份就會跟本尊分岔，
 * 測到的是抄本，比沒有測試更糟。
 *
 * 題目本身（哪個字、考哪幾條字根）是 Wilson 手挑的，建置時從
 * site/content/lianxi.md 產生 —— 那一側的檢查在建置裡（寫錯的行會出聲），
 * 不在這裡。
 */
const path = require('path');
// 第二個參數可以指到改過的副本，用來確認「把邏輯弄壞時測試真的會紅」
const cut = require('./cut_fn').loadTry(
  process.argv[2] || path.join(__dirname, '..', 'assets', 'lianxi.js'));

/* ── 替身：三題，兩題同一個字 ───────────────────────────────────── */
let POOL = [
  { c: '檢', L: 'A', g: [[4, 5, 6]], d: '「人」下有一橫或一點', code: 'TAOOY',
    src: '會', sst: [0, 1, 2] },
  { c: '檢', L: 'O', g: [[7, 8, 9], [10, 11, 12]], d: '「口」字及類似字形', code: 'TAOOY',
    src: '口', sst: [0, 1, 2] },
  { c: '虐', L: 'E', g: [[6, 7, 8]], d: '上下皆橫', code: 'RE',
    src: '虐', sst: [6, 7, 8] },
];
let GLYPHS = { 檢: new Array(17).fill('d'), 虐: new Array(9).fill('d'),
               會: new Array(13).fill('d'), 口: ['a', 'b', 'c'] };
let mastered = {}, lastKey = '';

eval(cut('keyOf'));
eval(cut('pickQuestion'));
eval(cut('spanText'));

/* ── 跑測試 ─────────────────────────────────────────────────────── */
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? '  ok   ' : '  ✗ FAIL ') + label + (cond || extra === undefined ? '' : '  ' + extra));
  if (!cond) fails++;
}
function reset() { mastered = {}; lastKey = ''; }

console.log('題目的身分');
ok('同一個字的兩條字根是兩題（key 認得出來）',
   keyOf(POOL[0]) === '檢|A' && keyOf(POOL[1]) === '檢|O', keyOf(POOL[1]));

console.log('挑題目');
reset();
ok('挑得出題目', !!pickQuestion());

reset();
mastered['檢|A'] = 1;
mastered['檢|O'] = 1;
let hitMastered = false;
for (let i = 0; i < 200; i++) { lastKey = ''; if (mastered[keyOf(pickQuestion().q)]) hitMastered = true; }
ok('答對過的先跳過，換沒練過的（200 次都不該回頭）', !hitMastered);

reset();
POOL.forEach(q => { mastered[keyOf(q)] = 1; });
lastKey = '';
ok('全部答對過之後照樣出得了題（整池重來一輪）', !!pickQuestion());

reset();
let prev = '', repeated = false, seen = {};
for (let i = 0; i < 300; i++) {
  const q = pickQuestion().q;
  if (keyOf(q) === prev) repeated = true;
  prev = keyOf(q);
  lastKey = prev;
  seen[prev] = 1;
}
ok('連續兩題不會撞同一題（300 次）', !repeated);
ok('每一題都摸得到', Object.keys(seen).length === 3, Object.keys(seen).length);

reset();
const savedPool = POOL;
POOL = [];
ok('一題都沒有時回傳 null（頁面會說還沒挑，不是拋例外）', pickQuestion() === null);
POOL = savedPool;

console.log('「取自…」那句話');
ok('整個字', spanText('口', [0, 1, 2]) === '整個字', spanText('口', [0, 1, 2]));
ok('連號寫成範圍', spanText('會', [0, 1, 2]) === '第 1–3 筆', spanText('會', [0, 1, 2]));
ok('單獨一筆', spanText('會', [4]) === '第 5 筆', spanText('會', [4]));
ok('不連號逐一列出', spanText('會', [0, 1, 5]) === '第 1、2、6 筆', spanText('會', [0, 1, 5]));
ok('沒有筆序就不講', spanText('會', []) === '');
ok('筆序沒排好也算得對', spanText('會', [2, 0, 1]) === '第 1–3 筆', spanText('會', [2, 0, 1]));

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
