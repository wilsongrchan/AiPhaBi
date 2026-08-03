-- 愛發筆 · 輸入容錯（filter）
-- 漏打一碼、多打一碼、某碼打成鍵盤隔壁鍵、相鄰兩碼打反 —— 也能找到字，標「可能」。
-- 由 aiphabi_fuzzy 開關控制（預設開）。萬用鍵那套不吃這裡（見 wildcard）。
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
  local seen, s, e = {}, nil, nil
  for cand in input:iter() do
    seen[cand.text] = true
    s = s or cand.start
    e = cand._end
    yield(cand)
  end
  if not ctx:get_option("aiphabi_fuzzy") then return end
  if not code or #code < 2 or code:find("[^a-z]") then return end
  s = s or 0
  e = e or #code
  local n = #code

  local function emit(candidates, test)
    for _, c in ipairs(candidates or {}) do
      if test(c) then
        for _, ch in ipairs(data.code2chars[c] or {}) do
          if not seen[ch] then
            seen[ch] = true
            yield(Candidate("ap_pool", s, e, ch, "[ " .. c:upper() .. " ]"))
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
