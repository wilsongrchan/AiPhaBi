-- 愛發筆＋拼音 · 候選重排（filter，只給 aiphabi_plus 用；純愛發筆的 aiphabi_order 不動）
-- 排序規則（使用者定的）：
--   選過次數（會隨時間衰減）  >  簡碼  >  主碼 exact  >  其餘照常用度
-- 用「虛擬選過次數（floor）」實作：
--   * 簡碼命中的字 floor = 9（S）：簡碼是發給最常用字的，就算撞到別字的完整碼，也要贏過那個 exact。
--   * 主碼 exact 的字 floor = 6（E）：次之；要「近期選過 >6 次」才壓得過它。
--   * 其餘 floor = 0。
--   每個候選的有效分數 = max(自己的衰減選過次數, floor)；先比這個，再比常用度。
--   所以「簡碼 > exact > 池」是預設；但你對某字（含拼音詞，如 BD→病毒）近期猛選、
--   衝過門檻（>6 壓過 exact、>9 壓過簡碼），它就會蓋過去；停一陣子衰減掉，又自動讓回來。
-- 其餘候選（形碼補全＋容錯＋拼音）混在同一池，照「常用度分數」排，分數是同一把尺：
--     * 單字 —— 字頻（data.freq）。
--     * 多字詞 —— 真語料詞頻（data.wordfreq，essay 校準到單字同尺）；沒收錄的罕詞打折。
--   字頻推不出詞頻（無性 兩字常用詞卻冷、武俠 反之），所以詞一律查真詞頻。
--   唯一保險：拼音的冷讀音（於＝wū 對 wu，拼音自己排很後面）字頻雖高、要打折，免得爬到前面。
-- 升頂門檻 PROMOTE_MIN = 3：池裡的字要「近期選過 ≥3 次」才升到 top 區、開始壓過整池；手滑選一兩次
--   （如剛剛的 於）不算，留在池裡照常用度排。簡碼(9)／exact(6) 靠 floor 本來就 ≥3，永遠在 top。
-- 選過次數存在 ~/Library/Rime/aiphabi_plus_userfreq.tsv（字\t分數\t時間戳），
--   每次 commit 累加、寫回；拿不到檔案就退回只記本次開機，候選照樣出。
local data = require("aiphabi_data")

local HALFLIFE = 2.5 * 24 * 3600   -- 衰減半衰期：2.5 天（秒）
local S_FLOOR     = 9               -- 簡碼 floor：預設排最前（撞到別字完整碼也贏）
local E_FLOOR     = 6               -- 主碼 exact floor：次之
local PROMOTE_MIN = 3               -- 池裡的字選過 ≥ 此值才升到 top 區（擋手滑一兩次）

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

local RARE_WORD = 0.2              -- 詞頻表沒收的多字詞＝罕詞，用最冷字字頻打這個折
local function clen(b) return (b < 0x80 and 1) or (b < 0xE0 and 2) or (b < 0xF0 and 3) or 4 end
local function ulen(s)             -- UTF-8 字數
  local n = 0
  for i = 1, #s do local b = s:byte(i); if b < 128 or b >= 192 then n = n + 1 end end
  return n
end
local function cf(text)            -- 常用度分數（同一把尺：單字字頻、多字真詞頻）
  local first = clen(text:byte(1) or 0)
  if #text > first then            -- 多字詞
    local wf = data.wordfreq and data.wordfreq[text]
    if wf then return wf end
    local m, i = nil, 1            -- 罕詞：取最冷字字頻再打折
    while i <= #text do
      local len = clen(text:byte(i))
      local f = data.freq[text:sub(i, i + len - 1)] or 0
      if m == nil or f < m then m = f end
      i = i + len
    end
    return (m or 0) * RARE_WORD
  end
  return data.freq[text] or 0      -- 單字
end

local function init(env)
  pcall(load)
  local ok, ctx = pcall(function() return env.engine.context end)
  if not ok or not ctx then return end
  pcall(function()
    env.apx_notifier = ctx.commit_notifier:connect(function(context)
      local got, text = pcall(function() return context:get_commit_text() end)
      -- 只記「含漢字」的上屏（標點、英數不訓練，免得像 ，被誤記）
      if got and text and text ~= "" and text:find("[\228-\233]") then
        pcall(bump, text); pcall(save)
      end
    end)
  end)
