-- 愛發筆＋拼音 · 候選重排（filter，只給 aiphabi_plus 用；純愛發筆的 aiphabi_order 不動）
-- 排序規則（使用者定的）：
--   選過次數（會隨時間衰減）  >  簡碼  >  主碼 exact  >  其餘照常用度
-- 用「虛擬選過次數（floor）」實作：
--   * 簡碼命中的字 floor = 9（S）：簡碼是發給最常用字的，就算撞到別字的完整碼，也要贏過那個 exact。
--   * 主碼 exact 的字 floor = 6（E）：次之；要「近期選過 >6 次」才壓得過它。
--     打滿的四碼快打（ap_si4）、打滿的左簡碼（ap_left）同樣吃這個 floor —— 都是推得
--     出來的碼，不是猜的。（左簡碼沒打完的補全不吃，那個是猜的。）
--   * 其餘 floor = 0。
--   每個候選的有效分數 = max(自己的衰減選過次數, floor)；先比這個，再比常用度。
--   所以「簡碼 > exact > 池」是預設；但你對某字（含拼音詞，如 BD→病毒）近期猛選、
--   衝過門檻（>6 壓過 exact、>9 壓過簡碼），它就會蓋過去；停一陣子衰減掉，又自動讓回來。
-- 其餘打滿整段、故意的捷徑候選（偏旁碼／同類／三簡＋拼音）混在同一池，照「常用度分數」排，
--   分數是同一把尺：
--     * 單字 —— 字頻（data.freq）。
--     * 多字詞 —— 真語料詞頻（data.wordfreq，essay 校準到單字同尺）；沒收錄的罕詞打折。
--   字頻推不出詞頻（無性 兩字常用詞卻冷、武俠 反之），所以詞一律查真詞頻。
--   唯一保險：拼音的冷讀音（於＝wū 對 wu，拼音自己排很後面）字頻雖高、要打折，免得爬到前面。
-- 碼還沒打完的補全（type=completion）不進這池，整批墊在它之後——見下方 comp bucket。
--   aiphabi_fuzzy 猜的「打錯了」（漏碼／多碼／隔壁鍵／打反）現在也標 completion、併進這一批：
--   猜你打錯了終究是猜的，不該無條件蓋過故意的捷徑，也不該蓋過「你可能還在打更長的詞」，
--   跟真的補全一起比常用度公平決勝（回報：NADNN 打 愉[容錯] 曾蓋過詞頻更高、真的還在打
--   的 愉快／愉悅）。
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
-- 補全候選（type=completion，打的是長詞前綴，如 YCLX→人民幣）整批墊在 pool 之後，
-- 不再跟打滿整段的候選（人民、碰巧）同池比字頻——曾用 0.7 打折，但頻率只高一點的
-- 補全（碰瓷 2110 vs 碰巧 1286）照樣壓過打滿的，索性硬分層。近期猛選的補全仍靠 top
-- 那個 bucket（PROMOTE_MIN）保送，不受影響。

