-- 愛發筆 · 自動上屏（processor，排在 speller 前面）
-- 開了 aiphabi_autocommit：這一鍵自己收（push_input），不讓 speller 收——收完馬上問一次
-- 「候選只剩一個，沒有第二個排隊」，是就直接上屏；不是就跟平常沒兩樣，繼續等下一鍵。
-- 打完最後一個字母當下就上屏，不必再多打一鍵、也不必按空白。
--
-- 「候選只剩一個」問的是 aiphabi_order 排好的最終候選欄：同類字／偏旁碼／三簡碼／
-- 左簡碼／四碼快打提示、還沒打完的補全，全部算在內，只要還有東西排隊，就代表
-- 「繼續打或許還有別的可能」，一律不上屏。唯獨容錯猜測（方括號標的）不算——那是
-- 「怕你打錯鍵」的另一個碼的提醒，跟這碼本身有沒有打完無關，見下面 is_fuzzy_guess。
--
-- 即時頂（2026-08-26 加，2026-08-27 停用）：唯一上屏只顧「打完了」，管不到「開
-- PPIN、闞 PPINX/PPINEX 這種罕見字卡住常見字」——闞這種字太少見，開永遠等不到
-- 「唯一」。即時頂本來是另一條路：不管現在是不是唯一，只要「這一鍵會把碼打死」
-- （見 is_dead_extension），就把上一段候選欄排最前面那個頂上屏。概念跟 Wilson
-- 貼的文章一致，叫「規則頂屏・即時頂」。**目前停用**——量出來 seg.menu:prepare()
-- 在頂之前那段沒收下這一鍵的舊 segment 上，成本時好時壞（10ms～268ms，找不出
-- 規律），犧牲的是這批字的零多按，換其餘打字不再偶爾卡頓，見下面 func() 裡的說明。
--
-- 為什麼不用 update_notifier 呼叫 context:commit()：試過，會在候選還在算到一半時
-- 重入，直接把打字打壞（症狀：完全打不出字）。這裡改成處理器＋
-- engine:commit_text()+context:clear()，跟 rime-ice 的 select_character.lua 同一種
-- 寫法——在「處理這一鍵」的最前面做，跟一般按鍵處理站在同一個呼叫層級，安全；
-- 差別只在於自己動手收字母（push_input），才能在「剛好收完這一鍵」的當下就檢查，
-- 不必等下一鍵才知道「上一段夠不夠決定了」。
-- 不查 key:modifier()——Caps Lock 等鎖定鍵也算進 modifier()，一般打字時常常不是 0，
-- 查了反而把正常按鍵擋掉。跟 rime-ice 的 select_character.lua 一樣，只憑 repr() 判斷。
local function is_plain_letter(key)
  return not key:release() and key:repr():match("^%l$") ~= nil
end

