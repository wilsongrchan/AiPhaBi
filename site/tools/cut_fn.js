/* 從出貨的原始碼裡「原地切出」一支函式（大括號配對），給底下那幾支單元測試用。
 * 抄一份到測試裡就會跟本尊分岔、測到的是抄本，那比沒有測試更糟——所以一律從
 * 真檔切。用的人：si4_cells_test.js、pair_cells_test.js。
 *
 * 找函式的順序是 try.js → glyphbox.js。paintGlyph 那幾支共用的搬去 glyphbox.js
 * 給〈拆碼查詢〉一起用之後，測試不必知道哪一支住在哪一個檔案。
 */
const fs = require('fs');
const path = require('path');

function loadTry(argvPath) {
  const files = [argvPath || path.join(__dirname, '..', 'assets', 'try.js'),
                 path.join(__dirname, '..', 'assets', 'glyphbox.js')];
  const sources = files.map(f => fs.readFileSync(f, 'utf8'));
  return function cut(name) {
    for (const src of sources) {
      const i = src.indexOf('function ' + name + '(');
      if (i < 0) continue;
      let d = 0;
      for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
      }
      throw new Error(name + ' 的大括號沒有配對成功');
    }
    throw new Error('找不到 ' + name + '（找過 ' + files.map(f => path.basename(f)).join('、') + '）');
  };
}

module.exports = { loadTry };
