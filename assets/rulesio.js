/* rules.json 的存檔：兩頁共用。
   取碼原則頁跟簡碼頁都讀寫同一個 data/rules.json，而且各自握著整份檔案。
   兩頁都開著的時候，誰後存誰就把對方的改動整個蓋掉 —— 所以存檔一定要帶
   X-Base-Stamp（server.py do_PUT 只有收到這個 header 才會做樂觀鎖），
   撞到就重讀、把自己負責的那幾條套回去、再存一次。

   「自己負責的那幾條」由 owns(rule) 決定：簡碼頁只管三條簡碼規則，
   取碼原則頁管其餘全部。兩頁改的是不同規則時，撞了也能自動合好。 */
(function (global) {
  const SHORTCODE_IDS = ['short_code', 'short3', 'left_short'];

  async function state() {
    return fetch('/api/state').then(r => r.json());
  }

  function put(data, stamp) {
    const headers = { 'Content-Type': 'application/json' };
    if (stamp) headers['X-Base-Stamp'] = stamp;
    return fetch('/api/rules', { method: 'PUT', headers,
                                 body: JSON.stringify(data, null, 2) });
  }

  /* 把 mine 裡「我負責」的規則套到 fresh 上：位置照 fresh 的順序，
     fresh 沒有的（我這頁新增的）補在後面。fresh 裡我不負責的原封不動。 */
  function merge(fresh, mine, owns) {
    const byId = new Map();
    for (const r of mine.rules) if (owns(r)) byId.set(r.id, r);
    const out = fresh.rules.map(r => (owns(r) && byId.has(r.id)) ? byId.get(r.id) : r);
    const have = new Set(out.map(r => r.id));
    for (const r of mine.rules) if (owns(r) && !have.has(r.id)) out.push(r);
    return { ...fresh, rules: out };
  }

  /* 回傳 { ok, stamp, data, merged }：
     merged 為 true 表示撞到別頁的修改、已經自動合併過，呼叫端要重畫。 */
  async function save(data, stamp, owns) {
    let res = await put(data, stamp);
    if (res.status !== 409) {
      return { ok: res.ok, stamp: res.ok ? (await state()).rules : stamp, data, merged: false };
    }
    const fresh = await fetch('/api/rules').then(r => r.json());
    const merged = merge(fresh, data, owns);
    res = await put(merged, (await state()).rules);
    return { ok: res.ok, stamp: res.ok ? (await state()).rules : stamp,
             data: merged, merged: true };
  }

  global.RulesIO = { save, merge, SHORTCODE_IDS,
                     isShortcode: r => SHORTCODE_IDS.includes(r.id) };
})(window);
