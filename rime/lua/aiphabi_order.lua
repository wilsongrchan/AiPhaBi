-- 愛發筆 · 候選重排（filter，排在 hint / fuzzy 之後、simplifier 之前）
-- 順序固定成三層：
--   1. 約定簡碼（type=ap_short）—— 認定過「就這個字」，永遠第一。
--   2. 主碼 exact match —— 你打的碼剛好是某字的完整碼（在 code2chars[碼] 裡）。
--   3. 其餘全部一池：補全、偏旁碼、同類、三簡、容錯（後四者都標 type=ap_pool）。
--      這一池不分類別，一律照「本次開機選過幾次（降冪）→ 常用度（降冪）」排。
--      例：打 W，心（偏旁碼）比一堆冷僻的三點水補全常用，就會排到它們前面。
-- 使用者選字次數只記在記憶體、純加分（重開歸零，不動碼表）；拿不到 commit_notifier
-- 也沒關係，退回純常用度排序，候選照樣出得來。
local data = require("aiphabi_data")

local USERFREQ = {}
local function bump(text)                 -- 一個 commit 可能是詞：逐 UTF-8 字加分
  local i = 1
  while i <= #text do
    local b = text:byte(i)
    local len = (b < 0x80 and 1) or (b < 0xE0 and 2) or (b < 0xF0 and 3) or 4
    local ch = text:sub(i, i + len - 1)
    USERFREQ[ch] = (USERFREQ[ch] or 0) + 1
    i = i + len
  end
end

local function init(env)
  local ok, ctx = pcall(function() return env.engine.context end)
  if not ok or not ctx then return end
  pcall(function()
    env.ap_order_notifier = ctx.commit_notifier:connect(function(context)
      local got, text = pcall(function() return context:get_commit_text() end)
      if got and text and text ~= "" then pcall(bump, text) end
    end)
  end)
end

local function fini(env)
  if env.ap_order_notifier then pcall(function() env.ap_order_notifier:disconnect() end) end
end

local function score(ch)                  -- 選過次數優先，其次常用度
  return (USERFREQ[ch] or 0) * 1000000000 + (data.freq[ch] or 0)
end

local function filter(input, env)
  local code = env.engine.context.input
  local cands = {}
  for cand in input:iter() do cands[#cands + 1] = cand end

  -- 萬用鍵／空碼／含非字母：不重排，原樣輸出
  if not code or code == "" or code:find("[^a-z]") then
    for _, c in ipairs(cands) do yield(c) end
    return
  end

  local exactSet = {}
  for _, ch in ipairs(data.code2chars[code] or {}) do exactSet[ch] = true end

  local short, exact, pool = {}, {}, {}
  for _, c in ipairs(cands) do
    if c.type == "ap_short" then short[#short + 1] = c
    elseif c.type == "ap_pool" then pool[#pool + 1] = { c = c }
    elseif exactSet[c.text] then exact[#exact + 1] = c
    else pool[#pool + 1] = { c = c } end                 -- 補全（沒中完整碼）也丟進池子
  end

  for i, e in ipairs(pool) do e.i = i end                -- 穩定排序用的原序
  table.sort(pool, function(a, b)
    local sa, sb = score(a.c.text), score(b.c.text)
    if sa ~= sb then return sa > sb end
    return a.i < b.i
  end)

  for _, c in ipairs(short) do yield(c) end              -- 1. 簡碼
  for _, c in ipairs(exact) do yield(c) end              -- 2. 主碼 exact
  for _, e in ipairs(pool) do yield(e.c) end             -- 3. 其餘（照 選過→常用度）
end

return { init = init, fini = fini, func = filter }
