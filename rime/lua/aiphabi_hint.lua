-- 愛發筆 · 同類字 + 偏旁碼提示（filter）
-- 打中約定表某形近字家族（土士工干上…）其一，就把整組同類字帶出來；
-- 打了某字「作為偏旁時」的碼，就提醒該字（它單獨成字另有取法，例 K → 大）。各附正碼。
-- 排序：最熱門的字仍是第一個，接著才排這些提示，再來才是其餘候選（含補全）——
-- 這樣就算某個碼補全出一大票字（例 扌 搬到 K 後，打 K 有近 200 個字），提示也不會被埋在最後。
-- 由 aiphabi_family / aiphabi_comp 兩個開關控制（預設開）。
local data = require("aiphabi_data")

return function(input, env)
  local ctx = env.engine.context
  local code = ctx.input
  -- 先收下全部候選（原順序不動），順便記下已出現的字
  local cands, seen = {}, {}
  for cand in input:iter() do
    cands[#cands + 1] = cand
    seen[cand.text] = true
  end

  -- 只處理純字母碼；萬用鍵那套交給 wildcard
  local ok = code and code ~= "" and not code:find("[^a-z]")
  local fam_on  = ok and ctx:get_option("aiphabi_family")
  local comp_on = ok and ctx:get_option("aiphabi_comp")

  local extra = {}
  if fam_on or comp_on then
    local s = cands[1] and cands[1].start or 0
    local e = cands[1] and cands[1]._end or #code
    if fam_on then                       -- 同類字：這個碼的字若屬某家族 → 帶出整組（各附正碼）
      for _, ch in ipairs(data.code2chars[code] or {}) do
        for _, sib in ipairs(data.family[ch] or {}) do
          if not seen[sib] then
            seen[sib] = true
            local sc = data.char2code[sib]
            extra[#extra + 1] = Candidate("aiphabi", s, e, sib, sc and ("同類 " .. sc:upper()) or "同類")
          end
        end
      end
    end
    if comp_on then                      -- 偏旁碼：這個碼剛好是某字的偏旁碼 → 提醒該字（附正碼）
      for _, ch in ipairs(data.comp[code] or {}) do
        if not seen[ch] then
          seen[ch] = true
          local sc = data.char2code[ch]
          extra[#extra + 1] = Candidate("aiphabi", s, e, ch, sc and ("偏旁碼 " .. sc:upper()) or "偏旁碼")
        end
      end
    end
  end

  -- 第一個候選 → 提示 → 其餘候選
  if cands[1] then yield(cands[1]) end
  for _, c in ipairs(extra) do yield(c) end
  for i = 2, #cands do yield(cands[i]) end
end
