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
-- U 是全表最少當末碼的字母（28 次），補上去幾乎撞不到真碼。
--
-- 「補完了、但還沒定案」的兩種——補完碼撞了 2 個以上的字（重碼），或補完碼還是別的
-- 補完碼的前綴（女 LJUU 上面有 姗 LJUUI）——都不即收：候選欄留著（見 aiphabi_supp_cand.lua），
-- 排第一的是字頻最高的那個。看的人可以按數字改選；沒看、繼續打——
--   * 這一鍵還能接出更長的補完碼／前綴（LJUU 接 I）→ 繼續往下打；
--   * 接不出（LJUU 接 D）→ 這一鍵是下一個字，先把排第一的即時頂上屏，再收這一鍵。
--
-- 這個開關靠自動上屏（aiphabi_autocommit），連動／互斥邏輯在 aiphabi_autocommit.lua。
-- 上屏補碼開著時，aiphabi_autocommit 那支處理器整段讓開，收鍵、上屏統一走這裡。
--
-- 自己記一份 buffer（env.buf）：不倚賴 ctx.input 去查補完碼——enable_sentence 會邊打邊把
-- 已知的詞切成獨立段，某些引擎下 ctx.input 就不是「這一段從頭到現在打的整串」了。改成
-- 自己一鍵一鍵累積，push_input 只負責把碼餵進候選欄。
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

-- code 補完了但還沒定案（重碼 或 還是別的補完碼的前綴）→ 回它排第一的字；否則 nil。
local function pending_char(code)
  local hit = data.suppcode[code]
  if hit and (#hit > 1 or data.suppcode_pre[code]) then return hit[1] end
  return nil
end

local function func(key, env)
  if key:release() then return 2 end
  local ctx = env.engine.context
  if not ctx:get_option("aiphabi_supp") then env.buf = nil; return 2 end

  local rep = key:repr()

  -- 候選欄整個空了（外部上屏／清空／切走再回來）→ buffer 也歸零，別留舊碼。
  if (ctx.input or "") == "" and env.buf then env.buf = nil end

  -- 萬用鍵：整段讓開，不歸這裡管
  if rep == "`" or (env.buf or ""):find("`", 1, true) then env.buf = nil; return 2 end

  if rep == "BackSpace" then
    if not env.buf or env.buf == "" then return 2 end
    env.buf = env.buf:sub(1, -2)
    if env.buf == "" then env.buf = nil end
    return 2                          -- ctx.input 交給 express_editor 退一格，兩邊同步縮
  end

  local buf = env.buf or ""
  local plain = is_plain_letter(key)

  -- 上一鍵停在「補完了、還沒定案」的碼
  local pc = pending_char(buf)
  if pc then
    if not plain then
      env.buf = nil; return 2          -- 空白／數字：交給候選欄選字
    end
    local nxt = buf .. rep
    if data.suppcode[nxt] or data.suppcode_pre[nxt] then
      -- 這一鍵繼續往更長的補完碼／前綴走，往下正常收
    else
      commit(env, pc)                  -- 接不出更長的 → 即時頂排第一的，這一鍵另起
      ctx:clear()
      buf = ""
    end
  elseif not plain then
    env.buf = nil; return 2            -- 沒定案狀態、又不是字母：讓開
  end

  buf = buf .. rep
  env.buf = buf
  ctx:push_input(rep)                  -- 把這一鍵餵進候選欄（碼／候選由 translator + table_translator 出）

  local hit = data.suppcode[buf]
  if hit and #hit == 1 and not data.suppcode_pre[buf] then
    commit(env, hit[1])               -- 補完了、獨一無二、後面接不出更長的 → 直接上屏
    ctx:clear()
    env.buf = nil
  end
  -- 重碼／還能接更長：候選欄留著，等下一鍵決定（見上面 pending_char）。沒補完：繼續等。
  return 1
end

return { func = func }
