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
-- 其餘候選（形碼補全＋容錯＋拼音）混在同一池，照常用度（cf）排；詞的常用度取「最冷那個字」，
--   所以常用單字（愛）自然贏過冷詞（無瑕）。唯一保險：拼音的冷讀音（於＝wū 對 wu）常用度打折。
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

local function cf(text)            -- 常用度：單字用自己的；詞用「最冷門那個字」的
  -- 一個詞大致被它最冷的字卡住常用度（無瑕 照 瑕 排），這樣常用單字「愛」自然贏過「無瑕」。
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

local PY_TOPK    = 5      -- 拼音候選前 K 個當「正常讀音」，之後的當冷讀音
local PY_OBSCURE = 0.10   -- 冷讀音的常用度打折（例：於＝wū 對 wu 是冷讀音，別讓高字頻把它頂上來）

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

  -- 兩層：
  --   top  = 選過(衰減) / 簡碼 / 主碼 exact —— 有門檻或 userfreq，照 eu 排（userfreq 能蓋簡碼/exact）
  --   pool = 其餘全部（形碼補全＋容錯＋拼音）混在同一池，照常用度（cf）排；愛 這種常用字自然贏過 無瑕。
  -- 唯一保險：拼音候選若排在拼音自己前 K 名之外（冷讀音），常用度打折，免得像 於 靠高字頻爬到第一。
  local top, pool = {}, {}
  local pyRank = 0
  for i, c in ipairs(cands) do
    local isShort = c.type == "ap_short"
    local isExact = exactSet[c.text]
    local eu = math.max(effUf(c.text), isShort and S_FLOOR or (isExact and E_FLOOR or 0))
    if eu > 0 then
      top[#top + 1] = { c = c, i = i, eu = eu, w = cf(c.text) }
    else
      local mc = data.char2code[c.text]
      local isForm = isShort or c.type == "ap_pool" or (mc and mc:sub(1, #code) == code)
      local w = cf(c.text)
      if not isForm then                      -- 拼音候選
        pyRank = pyRank + 1
        if pyRank > PY_TOPK then w = w * PY_OBSCURE end
      end
      pool[#pool + 1] = { c = c, i = i, w = w }
    end
  end
  table.sort(top, function(a, b)
    if a.eu ~= b.eu then return a.eu > b.eu end
    if a.w ~= b.w then return a.w > b.w end
    return a.i < b.i
  end)
  table.sort(pool, function(a, b)             -- 一個池，照常用度排
    if a.w ~= b.w then return a.w > b.w end
    return a.i < b.i
  end)

  for _, r in ipairs(top) do yield(r.c) end
  for _, r in ipairs(pool) do yield(r.c) end
end

return { init = init, fini = fini, func = filter }
