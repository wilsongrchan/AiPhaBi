-- 愛發筆 · 智能聯想（translator）
-- 接 aiphabi_assoc_seg 開出來的那一段，把剛剛選的字接續建議列出來（例：經 → 濟／驗／
-- 歷／常…），選了直接補上去，不用再打一次碼。各附正碼（有的話）。
-- 由 aiphabi_assoc 開關控制（預設關）；資料來自 rime-essay 語料，篩過現在打得出來的字。
local data = require("aiphabi_data")
local state = require("aiphabi_assoc_state")

local ASSOC_TAG = Set({"aiphabi_assoc"})

return function(input, seg, env)
  if (seg.tags * ASSOC_TAG):empty() then return end
  local ch = state.last
  if not ch then return end
  for _, nxt in ipairs(data.assoc[ch] or {}) do
    local sc = data.char2code[nxt]
    yield(Candidate("aiphabi", seg.start, seg._end, nxt, sc and ("聯想 " .. sc:upper()) or "聯想"))
  end
end