local function filter(input, env)
  local cands = {}
  for c in input:iter() do cands[#cands + 1] = c end

  -- enable_sentence 切分後，context.input 是整串（電腦 + tbt）；候選是「目前這段」的。
  -- 用候選的 start 取出目前這段的碼，才查得到 exact（不然拿整串去查 code2chars 一定落空，
  -- 桌／卓 就不被當 exact、被高頻補全壓下去）。沒切分時 start=0，等於原本行為。
  -- 目前這段的範圍 [segStart, segEnd]：所有候選 start 最小、_end 最大。enable_sentence 會切出
  -- 各種子段，不能只看 cands[1]——它可能吃前段（水[K]，start 0）或吃後段（民[CLX]，start 1）。
  local full = env.engine.context.input or ""
  local segStart, segEnd = 1e9, 0
  for _, c in ipairs(cands) do
    local st = c.start or 0
    if st < segStart then segStart = st end
    local en = c._end or 0
    if en > segEnd then segEnd = en end
  end
  if segStart == 1e9 then segStart = 0 end
  local code = full:sub(segStart + 1, segEnd)

  if not code or code == "" or code:find("[^a-z]") then   -- 萬用鍵／含非字母：不重排
    for _, c in ipairs(cands) do yield(c) end
    return
  end

  local exactSet = {}
  for _, ch in ipairs(data.code2chars[code] or {}) do exactSet[ch] = true end

  -- 判斷候選是「形碼」還是「拼音」：形碼 preedit 是大寫字母（HOYJBT）；拼音是小寫音節。
  local function isFormCand(c)
    if c.type == "ap_short" or c.type == "ap_pool" or c.type == "ap_si4"
       or c.type == "ap_left" then return true end
    local mc = data.char2code[c.text]
    if mc and mc:sub(1, #code) == code then return true end
    local pe = c.preedit
    return pe ~= nil and pe:match("^[A-Z`]+$") ~= nil
  end

  -- 覆蓋：吃滿整段 [minStart, maxEnd] 的才算數；缺頭（民 吃後段）或缺尾（水／最 吃前段）都墊底。
  -- 只跟同源比（形碼 vs 形碼、拼音 vs 拼音），免得拼音簡拼吃滿整串、把形碼真詞前綴（歡樂）壓掉。
  local info = {}
  local sForm, eForm, sPy, ePy = 1e9, 0, 1e9, 0
  for i, c in ipairs(cands) do
    local form = isFormCand(c)
    local st, en = c.start or 0, c._end or 0
    info[i] = { form = form, st = st, en = en }
    if form then
      if st < sForm then sForm = st end
      if en > eForm then eForm = en end
    else
      if st < sPy then sPy = st end
      if en > ePy then ePy = en end
    end
  end

  -- top = 選過(衰減)/簡碼/exact；pool = 其餘打滿整段的同池照 cf；comp = 碼還沒打完的補全，
  -- 墊在 pool 之後（打滿的 碰巧 不該輸給還差一碼的 碰瓷）；part = 同源裡吃不滿的，降到最後。
  --
  -- top 內部以前整批照 (eu,w) table.sort——這樣一來，簡碼／主碼 exact／左簡碼／四碼這種
  -- 「沒被近期選過」的候選（eu 全靠 floor 撐、彼此打平）也會照常用度重排，把 aiphabi_hint
  -- 的約定簡碼撞碼demote（這/記、麼/魔…：開了簡碼、打主碼 IOZ 時故意把 這 擠到 記 後面，
  -- 逼你改打簡碼 IZ 打 這）整個廢掉——這 常用度比 記 高，一重排就排回第一，demote 形同
  -- 虛設（回報：Wilson 期待 aiphabi_plus 打 IOZ 也該看到 記 排第一，結果沒有；aiphabi_order.lua
  -- 那邊本來就用插入排序保住這個機制，這裡沒有）。
  -- 改法：跟 aiphabi_order.lua 同一套「只移動有算分的候選（mover）」插入排序——
  --   * ap_variant（打繁出簡打簡出繁）、碼表打滿整段但不在 exactSet 裡的詞（如 不要＝
  --     jqij）永遠算 mover：一出現就該照常用度插進對的位置，沒有「原始順序」這回事
  --     可以維持（跟 aiphabi_order.lua 的 always_score 同一條理由）。
  --   * 簡碼／主碼 exact／左簡碼／四碼：只有「近期真的被選過 ≥ PROMOTE_MIN 次」（eff，
  --     不是 floor 撐出來的 eu）才算 mover；沒被選過就完全不移動，維持 aiphabi_hint 給的
  --     原始順序——這才保得住上面說的 demote 機制。
  --   * 原本在 pool／comp 池子裡、近期被選過 ≥ PROMOTE_MIN 次的候選，一樣拉進 top、永遠
  --     算 mover（pool／comp 沒有「原始順序」需要保護，是使用者自己選出來的訊號）。
  -- eu＝max(eff,floor) 這把尺不變，所以「選超過 9 次才壓得過簡碼、超過 6 次才壓得過
  -- exact」這個既有的爬升門檻也不變——只是「沒被選過的候選之間」不再無條件比常用度。
  local top, pool, comp, part = {}, {}, {}, {}
  local pyRank = 0
  for i, c in ipairs(cands) do
    local form, st, en = info[i].form, info[i].st, info[i].en
    local minS = form and sForm or sPy
    local maxE = form and eForm or ePy
    -- 部件字沒打 ` 前綴卻冒出來（舊碼表殘留／使用者詞典）：壓到墊底那批，見 aiphabi_order.lua
    if data.component_chars and data.component_chars[c.text] then
      part[#part + 1] = { c = c, i = i, cov = -1, w = 0 }
    elseif st > minS or en < maxE then      -- 吃不滿整段（缺頭或缺尾）→ 墊底
      part[#part + 1] = { c = c, i = i, cov = en - st, w = cf(c.text) }
    else
      local isShort = c.type == "ap_short"
      local isVariant = c.type == "ap_variant"
      local isSi4OrLeft = c.type == "ap_si4" or c.type == "ap_left"
      local isPool = c.type == "ap_pool"
      local isComp = c.type == "completion"
      -- 打滿整段、非容錯(ap_pool)／非補全(completion) 的也算 exact——碼表裡就有詞打滿這個
      -- 碼（如 不要＝jqij），只是不在單字碼表 exactSet 裡，打中就是打中，不是猜的，不能跟
      -- ap_pool 的容錯猜測同池比字頻（跟 aiphabi_order.lua 同一條修法，見那邊註解）；
      -- 這種「不在 exactSet」的情況（isFallback）跟 ap_variant 一樣永遠算 mover。
      local isFallback = (not isShort) and (not isVariant) and (not isSi4OrLeft)
        and (not isPool) and (not isComp) and (not exactSet[c.text])
      local isExactSetMember = (not isShort) and (not isVariant) and (not isSi4OrLeft)
        and (not isPool) and (not isComp) and exactSet[c.text]
      local alwaysMover = isVariant or isFallback
      local floor = isShort and S_FLOOR
        or ((isSi4OrLeft or isExactSetMember or alwaysMover) and E_FLOOR or 0)
      local eff = effUf(c.text)
      local eu = math.max(eff, floor)
      if eu >= PROMOTE_MIN then
        top[#top + 1] = { c = c, i = i, eu = eu, w = cf(c.text),
          mover = alwaysMover or eff >= PROMOTE_MIN, si4 = c.type == "ap_si4" }
      else
        local w = cf(c.text)
        if not form then
          pyRank = pyRank + 1
          -- 冷讀音打折只針對「單字」拼音候選（於＝wū）；多字詞不算
          if pyRank > PY_TOPK and ulen(c.text) == 1 then w = w * PY_OBSCURE end
        end
        if isComp then          -- 碼還沒打完：不進 pool，整批墊在 pool 之後
          comp[#comp + 1] = { c = c, i = i, w = w }
        else
          pool[#pool + 1] = { c = c, i = i, w = w }
        end
      end
    end
  end
  -- 插入排序前先把「主碼真的打中的字」跟「四碼快打湊巧撞同簽名的詞」（ap_si4）分兩批、
  -- 前者在前，兩批各自維持原序——不然常用單字會被候選來源剛好先吐出來的生僻四碼詞蓋過
  -- （跟 aiphabi_order.lua 同一條修法，見那邊註解；回報：jwej 打「爭」被地名「万山群島」
  -- 蓋過，兩邊都沒被選過，插入排序不會動它們，得靠這個分批墊底——純愛發筆那邊本來就有
  -- 這個分批，這裡是跟上約定簡碼撞碼demote 那個修法後才第一次需要它，之前 top 整批
  -- table.sort 時沒這個問題，因為那時候「沒被選過的候選」本來就會照常用度重排）。
  do
    local primary, si4Group = {}, {}
    for _, e in ipairs(top) do
      if e.si4 then si4Group[#si4Group + 1] = e else primary[#primary + 1] = e end
    end
    top = primary
    for _, e in ipairs(si4Group) do top[#top + 1] = e end
  end
  -- 插入排序：只有 mover 會往前追，追過「贏過正前方」的位置就停；non-mover 之間（含
  -- non-mover 對 non-mover、non-mover 被動待在原地）的相對順序完全不碰。
  for i = 2, #top do
    if top[i].mover then
      local j = i
      while j > 1 and (top[j - 1].eu < top[j].eu
            or (top[j - 1].eu == top[j].eu and top[j - 1].w < top[j].w)) do
        top[j - 1], top[j] = top[j], top[j - 1]
        j = j - 1
      end
    end
  end
  -- 池子上限：跟 aiphabi_order.lua 同理（見那邊註解）——候選欄一次只顯示 8～10 個，
  -- 沒人會不打字一路翻好幾十頁；I／J 這種常見字根補全一次可能上萬個候選，全排會卡頓
  -- （量過 17727 個時排序要 ~15ms，還沒算前面分類的開銷，Squirrel 裡的真實 Candidate
  -- 物件更重）。近期選過的字已經靠 top 那個 bucket（PROMOTE_MIN）保送，不受這個上限
  -- 影響；超過上限的維持原始順序（碼表已經照 weight 排過）接在後面。
  local MAX_SORT = 40
  if #pool > MAX_SORT then
    local head, tail = {}, {}
    for i = 1, MAX_SORT do head[i] = pool[i] end
    for i = MAX_SORT + 1, #pool do tail[#tail + 1] = pool[i] end
    table.sort(head, function(a, b)
      if a.w ~= b.w then return a.w > b.w end
      return a.i < b.i
    end)
    for _, e in ipairs(tail) do head[#head + 1] = e end
    pool = head
  else
    table.sort(pool, function(a, b)
      if a.w ~= b.w then return a.w > b.w end
      return a.i < b.i
    end)
  end
  -- 補全彼此照常用度；整批排在 pool 之後。同樣吃 MAX_SORT 上限（見上面）。
  -- 分數打平時優先真正的詞組補全，勝過四碼快打前二／三碼補全——理由跟 aiphabi_order.lua
  -- 同一段註解：手機上 M.wordfreq 清空，多字詞常打平在 0 分，四碼快打不該靠來源順序贏。
  local function compCmp(a, b)
    if a.w ~= b.w then return a.w > b.w end
    local pa = not (a.c.comment and a.c.comment:find("^四碼"))
    local pb = not (b.c.comment and b.c.comment:find("^四碼"))
    if pa ~= pb then return pa end
    return a.i < b.i
  end
  if #comp > MAX_SORT then
    local head, tail = {}, {}
    for i = 1, MAX_SORT do head[i] = comp[i] end
    for i = MAX_SORT + 1, #comp do tail[#tail + 1] = comp[i] end
    table.sort(head, compCmp)
    for _, e in ipairs(tail) do head[#head + 1] = e end
    comp = head
  else
    table.sort(comp, compCmp)
  end
  table.sort(part, function(a, b)             -- 前綴候選：吃得越多越前，再比常用度
    if a.cov ~= b.cov then return a.cov > b.cov end
    if a.w ~= b.w then return a.w > b.w end
    return a.i < b.i
  end)

  for _, r in ipairs(top) do yield(r.c) end
  for _, r in ipairs(pool) do yield(r.c) end
  for _, r in ipairs(comp) do yield(r.c) end
  for _, r in ipairs(part) do yield(r.c) end
end

-- _UF／_bump：只給 tests/run_tests.lua 用，不影響正式行為。
return { init = init, fini = fini, func = filter, _UF = UF, _bump = bump,
         _S_FLOOR = S_FLOOR, _E_FLOOR = E_FLOOR, _PROMOTE_MIN = PROMOTE_MIN }
