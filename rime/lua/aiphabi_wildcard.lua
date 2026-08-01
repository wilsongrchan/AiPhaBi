-- 愛發筆 · 萬用鍵 `（translator）
-- 某幾碼想不起來就按 `：單一 ` = 一碼以上（例 WJ`M → WJSTM 也找得到）；
-- 連續 N 個 ` = 剛好 N 碼（例 WJ``M 只找剛好多兩碼的）。查全表符合的碼、把字列出。
local data = require("aiphabi_data")

return function(input, seg, env)
  if not input:find("`", 1, true) then return end
  if input:find("[^a-z`]") then return end
  -- ` → 一碼以上；``…（N 個）→ 剛好 N 碼
  local pat = "^" .. input:gsub("`+", function(run)
    return #run == 1 and "[a-z]+" or string.rep("[a-z]", #run)
  end) .. "$"
  local seen = {}
  for code, chs in pairs(data.code2chars) do
    if code:match(pat) then
      for _, ch in ipairs(chs) do
        if not seen[ch] then
          seen[ch] = true
          yield(Candidate("aiphabi", seg.start, seg._end, ch, code))
        end
      end
    end
  end
end
