/* 〈字根練習〉出題邏輯的單元測試：node site/tools/lianxi_test.js
 *
 * 測的是 lianxi.js 的 buildPool／pickQuestion —— 也就是「這一輪該問哪一條字根、
 * 拿哪個字當例字」。畫面的部分（田字格、字母疊上去）用無頭瀏覽器看得出來，
 * 出題邏輯看不出來：它是機率性的，跑一次正確不代表下一次正確。
 *
 * ⚠️ 切的是 lianxi.js 本尊，不是抄一份（見 cut_fn.js）。抄一份就會跟本尊分岔，
 * 測到的是抄本，比沒有測試更糟。
 */
const path = require('path');
// 第二個參數可以指到改過的副本，用來確認「把邏輯弄壞時測試真的會紅」
const cut = require('./cut_fn').loadTry(
  process.argv[2] || path.join(__dirname, '..', 'assets', 'lianxi.js'));

/* ── 替身：一張小小的字根表 ─────────────────────────────────────────── */
// 兩個字母、三條字根。O 那條最常見（count 90）。
// ⚠️ 出題範圍是**手挑**的（PICKS，來自 site/content/lianxi.md），不是整張字根表 ——
// 這幾條測試同時在測「沒挑到的不會跑出來」。
let DATA = {
  letters: [
    { letter: 'O', groups: [
      { desc: '「口」字及類似字形', shapes: [
        { src: '口', st: [0, 1, 2], span: 'whole', count: 90,
          ex: [{ c: '口', st: [0, 1, 2] }, { c: '哪', st: [0, 1, 2] }, { c: '合', st: [3, 4, 5] }] },
      ] },
    ] },
    { letter: 'A', groups: [
      { desc: '「夕」字及類似字形', shapes: [
        { src: '夕', st: [0, 1, 2], span: 'whole', count: 50,
          ex: [{ c: '外', st: [0, 1, 2] }] },
      ] },
      { desc: '很罕見的那一條', shapes: [
        { src: '罗', st: [6, 7], span: '7–8', count: 5,
          ex: [{ c: '逻', st: [6, 7] }, { c: '沒有字形的字', st: [0] }] },
      ] },
    ] },
  ],
};
let GLYPHS = { 口: ['a', 'b', 'c'], 哪: 'abcdefghi'.split(''), 合: 'abcdef'.split(''),
                 外: ['a', 'b', 'c', 'd', 'e'], 逻: 'abcdefgh'.split('') };

/* ── 把要測的那幾支原地載進來 ───────────────────────────────────────── */
let POOL = [], mastered = {}, lastKey = '';
let opts = { order: 'common' };
// 手挑清單：預設三條全挑，個別測試再改
let PICKS = ['O|口|whole', 'A|夕|whole', 'A|罗|7–8'];
eval(cut('buildPool'));
eval(cut('pickQuestion'));

/* ── 跑測試 ─────────────────────────────────────────────────────────── */
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? '  ok   ' : '  ✗ FAIL ') + label + (cond || extra === undefined ? '' : '  ' + extra));
  if (!cond) fails++;
}
function reset() { mastered = {}; lastKey = ''; opts = { order: 'common' }; }

POOL = buildPool();

console.log('題庫');
ok('三條字根都收進來', POOL.length === 3, POOL.length);
ok('沒有字形的例字被剔掉（逻 留著、「沒有字形的字」不見了）',
   POOL[2].ex.length === 1 && POOL[2].ex[0].c === '逻');
ok('每一條都帶著取自字的筆序（給字根圖示用，不是從 span 回推）',
   POOL.every(q => Array.isArray(q.st) && q.st.length));
ok('key 認得出是哪一條字根', POOL[0].key === 'O|口|whole', POOL[0].key);

console.log('手挑清單');
PICKS = ['O|口|whole'];
POOL = buildPool();
ok('沒挑到的字根完全不出題', POOL.length === 1 && POOL[0].L === 'O', POOL.length);
PICKS = ['O|口|whole', 'A|沒有這條|whole'];
POOL = buildPool();
ok('清單裡有對不上的一條時，其餘照樣出得了題', POOL.length === 1);
PICKS = [];
POOL = buildPool();
ok('一條都沒挑：題庫是空的（頁面會說還沒挑，不是壞掉）', POOL.length === 0);
PICKS = ['O|口|whole', 'A|夕|whole', 'A|罗|7–8'];
POOL = buildPool();

console.log('挑題目');
reset();
let pick = pickQuestion();
ok('由常見到少見：第一題是最常見的那一條（O，count 90）', pick.q.L === 'O', pick.q.L);
// 一次就通過不算數 —— 例字是隨機挑的，抽 200 次都沒抽到取自字才叫「避開」
let hitSrc = false;
for (let i = 0; i < 200; i++) { lastKey = ''; if (pickQuestion().ex.c === '口') hitSrc = true; }
ok('例字避開取自字本身（口 這一條 200 次都不會拿 口 出題）', !hitSrc);
lastKey = '';

lastKey = pick.q.key;
ok('下一題不會又是同一條字根', pickQuestion().q.key !== lastKey);

reset();
mastered['O|口|whole'] = 1;
ok('答對過的先跳過，換沒練過的', pickQuestion().q.key === 'A|夕|whole');

reset();
POOL.forEach(q => { mastered[q.key] = 1; });
lastKey = '';
ok('全部答對過之後照樣出得了題（整池重來一輪）', !!pickQuestion());

reset();
opts.order = 'random';
lastKey = '';
const seen = {};
for (let i = 0; i < 300; i++) { const p = pickQuestion(); seen[p.q.key] = 1; lastKey = p.q.key; }
ok('隨機出題摸得到每一條（300 次抽樣）', Object.keys(seen).length === 3, Object.keys(seen).length);

reset();
lastKey = '';
let prev = '';
let repeated = false;
for (let i = 0; i < 200; i++) {
  const p = pickQuestion();
  if (p.q.key === prev) repeated = true;
  prev = p.q.key;
  lastKey = p.q.key;
}
ok('連續兩題不會撞同一條字根（200 次）', !repeated);

reset();
// 有些字根只有取自字本身這一個例字（例字挑不到別的），這時候不能空手而回
DATA = { letters: [{ letter: 'Z', groups: [{ desc: '', tier: 'primary', shapes: [
  { src: '口', st: [0], span: 'whole', count: 1, ex: [{ c: '口', st: [0] }] }] }] }] };
PICKS = ['Z|口|whole'];
POOL = buildPool();
lastKey = '';
ok('只有取自字一個例字時照樣出得了題（不是回傳空的）',
   POOL.length === 1 && pickQuestion().ex.c === '口');

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
