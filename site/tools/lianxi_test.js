/* 〈字根練習〉出題邏輯的單元測試：node site/tools/lianxi_test.js
 *
 * 測的是 lianxi.js 的 keyOf／levelLeft／pickQuestion —— 「下一題該問哪一題、
 * 現在該在第幾關」。畫面的部分（田字格、字母疊上去、猜錯變紅、三次自動揭曉）
 * 用無頭瀏覽器看得出來，這幾支看不出來：它們是機率性的，跑一次正確不代表
 * 下一次正確。
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

/* ── 替身：兩關，第一關兩題（同一個字的兩條字根）、第二關一題 ─────────── */
let POOL = [
  { c: '檢', L: 'A', g: [[4, 5, 6]], lv: 0 },
  { c: '檢', L: 'O', g: [[7, 8, 9]], lv: 0 },
  { c: '雪', L: 'E', g: [[8, 9, 10]], lv: 1, h: '水平翻轉' },
];
let LEVELS = ['正著看就像', '轉一下、翻過來才像'];
let mastered = {}, seenThisRound = {}, lastKey = '', forcedLevel = null;

eval(cut('keyOf'));
eval(cut('levelLeft'));
eval(cut('pickQuestion'));

/* ── 跑測試 ─────────────────────────────────────────────────────── */
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? '  ok   ' : '  ✗ FAIL ') + label + (cond || extra === undefined ? '' : '  ' + extra));
  if (!cond) fails++;
}
function reset() { mastered = {}; seenThisRound = {}; lastKey = ''; forcedLevel = null; }

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
// ⚠️ 這一關的每一題都摸得到就對了 —— 有關卡之後不該摸到下一關的題
ok('這一關的每一題都摸得到', Object.keys(seen).length === 2, Object.keys(seen).length);

reset();
const savedPool = POOL;
POOL = [];
ok('一題都沒有時回傳 null（頁面會說還沒挑，不是拋例外）', pickQuestion() === null);
POOL = savedPool;

console.log('關卡');
reset();
let onlyFirst = true;
for (let i = 0; i < 200; i++) { lastKey = ''; if (pickQuestion().q.lv !== 0) onlyFirst = false; }
ok('第一關沒做完就不會跑出第二關的題（200 次）', onlyFirst);

reset();
POOL.filter(q => q.lv === 0).forEach(q => { seenThisRound[keyOf(q)] = 1; });
lastKey = '';
ok('第一關每一題都看過答案之後，換第二關（不必答對）', pickQuestion().q.lv === 1);

reset();
POOL.forEach(q => { mastered[keyOf(q)] = 1; });
lastKey = '';
ok('全部答對過之後照樣出得了題', !!pickQuestion());

reset();
// 「下一關」把它鎖在指定那一關
forcedLevel = 1;
let stayed = true;
for (let i = 0; i < 100; i++) { lastKey = ''; if (pickQuestion().q.lv !== 1) stayed = false; }
ok('按過「下一關」之後鎖在那一關', stayed);

reset();
forcedLevel = 1;
POOL.filter(q => q.lv === 1).forEach(q => { mastered[keyOf(q)] = 1; seenThisRound[keyOf(q)] = 1; });
lastKey = '';
ok('鎖住的那一關做完就自己解鎖，回到照順序出', pickQuestion().q.lv === 0 && forcedLevel === null);

reset();
ok('levelLeft 只回傳那一關的題', levelLeft(1).length === 1 && levelLeft(0).length === 2);

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
