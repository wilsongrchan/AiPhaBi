-- 候選排序的回歸測試（Side B）。跑法：
--   ~/.local/bin/lua tests/run_tests.lua
-- 需要 rime/lua/aiphabi_data.lua 已經由 build_rime.py 產生（測的就是那份真資料）。
--
-- 每次動 aiphabi_hint / aiphabi_order / aiphabi_order_plus 之前跟之後都跑一次。
-- 兩支 order filter 的規則要一致，所以關鍵案例兩個 schema 各測一遍。

local h = require((...) and "harness" or "harness")
local data = require("aiphabi_data")
local T = {}

-- 開關全開，才測得到各機制；預設關的（三簡、左簡、詞組）在真機上要自己開。
local ALL_ON = {
  aiphabi_family = true, aiphabi_comp = true, aiphabi_short100 = true,
  aiphabi_short3 = true, aiphabi_left_short = true, aiphabi_phrase = true,
}

print("== 左簡碼：打滿的要排在最前（exact 一級），不能被冷門猜測壓過 ==")
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 模擬：打 smbf 時碼表本身給不出東西，只有切分湊出來的怪詞（尔日）跟一個高頻的雜訊字。
  -- 鯉 是靠 aiphabi_hint 從左簡碼表補進來的。若 鯉 仍標 ap_pool，就會照字頻輸給 的。
  local out = h.run{
    schema = schema, code = "smbf", options = ALL_ON,
    cands = {
      { text = "尔日" },          -- enable_sentence 湊出來的兩字組合
      { text = "的" },            -- 高頻雜訊（字頻遠高於 鯉）
    },
  }
  h.checkAt(schema .. " · 打滿 SMBF → 鯉 排第一", out, 1, "鯉")
  h.checkComment(schema .. " · 鯉 標「左簡 (主碼)」", out, "鯉", "左簡 (SOTMF)")
end

print()
print("== 左簡碼：沒打完的是補全，屬於猜測，不該搶到 exact 那一級 ==")
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  local out = h.run{
    schema = schema, code = "smb", options = ALL_ON,
    cands = { { text = "的" } },   -- 高頻字：補全的 鯉 不該壓過它
  }
  h.checkPresent(schema .. " · 打 SMB 找得到 鯉（補全）", out, "鯉", true)
  h.checkPresent(schema .. " · 打 SMB 也找得到 鯤", out, "鯤", true)
  h.checkAt(schema .. " · 但補全排在高頻字之後", out, 1, "的")
end

print()
print("== 提示寫法：圓括號＝參考用主碼，沒括號＝可以改打的捷徑碼 ==")
do
  -- 打簡碼 JKQ：我 要排第一，並標「簡碼 (主碼)」
  local out = h.run{
    schema = "aiphabi", code = "jkq", options = ALL_ON,
    cands = { { text = "丘" } },
  }
  h.checkAt("打 JKQ → 我 排第一（約定簡碼）", out, 1, "我")
  h.checkComment("打 JKQ → 我 標 簡碼 (JKXQ)", out, "我", "簡碼 (JKXQ)")

  -- 打主碼 JKXQ：我 要標「簡碼 JKQ」（沒括號＝下次可以改打這個）
  local out2 = h.run{
    schema = "aiphabi", code = "jkxq", options = ALL_ON,
    cands = { { text = "我" } },
  }
  h.checkComment("打 JKXQ → 我 標 簡碼 JKQ（無括號）", out2, "我", "簡碼 JKQ")

  -- 兼容碼：打 IF 出 主，標「兼容 (QE)」而不是「主碼 (QE)」
  local out3 = h.run{
    schema = "aiphabi", code = "if", options = ALL_ON,
    cands = { { text = "主" } },
  }
  h.checkComment("打 IF → 主 標 兼容 (QE)", out3, "主", "兼容 (QE)")
end

