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
print("== 效能：候選池上限（I／J 這種常見字根，一次補全上萬個不能卡頓）==")
-- 量過：不設上限時，i 字根單一 filter 的 table.sort 本身要 ~50ms（見開發紀錄）。候選欄
-- 一次只顯示 8～10 個，沒人會不打字一路翻幾十頁，上限訂 40（約十頁）。
-- 這裡不直接斷言耗時（機器快慢會飄，門檻抓太鬆就測不出回歸、抓太緊會在慢機器上誤報），
-- 改斷言「池子深處的候選不會被整包排序硬拉到最前面」——這個行為只有真的有上限才會發生，
-- 拿掉上限（mutation test 驗過）它會被排回第一，等於直接測到有沒有上限生效。
local MAX_SORT = 40
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 兩萬個雜訊候選，混進兩個真實高頻字：「的」放池子前段（第 10 個，落在排序上限內，
  -- 該被排到前面）；「是」放池子深處（第 8000 個，超過上限，該維持原位、不被拉到最前）
  -- ——兩個都是真實高頻字、沒有「的」那種可能撞上 exact 的巧合（「一」的主碼剛好是 i，
  -- 會被歸進 exact 一級，不受池子上限影響，不能拿來測這個）。
  local cands = {}
  for i = 1, 20000 do cands[i] = { text = "占" .. i } end
  cands[10] = { text = "的" }
  cands[8000] = { text = "是" }

  local out = h.run{ schema = schema, code = "i", options = {}, cands = cands }

  h.check(schema .. " · 候選一個都沒少", #out == #cands,
    string.format("expected %d, got %d", #cands, #out))

  local posDe, posShi = nil, nil
  for i, c in ipairs(out) do
    if c.text == "的" then posDe = i end
    if c.text == "是" then posShi = i end
  end
  h.check(schema .. " · 池子前段（第 10 個）的高頻字「的」排到前面",
    posDe ~= nil and posDe <= 20,
    string.format("的 landed at #%s", tostring(posDe)))
  h.check(schema .. " · 池子深處（第 8000 個）的高頻字「是」不會被硬拉到最前（上限生效）",
    posShi ~= nil and posShi > MAX_SORT,
    string.format("是 landed at #%s", tostring(posShi)))
end

print()
print("== 選過的字不該被池子上限擋住（aiphabi：USERFREQ 直接決定排序分數）==")
do
  -- aiphabi_order.lua 把「選過次數」直接乘進排序分數（不像 aiphabi_plus 另開 top bucket），
  -- 所以池子上限得把「選過的字」跟「純字頻」分開處理，選過的一定要完整排序——不然選過的
  -- 字剛好落在補全字根第 8000 個位置，就會被上限擋住、排不到前面，等於選過次數白記了。
  local order_mod = require("aiphabi_order")
  order_mod._USERFREQ["占4000"] = 99   -- 直接塞：模擬「這個字選過很多次」

  local cands = {}
  for i = 1, 20000 do cands[i] = { text = "占" .. i } end
  local out = h.run{ schema = "aiphabi", code = "i", options = {}, cands = cands }
  order_mod._USERFREQ["占4000"] = nil   -- 用完清掉，不要汙染其他測試

  h.checkAt("選過很多次的字（藏在第 4000 個）該排第一，不受池子上限擋住", out, 1, "占4000")
end

os.exit(h.report() == 0 and 0 or 1)
