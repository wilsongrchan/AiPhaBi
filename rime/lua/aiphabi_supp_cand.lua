-- 愛發筆 · 頂屏補碼 · 候選（aiphabi_supp 開關；translator）
--
-- 補完碼／補到一半的碼 → 對應的字，讓候選欄有東西：
--   * 補完了：data.suppcode[碼]（依字頻排，第一個是頂屏補碼要頂的那個）。重碼時整排都出，
--     看的人可以按數字改選。
--   * 還沒補完：data.suppcode_pre[碼]，補完前也讓人看得到往哪個字去。
-- aiphabi_supp 關就整個不出。頂上屏的邏輯在 aiphabi_supp.lua（processor）。
local data = require("aiphabi_data")

return function(input, seg, env)
  local ok, on = pcall(function() return env.engine.context:get_option("aiphabi_supp") end)
  if not (ok and on) then return end
  if input == "" or input:find("[^a-z]") then return end
  local function emit(list)
    if not list then return end
    for _, ch in ipairs(list) do
      yield(Candidate("aiphabi_supp", seg.start, seg._end, ch, ""))
    end
  end
  emit(data.suppcode[input])
  emit(data.suppcode_pre[input])
end
