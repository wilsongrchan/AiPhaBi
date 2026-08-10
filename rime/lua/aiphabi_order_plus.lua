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
-- 常用度（cf）：短碼（≤5，形碼／拼音短碼混戰的情況）才拿它排「其餘」；長串（純拼音
--   組句，如 wodemingzi）不動拼音自己的順序，只把簡碼／exact 插到前面。
-- 選過次數存在 ~/Library/Rime/aiphabi_plus_userfreq.tsv（字\t分數\t時間戳），
--   每次 commit 累加、寫回；拿不到檔案就退回只記本次開機，候選照樣出。
local data = require("aiphabi_data")

local HALFLIFE = 2.5 * 24 * 3600   -- 衰減半衰期：2.5 天（秒）
local S_FLOOR  = 3                  -- 簡碼門檻
local E_FLOOR  = 6                  -- 主碼 exact 門檻
local SHORT_MAX = 5                 -- 碼長 ≤ 此值才做跨系統常用度重排

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

local function firstchar(s)
  local b = s:byte(1) or 0
  local len = (b < 0x80 and 1) or (b < 0xE0 and 2) or (b < 0xF0 and 3) or 4
  return s:sub(1, len)
end
local function cf(text)            -- 常用度：單字用自己的；詞用首字的
  return data.freq[text] or data.freq[firstchar(text)] or 0
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

local PY_PER_GUESS = 2   -- 交錯比例：每插 1 個形碼猜測，先放 2 個拼音（拼音通常是主要想要的）

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

  -- 分三桶：
  --   top     = 選過(衰減) / 簡碼 / 主碼 exact —— 有 floor 或 userfreq，照 eu 排（userfreq 能蓋簡碼/exact）
  --   guesses = 其餘「形碼」候選（補全、容錯掉亂碼、同類/偏旁提示），照常用度排
  --   pinyin  = 拼音候選 —— 保留拼音自己的排序（尊重它的機率，別被字頻蓋掉，例：於 wū 是冷讀音就該排後面）
  local top, guesses, pinyin = {}, {}, {}
  for i, c in ipairs(cands) do
    local isShort = c.type == "ap_short"
    local isExact = exactSet[c.text]
    local eu = math.max(effUf(c.text), isShort and S_FLOOR or (isExact and E_FLOOR or 0))
    local mc = data.char2code[c.text]
    local isForm = isShort or isExact or c.type == "ap_pool"
                   or (mc and mc:sub(1, #code) == code)      -- 形碼補全（碼以輸入開頭）
    local rec = { c = c, i = i, eu = eu, cf = cf(c.text) }
    if eu > 0 then top[#top + 1] = rec
    elseif isForm then guesses[#guesses + 1] = rec
    else pinyin[#pinyin + 1] = rec end
  end
  table.sort(top, function(a, b)
    if a.eu ~= b.eu then return a.eu > b.eu end
    if a.cf ~= b.cf then return a.cf > b.cf end
    return a.i < b.i
  end)
  table.sort(guesses, function(a, b)   -- 形碼猜測照常用度（愛 這種常用字排前面，冷字排後）
    if a.cf ~= b.cf then return a.cf > b.cf end
    return a.i < b.i
  end)
  -- pinyin 維持原順序（i 遞增），不動

  for _, r in ipairs(top) do yield(r.c) end
  local gi, pj = 1, 1
  while gi <= #guesses or pj <= #pinyin do
    for _ = 1, PY_PER_GUESS do
      if pj <= #pinyin then yield(pinyin[pj].c); pj = pj + 1 end
    end
    if gi <= #guesses then yield(guesses[gi].c); gi = gi + 1 end
  end
end

return { init = init, fini = fini, func = filter }
