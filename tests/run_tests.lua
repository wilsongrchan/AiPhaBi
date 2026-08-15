-- 候選排序的回歸測試（Side B）。跑法：
--   ~/.local/bin/lua tests/run_tests.lua
-- 需要 rime/lua/aiphabi_data.lua 已經由 build_rime.py 產生（測的就是那份真資料）。
--
-- 每次動 aiphabi_hint / aiphabi_order / aiphabi_order_plus 之前跟之後都跑一次。
-- 兩支 order filter 的規則要一致，所以關鍵案例兩個 schema 各測一遍。

local h = require((...) and "harness" or "harness")
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

os.exit(h.report() == 0 and 0 or 1)
