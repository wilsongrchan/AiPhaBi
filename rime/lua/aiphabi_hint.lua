-- 愛發筆 · 同類字 + 偏旁碼提示（filter）
-- 打中約定表某形近字家族（土士工干上…）其一，就把整組同類字附在候選後面；
-- 打了某字「作為偏旁時」的碼，就提醒該字（它單獨成字另有取法）。各附「同類／偏旁碼」標記。
-- 由 aiphabi_family / aiphabi_comp 兩個開關控制（預設開）。
local data = require("aiphabi_data")

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
  -- 只處理純字母碼；萬用鍵那套交給 wildcard
  if not code or code == "" or code:find("[^a-z]") then return end
  local fam_on  = ctx:get_option("aiphabi_family")
  local comp_on = ctx:get_option("aiphabi_comp")
  if not (fam_on or comp_on) then return end
  s = s or 0
  e = e or #code
  local extra = {}
  if fam_on then                       -- 同類字：這個碼的字若屬某家族 → 帶出整組
    for _, ch in ipairs(data.code2chars[code] or {}) do
      for _, sib in ipairs(data.family[ch] or {}) do
        if not seen[sib] then
          seen[sib] = true
          local sc = data.char2code[sib]           -- 同類字也把它的正碼顯示出來
          local tag = sc and ("同類 " .. sc:upper()) or "同類"
          extra[#extra + 1] = { sib, tag }
        end
      end
    end
  end
  if comp_on then                      -- 偏旁碼：這個碼剛好是某字的偏旁碼 → 提醒該字
    for _, ch in ipairs(data.comp[code] or {}) do
      if not seen[ch] then
        seen[ch] = true
        local sc = data.char2code[ch]            -- 偏旁碼候選也把它的正碼顯示出來
        local tag = sc and ("偏旁碼 " .. sc:upper()) or "偏旁碼"
        extra[#extra + 1] = { ch, tag }
      end
    end
  end
  for _, x in ipairs(extra) do
    yield(Candidate("aiphabi", s, e, x[1], x[2]))
  end
end
