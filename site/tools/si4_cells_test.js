/* 四碼快打那四小格的單元測試：node site/tools/si4_cells_test.js
 *
 * 為什麼要有這一支：這幾格的行為（幾格、哪一格兩碼、按幾次 = 才亮）沒辦法用
 * 無頭瀏覽器穩定驗 —— 試打頁要抓 3MB 詞庫，headless Chrome 的
 * --screenshot／--dump-dom 在這台機器上會卡住不回來（2026-08-26 實測，程序閒置
 * 0% CPU，不是 JS 迴圈）。所以改成把那兩支函式從 try.js 裡**原地切出來**跑。
 *
 * ⚠️ 切的是 try.js 本尊的原始碼（用大括號配對切函式），不是另外抄一份。抄一份
 *    就會跟本尊分岔，測到的是抄本 —— 那比沒有測試更糟。
 */
const fs = require('fs');
const path = require('path');
const TRY = process.argv[2] || path.join(__dirname, '..', 'assets', 'try.js');
const src = fs.readFileSync(TRY, 'utf8');

function cut(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到 ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
}

// 最小替身：只有被抽出來那幾支真的會用到的東西
const P = { unit: '', qstep: 0, glyphs: {}, cell: { innerHTML: '' } };
const QZ = [0, 1, 2, 4];
const GRID = '', SVG_TF = '';
const SEGS = {
  悲: [{ L: 'J', st: [0] }, { L: 'E', st: [1] }, { L: 'W', st: [2] }],
  歡: [{ L: 'H', st: [0] }, { L: 'O', st: [1] }],
  離: [{ L: 'I', st: [0] }, { L: 'X', st: [1] }],
  合: [{ L: 'A', st: [0] }, { L: 'O', st: [1] }],
  不: [{ L: 'J', st: [0] }, { L: 'Q', st: [1] }],
  容: [{ L: 'Q', st: [0] }, { L: 'U', st: [1] }],
  易: [{ L: 'B', st: [0] }, { L: 'F', st: [1] }, { L: 'J', st: [2] }],
  山: [{ L: 'W', st: [0, 1, 2] }],
};
function segsOf(ch) { return SEGS[ch] || null; }
// 每個字給幾條假筆畫，drawQuad 才走得到上色那一段（P.glyphs 空的話它整段跳過）
for (const ch of Object.keys(SEGS)) P.glyphs[ch] = ['a', 'b', 'c'];

eval(cut('si4Cells'));
eval(cut('drawQuad'));

function caps(unit, qstep) {
  P.unit = unit; P.qstep = qstep;
  const cells = si4Cells(unit);
  if (!cells) return null;
  drawQuad(cells);
  const html = P.cell.innerHTML;
  const three = /tz-quad is-three/.test(html);
  const letters = html.split('<div class="tz-q">').slice(1).map(c => {
    const m = c.match(/<span class="tz-qcode">(.*?)<\/span>/s);
    return m[1].replace(/<i class="tz-qtag">末<\/i>/g, '末')
               .replace(/<i class="tz-qdot">·<\/i>/g, '·');
  });
  const lit = [...html.matchAll(/tz-z(\d)/g)].map(m => +m[1]);
  return { boxes: letters.length, three, letters, lit };
}

let fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label);
  if (!ok) console.log('        got  ' + g + '\n        want ' + w);
}

console.log('四字詞 悲歡離合（四格，= 一次揭一碼）');
check('qstep 0', caps('悲歡離合', 0), {boxes:4, three:false, letters:['·','·','·','·'], lit:[]});
check('qstep 1', caps('悲歡離合', 1), {boxes:4, three:false, letters:['J','·','·','·'], lit:[0]});
check('qstep 2', caps('悲歡離合', 2), {boxes:4, three:false, letters:['J','H','·','·'], lit:[0,1]});
check('qstep 4', caps('悲歡離合', 4), {boxes:4, three:false, letters:['J','H','I','A'], lit:[0,1,2,4]});

console.log('三字詞 不容易（三格，第三格兩碼、末碼標「末」）');
check('qstep 0', caps('不容易', 0), {boxes:3, three:true, letters:['·','·','· ·'], lit:[]});
check('qstep 3', caps('不容易', 3), {boxes:3, three:true, letters:['J','Q','B ·'], lit:[0,1,2]});
check('qstep 4', caps('不容易', 4), {boxes:3, three:true, letters:['J','Q','B J末'], lit:[0,1,2,4]});

console.log('三字詞 末字一碼（首碼末碼同一段，字母照印兩個）');
check('長白山 qstep 4', caps('悲歡山', 4).letters, ['J','H','W W末']);

console.log('兩字詞不該有四格');
check('悲歡', caps('悲歡', 0), null);

process.exit(fail ? 1 : 0);
