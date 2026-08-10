-- 愛發筆＋拼音 · 候選重排（filter，只給 aiphabi_plus 用；純愛發筆的 aiphabi_order 不動）
-- 排序規則（使用者定的）：
--   選過次數（會隨時間衰減）  >  簡碼  >  主碼 exact  >  其餘照常用度
-- 用「虛擬選過次數（floor）」實作門檻：
--   * 簡碼命中的字 floor = 3（S）：別的候選要「近期選過 >3 次」才壓得過它。
--   * 主碼 exact 的字 floor = 6（E）：要「近期選過 >6 次」才壓得過它（比簡碼更黏）。
--   * 其餘 floor = 0。
--   每個候選的有效分數 = max(自己的衰減選過次數, floor)；先比這個，再比常用度。
--   所以簡碼／exact 預設在最前，但你對某字（含拼音詞，如 BD→病毒）近期猛選、
--   衝過門檻，它就會蓋過去；停一陣子衰減掉，又自動讓回來。
-- 其餘候選（形碼補全＋容錯＋拼音）排在一起：字頻推不出詞頻（無性 兩字常用詞卻冷、武俠 反之），
--   而拼音引擎本來就用真語料把詞排好了（武俠 排 無性 前、冷讀音 於 排後），所以：
--     * 拼音候選 —— 保留拼音自己的名次（等於用真詞頻），第 k 名給位置分 1-(k-.5)/P。
--     * 形碼候選（補全／容錯，多半單字）—— 給「字頻百分位」當位置分（愛 這種常用字排前面）。
--   兩邊照位置分一起排。這樣常用形碼字插到拼音高頻詞之間，罕見形碼字沉到後面。
-- 選過次數存在 ~/Library/Rime/aiphabi_plus_userfreq.tsv（字\t分數\t時間戳），
--   每次 commit 累加、寫回；拿不到檔案就退回只記本次開機，候選照樣出。
local data = require("aiphabi_data")

local HALFLIFE = 2.5 * 24 * 3600   -- 衰減半衰期：2.5 天（秒）
local S_FLOOR  = 3                  -- 簡碼門檻
local E_FLOOR  = 6                  -- 主碼 exact 門檻

local PATH = (os.getenv("HOME") and (os.getenv("HOME") .. "/Library/Rime/aiphabi_plus_userfreq.tsv")) or nil
local UF = {}                      -- text -> { score, ts }

local function now() local ok, t = pcall(os.time); return ok and t or 0 end
local function decay(dt) return 0.5 ^ (dt / HALFLIFE) end
local function effUf(text)
  local e = UF[text]; if not e then return 0 end
  return e.score * decay(now() - e.ts)
end
local function bump(text)
  local e = UF[text]
  if e then e.score = e.score * decay(now() - e.ts) + 1; e.ts = now()
  else UF[text] = { score = 1, ts = now() } end
end
local function load()
  if not PATH then return end
  local f = io.open(PATH, "r"); if not f then return end
  for line in f:lines() do
    local t, s, ts = line:match("^(.-)\t([%d.]+)\t(%d+)$")
    if t and t ~= "" then UF[t] = { score = tonumber(s), ts = tonumber(ts) } end
  end
  f:close()
end
local function save()
  if not PATH then return end
  local f = io.open(PATH, "w"); if not f then return end
  for t, e in pairs(UF) do f:write(t, "\t", string.format("%.4f", e.score), "\t", e.ts, "\n") end
  f:close()
end

local function cf(text)            -- 字頻分數：單字用自己的；多字取「最冷那個字」（只給形碼候選用）
  local m, i = nil, 1
  while i <= #text do
    local b = text:byte(i)
    local len = (b < 0x80 and 1) or (b < 0xE0 and 2) or (b < 0xF0 and 3) or 4
    local f = data.freq[text:sub(i, i + len - 1)] or 0
    if m == nil or f < m then m = f end
    i = i + len
  end
  return m or 0
end

local FSORT = nil                  -- 所有字頻值（升序），算百分位用；第一次用時建好快取
local function pct(f)              -- f 落在所有字頻裡的百分位（0..1）
  if not FSORT then
    FSORT = {}
    for _, v in pairs(data.freq) do FSORT[#FSORT + 1] = v end
    table.sort(FSORT)
  end
  local n = #FSORT
  if n == 0 then return 0.5 end
  local lo, hi = 1, n
  while lo <= hi do
    local mid = math.floor((lo + hi) / 2)
    if FSORT[mid] <= f then lo = mid + 1 else hi = mid - 1 end
  end
  return (lo - 1) / n
end

local function init(env)
  pcall(load)
  local ok, ctx = pcall(function() return env.engine.context end)
  if not ok or not ctx then return end
  pcall(function()
    env.apx_notifier = ctx.commit_notifier:connect(function(context)
      local got, text = pcall(function() return context:get_commit_text() end)
      if got and text and text ~= "" then pcall(bump, text); pcall(save) end
    end)
  end)
end
local function fini(env)
  if env.apx_notifier then pcall(function() env.apx_notifier:disconnect() end) end
end

local function filter(input, env)
  local code = env.engine.context.input
  local cands = {}
  for c in input:iter() do cands[#cands + 1] = c end

  if not code or code == "" or code:find("[^a-z]") then   -- 萬用鍵／含非字母：不重排
    for _, c in ipairs(cands) do yield(c) end
    return
  end

  local exactSet = {}
  for _, ch in ipairs(data.code2chars[code] or {}) do exactSet[ch] = true end

  -- top = 選過(衰減) / 簡碼 / 主碼 exact；form = 其餘形碼候選；py = 拼音候選（保留拼音名次）
  local top, form, py = {}, {}, {}
  for i, c in ipairs(cands) do
    local isShort = c.type == "ap_short"
    local isExact = exactSet[c.text]
    local eu = math.max(effUf(c.text), isShort and S_FLOOR or (isExact and E_FLOOR or 0))
    if eu > 0 then
      top[#top + 1] = { c = c, i = i, eu = eu, w = cf(c.text) }
    else
      local mc = data.char2code[c.text]
      local isForm = isShort or c.type == "ap_pool" or (mc and mc:sub(1, #code) == code)
      if isForm then form[#form + 1] = { c = c, i = i } else py[#py + 1] = { c = c, i = i } end
    end
  end

  -- 混池：拼音照名次給位置分（等於真詞頻）；形碼照字頻百分位給位置分。
  local pool, P = {}, math.max(#py, 1)
  for k, e in ipairs(py) do
    pool[#pool + 1] = { c = e.c, i = e.i, score = 1 - (k - 0.5) / P }
  end
  for _, e in ipairs(form) do
    pool[#pool + 1] = { c = e.c, i = e.i, score = pct(cf(e.c.text)) }
  end

  table.sort(top, function(a, b)
    if a.eu ~= b.eu then return a.eu > b.eu end
    if a.w ~= b.w then return a.w > b.w end
    return a.i < b.i
  end)
  table.sort(pool, function(a, b)
    if a.score ~= b.score then return a.score > b.score end
    return a.i < b.i
  end)

  for _, r in ipairs(top) do yield(r.c) end
  for _, r in ipairs(pool) do yield(r.c) end
end

return { init = init, fini = fini, func = filter }
