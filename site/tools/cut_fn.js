/* 從 try.js 本尊裡「原地切出」一支函式的原始碼（大括號配對），給底下那幾支
 * 單元測試用。抄一份到測試裡就會跟本尊分岔、測到的是抄本，那比沒有測試更糟
 * ——所以一律從真檔切。用的人：si4_cells_test.js、pair_cells_test.js。
 */
const fs = require('fs');
const path = require('path');

function loadTry(argvPath) {
  const file = argvPath || path.join(__dirname, '..', 'assets', 'try.js');
  const src = fs.readFileSync(file, 'utf8');
  return function cut(name) {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('找不到 ' + name);
    let d = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') d++;
      else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
    }
    throw new Error(name + ' 的大括號沒有配對成功');
  };
}

module.exports = { loadTry };
