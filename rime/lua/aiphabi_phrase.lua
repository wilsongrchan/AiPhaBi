-- 詞組連打開關（只掛在純愛發筆的 filter 鏈上）：
--   關掉 aiphabi_phrase 時，把多字候選（詞組）濾掉，只留單字——純愛發筆碼表裡多字的就只有詞組。
--   開著（或二合一沒掛這個 filter）時原樣放行。詞組本身收在共用碼表 aiphabi.dict，靠 enable_completion
--   打前綴就補得出整個詞；這個 filter 不產生候選、只做開關過濾。
local function ulen(s)                 -- UTF-8 字數（數非接續位元組）
  local n = 0
  for i = 1, #s do
    local b = s:byte(i)
    if b < 128 or b >= 192 then n = n + 1 end
  end
  return n
end

return function(input, env)
  local ok, on = pcall(function() return env.engine.context:get_option("aiphabi_phrase") end)
  on = ok and on
  for c in input:iter() do
    if on or ulen(c.text) <= 1 then yield(c) end
  end
end