print()
print("== 左簡碼反向提醒：只提真的比主碼短的字 ==")
do
  -- 鮭 主碼 SOTMF（5）、左簡碼 SMFF（4）→ 有省到，要提醒
  local out = h.run{
    schema = "aiphabi", code = "sotmf", options = ALL_ON,
    cands = { { text = "鮭" } },
  }
  h.checkComment("打 鮭 主碼 → 提醒 左簡 SMFF", out, "鮭", "左簡 SMFF")

  -- 鐵 主碼 YFVFQ（5）、左簡碼 YVFOQ（5）→ 沒省到，不該提醒左簡
  local out2 = h.run{
    schema = "aiphabi", code = "yfvfq", options = ALL_ON,
    cands = { { text = "鐵" } },
  }
  local c
  for _, x in ipairs(out2) do if x.text == "鐵" then c = x.comment end end
  h.check("打 鐵 主碼 → 不提左簡（一樣長，沒省到）",
    c == nil or not tostring(c):find("左簡"),
    string.format("got %q", tostring(c)))
end

print()
print("== 開關關掉就完全不作用 ==")
do
  local out = h.run{
    schema = "aiphabi", code = "smbf",
    options = { aiphabi_left_short = false, aiphabi_short100 = true },
    cands = { { text = "尔日" } },
  }
  h.checkPresent("左簡碼關 → 打 SMBF 不會冒出 鯉", out, "鯉", false)
end

print()
print("== 效能：三層上限（I／J 這種常見字根，一次補全上萬個不能卡頓）==")
-- 量過：光是三個 filter（hint／fuzzy／order）各自把上萬個候選整包掃過一輪，比池子排序
-- 本身更貴——這才是「加了排序上限還是卡」的真正原因。所以有三層，越前面越省：
--   1. RAW_CAP＝1500（aiphabi_hint.lua，filter 鏈最前面）：根本不跟上游多要——超過這個
--      數量的候選直接不存在，後面幾個 filter 收到的候選量也一起變小，不用各自設上限。
--   2. MAX_SORT＝40（aiphabi_order[_plus].lua）：RAW_CAP 之內的，也只有前 40 個做真的
--      table.sort；超過的維持原始順序（碼表已經照 weight 排過）接在後面。
--   3. 選過的字（USERFREQ／aiphabi_plus 的 top bucket）不受 MAX_SORT 影響——只要還在
--      RAW_CAP 之內，一定排到前面。
-- 這裡不直接斷言耗時（機器快慢會飄，門檻抓太鬆就測不出回歸、抓太緊會在慢機器上誤報），
-- 改斷言「行為」——拿掉任一層上限（mutation test 驗過），對應的斷言就會變紅。
local RAW_CAP, MAX_SORT = 1500, 40
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 兩萬個雜訊候選，混進三個真實字：「的」在第 10（兩層之內，該排到最前）；「是」在
  -- 第 1000（在 RAW_CAP 之內、但超過 MAX_SORT，該維持原位、不被拉到最前，但要還在）；
  -- 「占16000」代表「超過 RAW_CAP」的候選，該整個消失，連補全都補不出來——這是刻意的
  -- 取捨（見 aiphabi_hint.lua 開頭註解），不是漏洞。（沒用「一」是因為它主碼剛好是 i，
  -- 會被歸進 exact 一級，不受這兩層上限影響，測不出東西。）
  local cands = {}
  for i = 1, 20000 do cands[i] = { text = "占" .. i } end
  cands[10] = { text = "的" }
  cands[1000] = { text = "是" }

  local out = h.run{ schema = schema, code = "i", options = {}, cands = cands }

  local posDe, posShi, has16000 = nil, nil, false
  for i, c in ipairs(out) do
    if c.text == "的" then posDe = i end
    if c.text == "是" then posShi = i end
    if c.text == "占16000" then has16000 = true end
  end
  h.check(schema .. " · RAW_CAP 之內（第 10）的高頻字「的」排到前面",
    posDe ~= nil and posDe <= 20,
    string.format("的 landed at #%s", tostring(posDe)))
  h.check(schema .. " · RAW_CAP 之內、MAX_SORT 之外（第 1000）的高頻字「是」還在、但不會被硬拉到最前",
    posShi ~= nil and posShi > MAX_SORT,
    string.format("是 landed at #%s", tostring(posShi)))
  h.check(schema .. " · 超過 RAW_CAP（第 16000）的候選整個不出現——這是取捨，不是漏洞",
    not has16000, "占16000 unexpectedly present in output")
