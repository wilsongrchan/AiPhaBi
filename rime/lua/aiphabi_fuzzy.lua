-- 愛發筆 · 輸入容錯（filter）
-- 漏打一碼、多打一碼、某碼打成鍵盤隔壁鍵、相鄰兩碼打反 —— 也能找到字，標「可能」。
-- 由 aiphabi_fuzzy 開關控制（預設開）。萬用鍵那套不吃這裡（見 wildcard）。
-- 這些都是「猜你打錯了」，排序上該輸給「還沒打完、繼續打下去」（type=completion）——
-- 打錯是猜的，還沒打完是打的這幾碼本身就對得上，比猜測可信。見 aiphabi_order.lua
-- 排序那幾層的說明。
local data = require("aiphabi_data")

-- QWERTY 相鄰鍵（簡化：只列左右上下大致相鄰的）
local ADJ = {
  q = "wa", w = "qeas", e = "wrsd", r = "etdf", t = "rygf", y = "tuhg",
  u = "yijh", i = "uokj", o = "iplk", p = "ol",
  a = "qwsz", s = "awedxz", d = "serfcx", f = "drtgvc", g = "ftyhbv",
  h = "gyujnb", j = "huikmn", k = "jiolm", l = "kop",
  z = "asx", x = "zsdc", c = "xdfv", v = "cfgb", b = "vghn", n = "bhjm", m = "njk",
}

local function one_missing(short, long)   -- long 比 short 多一碼、其餘一致
  if #long ~= #short + 1 then return false end
  local i = 1
  while i <= #short and short:sub(i, i) == long:sub(i, i) do i = i + 1 end
  return short:sub(i) == long:sub(i + 1)
end

local function adjacent_typo(a, b)        -- 剛好一碼打成隔壁鍵
  if #a ~= #b then return false end
  local diff = 0
  for i = 1, #a do
    local ca, cb = a:sub(i, i), b:sub(i, i)
    if ca ~= cb then
      diff = diff + 1
      if diff > 1 or not (ADJ[ca] and ADJ[ca]:find(cb, 1, true)) then return false end
    end
  end
  return diff == 1
end

local function transpose(a, b)            -- 相鄰兩碼打反
  if #a ~= #b then return false end
  local d = {}
  for i = 1, #a do if a:sub(i, i) ~= b:sub(i, i) then d[#d + 1] = i end end
  return #d == 2 and d[2] == d[1] + 1
     and a:sub(d[1], d[1]) == b:sub(d[2], d[2])
     and a:sub(d[2], d[2]) == b:sub(d[1], d[1])
end

return function(input, env)
  local ctx = env.engine.context
  local code = ctx.input
  -- 容錯要碼長 ≥2 才有意義（少一碼、多一碼、隔壁鍵……都需要至少兩碼去比對）。單一字根
  -- 補全（打 I／J 這種一碼）用不到底下這些，先判斷再決定要不要多記 seen/s/e——I／J
  -- 補全一次可能上萬個候選，每個候選多做兩次表寫入，白花的時間會隨字根補全量一起長大。
  local fuzzy_relevant = ctx:get_option("aiphabi_fuzzy")
    and code and #code >= 2 and not code:find("[^a-z]")
  if not fuzzy_relevant then
    for cand in input:iter() do yield(cand) end
    return
  end

  -- s, e 固定覆蓋 0..#code，不能抄第一個候選的 start/_end——容錯猜的是整串輸入的碼，
  -- 但候選是在「目前這個 segment」的 filter 鏈裡跑的，segment 可能只吃到前段（打
  -- xjix 全串沒配到，librime 切成 X／J／IX 三段，第一段只有 0..1）。抄了會讓猜中的
  -- 字被塞進第一段當替代候選，選下去只換掉那一段、剩下的段落原封不動留在輸入框，
  -- 見 aiphabi_hint.lua 同一條註解（那邊已經修過一次，這裡少修了）。
  local seen = {}
  for cand in input:iter() do
    seen[cand.text] = true
    yield(cand)
  end
  local s, e = 0, #code
  local n = #code

  -- 這整支模組猜的都是「你打錯了」（漏碼／多碼／隔壁鍵／打反），不是故意的捷徑（那是
  -- aiphabi_hint 的偏旁碼／三簡碼／同類字，仍標 ap_pool、不受這裡影響）。標 ap_typo，
  -- 不是 completion——容錯猜測終究是猜的，不該跟「還沒打完、繼續打下去」（librime
  -- 自己標的 completion、或 aiphabi_hint 的四碼前綴）同池比常用度：那樣只要猜到的字
  -- 剛好比較常用就贏，蓋過真正還在打的詞（回報一：NADNN 打 愉[NADN，多打一碼容錯]
  -- 排第一，蓋過 愉快／愉悅 這種還在打、詞頻明明更高的候選；回報二：yhvy 打
  -- 供[YHV，多打一碼容錯] 排第一，蓋過 價位／供貨／價值／價錢 這些連續打好幾碼、真的
  -- 打到合法前綴的詞——手滑多打一碼沒有「打到一半的合法詞前綴」常見）。ap_typo 在
  -- aiphabi_order／aiphabi_order_plus 裡固定排在 completion 之後，不比常用度、是規則，
  -- 不是「剛好兩者衝突時才輸」。
  local function emit(candidates, test)
    for _, c in ipairs(candidates or {}) do
      if test(c) then
        for _, ch in ipairs(data.code2chars[c] or {}) do
          if not seen[ch] then
            seen[ch] = true
            yield(Candidate("ap_typo", s, e, ch, "[ " .. c:upper() .. " ]"))
          end
        end
      end
    end
  end

  emit(data.by_len[n + 1], function(c) return one_missing(code, c) end)         -- 漏打一碼
  emit(data.by_len[n - 1], function(c) return one_missing(c, code) end)         -- 多打一碼
  emit(data.by_len[n], function(c)                                              -- 隔壁鍵／打反
    return c ~= code and (adjacent_typo(code, c) or transpose(code, c))
  end)
end
