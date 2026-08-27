-- 愛發筆 · 候選重排（filter，排在 hint / fuzzy 之後、simplifier 之前）
-- 順序固定成三層：
--   1. 約定簡碼（type=ap_short）—— 認定過「就這個字」，永遠第一。
--   2. 主碼 exact match —— 你打的碼剛好是某字的完整碼（在 code2chars[碼] 裡）。
--      打滿的四碼快打（ap_si4）、打滿的左簡碼（ap_left）也算這一級：都是推得出來的
--      碼、確定性跟打中主碼同級，不該跟猜測同池。（左簡碼「還沒打完」的補全不算，
--      那個是猜的，留在第 3 層。）
--   3. 其餘全部一池：補全、偏旁碼、同類、三簡、容錯（後四者都標 type=ap_pool）。
--      這一池不分類別，一律照「本次開機選過幾次（降冪）→ 常用度（降冪）」排。
--      例：打 W，心（偏旁碼）比一堆冷僻的三點水補全常用，就會排到它們前面。
-- 使用者選字次數只記在記憶體、純加分（重開歸零，不動碼表）；拿不到 commit_notifier
-- 也沒關係，退回純常用度排序，候選照樣出得來。
local data = require("aiphabi_data")

-- 上一次上屏的文字：給 aiphabi_wildcard 的「重複上字」（單獨 `）用，見該檔開頭註解。
local LAST_COMMIT = nil
local function get_last_commit() return LAST_COMMIT end

local USERFREQ = {}
-- 選字次數持久化：存在 Rime 使用者目錄（macOS：~/Library/Rime）。拿不到路徑或不能寫，
-- 就退回「只記這次開機」——照樣能用，只是重開後不記得。格式：每行「字\t次數」。
local PATH = (os.getenv("HOME") and (os.getenv("HOME") .. "/Library/Rime/aiphabi_userfreq.tsv")) or nil

local function load()
  if not PATH then return end
  local f = io.open(PATH, "r"); if not f then return end
  for line in f:lines() do
    local ch, n = line:match("^(.-)\t(%d+)$")
    if ch and ch ~= "" then USERFREQ[ch] = tonumber(n) end
  end
  f:close()
end

local function save()
  if not PATH then return end
  local f = io.open(PATH, "w"); if not f then return end
  for ch, n in pairs(USERFREQ) do f:write(ch, "\t", n, "\n") end
  f:close()
end

local function bump(text)                 -- 詞本身也要加分，不能只拆單字——不然選詞候選
  USERFREQ[text] = (USERFREQ[text] or 0) + 1  -- （score() 查的是整個候選的 text）永遠選不進去，
  local i = 1                                 -- 次數全記在拆出來的單字頭上，詞卡在原地不會升。
  while i <= #text do
    local b = text:byte(i)
    local len = (b < 0x80 and 1) or (b < 0xE0 and 2) or (b < 0xF0 and 3) or 4
    local ch = text:sub(i, i + len - 1)
    if ch ~= text then USERFREQ[ch] = (USERFREQ[ch] or 0) + 1 end  -- 單字本身避免跟上面重複加
    i = i + len
  end
end

-- 記一次上屏：手動選字（commit_notifier 接得到）跟 aiphabi_autocommit 的自動上屏
-- （唯一上屏／即時頂，見該檔）共用同一個入口。實測發現：engine:commit_text() 是
-- 直接送字（跟 rime-ice select_character.lua 同一種寫法），不會像正常選字那樣經過
-- Context:Commit()——commit_notifier 收不到，自動上屏出來的字選字次數／重複上字都
-- 記不到（回報：打 當 自動上屏後按 `，重複上字不是 當）。所以 aiphabi_autocommit
-- 每次呼叫 engine:commit_text() 也要自己呼叫這裡一次，不能只靠 notifier。
local function note_commit(text)
  if not text or text == "" then return end
  LAST_COMMIT = text
  bump(text)
  pcall(save)                             -- 每次上屏就寫回，重開也記得
end

local function init(env)
  pcall(load)                             -- 開機讀回上次的選字次數
  local ok, ctx = pcall(function() return env.engine.context end)
  if not ok or not ctx then return end
  pcall(function()
    env.ap_order_notifier = ctx.commit_notifier:connect(function(context)
      local got, text = pcall(function() return context:get_commit_text() end)
      if got and text and text ~= "" then
        pcall(note_commit, text)
      end
    end)
  end)
end

local function fini(env)
  if env.ap_order_notifier then pcall(function() env.ap_order_notifier:disconnect() end) end
end

local function cf(text)                    -- 常用度：單字用字頻，多字（切分組出的詞）用詞頻
  return (data.wordfreq and data.wordfreq[text]) or data.freq[text] or 0
end
local function score(ch)                   -- 選過次數優先，其次常用度
  return (USERFREQ[ch] or 0) * 1000000000 + cf(ch)
end

