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
const cut = require('./cut_fn').loadTry(process.argv[2]);

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
  // 字母連同它的顏色位一起讀出來：J:z0 表示「字母 J、第一位的顏色」。
  // 只讀字母不讀顏色的話，「顏色跟字根對得起來」這件事就沒被測到。
  const letters = html.split('<div class="tz-q">').slice(1).map(c => {
    const m = c.match(/<span class="tz-qcode">(.*)<\/span>\s*<\/div>/s);
    return m[1]
      .replace(/<span class="tz-chip z(\d)">(.*?)<\/span>/g, (_, z, L) => L + ':z' + z)
      .replace(/<span class="tz-chip is-blank">？<\/span>/g, '?')
      .replace(/<i class="tz-qtag">末<\/i>/g, '末');
  });
  const lit = [...html.matchAll(/tz-z(\d)/g)].map(m => +m[1]);
  // 揭過碼的格子，其餘筆畫要壓成 tz-off；一碼都沒揭的格子維持 tz-ink
  const off = (html.match(/tz-off/g) || []).length;
  const ink = (html.match(/tz-ink/g) || []).length;
  return { boxes: letters.length, three, letters, lit, off, ink };
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
check('qstep 0', caps('悲歡離合', 0), {boxes:4, three:false, letters:['?','?','?','?'], lit:[], off:0, ink:12});
check('qstep 1', caps('悲歡離合', 1), {boxes:4, three:false, letters:['J:z0','?','?','?'], lit:[0], off:2, ink:9});
check('qstep 2', caps('悲歡離合', 2), {boxes:4, three:false, letters:['J:z0','H:z1','?','?'], lit:[0,1], off:4, ink:6});
check('qstep 4', caps('悲歡離合', 4), {boxes:4, three:false, letters:['J:z0','H:z1','I:z2','A:z4'], lit:[0,1,2,4], off:8, ink:0});

console.log('三字詞 不容易（三格，第三格兩碼、末碼標「末」）');
check('qstep 0', caps('不容易', 0), {boxes:3, three:true, letters:['?','?','??'], lit:[], off:0, ink:9});
check('qstep 3', caps('不容易', 3), {boxes:3, three:true, letters:['J:z0','Q:z1','B:z2?'], lit:[0,1,2], off:6, ink:0});
check('qstep 4', caps('不容易', 4), {boxes:3, three:true, letters:['J:z0','Q:z1','B:z2J:z4末'], lit:[0,1,2,4], off:5, ink:0});

console.log('三字詞 末字一碼（首碼末碼同一段，字母照印兩個）');
check('長白山 qstep 4', caps('悲歡山', 4).letters, ['J:z0','H:z1','W:z2W:z4末']);

console.log('兩字詞不該有四格');
check('悲歡', caps('悲歡', 0), null);

process.exit(fail ? 1 : 0);