-- 即時頂要判斷「這串碼接下去還有沒有路」——查的是「碼表裡任何一個碼，是不是剛好等於
-- 這串，或者以這串開頭」。資料來源四個表都要查：code2chars（主碼／alts／異體字，
-- 一般字的路，兼容碼已經併在裡面，見 build_rime.py）、leftshort／leftshort_pre
-- （左簡碼家族自己的一條路，主碼表查不到，只活在這兩張表——漏查會把還在打左簡碼的人
-- （SMB 正要打 SMBF）當「碼死了」誤頂掉）、shortcode／short3（約定簡碼／三簡碼，
-- aiphabi_hint.lua 拿它們現生成真候選，一樣主碼表查不到——漏查就是「NK 候 被 N 几 誤頂」
-- 那個 bug：候 的約定簡碼 nk 只活在 shortcode，n 打完再打 k 時查不到任何路，誤判成打死。
-- 這四張表都不看目前的開關狀態（short_on／short3_on 等）——寧可判斷「其實還有路」多算
-- 幾種將來可能用不到的情況（頂多這次沒頂，退回舊行為，等使用者自己打完或按退格），也不能
-- 反過來把活路當死路（那才是真的誤頂、丟字）。詞組／si4 的碼不查：自動上屏跟詞組連打互斥
-- （見下面 enforce_mutex），開自動上屏時 aiphabi_phrase 一定是關的，詞組候選本來就看不到，
-- 沒理由讓一條使用者永遠看不見的路去擋這個判斷。
local data = require("aiphabi_data")
local order = require("aiphabi_order")
local CODE_INDEX      -- 排序後的碼陣列，binary search 用（module 第一次用到才建，見 build_index）
local function build_index()
  local seen, out = {}, {}
  local function collect(tbl)
    for code in pairs(tbl) do
      if not seen[code] then seen[code] = true; out[#out + 1] = code end
    end
  end
  collect(data.code2chars)
  collect(data.leftshort)
  collect(data.leftshort_pre)
  collect(data.shortcode)
  collect(data.short3)
  table.sort(out)
  CODE_INDEX = out
end

-- newCode 打死了嗎：碼表裡沒有任何碼「等於它」或「以它開頭」，就是死路——不管
-- 再往下打什麼字母都救不回來，代表上一段已經是唯一確定的答案，不會再有別的可能。
local function is_dead_extension(newCode)
  if not CODE_INDEX then build_index() end
  local lo, hi = 1, #CODE_INDEX + 1
  while lo < hi do
    local mid = (lo + hi) // 2
    if CODE_INDEX[mid] < newCode then lo = mid + 1 else hi = mid end
  end
  local hit = CODE_INDEX[lo]
  return not (hit and hit:sub(1, #newCode) == newCode)
end

-- code 還能不能再往下接出「更長、但仍在正常主碼長度（≤5 碼）內」的碼。有的話現在
-- 上屏太早：使用者可能正打那個更長的字（夜＝IYAR 卡在 大＝IY 上面，sole_real_candidate
-- 只看候選欄「剩幾個」，補全沒被算進去時就誤判 大 是唯一解、打 IY 直接頂掉 大——回報
-- 2026-08-29）。
--
-- ≥6 碼的完整碼（一般是別的字的整串拆碼，如 競 IVOJLIVOJL、飄 IHEMNJOG）不算：
-- 沒人打 兗 的 IVOJL 是要接去打那條，讓它擋自動上屏只是白白讓 239 個五碼字得多按
-- 一次空白。完整碼照樣收得進來當輸入（完整碼一律接受），只是不進這個「還沒打完」
-- 的判斷。兼容碼（≤5，人工收的另一種拆法）仍算——那是有人真的會習慣打的路。
-- CODE_INDEX 只收單字碼（見 build_index），跟自動上屏／詞組連打互斥的前提一致。
local function has_longer_code(code)
  if not CODE_INDEX then build_index() end
  if #code >= 5 then return false end   -- 5 碼已滿，任何延伸都是 ≥6 的完整碼
  local lo, hi = 1, #CODE_INDEX + 1
  while lo < hi do
    local mid = (lo + hi) // 2
    if CODE_INDEX[mid] <= code then lo = mid + 1 else hi = mid end
  end
  for i = lo, #CODE_INDEX do
    local c = CODE_INDEX[i]
    if c:sub(1, #code) ~= code then break end   -- 出了 code 的前綴範圍，後面不會再有
    if #c > #code and #c <= 5 then return true end
  end
  return false
end

-- 容錯（aiphabi_fuzzy 標的）只是「怕你打錯鍵，另外提醒一個可能」，跟「這串碼本身
-- 打完了沒」無關——它講的是別的碼，不是這碼還沒完。方括號 [ 碼 ] 是容錯專用格式
-- （見 aiphabi_hint.lua 開頭），拿掉這批猜測後如果只剩一個，一樣算「沒有第二個排隊」。
-- CAP：夠大蓋過容錯常見的幾個猜測就好，不必掃到底——真要很多個非容錯候選排隊，
-- 前面幾個就看得出來了。
local CAP = 20
local function is_fuzzy_guess(cand)
  return cand.comment and cand.comment:match("^%[") ~= nil
end

-- 「只剩一個」不夠——那一個還得是「這串碼本身已經打完」，不能是還在等後面幾碼的
-- completion。例：候 主碼 NCYK，打到 NC 時全表沒有別的字撞這個前綴，候 變成暫時
-- 「唯一」候選，但碼根本沒打完，這時上屏會把使用者接下來按的 YK 兩鍵當成新字的
-- 開頭（候yk）。凡是「還在猜、還沒確定就是這條路」的都不算完整：
--   completion —— librime 自己標的，碼還沒打完的補全（含左簡碼／三簡碼還沒打完那段）。
--   ap_pool    —— aiphabi_hint.lua 自己發的提示／猜測（同類字／偏旁碼／三簡碼／
--                 左簡碼補全／四碼前綴），沒有一個是「認定過就是這個字」。
-- 剩下的（一般完整比對、ap_short 簡碼、ap_si4 打滿的四碼快打、ap_left 打滿的左簡碼）
-- 才算「碼本身打完了」，可以上屏。
local INCOMPLETE_TYPE = { completion = true, ap_pool = true }
local function is_complete_match(cand)
  return not INCOMPLETE_TYPE[cand.type]
end

local function sole_real_candidate(seg)
  seg.menu:prepare(CAP)
  local real, n = nil, 0
  local total = seg.menu:candidate_count()
  for i = 0, math.min(total, CAP) - 1 do
    local c = seg:get_candidate_at(i)
    if c and not is_fuzzy_guess(c) then
      n = n + 1
      if n > 1 then return nil end
      real = c
    end
  end
  if n == 1 and is_complete_match(real) then return real end
  return nil
end

-- 從目前候選欄（頂之前，還沒收下這一鍵）挑「排最前面、非容錯、已經打完」的那個，
-- 當即時頂要頂的對象。文章原話：「頂屏的前提是被頂的字詞已經完全確定」——挑不到
-- 這樣的候選（例如整段從頭到尾都只是提示／猜測，沒有真正打中過什麼）就不頂，讓這一鍵
-- 照舊往下走（碼死了就死了，跟現在沒開這個功能時一樣，等使用者自己按退格）。
local function top_complete_candidate(seg)
  seg.menu:prepare(CAP)
  local total = seg.menu:candidate_count()
  for i = 0, math.min(total, CAP) - 1 do
    local c = seg:get_candidate_at(i)
    if c and not is_fuzzy_guess(c) and is_complete_match(c) then return c end
  end
  return nil
end

-- try_commit：假設這一鍵已經 push_input 進去了，看「自然碼」有沒有打到獨一無二、打完了
-- ——是就上屏＋清空、回 true；不是回 false。給自己的 func 用，也給 aiphabi_supp 用
-- （自動上屏＋頂屏補碼一起開時，補碼那支處理器每一鍵先問一次這裡，收得了就不必補到固定長度）。
local function try_commit(env)
  local ctx = env.engine.context
  local code = ctx.input or ""
  if #code <= 1 then return false end             -- 第一碼不查（效能，見下面 func 裡的說明）
  if code:find("`", 1, true) then return false end
  if has_longer_code(code) then return false end  -- 還能接出更長的字（大 IY 上面有 夜 IYAR）→ 先別收
  local seg = ctx.composition:back()
  if not seg then return false end
  local cand = sole_real_candidate(seg)
  if not cand then return false end
  env.engine:commit_text(cand.text)
  order.note_commit(cand.text)                    -- 上屏不經過 commit_notifier，選字次數／重複上字自己補記
  ctx:clear()
  return true
end

local function func(key, env)
  if not is_plain_letter(key) then return 2 end
  local ctx = env.engine.context
  if ctx:get_option("aiphabi_supp") then return 2 end   -- 頂屏補碼開著：統一交給 aiphabi_supp 收鍵
  if not ctx:get_option("aiphabi_autocommit") then return 2 end

  local code = ctx.input or ""
  local k = key:repr()

  -- 已經在打萬用鍵（碼裡有反引號）：整段不歸這裡管，讓開。CODE_INDEX 是純 a-z 的
  -- 正常碼表，含反引號的字串永遠不可能是任何一條的前綴——is_dead_extension 會
  -- 對「這一鍵」永遠回真，把萬用鍵當「打死了」誤頂掉（實測回報：W`T 的 T 把
  -- W` 第一個候選頂上屏、T 自己另起爐灶，變成查不了 W?T／W??T 這種樣式；harness
  -- 底下沒有這個 guard 甚至會直接 crash，因為 harness 沒 stub ctx.composition）。
  if code:find("`", 1, true) then return 2 end

  -- 一個字的第一碼：讓開，交給 speller 正常收。實測回報＋量過：I／J 這種根大的
  -- 字根，每次打第一碼都要 90～410ms，比打第二碼起（20ms 內）慢二三十倍——因為
  -- sole_real_candidate 會呼叫 seg.menu:prepare()，逼 Rime 在這一鍵就把整組候選
  -- （往往上千個）算出來，而單一字母的碼幾乎不可能是唯一解（26 個字根裡只有
  -- 月下厂十八 5 個字真的一碼打完，其餘全部有第二個字接在後面）。犧牲這 5 個字的
  -- 「零多按」——它們照樣會被即時頂在下一鍵頂上屏，頂多多按一次空白——換全部字的
  -- 第一碼不再卡頓。詳見 aiphabi-side-b-ij-lag-2026-08-27 記憶（同一次順帶砍了
  -- aiphabi_hint.lua 的 RAW_CAP，真正的大頭在那邊，這裡只是第一層）。
  if code == "" then return 2 end

  -- 即時頂暫時停用（2026-08-27）：量過（aiphabi_autocommit_timing.log），
  -- top_complete_candidate() 的 seg.menu:prepare() 在「頂之前」這個還沒收這一鍵的
  -- 舊 segment 上，時好時壞——同一組碼量出 10ms 也量出 268ms，沒有找到跟碼長／
  -- 分支數對得上的規律，看起來是 Rime 內部（可能是 enable_sentence 的整句重新
  -- 分析）的成本，不是這支 Lua 自己能控制的。唯一上屏（下面 sole_real_candidate，
  -- 量到的都在 4～26ms）沒有這個問題，繼續用。犧牲的是 PPIN/開 這類「常見字卡在
  -- 罕見完整碼後面」的零多按——退回原本行為，多按一次空白，換其餘所有打字不再
  -- 偶爾卡頓。is_dead_extension／top_complete_candidate 留著沒刪，將來想清楚怎麼
  -- 避開 seg.menu:prepare()（例如純用 data.code2chars 自己判斷，不問 Rime 的
  -- 候選欄）再重新接上。

  ctx:push_input(k)    -- 自己收下這個字母，等於代替 speller 做這一鍵的事
  try_commit(env)      -- 打完了就上屏；沒有就繼續等下一鍵
  return 1             -- 這一鍵已經自己收掉了，別再讓 speller 收一次（會重複）
end

-- 自動上屏／詞組連打互斥：詞組開著時，打完一個字的完整碼常常還會接著冒出「候選」
-- 「候選人」之類的詞組候選排在後面（同一串碼是那些詞的前綴）——sole_real_candidate
-- 會正確判斷成「不只一個」而按兵不動，但這樣自動上屏形同虛設（詞組開著幾乎每個字
-- 後面都可能接得出詞，永遠不會只剩一個）。乾脆兩個開關互斥：選單勾其中一個，
-- 另一個自動關掉，不必先弄懂兩者會怎麼互相牽制。
-- ctx:set_option() 改的是這次執行的即時狀態，不保證寫回 user.yaml——實測回報：
-- 兩個開關互斥修正過後，user.yaml 卻同時存了 aiphabi_autocommit: true 跟
-- aiphabi_phrase: true（兩個本來不該同時是 true），開機時 init() 的修正只改得動
-- 記憶體，檔案還是舊的錯誤值，下次開機又要修一次——使用者看起來像是「選的開關
-- 沒被記住」。switcher 選單自己點的那半（真的按下去的那個）Rime 會存，但另一半
-- 被我們的互斥邏輯連帶關掉的，不會跟著存。這裡直接把該同步的那個值寫回
-- user.yaml，不依賴 Rime 自動幫忙。只動 var: option: 底下那一行，抓不到就跳過
-- （不強行破壞使用者檔案格式），全程 pcall，寫失敗也不影響正常打字。
-- patch_option_line：純字串處理，不碰檔案——只給 tests/ 用來驗證這段 regex 到底
-- 抓不抓得到、換不換得對，不用真的去動 user.yaml。
local function patch_option_line(content, name, value)
  local valueStr = value and "true" or "false"
  local pattern = "(%s+" .. name:gsub("%p", "%%%1") .. ":%s*)%a+"
  local newContent, n = content:gsub(pattern, "%1" .. valueStr, 1)
  if n == 0 then return nil end   -- 檔案裡本來就沒有這個 key（從沒切過），不硬插入
  return newContent
end

local USER_YAML = (os.getenv("HOME") and (os.getenv("HOME") .. "/Library/Rime/user.yaml")) or nil
-- 只給 tests/ 用：把路徑指到暫存檔，測試才不會真的動到使用者的 user.yaml。
local function _set_user_yaml_path_for_tests(path) USER_YAML = path end
local function persist_option(name, value)
  if not USER_YAML then return end
  local f = io.open(USER_YAML, "r")
  if not f then return end
  local content = f:read("a")
  f:close()
  if not content then return end
  local newContent = patch_option_line(content, name, value)
  if not newContent then return end
  local tmp = USER_YAML .. ".ap_tmp"
  local out = io.open(tmp, "w")
  if not out then return end
  out:write(newContent)
  out:close()
  os.rename(tmp, USER_YAML)   -- 同檔案系統內是原子操作，比直接覆寫原檔安全
end

-- 重入防護：ctx:set_option() 本身會再觸發一次 option_update_notifier——沒有這個
-- 開關，「關掉另一個」這個動作自己會被當成又一次「剛剛切換」，反過來把使用者
-- 這一次真正按下去的那個開關關掉（實測回報：autocommit 開著時要開詞組，得按兩次
-- 才開得起來——第一次觸發「開詞組→關自動上屏→（重入）自動上屏剛被關、詞組還開著
-- →誤判成又要關詞組」，兩個開關繞一圈變成全部關掉；第二次因為自動上屏已經是關的，
-- 繞不回來，才终于開成）。suppressing 擋住這個重入，讓「關另一個」的動作不會
-- 再被自己的回呼解讀成一次新的切換。
-- 三個「不必按空白」的開關：
--   * aiphabi_phrase（詞組連打）跟另兩個都互斥——它濾掉多字候選、每個字後面都可能接出
--     詞，跟「打完就收」的判斷打架。
--   * aiphabi_autocommit（自動上屏）跟 aiphabi_supp（頂屏補碼）可以一起開：自然碼打到
--     獨一無二就先收（省鍵），收不了的補 U 到固定長度收。合併邏輯在 aiphabi_supp.lua——
--     頂屏補碼開著時，這支處理器讓開（見 func 開頭），統一由 aiphabi_supp 收鍵。
local NO_SPACE = { "aiphabi_autocommit", "aiphabi_supp" }
local suppressing = false
local function enforce_mutex(ctx, just_turned_on)
  if suppressing then return end
  suppressing = true
  if just_turned_on == "aiphabi_phrase" then
    if ctx:get_option("aiphabi_phrase") then          -- 開詞組 → 關掉「不必按空白」那兩個
      for _, n in ipairs(NO_SPACE) do
        if ctx:get_option(n) then
          ctx:set_option(n, false)
          pcall(persist_option, n, false)
        end
      end
    end
  else
    for _, n in ipairs(NO_SPACE) do                   -- 開自動上屏／頂屏補碼 → 關掉詞組
      if just_turned_on == n and ctx:get_option(n) and ctx:get_option("aiphabi_phrase") then
        ctx:set_option("aiphabi_phrase", false)
        pcall(persist_option, "aiphabi_phrase", false)
      end
    end
  end
  suppressing = false
end

local function init(env)
  local ctx = env.engine.context
  -- 開機當下詞組跟「不必按空白」的機制同時 true（例如手改設定檔）：關掉詞組。
  pcall(function()
    if ctx:get_option("aiphabi_phrase")
       and (ctx:get_option("aiphabi_autocommit") or ctx:get_option("aiphabi_supp")) then
      ctx:set_option("aiphabi_phrase", false)
      pcall(persist_option, "aiphabi_phrase", false)
    end
  end)
  pcall(function()
    env.ap_autocommit_mutex_notifier = ctx.option_update_notifier:connect(function(context, option_name)
      enforce_mutex(context, option_name)
    end)
  end)
end

local function fini(env)
  if env.ap_autocommit_mutex_notifier then
    pcall(function() env.ap_autocommit_mutex_notifier:disconnect() end)
  end
end

-- try_commit：aiphabi_supp 兩個開關一起開時會呼叫，是正式行為的一部分。
-- _is_dead_extension／_has_longer_code：只給 tests/ 用，直接對真正的碼表驗證前綴判斷，不影響正式行為。
return { init = init, fini = fini, func = func, try_commit = try_commit,
         _is_dead_extension = is_dead_extension,
         _has_longer_code = has_longer_code,
         _patch_option_line = patch_option_line,
         _set_user_yaml_path_for_tests = _set_user_yaml_path_for_tests }