local function filter(input, env)
  local cands = {}
  for cand in input:iter() do cands[#cands + 1] = cand end

  -- enable_sentence 切分後，context.input 是整串；候選是「目前這段」的。目前這段的範圍
  -- [segStart, segEnd]＝所有候選 start 最小、_end 最大（不能只看 cands[1]，它可能吃前段或後段）。
  -- 用這段的碼查 exact（不然拿整串查 code2chars 一定落空、exact 字被壓下去）。
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

  -- 萬用鍵／空碼／含非字母：不重排，原樣輸出——唯一例外是重複上字（ap_repeat，見
  -- aiphabi_wildcard.lua）：punct_translator 也認得反引號，會搶先冒出「`」符號本身
  -- 這個候選，排在 translators: 清單裡萬用鍵前面；不吃掉它，只是把 ap_repeat 挑出來
  -- 墊到最前，其餘（含那個「`」符號）維持原順序接在後面。
  if not code or code == "" or code:find("[^a-z]") then
    local repeatCand, restIdx = nil, 0
    local rest = {}
    for _, c in ipairs(cands) do
      if not repeatCand and c.type == "ap_repeat" then
        repeatCand = c
      else
        restIdx = restIdx + 1
        rest[restIdx] = c
      end
    end
    if repeatCand then yield(repeatCand) end
    for _, c in ipairs(rest) do yield(c) end
    return
  end

  local exactSet = {}
  for _, ch in ipairs(data.code2chars[code] or {}) do exactSet[ch] = true end

  -- 覆蓋：enable_sentence 會冒出吃前段（水[K]）或吃後段（民[CLX]）的切分候選。吃不滿整段
  -- [segStart,segEnd]（缺頭或缺尾）的一律墊底，別讓常用單字壓過打滿的詞（水瓶座＝KVRF、人民＝YCLX）。
  local short, exact, pool, part = {}, {}, {}, {}
  for _, c in ipairs(cands) do
    if (c.start or 0) > segStart or (c._end or 0) < segEnd then
      part[#part + 1] = { c = c, cov = (c._end or 0) - (c.start or 0) }
    elseif c.type == "ap_short" then short[#short + 1] = c
    elseif c.type == "ap_si4" then exact[#exact + 1] = c   -- 打滿四碼詞＝exact 一級
    elseif c.type == "ap_left" then exact[#exact + 1] = c  -- 打滿的左簡碼＝exact 一級（推得出來的碼，不是猜的）
    elseif c.type == "ap_pool" then pool[#pool + 1] = { c = c }
    elseif exactSet[c.text] then exact[#exact + 1] = c
    else pool[#pool + 1] = { c = c } end                 -- 補全（沒中完整碼）也丟進池子
  end

  -- 選過的字別被上限擋住：USERFREQ 命中的（這台機器上真的選過的字，跟字根補全量無關，
  -- 表本來就小）另外抽出來全排、擺最前面；池子其餘的才吃下面那個上限。
  local boosted, plain = {}, {}
  for _, e in ipairs(pool) do
    if USERFREQ[e.c.text] then boosted[#boosted + 1] = e else plain[#plain + 1] = e end
  end
  for i, e in ipairs(boosted) do e.i = i end
  table.sort(boosted, function(a, b)
    local sa, sb = score(a.c.text), score(b.c.text)
    if sa ~= sb then return sa > sb end
    return a.i < b.i
  end)

  -- 池子上限：候選欄一次只顯示 8～10 個，沒人會不打字一路翻超過幾頁。I／J 這種常見
  -- 字根補全一次可能上萬個候選，每一鍵都整包排序會卡頓（量過：17727 個時 table.sort
  -- 要 ~50ms，Squirrel 裡的真實 Candidate 物件比這裡的模擬更重，實際感受到的卡頓比這
  -- 個數字更久）。只排前 MAX_SORT 個，換算大概十頁的量，翻到那麼深的機率極低；真翻到
  -- 了，超過的部分维持原始順序（碼表已經照 weight 排過，還是堪用，只是沒精排）接在後面。
  local MAX_SORT = 40
  local plainHead, plainTail = plain, nil
  if #plain > MAX_SORT then
    plainHead, plainTail = {}, {}
    for i = 1, MAX_SORT do plainHead[i] = plain[i] end
    for i = MAX_SORT + 1, #plain do plainTail[#plainTail + 1] = plain[i] end
  end
  for i, e in ipairs(plainHead) do e.i = i end            -- 穩定排序用的原序
  table.sort(plainHead, function(a, b)
    local sa, sb = score(a.c.text), score(b.c.text)
    if sa ~= sb then return sa > sb end
    return a.i < b.i
  end)
  if plainTail then
    for _, e in ipairs(plainTail) do plainHead[#plainHead + 1] = e end
  end
  pool = boosted
  for _, e in ipairs(plainHead) do pool[#pool + 1] = e end
  for i, e in ipairs(part) do e.i = i end                -- 前綴候選：吃得越多越前
  table.sort(part, function(a, b)
    if a.cov ~= b.cov then return a.cov > b.cov end
    return a.i < b.i
  end)

  for _, c in ipairs(short) do yield(c) end              -- 1. 簡碼
  for _, c in ipairs(exact) do yield(c) end              -- 2. 主碼 exact
  for _, e in ipairs(pool) do yield(e.c) end             -- 3. 其餘（照 選過→常用度）
  for _, e in ipairs(part) do yield(e.c) end             -- 4. 只吃前綴的切分候選，墊底
end

-- _USERFREQ／_bump：只給 tests/run_tests.lua 用，不影響正式行為。
-- get_last_commit／note_commit：給 aiphabi_wildcard／aiphabi_autocommit 用，是正式行為的一部分。
return { init = init, fini = fini, func = filter, _USERFREQ = USERFREQ, _bump = bump,
         get_last_commit = get_last_commit, note_commit = note_commit }