end
local function fini(env)
  if env.apx_notifier then pcall(function() env.apx_notifier:disconnect() end) end
end

local PY_TOPK    = 5      -- 拼音候選前 K 名當「正常讀音」；之後的當冷讀音（於＝wū 對 wu）
local PY_OBSCURE = 0.10   -- 冷讀音字頻打這個折，免得高字頻把它頂到前面
local COMPLETION_PEN = 0.7 -- 補全候選（打的是長詞前綴，如 YCLX→人民幣）打個折，讓打滿的 exact（人民）
                           -- 有優勢；但只是打折不是絕對——頻率高很多的補全（中華）照樣壓過冷門 exact。

local function filter(input, env)
  local code = env.engine.context.input
  local cands = {}
  for c in input:iter() do cands[#cands + 1] = c end

  if not code or code == "" or code:find("[^a-z]") then   -- 萬用鍵／含非字母：不重排
    for _, c in ipairs(cands) do yield(c) end
    return
  end

  -- 覆蓋長度：能吃掉整串輸入的候選（zuimeidehua→最美的話）要贏過只吃前段的（最、最美）。
  -- 只吃前綴的一律降到最後，照吃得越多越前、再照常用度。短碼時大家都吃滿，等於沒差。
  local maxCov = 0
  for _, c in ipairs(cands) do
    local e = c._end or 0
    if e > maxCov then maxCov = e end
  end

  local exactSet = {}
  for _, ch in ipairs(data.code2chars[code] or {}) do exactSet[ch] = true end

  -- 吃滿的：top = 有效選過次數 ≥ PROMOTE_MIN(3)（簡碼 floor 9／exact floor 6 靠 floor 就達標）；
  --         pool = 其餘全部同池照 cf 排，拼音冷讀音打折。 part = 只吃前綴的，全部降到最後。
  local top, pool, part = {}, {}, {}
  local pyRank = 0
  for i, c in ipairs(cands) do
    if (c._end or maxCov) < maxCov then
      part[#part + 1] = { c = c, i = i, cov = c._end or 0, w = cf(c.text) }
    else
      local isShort = c.type == "ap_short"
      local isExact = exactSet[c.text]
      local eu = math.max(effUf(c.text), isShort and S_FLOOR or (isExact and E_FLOOR or 0))
      if eu >= PROMOTE_MIN then
        top[#top + 1] = { c = c, i = i, eu = eu, w = cf(c.text) }
      else
        local mc = data.char2code[c.text]
        local isForm = isShort or c.type == "ap_pool" or (mc and mc:sub(1, #code) == code)
        local w = cf(c.text)
        if not isForm then
          pyRank = pyRank + 1
          -- 冷讀音打折只針對「單字」拼音候選（於＝wū）；多字詞（人民/中華）不是冷讀音、不打折
          if pyRank > PY_TOPK and ulen(c.text) == 1 then w = w * PY_OBSCURE end
        end
        if c.type == "completion" then w = w * COMPLETION_PEN end   -- 補全讓步給打滿的 exact
        pool[#pool + 1] = { c = c, i = i, w = w }
      end
    end
  end
  table.sort(top, function(a, b)
    if a.eu ~= b.eu then return a.eu > b.eu end
    if a.w ~= b.w then return a.w > b.w end
    return a.i < b.i
  end)
  table.sort(pool, function(a, b)
    if a.w ~= b.w then return a.w > b.w end
    return a.i < b.i
  end)
  table.sort(part, function(a, b)             -- 前綴候選：吃得越多越前，再比常用度
    if a.cov ~= b.cov then return a.cov > b.cov end
    if a.w ~= b.w then return a.w > b.w end
    return a.i < b.i
  end)

  for _, r in ipairs(top) do yield(r.c) end
  for _, r in ipairs(pool) do yield(r.c) end
  for _, r in ipairs(part) do yield(r.c) end
end

return { init = init, fini = fini, func = filter }
