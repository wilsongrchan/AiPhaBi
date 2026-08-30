/* 首頁打字示範——只有 index.html 用得到。
 *
 * 沒人動它的時候，自動把兩組範例碼（BD、JT）一個字母一個字母打進框裡，查
 * dict.json 的碼表、秀出結果，停一下，清掉，換下一組，一直循環——這是首頁
 * 唯一的「動畫」，但它查的是真正的碼表，不是另外寫死一份假資料。
 *
 * 使用者一聚焦或自己打字，自動播放立刻讓路：框子變成一個真的能查的小工具，
 * 打什麼字母就查什麼字母，跟自動播放共用同一套 lookup／render。
 *
 * 沒有做候選字排序、選字、上屏那一整套——這裡只是「看看字母變成什麼字」的
 * 一眼展示，真正練打字的地方是 try.html（見下面的「完整試打頁面」連結）。 */
(function () {
  'use strict';

  var input = document.getElementById('ld-input');
  var out = document.getElementById('ld-out');
  if (!input || !out) return;

  var codes = {};
  var userTyping = false;
  var demoTimer = null;

  function lookup(code) {
    return codes[code.toLowerCase()] || '';
  }

  function render(code) {
    if (!code) {
      out.textContent = '';
      out.classList.remove('is-hit');
      return;
    }
    var v = lookup(code);
    if (v) {
      out.textContent = '→ ' + v.charAt(0);
      out.classList.add('is-hit');
    } else {
      out.textContent = '';
      out.classList.remove('is-hit');
    }
  }

  function stopDemo() {
    if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
  }

  var EXAMPLES = ['BD', 'JT'];

  function startDemo() {
    stopDemo();
    var exIdx = 0;

    function playOne() {
      if (userTyping) return;
      var code = EXAMPLES[exIdx % EXAMPLES.length];
      exIdx++;
      var i = 0;

      function step() {
        if (userTyping) return;
        if (i > code.length) {
          demoTimer = window.setTimeout(function () {
            if (userTyping) return;
            input.value = '';
            render('');
            demoTimer = window.setTimeout(playOne, 450);
          }, 1300);
          return;
        }
        input.value = code.slice(0, i);
        render(input.value);
        i++;
        demoTimer = window.setTimeout(step, 260);
      }
      step();
    }
    playOne();
  }

  input.addEventListener('focus', function () {
    userTyping = true;
    stopDemo();
  });

  input.addEventListener('input', function () {
    userTyping = true;
    stopDemo();
    var v = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (v !== input.value) input.value = v;
    render(v);
  });

  input.addEventListener('blur', function () {
    /* 離開框子過一陣子沒再回來才恢復自動播放，不然滑鼠隨便掃過去都會被打斷 */
    window.setTimeout(function () {
      if (document.activeElement !== input) {
        userTyping = false;
        startDemo();
      }
    }, 3000);
  });

  fetch('assets/dict.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      codes = d.codes || {};
      startDemo();
    })
    .catch(function () { /* 查不到表就讓框子留空，不擋頁面其餘部分 */ });
})();
