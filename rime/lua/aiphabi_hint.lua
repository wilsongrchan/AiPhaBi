-- 愛發筆 · 同類字 + 偏旁碼 + 打繁出簡 + 打簡出繁 + 不打簡體 提示（filter）
-- 打中約定表某形近字家族（土士工干上…）其一，就把整組同類字帶出來；
-- 打了某字「作為偏旁時」的碼，就提醒該字（它單獨成字另有取法，例 K → 大）；
-- 打繁出簡／打簡出繁：這個碼的字若有簡體／繁體對應版本，就順便帶出來。各附正碼（有的話）。
-- 不打簡體：把簡體專屬字（純一對一簡化，如 馬→马）從候選裡整個濾掉；歸併字
-- （后／干／咸…本身也是獨立傳承字）不算，不會被濾掉。
-- 約定簡碼：打中某個常用字「主碼首尾兩碼」剛好組成的簡碼，就把那個字也帶出來（附正碼）。
-- 這個字會排到最前面，蓋過原本占那個碼的字——會被挑進約定簡碼，就是你認定它比
-- 誰占那個碼都常用，理當排第一，不然約定了也沒省到選字的那一下。
-- 三簡碼：跟約定簡碼同個道理，但不用手動挑——4 碼以上的字都適用，打 3 碼（頭兩碼
-- +末一碼）當「AB`C」查全表，碰到的都帶出來（附正碼）。跟約定簡碼不一樣：約定簡碼
-- 是認定過「就這個字」，值得排最前面、蓋過其他候選；三簡碼是自動配對、可能撞好幾個
-- 字，沒有這種把握，所以排在所有正常候選（含補全）之後——真正打中的字（哪怕只是
-- 補全中）永遠比三簡碼這種猜測優先，不然打對的字反而被一堆猜測擠到後面去。
-- 排序：簡碼（認定過「就這個字」）> 完整的正常候選（含補全，是不是主碼都算「打中了」）
-- > 其餘提示（同類／偏旁碼／三簡碼…都是自動配對、沒認定過「就這個字」，一律墊底）。
-- 真正打中的候選，哪怕只是補全中，也不該被這些自動提示擠到後面去。
-- 由 aiphabi_family / aiphabi_comp / aiphabi_t2s / aiphabi_s2t / aiphabi_no_simp / aiphabi_short100
-- / aiphabi_short3 各自獨立控制。
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

-- 上限：table_translator 開 enable_completion，碰上大碼表＋常見短前綴，一次可能
-- 生出成千上百個候選（哪個字/詞的碼剛好以這幾碼開頭都算）。這裡若照單全收，等於
-- 每個按鍵都要把這一大串全部算完（含底下的字典查找、組字串），纔輪到下面的 filter
-- ——這就是手機上感覺到卡頓的根源，不是碼表本身「大」的問題（雾凇拼音碼表更大也
-- 不卡，只是它沒有這種「先收全部再處理」的自訂 filter）。反正最後只會顯示
-- page_size（6）個，游標往後的候選再多也用不到，收滿這個數字就不再跟 table_translator
-- 要更多，讓它不必真的算出後面那一大串。
local CAND_CAP = 200

local function filter(input, env)
  local ctx = env.engine.context
  local code = ctx.input
  -- 先收下候選（原順序不動，但設上限，見上），順便記下已出現的字。
  -- enable_sentence 自己組出來的組句候選，type 是 librime 內建的 "sentence"——「仓」
  -- 在候選旁邊畫的那顆 ☯ 圖示是認這個 type 畫的，不是文字（comment_format 換不掉）。
  -- 這裡重包成 ap_pool，圖示就不會跟著長出來，其餘（text/comment）原樣照抄。
  local cands, seen = {}, {}
  for cand in input:iter() do
    if cand.type == "sentence" then
      cand = Candidate("ap_pool", cand.start, cand._end, cand.text, cand.comment)
    end
    cands[#cands + 1] = cand
    seen[cand.text] = true
    if #cands >= CAND_CAP then break end
  end

  -- 只處理純字母碼；萬用鍵那套交給 wildcard
  local ok = code and code ~= "" and not code:find("[^a-z]")
  local fam_on   = ok and ctx:get_option("aiphabi_family")
  local comp_on  = ok and ctx:get_option("aiphabi_comp")
  local t2s_on   = ok and ctx:get_option("aiphabi_t2s")
  local s2t_on   = ok and ctx:get_option("aiphabi_s2t")
  local short_on = ok and ctx:get_option("aiphabi_short100")
  local short3_on = ok and #code == 3 and ctx:get_option("aiphabi_short3")
  -- 四碼詞組：跟著詞組走——二合一（aiphabi_plus）詞組恆開故恆有；純愛發筆看 aiphabi_phrase。
  -- 打到第 3 碼就先補全（四碼的前三碼），第 4 碼是完整四碼。
  local phrase_on = env.engine.schema.schema_id == "aiphabi_plus" or ctx:get_option("aiphabi_phrase")
  local si4_on    = ok and (#code == 3 or #code == 4) and phrase_on
  local no_simp  = ctx:get_option("aiphabi_no_simp")

  local extra = {}
  local extra3 = {}        -- 三簡碼命中的字：排在所有正常候選之後（見下方排序理由）
  local extra4 = {}        -- 四碼連打命中的詞：同三簡碼道理，墊底、依詞頻排（order 再處理）
  local short_hit = nil    -- 約定簡碼命中的字：排最前面，不跟其他提示混在一起
  if fam_on or comp_on or t2s_on or s2t_on or short_on or short3_on or si4_on then
    local s = cands[1] and cands[1].start or 0
    local e = cands[1] and cands[1]._end or #code
    if fam_on or t2s_on or s2t_on then
      for _, ch in ipairs(data.code2chars[code] or {}) do
        if fam_on then                     -- 同類字：這個碼的字若屬某家族 → 帶出整組（各附正碼）
          for _, sib in ipairs(data.family[ch] or {}) do
            if not seen[sib] then
              seen[sib] = true
              local sc = data.char2code[sib]
              extra[#extra + 1] = Candidate("ap_pool", s, e, sib, sc and ("同類 " .. sc:upper()) or "同類")
            end
          end
        end
        if t2s_on then                     -- 打繁出簡：這個字有簡體對應 → 帶出來（附正碼）
          for _, v in ipairs(data.t2s[ch] or {}) do
            if not seen[v] then
              seen[v] = true
              local sc = data.char2code[v]
              extra[#extra + 1] = Candidate("ap_pool", s, e, v, sc and ("簡 " .. sc:upper()) or "簡")
            end
          end
        end
        if s2t_on then                     -- 打簡出繁：這個字有繁體對應 → 帶出來（附正碼）
          for _, v in ipairs(data.s2t[ch] or {}) do
            if not seen[v] then
              seen[v] = true
              local sc = data.char2code[v]
              extra[#extra + 1] = Candidate("ap_pool", s, e, v, sc and ("繁 " .. sc:upper()) or "繁")
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
          extra[#extra + 1] = Candidate("ap_pool", s, e, ch, sc and ("偏旁碼 " .. sc:upper()) or "偏旁碼")
        end
      end
    end
    if short3_on then                    -- 三簡碼：打了 3 碼，當「頭兩碼+末一碼」查（相當於 AB`C）；
                                          -- 提示一律秀主碼，不是比對到的那個碼（可能是完整碼，太長）
      for _, ch in ipairs(data.short3[code] or {}) do
        if not seen[ch] then
          seen[ch] = true
          local sc = data.char2code[ch]
          extra3[#extra3 + 1] = Candidate("ap_pool", s, e, ch, sc and ("三簡 " .. sc:upper()) or "三簡")
        end
      end
    end
    if si4_on then                       -- 四碼連打：打了 4 碼，查詞庫壓成的四碼 → 帶出整詞（依詞頻）
      for _, w in ipairs(data.si4[code] or {}) do
        if not seen[w] then
          seen[w] = true
          extra4[#extra4 + 1] = Candidate("ap_pool", s, e, w, "四碼")
        end
      end
    end
    if short_on then                     -- 約定簡碼：打中某常用字「主碼首尾兩碼」→ 排到最前面（附正碼）
      -- 注意：不能用「not seen[ch]」擋——這個碼常常本來就補全得出這個字（只是排
      -- 在後面、沒被標「簡碼」），seen[ch] 早就是 true 了。要挑的是「排到第一個」，
      -- 不是「加一個原本沒有的候選」，所以這裡不看 seen，下面 yield 時才把它從
      -- 原本的位置濾掉，改成排最前面。
      local ch = (data.shortcode[code] or {})[1]
      if ch then
        local sc = data.char2code[ch]
        short_hit = Candidate("ap_short", s, e, ch, sc and ("簡碼 " .. sc:upper()) or "簡碼")
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
  --
  -- 反過來的情況：打的就是這個字自己的完整碼（不是兼容碼、也不是簡碼本身），
  -- 但這個字剛好有約定簡碼可以打——附「簡碼 XX」提醒，教下次可以少打幾碼。
  -- 兩種提示互斥、兼容碼優先（你正在繞路，比「其實有更快的路」更該先知道）。
  -- 跟同類／偏旁碼等提示不一樣，這個只標正常候選（cands），不標 extra 那批 hint
  -- （它們各自已有自己的標籤）；三簡碼那套太模糊，不比照辦理。
  local function markHints(cand)
    local acs = data.altcode[cand.text]
    local main = data.char2code[cand.text]
    if acs and acs[code] and main then
      cand.comment = "主碼 (" .. main:upper() .. ")"
      return cand
    end
    if short_on then
      local sc = data.shortcode_rev[cand.text]
      if sc and sc ~= code then
        cand.comment = "簡碼 " .. sc:upper()
        return cand
      end
    end
    -- 碼還沒打完：自己算「還差幾碼」，不要相信 Rime 配到的那個——它可能是配到
    -- 完整碼那條路，完整碼有時長到看不完（例：打 3 碼配到一個 10 碼字，秀「還差
    -- 7 碼」一點意義都沒有；主碼明明只差 2 碼）。打的這幾碼是主碼的前綴，就秀
    -- 主碼還差幾碼；不是主碼的前綴（只能靠完整碼配到），秀完整的主碼當參考。
    -- 萬用鍵（含反引號）不管，那邊自己有一套（ok 已經濾掉含反引號的情況）。
    if ok and main and main ~= code then
      if main:sub(1, #code) == code then
        cand.comment = "- " .. main:sub(#code + 1):upper()
      else
        cand.comment = main:upper()
      end
    end
    return cand
  end

  -- 約定簡碼命中的字 → 全部正常候選（含補全）→ 同類／偏旁碼等提示 → 三簡碼。
  -- short_hit 那個字如果本來就在 cands 裡（常見：這個碼補全得到它，只是排比較後面），
  -- 底下要把原本那個位置濾掉，不然會兩個一模一樣的候選一起出現。
  local shortText = short_hit and short_hit.text
  if short_hit and keep(short_hit) then yield(short_hit) end
  for i = 1, #cands do
    if cands[i].text ~= shortText and keep(cands[i]) then yield(markHints(cands[i])) end
  end
  for _, c in ipairs(extra) do
    if keep(c) then yield(c) end
  end
  for _, c in ipairs(extra3) do
    if keep(c) then yield(c) end
  end
  for _, c in ipairs(extra4) do
    if keep(c) then yield(c) end
  end
end

return { init = init, fini = fini, func = filter }
