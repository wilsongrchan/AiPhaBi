-- 愛發筆 · 頂屏補碼 · 頂上屏（aiphabi_supp 開關；processor，排在 speller 前面）
--
-- 盲打（眼睛看稿、不看螢幕）用的固定長度碼：把主碼補「U」補到固定長度，打滿就頂上屏，
-- 不必按空白。規則：
--   1 碼字 —— 不補，一律按空白／數字選字（月 一 日… 這 51 個字根）。
--   2、3 碼字 —— 補 UU（大 IY → IYUU、上 JII → JIIUU）。
--   4 碼字 —— 補 U（臨 NAUT → NAUTU）。
--   5 碼字 —— 不變（主碼本來就是固定長度）。
-- U 是全表最少當末碼的字母（28 次），補上去幾乎撞不到真碼；補完碼剛好是別的字補完碼的
-- 前綴那極少數（~5 個：外 女 庄…）不收，照舊按空白。
--
-- 重碼（一個補完碼對到 2 個以上的字）：不即收，把候選欄留著（見 aiphabi_supp_cand.lua）——
-- 看的人可以按數字改選；沒看、繼續打下一個字時，這一鍵先把排第一（字頻最高）的那個頂
-- 上屏，再當新字的開頭（即時頂）。字頻排序把「頂錯」的機會壓到最低。
--
-- 跟詞組連打（aiphabi_phrase）互斥。跟自動上屏（aiphabi_autocommit）可以一起開：兩個都開時，
-- 這一鍵先問 aiphabi_autocommit.try_commit（自然碼打到獨一無二就先收，省鍵），收不了才看
-- 補完碼有沒有打滿。頂屏補碼開著時 aiphabi_autocommit 那支處理器讓開，統一由這裡收鍵。
local data = require("aiphabi_data")
local order = require("aiphabi_order")
local ac = require("aiphabi_autocommit")

local function is_plain_letter(key)
  return not key:release() and key:repr():match("^%l$") ~= nil
end

local function commit(env, ch)
  env.engine:commit_text(ch)
  pcall(order.note_commit, ch)      -- 選字次數／重複上字：頂上屏不經過 commit_notifier，自己補記
end

local function func(key, env)
  if not is_plain_letter(key) then return 2 end
  local ctx = env.engine.context
  if not ctx:get_option("aiphabi_supp") then return 2 end

  local cur = ctx.input or ""
  -- 已經在打萬用鍵（碼裡有反引號）：整段讓開，不歸這裡管。
  if cur:find("`", 1, true) then return 2 end

  -- 上一鍵停在「補完了、但撞了 2 字以上」的碼（候選欄還開著）——這一鍵是下一個字的
  -- 開頭，先把排第一的頂上屏（即時頂），再讓這一鍵照常收。
  if cur ~= "" then
    local pend = data.suppcode[cur]
    if pend and #pend > 1 then
      commit(env, pend[1])
      ctx:clear()
    end
  end

  ctx:push_input(key:repr())

  -- 自動上屏也開著：自然碼已經打到獨一無二、打完了 → 先收，不必補到固定長度（省鍵）。
  if ctx:get_option("aiphabi_autocommit") and ac.try_commit(env) then
    return 1
  end

  local hit = data.suppcode[ctx.input]
  if hit and #hit == 1 then           -- 補完了、獨一無二 → 直接頂
    commit(env, hit[1])
    ctx:clear()
  end
  -- 補完了但撞碼（#hit > 1）：不動，候選欄留著，等下一鍵（上面那段）或空白／數字選字。
  -- 沒補完：繼續等下一鍵。
  return 1
end

return { func = func }
