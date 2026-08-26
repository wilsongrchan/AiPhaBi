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
-- 即時頂（2026-08-26 加）：唯一上屏只顧「打完了」，管不到「開 PPIN、闞 PPINX/PPINEX
-- 這種罕見字卡住常見字」——闞這種字太少見，開永遠等不到「唯一」。即時頂是另一條路：
-- 不管現在是不是唯一，只要「這一鍵會把碼打死」（打出來的這串碼，接下來不管碼表裡
-- 哪個字都接不上，見 is_dead_extension），就代表上一段已經確定沒有回頭路了——把
-- 上一段候選欄排最前面那個（一定要是「打完了」的，見 is_complete_match）頂上屏，
-- 這一鍵自己重新當下一個字的開頭。概念跟見 PROJECT_NOTES／Wilson 貼的文章一致，
-- 叫「規則頂屏・即時頂」：頂的是「N-1 碼」，不是往更早回溯（那是「延遲頂」，這裡沒做）。
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

local function func(key, env)
  if not is_plain_letter(key) then return 2 end
  local ctx = env.engine.context
  if not ctx:get_option("aiphabi_autocommit") then return 2 end

  local code = ctx.input or ""
  local k = key:repr()

  -- 即時頂：碼死之前先問——這一鍵加進去，碼還有沒有救。有救（還是某個碼的前綴）
  -- 就照舊往下走；沒救就在「加進去、變成打死的殘局」之前，先把頂之前（也就是
  -- 現在，這一鍵還沒收）的候選欄第一個頂上屏，這一鍵才另起爐灶當新字第一碼。
  if code ~= "" and is_dead_extension(code .. k) then
    local seg = ctx.composition:back()
    local top = seg and top_complete_candidate(seg)
    if top then
      env.engine:commit_text(top.text)
      ctx:clear()
      ctx:push_input(k)
      return 1
    end
    -- 挑不到能頂的候選：不攔這一鍵，照舊往下走（含下面的正常收字流程）。
  end

  ctx:push_input(k)    -- 自己收下這個字母，等於代替 speller 做這一鍵的事
  local seg = ctx.composition:back()
  if seg then
    local cand = sole_real_candidate(seg)
    if cand then
      env.engine:commit_text(cand.text)
      ctx:clear()
    end
  end
  return 1                      -- 這一鍵已經自己收掉了，別再讓 speller 收一次（會重複）
end

-- 自動上屏／詞組連打互斥：詞組開著時，打完一個字的完整碼常常還會接著冒出「候選」
-- 「候選人」之類的詞組候選排在後面（同一串碼是那些詞的前綴）——sole_real_candidate
-- 會正確判斷成「不只一個」而按兵不動，但這樣自動上屏形同虛設（詞組開著幾乎每個字
-- 後面都可能接得出詞，永遠不會只剩一個）。乾脆兩個開關互斥：選單勾其中一個，
-- 另一個自動關掉，不必先弄懂兩者會怎麼互相牽制。
local function enforce_mutex(ctx, just_turned_on)
  if just_turned_on == "aiphabi_autocommit" and ctx:get_option("aiphabi_phrase") then
    ctx:set_option("aiphabi_phrase", false)
  elseif just_turned_on == "aiphabi_phrase" and ctx:get_option("aiphabi_autocommit") then
    ctx:set_option("aiphabi_autocommit", false)
  end
end

local function init(env)
  local ctx = env.engine.context
  -- 開機當下兩個都是 true（例如手改設定檔）也一併修正一次，不用等使用者動一次選單。
  pcall(function()
    if ctx:get_option("aiphabi_autocommit") and ctx:get_option("aiphabi_phrase") then
      ctx:set_option("aiphabi_phrase", false)
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

-- _is_dead_extension：只給 tests/ 用，直接驗證即時頂的死路判斷對不對真正的碼表，不影響正式行為。
return { init = init, fini = fini, func = func, _is_dead_extension = is_dead_extension }
