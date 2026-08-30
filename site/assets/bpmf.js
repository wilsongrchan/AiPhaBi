/* 注音（BPMF）鍵盤：〈線上試打〉〈拆碼查詢〉共用，跟 glyphbox.js 同一個理由——
 * 不要抄。鍵位表、螢幕鍵盤怎麼畫、鍵盤直接對應怎麼攔鍵，兩頁都要一模一樣，
 * 抄一份過去遲早會有「調過鍵位一邊忘了另一邊」的坑。
 *
 * 呼叫端只要接上「按了插入這個字元」跟「查詢用的字串」，其餘（鍵位、畫法、
 * 攔鍵）都在這裡。
 *
 * ⚠️ 這支要排在 try.js／chaima.js **前面**載入。
 */
(function (root) {
  'use strict';

  // 鍵位跟實體注音鍵盤上印的一模一樣（標準鍵盤／許氏鍵盤共用的字母部分）。
  var KEYMAP = {
    '1': 'ㄅ', '2': 'ㄉ', '3': 'ˇ', '4': 'ˋ', '5': 'ㄓ', '6': 'ˊ', '7': '˙', '8': 'ㄚ', '9': 'ㄞ', '0': 'ㄢ', '-': 'ㄦ',
    'q': 'ㄆ', 'w': 'ㄊ', 'e': 'ㄍ', 'r': 'ㄐ', 't': 'ㄔ', 'y': 'ㄗ', 'u': 'ㄧ', 'i': 'ㄛ', 'o': 'ㄟ', 'p': 'ㄣ',
    'a': 'ㄇ', 's': 'ㄋ', 'd': 'ㄎ', 'f': 'ㄑ', 'g': 'ㄕ', 'h': 'ㄖ', 'j': 'ㄨ', 'k': 'ㄜ', 'l': 'ㄠ', ';': 'ㄤ',
    'z': 'ㄈ', 'x': 'ㄌ', 'c': 'ㄏ', 'v': 'ㄒ', 'b': 'ㄘ', 'n': 'ㄙ', 'm': 'ㄩ', ',': 'ㄝ', '.': 'ㄡ', '/': 'ㄥ'
  };
  // 調號鍵（一聲不標調、沒有鍵，鍵盤上留空）——查詢用的字串一律去掉調號
  // （build_pinyin() 產生的 zhuyin_index 本來就不分聲調，見 stripTones）。
  var TONE_KEYS = { '3': 1, '4': 1, '6': 1, '7': 1 };
  var TONE_MARKS = /[ˇˊˋ˙]/g;
  // 螢幕鍵盤照實體鍵盤的四排排版畫（含調號鍵），找起來才跟真的鍵盤對得上。
  var ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/']
  ];

  function stripTones(s) { return (s || '').replace(TONE_MARKS, ''); }

  /* 畫螢幕鍵盤到 container 裡（含清除鍵），點了字母鍵呼叫 onKey(注音符號)、
   * 點了清除鍵呼叫 onClear()。只建一次，呼叫端自己決定什麼時候顯示／隱藏
   * 整塊（切拼音／注音模式時），不用重畫。 */
  function build(container, onKey, onClear) {
    container.innerHTML = '';
    ROWS.forEach(function (row) {
      var rowEl = document.createElement('div');
      rowEl.className = 'pyq-bpmf-row';
      row.forEach(function (key) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pyq-bpmf-key' + (TONE_KEYS[key] ? ' is-tone' : '');
        b.textContent = KEYMAP[key];
        if (TONE_KEYS[key]) b.title = '調號（不影響查詢結果）';
        b.addEventListener('click', function () { onKey(KEYMAP[key]); });
        rowEl.appendChild(b);
      });
      container.appendChild(rowEl);
    });
    var clearRow = document.createElement('div');
    clearRow.className = 'pyq-bpmf-row';
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'pyq-bpmf-key is-wide';
    clearBtn.textContent = '⌫ 清除';
    clearBtn.addEventListener('click', onClear);
    clearRow.appendChild(clearBtn);
    container.appendChild(clearRow);
  }

  /* 鍵盤直接對應：注音模式下攔截 inputEl 的 keydown，把對應的英文鍵轉成
   * 注音符號插入，不是原本的英文字母——跟實體注音鍵盤同一個鍵位。
   * isActive() 回傳現在是不是注音模式；insertFn(注音符號) 負責真的插入。
   * 放行 Backspace／方向鍵／Tab 等控制鍵，cmd／ctrl／alt 組合鍵一律不攔
   * （複製貼上、全選要照常運作），只攔截真的對應到注音符號的那些鍵。 */
  function attachKeydown(inputEl, isActive, insertFn) {
    inputEl.addEventListener('keydown', function (e) {
      if (!isActive() || e.metaKey || e.ctrlKey || e.altKey) return;
      var bpmf = KEYMAP[e.key.toLowerCase()];
      if (!bpmf) return;
      e.preventDefault();
      insertFn(bpmf);
    });
  }

  root.BPMF = {
    KEYMAP: KEYMAP, ROWS: ROWS, TONE_KEYS: TONE_KEYS, TONE_MARKS: TONE_MARKS,
    stripTones: stripTones, build: build, attachKeydown: attachKeydown
  };
})(window);
