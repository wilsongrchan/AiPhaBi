-- 愛發筆 · 同類字 + 偏旁碼 + 打繁出簡 + 打簡出繁 + 不打簡體 提示（filter）
-- 打中約定表某形近字家族（土士工干上…）其一，就把整組同類字帶出來；
-- 打了某字「作為偏旁時」的碼，就提醒該字（它單獨成字另有取法，例 K → 大）；
-- 打繁出簡／打簡出繁：這個碼的字若有簡體／繁體對應版本，就順便帶出來。各附正碼（有的話）。
-- 不打簡體：把簡體專屬字（純一對一簡化，如 馬→马）從候選裡整個濾掉；歸併字
-- （后／干／咸…本身也是獨立傳承字）不算，不會被濾掉。
-- 排序：最熱門的字仍是第一個，接著才排這些提示，再來才是其餘候選（含補全）——
-- 這樣就算某個碼補全出一大票字（例 扌 搬到 K 後，打 K 有近 200 個字），提示也不會被埋在最後。
-- 由 aiphabi_family / aiphabi_comp / aiphabi_t2s / aiphabi_s2t / aiphabi_no_simp 各自獨立控制。
local data = require("aiphabi_data")

-- 不打簡體開了，「打簡出繁」就沒有簡體本字可用（碼表裡已經濾掉了）——順便關掉，
-- 不然那個開關會一直是死的，使用者搞不懂為什麼打簡出繁沒反應。
local function init(env)
  local ctx = env.engine.context
  env.aiphabi_notifier = ctx.option_update_notifier:connect(function(context, option_name)
    if option_name == "aiphabi_no_simp"
       and context:get_option("aiphabi_no_simp")
       and context:get_option("aiphabi_s2t") then
      context:set_option("aiphabi_s2t", false)
    end
  end)
end

local function fini(env)
  if env.aiphabi_notifier then env.aiphabi_notifier:disconnect() end
end

local function filter(input, env)
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
  local fam_on   = ok and ctx:get_option("aiphabi_family")
  local comp_on  = ok and ctx:get_option("aiphabi_comp")
  local t2s_on   = ok and ctx:get_option("aiphabi_t2s")
  local s2t_on   = ok and ctx:get_option("aiphabi_s2t")
  local no_simp  = ctx:get_option("aiphabi_no_simp")

  local extra = {}
  if fam_on or comp_on or t2s_on or s2t_on then
    local s = cands[1] and cands[1].start or 0
    local e = cands[1] and cands[1]._end or #code
    if fam_on or t2s_on or s2t_on then
      for _, ch in ipairs(data.code2chars[code] or {}) do
        if fam_on then                     -- 同類字：這個碼的字若屬某家族 → 帶出整組（各附正碼）
          for _, sib in ipairs(data.family[ch] or {}) do
            if not seen[sib] then
              seen[sib] = true
              local sc = data.char2code[sib]
              extra[#extra + 1] = Candidate("aiphabi", s, e, sib, sc and ("同類 " .. sc:upper()) or "同類")
            end
          end
        end
        if t2s_on then                     -- 打繁出簡：這個字有簡體對應 → 帶出來（附正碼）
          for _, v in ipairs(data.t2s[ch] or {}) do
            if not seen[v] then
              seen[v] = true
              local sc = data.char2code[v]
              extra[#extra + 1] = Candidate("aiphabi", s, e, v, sc and ("簡 " .. sc:upper()) or "簡")
            end
          end
        end
        if s2t_on then                     -- 打簡出繁：這個字有繁體對應 → 帶出來（附正碼）
          for _, v in ipairs(data.s2t[ch] or {}) do
            if not seen[v] then
              seen[v] = true
              local sc = data.char2code[v]
              extra[#extra + 1] = Candidate("aiphabi", s, e, v, sc and ("繁 " .. sc:upper()) or "繁")
            end
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

  -- 不打簡體：簡體專屬字整個濾掉（正選、提示都一起濾）
  local function keep(cand)
    return not (no_simp and data.simp[cand.text])
  end

  -- 兼容碼：現在打的這串碼剛好是這個字「手動收的另一種拆法」（不是主碼）。
  -- 標的不是你剛打的碼（螢幕上已經看得到了，沒意思）——是「主碼 (正確的碼)」，
  -- 讓你知道這條路是繞的，順便學到該打哪個才是主碼。用圓括號，不用方括號——
  -- 方括號 [ ] 已經被輸入容錯（aiphabi_fuzzy）拿去標「可能」了，撞了會分不清。
  -- 跟同類／偏旁碼等提示不一樣，這個只標正常候選（cands），不標 extra 那批 hint
  -- （它們各自已有自己的標籤）。
  local function markAltcode(cand)
    local acs = data.altcode[cand.text]
    local main = data.char2code[cand.text]
    if acs and acs[code] and main then
      cand.comment = "主碼 (" .. main:upper() .. ")"
    end
    return cand
  end

  -- 第一個候選 → 提示 → 其餘候選
  if cands[1] and keep(cands[1]) then yield(markAltcode(cands[1])) end
  for _, c in ipairs(extra) do
    if keep(c) then yield(c) end
  end
  for i = 2, #cands do
    if keep(cands[i]) then yield(markAltcode(cands[i])) end
  end
end

return { init = init, fini = fini, func = filter }
