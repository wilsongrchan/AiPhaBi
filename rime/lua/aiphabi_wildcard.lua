-- 愛發筆 · 萬用鍵 `（translator）
-- 某幾碼想不起來就按 `：單一 ` = 一碼以上（例 WJ`M → WJSTM 也找得到）；
-- 連續 N 個 ` = 剛好 N 碼（例 WJ``M 只找剛好多兩碼的）。查全表符合的碼、把字列出。
--
-- 單獨一個 `（前後都還沒打別的字母）本來就是「一碼以上、內容隨便」——比對得到全表
-- 每一個碼，一定會把整張表倒出來，沒有人真的會就停在這裡選一個。這個狀態借來加一個
-- 「上一個上屏的字/詞」排在最前面，幾乎零成本（反正本來就要掃全表）：選到就是重複
-- 上一個字，不選、接著打更多字母（`W、``M……）馬上進到別的模式，原本的萬用鍵完全
-- 沒被動到。
local data = require("aiphabi_data")
local order = require("aiphabi_order")

return function(input, seg, env)
  if not input:find("`", 1, true) then return end
  if input:find("[^a-z`]") then return end

  if input == "`" then
    local last = order.get_last_commit()
    if last and last ~= "" then
      yield(Candidate("ap_repeat", seg.start, seg._end, last, "重複上字"))
    end
  end

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
          -- 標一律秀主碼，不是比對到的那個碼——萬用鍵常常比對到完整碼（可能長到
          -- 看不完），跟 aiphabi_hint 的 markHints 同一個原則。
          -- 加圓括號：這是「參考用的主碼」，不是叫你改打的捷徑碼——跟 aiphabi_hint
          -- 的 refMark 同一套規矩（括號裡的拿來看，沒括號的拿來打）。
          local mc = data.char2code[ch] or code
          yield(Candidate("aiphabi", seg.start, seg._end, ch, "(" .. mc:upper() .. ")"))
        end
      end
    end
  end
end
