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

-- 容錯（aiphabi_fuzzy 標的）只是「怕你打錯鍵，另外提醒一個可能」，跟「這串碼本身
-- 打完了沒」無關——它講的是別的碼，不是這碼還沒完。方括號 [ 碼 ] 是容錯專用格式
-- （見 aiphabi_hint.lua 開頭），拿掉這批猜測後如果只剩一個，一樣算「沒有第二個排隊」。
-- CAP：夠大蓋過容錯常見的幾個猜測就好，不必掃到底——真要很多個非容錯候選排隊，
-- 前面幾個就看得出來了。
local CAP = 20
local function is_fuzzy_guess(cand)
  return cand.comment and cand.comment:match("^%[") ~= nil
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
  if n == 1 then return real end
  return nil
end

local function func(key, env)
  if not is_plain_letter(key) then return 2 end
  local ctx = env.engine.context
  if not ctx:get_option("aiphabi_autocommit") then return 2 end
  ctx:push_input(key:repr())    -- 自己收下這個字母，等於代替 speller 做這一鍵的事
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

return { func = func }