end

print()
print("== 選過的字不該被排序上限擋住（RAW_CAP 之內才有效——見上面「這是取捨」那條）==")
do
  -- aiphabi_order.lua 把「選過次數」直接乘進排序分數（不像 aiphabi_plus 另開 top bucket），
  -- 所以排序上限得把「選過的字」跟「純字頻」分開處理，選過的一定要完整排序——不然選過的
  -- 字剛好落在 MAX_SORT 之外，就會排不到前面，等於選過次數白記了。字要擺在 RAW_CAP
  -- （1500）之內，不然還沒排到這裡，先被 aiphabi_hint.lua 那層擋掉了。
  local order_mod = require("aiphabi_order")
  order_mod._USERFREQ["占1000"] = 99   -- 直接塞：模擬「這個字選過很多次」

  local cands = {}
  for i = 1, 20000 do cands[i] = { text = "占" .. i } end
  local out = h.run{ schema = "aiphabi", code = "i", options = {}, cands = cands }
  order_mod._USERFREQ["占1000"] = nil   -- 用完清掉，不要汙染其他測試

  h.checkAt("選過很多次的字（藏在第 1000 個，RAW_CAP 之內）該排第一，不受排序上限擋住",
    out, 1, "占1000")
end

print()
print("== 選詞候選本身要記到選過次數，不能只拆單字（2026-08-26 明日/BDB 一直在第二頁那次）==")
do
  -- bump() 以前只拆 UTF-8 字加分：選「明日」只會加到 USERFREQ["明"]／["日"]，
  -- USERFREQ["明日"]（score() 真正查的 key）永遠是 0，選幾百次候選都不會被拉到最前。
  local order_mod = require("aiphabi_order")
  for _ = 1, 5 do order_mod._bump("明日") end
  h.check("bump(\"明日\") 五次後，USERFREQ[\"明日\"] 本身要有記到",
    order_mod._USERFREQ["明日"] == 5,
    string.format("got %s", tostring(order_mod._USERFREQ["明日"])))
  h.check("單字 明／日 也照舊各自加分（沒有這個規矩不能破）",
    order_mod._USERFREQ["明"] == 5 and order_mod._USERFREQ["日"] == 5,
    string.format("明=%s 日=%s", tostring(order_mod._USERFREQ["明"]), tostring(order_mod._USERFREQ["日"])))
  order_mod._USERFREQ["明日"] = nil
  order_mod._USERFREQ["明"] = nil
  order_mod._USERFREQ["日"] = nil

  -- 端到端：明日 被選過、混在一堆雜訊候選裡，該排到最前（跟前面「占1000」那個測試同機制，
  -- 差別是這裡驗證的是 bump() 真的把 key 記對了，不是排序邏輯本身）。
  order_mod._bump("明日")
  order_mod._bump("明日")
  order_mod._bump("明日")
  local cands = { { text = "明日" } }
  for i = 1, 40 do cands[#cands + 1] = { text = "占" .. i } end
  local out = h.run{ schema = "aiphabi", code = "bdb", options = {}, cands = cands }
  order_mod._USERFREQ["明日"] = nil
  order_mod._USERFREQ["明"] = nil
  order_mod._USERFREQ["日"] = nil
  h.checkAt("選過的詞候選「明日」排第一，不會卡在池子裡出不了頭", out, 1, "明日")
end

os.exit(h.report() == 0 and 0 or 1)
