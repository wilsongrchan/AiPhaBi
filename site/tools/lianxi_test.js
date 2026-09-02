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
let NLEVELS = 2;
let PASS = 8;                 // 過關要答對幾題（一關可以有更多題，多的是備胎）
let mastered = {}, roundOk = {}, seenThisRound = {}, lastKey = '', forcedLevel = null;

eval(cut('keyOf'));
eval(cut('levelLeft'));
eval(cut('levelPool'));
eval(cut('levelGoal'));
eval(cut('levelScore'));
eval(cut('levelDone'));
eval(cut('levelSource'));
eval(cut('pickFromLevel'));
eval(cut('pickQuestion'));

/* ── 跑測試 ─────────────────────────────────────────────────────── */
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? '  ok   ' : '  ✗ FAIL ') + label + (cond || extra === undefined ? '' : '  ' + extra));
  if (!cond) fails++;
}
function reset() { mastered = {}; roundOk = {}; seenThisRound = {}; lastKey = ''; forcedLevel = null; }

/* ⚠️ 這一項是被咬出來的：用「切一段換一段」的方式改檔案時，很容易留下**同名的
   第二個函式**（2026-09-01 一天之內 paintLevel、paintAsk 各中一次）。後面那個會
   蓋掉前面那個，畫面上看起來就是「改了沒反應」，而且沒有任何錯誤訊息。 */
console.log('檔案本身');
{
  const fs = require('fs');
  const src = fs.readFileSync(
    process.argv[2] || path.join(__dirname, '..', 'assets', 'lianxi.js'), 'utf8');
  const names = [...src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  ok('沒有同名的函式被宣告兩次', dupes.length === 0, dupes.join('、'));
}

console.log('題目的身分');
ok('同一個字的兩條字根是兩題（key 認得出來）',
   keyOf(POOL[0]) === '檢|A' && keyOf(POOL[1]) === '檢|O', keyOf(POOL[1]));

console.log('挑題目');
reset();
ok('挑得出題目', !!pickQuestion());

// ⚠️ 「答對過的先跳過」只在**同一關裡還有沒練過的**時候成立。整關都答對過了還是
// 要出題（那是重練一輪），這一條在底下另外測。
reset();
mastered['檢|A'] = 1;
let hitMastered = false;
for (let i = 0; i < 200; i++) { lastKey = ''; if (keyOf(pickQuestion().q) === '檢|A') hitMastered = true; }
ok('同一關裡，答對過的排在沒練過的後面（200 次）', !hitMastered);

reset();
POOL.forEach(q => { mastered[keyOf(q)] = 1; roundOk[keyOf(q)] = 1; });
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
// ⚠️ 只按「看答案」不會過關 —— 過關要**答對** PASS 題。看過一輪還沒答對的會再出
// 一次；真的不想練這一關，畫面上有「下一關」可以按。
ok('只看答案不會被推去下一關，沒答對的會再出一次', pickQuestion().q.lv === 0);

reset();
POOL.forEach(q => { mastered[keyOf(q)] = 1; roundOk[keyOf(q)] = 1; });
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
POOL.filter(q => q.lv === 1).forEach(q => { mastered[keyOf(q)] = 1; roundOk[keyOf(q)] = 1; seenThisRound[keyOf(q)] = 1; });
lastKey = '';
// 「繼續練習這一關」要的就是這個：做完了還留在原地重抽，不會自己被推去下一關
ok('鎖住的那一關做完之後還是留在那一關（整關重抽）', pickQuestion().q.lv === 1);

reset();
ok('levelDone：還沒答對就不算過關', !levelDone(0));
POOL.filter(q => q.lv === 0).forEach(q => { roundOk[keyOf(q)] = 1; });
ok('levelDone：答對足夠題數就過關', levelDone(0) && !levelDone(1));

// ⚠️ 過關看的是**這一輪**答對幾題，不是 localStorage 裡的終身紀錄 —— 不然練過一輪
// 的人再打開這一頁，進度條永遠停在滿格、關卡永遠是過的（Wilson 回報兩次）。
reset();
POOL.forEach(q => { mastered[keyOf(q)] = 1; });
ok('以前全部答對過，但這一輪還沒開始 → 還沒過關', !levelDone(0) && levelScore(0) === 0);
lastKey = '';
ok('以前全部答對過，照樣出得了這一關的題', pickQuestion().q.lv === 0);

// ⚠️ 一關可以有比過關題數更多的題（備胎）：答對 PASS 題就過關，不必做完整關
reset();
const big = [];
for (let i = 0; i < 12; i++) big.push({ c: '甲' + i, L: 'A', g: [[0]], lv: 0 });
const savedPool2 = POOL;
POOL = big.concat([{ c: '乙', L: 'B', g: [[0]], lv: 1 }]);
PASS = 8;
big.slice(0, 7).forEach(q => { roundOk[keyOf(q)] = 1; });
ok('12 題的一關，答對 7 題還沒過關', !levelDone(0) && levelGoal(0) === 8);
roundOk[keyOf(big[7])] = 1;
ok('答對第 8 題就過關（剩下 4 題是備胎）', levelDone(0));
lastKey = '';
ok('過關之後自動出下一關的題（不必把備胎做完）', pickQuestion().q.lv === 1);
POOL = savedPool2;
PASS = 8;

reset();
POOL.filter(q => q.lv === 0).forEach(q => { mastered[keyOf(q)] = 1; roundOk[keyOf(q)] = 1; });
lastKey = '';
ok('pickFromLevel：做完的關照樣抽得出題', pickFromLevel(0).q.lv === 0);

reset();
ok('levelLeft 只回傳那一關的題', levelLeft(1).length === 1 && levelLeft(0).length === 2);

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
