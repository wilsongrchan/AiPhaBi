-- 愛發筆 · 上屏補碼 · 上屏（aiphabi_supp 開關；processor，排在 speller 前面）
--
-- 自動上屏的固定長度版，給盲打（眼睛看稿、不看螢幕）用：開了這個，每個字一律打「補完碼」
-- ——主碼補「U」補到固定長度——打滿就上屏，不必按空白，也不會提早在自然碼打完時就收
-- （夜 一定是 IYARU，IYAR 不算）。哪個字幾碼、何時上屏完全固定，不用邊打邊判斷。
-- 規則：
--   1 碼字 —— 不補，一律按空白／數字選字（月 一 日… 這 51 個字根）。
--   2、3 碼字 —— 補 UU（大 IY → IYUU、上 JII → JIIUU）。
--   4 碼字 —— 補 U（臨 NAUT → NAUTU）。
--   5 碼字 —— 不變（主碼本來就是固定長度）。
-- U 是全表最少當末碼的字母（28 次），補上去幾乎撞不到真碼；補完碼剛好是別的字補完碼的
-- 前綴那極少數（~7 個：外 女 庄…）不收，照舊按空白。
--
-- 重碼（一個補完碼對到 2 個以上的字）：不即收，把候選欄留著（見 aiphabi_supp_cand.lua）——
-- 看的人可以按數字改選；沒看、繼續打下一個字時，這一鍵先把排第一（字頻最高）的那個上屏，
-- 再當新字的開頭（即時頂）。字頻排序把「上錯字」的機會壓到最低。
--
-- 這個開關靠自動上屏（aiphabi_autocommit），連動／互斥邏輯在 aiphabi_autocommit.lua。
-- 上屏補碼開著時，aiphabi_autocommit 那支處理器整段讓開，收鍵、上屏統一走這裡。
--
-- 自己記一份 buffer（env.buf）：不倚賴 ctx.input 去查補完碼——enable_sentence 會邊打邊把
-- 已知的詞切成獨立段，某些引擎下 ctx.input 就不是「這一段從頭到現在打的整串」了，跨越
-- 那個切點的補完碼查不到。改成自己一鍵一鍵累積，push_input 只負責把碼餵進候選欄。
-- （注意：librime-lua 的 Context 沒有 set_input，只能 push_input／pop_input／clear。）
local data = require("aiphabi_data")
local order = require("aiphabi_order")

local function is_plain_letter(key)
  return not key:release() and key:repr():match("^%l$") ~= nil
end

local function commit(env, ch)
  env.engine:commit_text(ch)
  pcall(order.note_commit, ch)      -- 選字次數／重複上字：上屏不經過 commit_notifier，自己補記
end

local function func(key, env)
  if key:release() then return 2 end
  local ctx = env.engine.context
  if not ctx:get_option("aiphabi_supp") then env.buf = nil; return 2 end

  local rep = key:repr()

  -- 候選欄整個空了（外部上屏／清空／切走再回來）→ buffer 也歸零，別留舊碼。
  -- （只認「空」這個明確訊號；不去比長度——enable_sentence 的分段不縮 ctx.input，
  -- 但真要縮了也不該拿分段後的殘段覆蓋自己記的整串。）
  if (ctx.input or "") == "" and env.buf then env.buf = nil end

  -- 萬用鍵：整段讓開，不歸這裡管
  if rep == "`" or (env.buf or ""):find("`", 1, true) then env.buf = nil; return 2 end

  if rep == "BackSpace" then
    if not env.buf or env.buf == "" then return 2 end
    env.buf = env.buf:sub(1, -2)
    if env.buf == "" then env.buf = nil end
    return 2                          -- ctx.input 交給 express_editor 退一格，兩邊同步縮
  end

  if not is_plain_letter(key) then
    -- 空白／標點／數字選字／方向鍵…：這一段結束，把控制權交還（候選欄還是剛才餵進去的碼，
    -- 空白／數字照舊在上面選字——補完了但撞碼、或補到一半按空白，都靠這條路收）。
    env.buf = nil
    return 2
  end

  -- 上一鍵停在「補完了、但撞了 2 字以上」的碼 → 這一鍵是下一個字的開頭，
  -- 先把排第一（字頻最高）的那個上屏（即時頂），再讓這一鍵照常收。
  local buf = env.buf or ""
  local pend = data.suppcode[buf]
  if pend and #pend > 1 then
    commit(env, pend[1])
    ctx:clear()
    buf = ""
  end

  buf = buf .. rep
  env.buf = buf
  ctx:push_input(rep)                 -- 把這一鍵餵進候選欄（碼／候選由 translator + table_translator 出）

  local hit = data.suppcode[buf]
  if hit and #hit == 1 then           -- 補完了、獨一無二 → 直接上屏
    commit(env, hit[1])
    ctx:clear()
    env.buf = nil
  end
  -- 補完了但撞碼（#hit > 1）：不動，候選欄留著，等下一鍵（上面那段）或空白／數字選字。
  -- 沒補完：繼續等下一鍵。
  return 1
end

return { func = func }
