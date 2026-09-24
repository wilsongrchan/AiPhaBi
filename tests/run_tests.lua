-- 候選排序的回歸測試（Side B）。跑法：
--   ~/.local/bin/lua tests/run_tests.lua
-- 需要 rime/lua/aiphabi_data.lua 已經由 build_rime.py 產生（測的就是那份真資料）。
--
-- 每次動 aiphabi_hint / aiphabi_order / aiphabi_order_plus 之前跟之後都跑一次。
-- 兩支 order filter 的規則要一致，所以關鍵案例兩個 schema 各測一遍。

local h = require((...) and "harness" or "harness")
local data = require("aiphabi_data")
local T = {}

-- 左簡碼整支功能 2026-09-14 起 rules.json enabled:false（見該條 note）：build_rime.py
-- 讀到就跳過整段運算，M.leftshort/leftshort_pre/leftshort_rev 全空。下面幾個依賴
-- 具體字（飫/針/銅/鍋，原本測金字旁家族）的正向案例先跳過，不當成真的回歸——
-- 名單只是關掉、沒刪，等哪天開回來這些案例會自動繼續跑。
local LEFTSHORT_ON = next(data.leftshort) ~= nil

-- 開關全開，才測得到各機制；預設關的（三簡、左簡、詞組）在真機上要自己開。
local ALL_ON = {
  aiphabi_family = true, aiphabi_comp = true, aiphabi_short100 = true,
  aiphabi_short3 = true, aiphabi_left_short = true, aiphabi_phrase = true,
}

print("== 左簡碼：打滿的要排在最前（exact 一級），不能被冷門猜測壓過 ==")
if not LEFTSHORT_ON then
  print("  (skip - 左簡碼 enabled:false)")
else
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 模擬：打 agjk 時碼表本身給不出東西，只有切分湊出來的怪詞（尔日）跟一個高頻的雜訊字。
  -- 飫（食字旁）是靠 aiphabi_hint 從左簡碼表補進來的。若 飫 仍標 ap_pool，就會照字頻輸給 的。
  -- （原本用魚字旁的 鯉 SMBF；魚 已不在 rules.json left_short 家族名單裡，改用食字旁 AEG。）
  local out = h.run{
    schema = schema, code = "agjk", options = ALL_ON,
    cands = {
      { text = "尔日" },          -- enable_sentence 湊出來的兩字組合
      { text = "的" },            -- 高頻雜訊（字頻遠高於 飫）
    },
  }
  h.checkAt(schema .. " · 打滿 AGJK → 飫 排第一", out, 1, "飫")
  h.checkComment(schema .. " · 飫 標「左簡 (主碼)」", out, "飫", "左簡 (AEGJK)")
end
end

print()
print("== 左簡碼：沒打完的是補全，屬於猜測，不該搶到 exact 那一級 ==")
if not LEFTSHORT_ON then
  print("  (skip - 左簡碼 enabled:false)")
else
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  local out = h.run{
    schema = schema, code = "agj", options = ALL_ON,
    cands = { { text = "的" } },   -- 高頻字：補全的 飫 不該壓過它
  }
  h.checkPresent(schema .. " · 打 AGJ 找得到 飫（補全）", out, "飫", true)
  h.checkPresent(schema .. " · 打 AGJ 也找得到 餓", out, "餓", true)
  h.checkAt(schema .. " · 但補全排在高頻字之後", out, 1, "的")
end
end

print()
print("== 補全 vs 打滿：碼還沒打完的補全（type=completion）不該排在打滿整段的候選前面 ==")
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 打 JOVNVIS：碰巧（jovnvis）打滿了；碰瓷（jovnvisq）還差一碼、是 librime 標的 completion。
  -- 碰瓷 詞頻較高（2110 vs 1286），舊行為會讓補全排到打滿的前面（回報的畫面）。
  local out = h.run{
    schema = schema, code = "jovnvis", options = ALL_ON,
    cands = {
      { text = "碰瓷", type = "completion", comment = "- Q" },  -- 補全：Rime 標的「還沒打完」
      { text = "碰巧" },                                         -- 打滿整段
    },
  }
  h.checkAt(schema .. " · 打滿的 碰巧 排在補全 碰瓷 前面", out, 1, "碰巧")
  h.checkPresent(schema .. " · 補全 碰瓷 還在（只是墊後）", out, "碰瓷", true)
end

print()
print("== exact 一級內部：主碼 exact 跟打滿的四碼詞同級，但同級內仍要照常用度排 ==")
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 打 JWEJ：爭 的主碼剛好是 JWEJ；同一個簽名底下也收了幾個生僻地名（长山群岛／舟山
  -- 群島／万山群岛），都標 type=ap_si4。兩者都算 exact 一級（推得出來的碼），但常用單字
  -- 爭 不該輸給候選提供者剛好先吐出來的冷門地名（回報：jwej 打「爭」被「万山群島」蓋過）。
  local out = h.run{
    schema = schema, code = "jwej", options = ALL_ON,
    cands = {
      { text = "万山群島", type = "ap_si4" },
      { text = "长山群岛", type = "ap_si4" },
      { text = "爭" },
    },
  }
  h.checkAt(schema .. " · 常用字 爭 排在生僻四碼地名前面", out, 1, "爭")
  h.checkPresent(schema .. " · 四碼地名 万山群島 還在（只是排後面）", out, "万山群島", true)
end

print()
print("== 四碼快打只打到前三碼＝補全，不是打滿：不能跟打滿的主碼擠同一級 ==")
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 打 QOQ：中國 的詞組碼剛好是 QOQ（中q + 國oq，國有約定簡碼）；同一個前三碼底下也收了
  -- 好幾個四碼快打詞（福田康夫＝QOQI、家喻户晓＝QOQB…），都只打到前三碼，還差最後一碼，
  -- 標 type=completion（跟 librime 原生補全同一個 type，見 aiphabi_hint.lua）。這些
  -- 「還沒打完」的是補全一級，不該跟打滿主碼、exact 一級的 中國 同級（回報：福田康夫
  -- 排到 中國 前面，因為前三碼曾經被當「打滿的四碼」處理，沒有跟真的打滿四碼分開）。
  -- 福田康夫／家喻户晓 不用自己塞進 cands——它們是 aiphabi_hint.lua 自己從真實的
  -- data.si4['qoq'] 查出來、動態生成 extra4 候選的（type/comment 都是那邊決定），
  -- 塞一個「假裝已經是 completion」的候選進 cands 反而不寫實：cands 代表的是碼表
  -- 吐出來的原始候選，真實情況下 Rime 不會吐出這個 type，會被主迴圈的 markHints 誤當
  -- 一般候選重新處理、蓋掉本來該有的「- I」提示。
  local out = h.run{
    schema = schema, code = "qoq", options = ALL_ON,
    cands = { { text = "中國" } },
  }
  h.checkAt(schema .. " · 打滿主碼 中國 排在還沒打完的四碼快打前面", out, 1, "中國")
  h.checkComment(schema .. " · 福田康夫 標「四碼 - I」（還差哪一碼）", out, "福田康夫", "四碼 - I")
  h.checkPresent(schema .. " · 福田康夫 還在（只是排後面）", out, "福田康夫", true)
end

print()
print("== 四碼快打打到前兩碼也該有提示：不然候選欄看起來斷頭，使用者以為打錯 ==")
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 打 QQ：容祖兒 的四碼簽名是 QQFL（容q + 祖q + 兒首f + 兒末l）。只到第三碼（QQF）才有
  -- 提示的話，打完第二碼候選欄會像斷頭一樣（回報：QQ 打到一半看起來沒東西，QQF 才冒出來，
  -- 使用者誤以為 QQ 這條路打錯了）。打到第二碼也該冒出來，標「四碼 - FL」（還差兩碼）。
  local out = h.run{
    schema = schema, code = "qq", options = ALL_ON,
    cands = {},
  }
  h.checkPresent(schema .. " · 打 QQ 找得到 容祖兒（四碼快打前兩碼）", out, "容祖兒", true)
  h.checkComment(schema .. " · 容祖兒 標「四碼 - FL」（還差哪兩碼）", out, "容祖兒", "四碼 - FL")
end

print()
print("== 補全彼此打平分數時：真正的詞組補全該贏四碼快打的前三碼補全 ==")
do
  -- 手機上 M.wordfreq 清空成 {}（LuaJIT 常數上限緣故），多字詞一律 0 分，score()／cf()
  -- 打平——這裡模擬那個情境（跑完就還原，不影響後面其他測），兩種補全（中國人 真正的
  -- 詞組補全 vs 福田康夫 四碼快打的前三碼補全）在 comp 這一層打平分數時，不能靠候選
  -- 來源順序決勝負（四碼快打先吐出來就贏），該優先真正的詞組補全（回報：qoq 打
  -- 「中國人」被「福田康夫」蓋過）。
  local savedWordfreq = data.wordfreq
  data.wordfreq = {}
  for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
    local out = h.run{
      schema = schema, code = "qoq", options = ALL_ON,
      cands = {
        { text = "中國" },
        { text = "中國人", type = "completion", comment = "- Y" },
      },
    }
    h.checkAt(schema .. " · 分數打平時 中國人（真正的補全）排在 福田康夫（四碼補全）前面",
      out, 2, "中國人")
  end
  data.wordfreq = savedWordfreq
end

print()
print("== 不打簡體：地名詞庫逐字簡化的簡體詞（澳门…）跟簡體專屬單字一起被濾掉 ==")
do
  h.check("澳门 在 M.simp_phrase 裡、澳門 不在",
    data.simp_phrase["澳门"] == true and data.simp_phrase["澳門"] == nil,
    "expected simp_phrase[澳门]=true, [澳門]=nil")
  h.check("essay 高頻日常詞的簡體版也進了 M.simp_phrase（这个／我们／因为）",
    data.simp_phrase["这个"] == true and data.simp_phrase["我们"] == true
      and data.simp_phrase["因为"] == true,
    "expected simp_phrase 这个/我们/因为 = true")
  for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
    -- 打 澳门 的詞組碼 wjkqc（見 aiphabi.dict.yaml）：候選同時有簡繁兩式。
    local base = { code = "wjkqc", schema = schema,
      cands = { { text = "澳门" }, { text = "澳門" } } }
    local off = h.run{ code = base.code, schema = schema, options = ALL_ON, cands = base.cands }
    h.checkPresent(schema .. " · 不打簡體關 → 澳门 照常在", off, "澳门", true)
    local on_opts = { aiphabi_phrase = true, aiphabi_no_simp = true }
    local on = h.run{ code = base.code, schema = schema, options = on_opts, cands = base.cands }
    h.checkPresent(schema .. " · 不打簡體開 → 澳门 被濾掉", on, "澳门", false)
    h.checkPresent(schema .. " · 不打簡體開 → 澳門 還在", on, "澳門", true)
  end
end

print()
print("== 不打簡體：甲表字一律不算簡體專屬，dual_use_merged.json 逐字補的也是 ==")
do
  -- 岩/升/蔑/晒/霉…都在甲表（教育部常用國字），卻剛好也是某個字的簡化目標
  -- （t2s[巖]=岩、t2s[昇]=升…）——之前被 s2t_map 一律當簡體專屬濾掉，回報過好幾次
  -- （2026-09-10 岩，Wilson 順手核過整批甲表交集）。build_rime.py 現在自動排除甲表字，
  -- 不用逐字收進 dual_use_merged.json。
  local tw_rescued = { "岩", "升", "恤", "蔑", "肴", "灶", "咨", "冢", "漓", "晒",
                        "霉", "痴", "仆", "辟", "庵", "穗", "夸", "虫", "捆", "札",
                        "皂", "愿", "粽", "浚", "苧", "斫", "胄", "吁", "荐", "虱", "并" }
  for _, ch in ipairs(tw_rescued) do
    h.check("甲表字 " .. ch .. " 不在 M.simp 裡", data.simp[ch] == nil,
      "got data.simp[" .. ch .. "]=" .. tostring(data.simp[ch]))
  end
  -- 册（不在甲表，冊 才在）：手動補進 dual_use_merged.json 那條路還要繼續管用。
  h.check("册 手動收進 dual_use_merged.json，不在 M.simp 裡", data.simp["册"] == nil,
    "got data.simp[册]=" .. tostring(data.simp["册"]))
  -- 反例：真正的簡體專屬字不該被這條規則誤放行。
  h.check("馬 的簡化 马 仍在 M.simp 裡（真的簡體專屬）", data.simp["马"] == true,
    "got data.simp[马]=" .. tostring(data.simp["马"]))
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

  -- 兼容碼：主 改碼後主碼是 IF、兼容碼是 QE（a1b90ea）——打 QE 出 主，
  -- 標「兼容 (IF)」而不是「主碼 (IF)」
  local out3 = h.run{
    schema = "aiphabi", code = "qe", options = ALL_ON,
    cands = { { text = "主" } },
  }
  h.checkComment("打 QE → 主 標 兼容 (IF)", out3, "主", "兼容 (IF)")

  -- 兼容字型：電 主碼 MIIBL、有一條「香港字形」變體碼 MIKBL（同一個字，另一地區
  -- 正式寫法，不是退一步的拆法）——以前完全沒標（空括號 (MIIBL) 看不出是什麼），
  -- 跟兼容碼共用同一個「兼容」標籤，提示要短，不分是拆法退一步還是地區正式寫法
  -- （2026-09-23 回報；一度分開標「兼容字型」，Wilson 要求收回共用同一個標籤）。
  local out4 = h.run{
    schema = "aiphabi", code = "mikbl", options = ALL_ON,
    cands = { { text = "電" } },
  }
  h.checkComment("打 MIKBL → 電 標 兼容 (MIIBL)", out4, "電", "兼容 (MIIBL)")
end

print()
print("== 約定簡碼字本身主碼撞碼：開簡碼時把有簡碼可打的那個擠到最後，逼你改用簡碼 ==")
do
  -- 這／記 主碼都是 IOZ，這 有約定簡碼 IZ、記 沒有。這 字頻本來就比 記高（模擬碼表
  -- 原序：較常用的先），不擠的話簡碼開了也沒人會用——反正打主碼一樣先看到 這。
  local out = h.run{
    schema = "aiphabi", code = "ioz", options = ALL_ON,
    cands = { { text = "這" }, { text = "記" } },   -- 碼表原序：這（較常用）先
  }
  h.checkAt("開約定簡碼 → 打主碼 IOZ：記（沒簡碼）排第一", out, 1, "記")
  h.checkAt("開約定簡碼 → 這（有簡碼）擠到第二", out, 2, "這")
  h.checkComment("開約定簡碼 → 這 仍標「簡碼 IZ」提醒（沒被擠掉，只是往後排）", out, "這", "簡碼 IZ")

  -- 開關關掉：完全不查 short_demote，字頻排序照舊（這 排第一）——這也是使用者
  -- 沒開約定簡碼時該有的行為：比較常用的字本來就該先出來。
  local off = h.run{
    schema = "aiphabi", code = "ioz", options = {},
    cands = { { text = "這" }, { text = "記" } },
  }
  h.checkAt("約定簡碼關掉 → 打主碼 IOZ：這（較常用）照舊排第一", off, 1, "這")
end

print()
print("== 同一機制也管得到「撞的是別人的兼容碼」，不限於兩個字天生同一個主碼 ==")
do
  -- 家 主碼 QJK、有約定簡碼 QK；衣 主碼是 IJK，但另收了一條兼容碼 QJK——打 QJK
  -- 兩個字都會冒出來（碼表「完整碼／兼容碼一律接受」）。這種撞法一樣該擠 家。
  local out = h.run{
    schema = "aiphabi", code = "qjk", options = ALL_ON,
    cands = { { text = "家" }, { text = "衣" } },
  }
  h.checkAt("開約定簡碼 → 打 QJK：衣（撞碼、沒簡碼）排第一", out, 1, "衣")
  h.checkAt("開約定簡碼 → 家（有簡碼 QK）擠到第二", out, 2, "家")
end

print()
print("== 左簡碼反向提醒：只提真的比主碼短的字 ==")
do
  -- 針 主碼 YFVT（4）、左簡碼 YVT（3）→ 有省到，要提醒
  -- （原本用魚字旁的 鮭；魚 已不在 rules.json left_short 家族名單裡，改用金字旁 YFV；
  -- 金 現在也整支關掉了，見 LEFTSHORT_ON。）
  if LEFTSHORT_ON then
    local out = h.run{
      schema = "aiphabi", code = "yfvt", options = ALL_ON,
      cands = { { text = "針" } },
    }
    h.checkComment("打 針 主碼 → 提醒 左簡 YVT", out, "針", "左簡 YVT")
  else
    print("  (skip - 打 針 主碼 → 提醒 左簡 YVT：左簡碼 enabled:false)")
  end

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
print("== 左簡碼：主碼因五碼上限被壓成同一碼時，左簡碼能拆開重碼（銅/鍋 都壓成 YFVUO）==")
-- （原本用魚字旁的 贏赢嬴羸蠃；魚 已不在 rules.json left_short 家族名單裡，改用金字旁 YFV
-- 底下同樣因五碼上限撞碼的 銅／鍋；金 現在也整支關掉了，見 LEFTSHORT_ON。）
if not LEFTSHORT_ON then
  print("  (skip - 左簡碼 enabled:false)")
else
do
  -- 銅 YFVUO、鍋 YFVUUO（6 碼，超五碼上限）主碼都被壓成 YFVUO。左簡碼另外用自己的
  -- 「偏旁頭兩碼＋剩餘最多三碼」規則（沒有五碼那個上限），銅 YVUO、鍋 YVUUO 各自獨立成碼。
  h.check("M.leftshort yvuo → 只有 銅",
    data.leftshort["yvuo"] and data.leftshort["yvuo"][1] == "銅"
      and #data.leftshort["yvuo"] == 1,
    "got " .. tostring(data.leftshort["yvuo"] and table.concat(data.leftshort["yvuo"], "／")))
  h.check("M.leftshort yvuuo → 只有 鍋",
    data.leftshort["yvuuo"] and data.leftshort["yvuuo"][1] == "鍋",
    "got " .. tostring(data.leftshort["yvuuo"] and data.leftshort["yvuuo"][1]))
  local out = h.run{
    schema = "aiphabi", code = "yvuo", options = ALL_ON,
    cands = { { text = "的" } },   -- 高頻雜訊，不該壓過打滿的左簡碼
  }
  h.checkAt("打滿 YVUO → 銅 排第一", out, 1, "銅")
  -- yfvuo（主碼）比左簡碼 yvuo 長一碼 → 該提左簡
  local out2 = h.run{
    schema = "aiphabi", code = "yfvuo", options = ALL_ON,
    cands = { { text = "銅" } },
  }
  h.checkComment("打 銅 主碼 yfvuo → 提醒 左簡 YVUO", out2, "銅", "左簡 YVUO")
end
end

print()
print("== 開關關掉就完全不作用 ==")
do
  local out = h.run{
    schema = "aiphabi", code = "agjk",
    options = { aiphabi_left_short = false, aiphabi_short100 = true },
    cands = { { text = "尔日" } },
  }
  h.checkPresent("左簡碼關 → 打 AGJK 不會冒出 飫", out, "飫", false)
end

print()
print("== 效能：三層上限（I／J 這種常見字根，一次補全上萬個不能卡頓）==")
-- 量過：光是三個 filter（hint／fuzzy／order）各自把上萬個候選整包掃過一輪，比池子排序
-- 本身更貴——這才是「加了排序上限還是卡」的真正原因。所以有三層，越前面越省：
--   1. RAW_CAP（aiphabi_hint.lua，filter 鏈最前面）：根本不跟上游多要——超過這個
--      數量的候選直接不存在，後面幾個 filter 收到的候選量也一起變小，不用各自設上限。
--   2. MAX_SORT（aiphabi_order[_plus].lua）：RAW_CAP 之內的，也只有前面這些做真的
--      table.sort；超過的維持原始順序（碼表已經照 weight 排過）接在後面。
--   3. 選過的字（USERFREQ／aiphabi_plus 的 top bucket）不受 MAX_SORT 影響——只要還在
--      RAW_CAP 之內，一定排到前面。
-- 這裡不直接斷言耗時（機器快慢會飄，門檻抓太鬆就測不出回歸、抓太緊會在慢機器上誤報），
-- 改斷言「行為」——拿掉任一層上限（mutation test 驗過），對應的斷言就會變紅。
-- 兩個數字直接從真正的模組讀，不在這裡另外硬編一份——2026-08-27 把 RAW_CAP 從 1500
-- 砍到 120（見 aiphabi_hint.lua 開頭），這裡不跟著改就會測錯（實際發生過一次）。
local hint_mod_for_caps = require("aiphabi_hint")
local order_mod_for_caps = require("aiphabi_order")
local RAW_CAP, MAX_SORT = hint_mod_for_caps._RAW_CAP, order_mod_for_caps._MAX_SORT
-- 「是」要落在「超過 MAX_SORT、但還在 RAW_CAP 之內」這個區間——用相對位置算，
-- 不用寫死的絕對數字，RAW_CAP 再怎麼調整這個測試都還站得住。
local midPos = MAX_SORT + math.max(1, math.floor((RAW_CAP - MAX_SORT) / 2))
for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
  -- 兩萬個雜訊候選，混進三個真實字：「的」在第 10（兩層之內，該排到最前）；「是」在
  -- midPos（在 RAW_CAP 之內、但超過 MAX_SORT，該維持原位、不被拉到最前，但要還在）；
  -- 「占16000」代表「超過 RAW_CAP」的候選，該整個消失，連補全都補不出來——這是刻意的
  -- 取捨（見 aiphabi_hint.lua 開頭註解），不是漏洞。（沒用「一」是因為它主碼剛好是 i，
  -- 會被歸進 exact 一級，不受這兩層上限影響，測不出東西；標 ap_pool 是因為這裡要測的
  -- 是池子的容量／排序上限，不是「打滿整段的字典詞一律 exact」那條規則——未標類型的
  -- 候選現在也會被歸進 exact 一級，見 aiphabi_order.lua 該處註解，不再落進這個池子。）
  local cands = {}
  for i = 1, 20000 do cands[i] = { text = "占" .. i, type = "ap_pool" } end
  cands[10] = { text = "的", type = "ap_pool" }
  cands[midPos] = { text = "是", type = "ap_pool" }

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
  h.check(schema .. " · RAW_CAP 之內、MAX_SORT 之外（第 " .. midPos .. "）的高頻字「是」還在、但不會被硬拉到最前",
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
  -- 之內，不然還沒排到這裡，先被 aiphabi_hint.lua 那層擋掉了。
  local order_mod = require("aiphabi_order")
  local key = "占" .. midPos
  order_mod._USERFREQ[key] = 99   -- 直接塞：模擬「這個字選過很多次」

  local cands = {}
  for i = 1, 20000 do cands[i] = { text = "占" .. i, type = "ap_pool" } end
  local out = h.run{ schema = "aiphabi", code = "i", options = {}, cands = cands }
  order_mod._USERFREQ[key] = nil   -- 用完清掉，不要汙染其他測試

  h.checkAt("選過很多次的字（藏在第 " .. midPos .. " 個，RAW_CAP 之內）該排第一，不受排序上限擋住",
    out, 1, key)
end

print()
print("== 偏旁碼／同類等提示不能被埋在補全堆裡（2026-08-29 回報：K 打不到 大）==")
do
  -- extra/extra3/extraL/extra4（偏旁碼／同類／三簡／左簡／四碼前綴）以前排在 cands
  -- 之後才 yield：K／W 這種常見字根一次補全可能上千個候選，這些提示（人工挑過，數量
  -- 本來就少）排在後面，會被擠到第 1000+ 名，等於提示完全失效。修法：extra 系列先
  -- yield，才能真的排進會被排序的那前段。
  -- 上限現在不是單純 MAX_SORT=40：打滿整段、不在 exactSet 的候選（如 不要／碰巧）
  -- 改併進 exact 一級（見上面「打繁出簡」那個 always_score 的說明），這批「占N」假詞
  -- 沒有 type，一樣落進 exact；exact 一級也吃 MAX_SORT 上限（同一套保護），但 大 本身
  -- 是 ap_pool（偏旁碼提示），落在 exact 之後的 pool 一級——真正的上限是 hint.lua 的
  -- RAW_CAP（進 order.lua 之前就砍到這個數字，見那邊定義），exact 一級最多吃滿 RAW_CAP
  -- 個，大 落在 pool 第一個，位置頂多是 RAW_CAP + 1。跟這條回報原本要防的「1000+ 名、
  -- 完全構不到」比，RAW_CAP+1（現在這個量級）還是很淺、滑一兩下就到，不是同一種故障。
  local hint_mod = require("aiphabi_hint")
  local RAW_CAP = hint_mod._RAW_CAP
  local cands = {}
  for i = 1, 3000 do cands[i] = { text = "占" .. i, start = 0, _end = 1 } end
  local out = h.run{ schema = "aiphabi", code = "k", options = { aiphabi_comp = true }, cands = cands }
  local pos = nil
  for i, c in ipairs(out) do
    if c.text == "大" then pos = i; break end
  end
  h.check("K 打「大」的偏旁碼提示：混進 3000 個雜訊候選也該淺（不是第 1000+ 名，最深 RAW_CAP+1）",
    pos ~= nil and pos <= RAW_CAP + 1,
    string.format("大 landed at #%s (RAW_CAP=%s)", tostring(pos), tostring(RAW_CAP)))
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

print()
print("== 兩個字天生同一個主碼（重複碼組）時，選過次數也要管得到，不是只管猜出來的池子 ==")
do
  -- 回報過：母／红 天生都是主碼 gi（見 codes.json），一直選 母，還是排不到第一——
  -- 因為 exact 這一級（主碼 exact match）以前完全不排序，直接照 librime 給的原始順序
  -- 出去，選字次數對它沒有作用。注意：母 常用度本來就比 红 高（149276 vs 104772.5，
  -- 红 是簡體字，常用度打過折），這裡的 bug 不是「母 要追過 红」，是「librime 給的
  -- 原始順序恰好把常用度較低的 红 排第一」，選字次數只需要跨過「防手滑」這個下限
  -- （min_eff()，見 aiphabi_order.lua 校準說明）就能把 母 拉回它本來就該有的第一名——
  -- 不需要额外的加分去追差距，因為它從一開始就沒有落後。母（149276）離 min_eff() 的
  -- 常用度基準（合 389799）不算太遠，門檻只略高於 1.5（~1.98），選兩次就跨得過去；
  -- 志／忑、孑／孒 那種更冷僻的字（十萬上下）門檻更高（~2.2），選兩次還不夠，見下面。
  -- 「差距越大，需要的次數越多」測的是另一種情況：選的字本身常用度真的比對手低，見
  -- 下面 孑／子 那組。
  local order_mod = require("aiphabi_order")

  local function reset(...)
    for _, ch in ipairs({ ... }) do
      order_mod._USERFREQ[ch] = nil
      order_mod._EXACTFREQ[ch] = nil
    end
  end

  -- 選一次不算：eff(1) < min_eff("母")（防手滑），排序完全不動，紅還在第一。
  reset("母")
  order_mod._bump("母")
  local out1 = h.run{
    schema = "aiphabi", code = "gi", options = {},
    cands = { { text = "红" }, { text = "母" } },
  }
  h.checkAt("打 GI：只選 母 一次——手滑不算，紅還是排第一", out1, 1, "红")
  reset("母")

  -- 選兩次：跨過 min_eff("母") 下限，母本來常用度就贏 红，一跨過門檻就排回第一——
  -- 不需要額外加分去追差距，因為它從一開始就沒有落後（見上面說明）。
  order_mod._bump("母"); order_mod._bump("母")
  local out2 = h.run{
    schema = "aiphabi", code = "gi", options = {},
    cands = { { text = "红" }, { text = "母" } },
  }
  h.checkAt("打 GI：選 母 兩次——跨過防手滑門檻，母排回第一（它本來就比較常用）", out2, 1, "母")
  reset("母")

  -- 真正的「差距越大，需要的次數越多」：孑（96322）想贏過常用度懸殊高出很多的
  -- 子（379935，log 差 1.3+，比 母/紅 的 0.58 大超過一倍），選六次遠遠不夠。
  reset("孑")
  for i = 1, 6 do order_mod._bump("孑") end
  local outBig = h.run{
    schema = "aiphabi", code = "pi", options = {},
    cands = { { text = "子" }, { text = "孑" } },
  }
  h.checkAt("打 PI：孑 想贏過懸殊常用的 子，選六次還不夠（差距很大）", outBig, 1, "子")
  reset("孑")

  -- 但選夠多次還是追得過去——不是「贏不了」，是「要選更多次」。孑/子 差距要選到
  -- 15 次才夠（(12.848-11.475)/0.1 ≈ 13.7，取整數往上抓 15 次留點餘裕）。
  reset("孑")
  for i = 1, 15 do order_mod._bump("孑") end
  local outBigEnough = h.run{
    schema = "aiphabi", code = "pi", options = {},
    cands = { { text = "子" }, { text = "孑" } },
  }
  h.checkAt("打 PI：孑 選到 15 次，差距夠大的次數終於追過 子", outBigEnough, 1, "孑")
  reset("孑")

  -- 差距小的話，跨過防手滑門檻就夠：孑（96322）跟 孒（93037）常用度很接近
  -- （log 差只有 0.03）——但孑／孒 本身都不算常用（十萬上下，離 min_eff() 的常用度
  -- 基準「合」389799 有 1.3+ 個 log 單位的距離），門檻本身被拉高到 ~2.2（見
  -- aiphabi_order.lua 的 min_eff() 校準說明），選兩次（eff=2.0）還跨不過，要選到
  -- 第三次（eff=3.0）才算數；門檻一跨過，差距小的話馬上就追過去，不用選到 15 次。
  reset("孑")
  order_mod._bump("孑"); order_mod._bump("孑")
  local outClose2 = h.run{
    schema = "aiphabi", code = "pi", options = {},
    cands = { { text = "孒" }, { text = "孑" } },
  }
  h.checkAt("打 PI：孑 跟 孒 常用度接近，但兩字都冷僻，選兩次還不夠跨過門檻", outClose2, 1, "孒")
  reset("孑")

  order_mod._bump("孑"); order_mod._bump("孑"); order_mod._bump("孑")
  local outClose3 = h.run{
    schema = "aiphabi", code = "pi", options = {},
    cands = { { text = "孒" }, { text = "孑" } },
  }
  h.checkAt("打 PI：孑 跟 孒 常用度接近，選三次跨過門檻後，差距小馬上就追過去", outClose3, 1, "孑")
  reset("孑")

  -- 選過的分數會隨時間衰減：模擬「很久以前選過六次、後來都沒再選」——EXACTFREQ 直接
  -- 塞一個很舊的時間戳，過了好幾個半衰期，就算原始次數是 6，衰減後 eff 也該掉到
  -- min_eff("母") 以下，回到跟沒選過一樣。
  order_mod._EXACTFREQ["母"] = { score = 6, ts = os.time() - 20 * 24 * 3600 }  -- 20 天前，半衰期 2.5 天
  local effOld = order_mod._exact_eff("母")
  h.check("選過 6 次但是 20 天前的事——衰減後 eff 該掉到 min_eff(\"母\") 以下",
    effOld < order_mod._min_eff("母"), string.format("got eff=%.4f", effOld))
  local outDecayed = h.run{
    schema = "aiphabi", code = "gi", options = {},
    cands = { { text = "红" }, { text = "母" } },
  }
  h.checkAt("打 GI：20 天前選過 母 六次、之後沒再選——退回跟沒選過一樣，紅還是第一", outDecayed, 1, "红")
  reset("母")

  -- 不能矯枉過正：約定簡碼撞碼demote（這/記）不靠 USERFREQ，兩邊都沒選過時要維持
  -- aiphabi_hint 已經排好的相對順序，不能被這裡新加的 exact 排序打散——這個案例
  -- 前面「約定簡碼字本身主碼撞碼」那組測試已經覆蓋，這裡只是註明兩者不衝突。

  -- min_eff() 門檻本身也該看常用度：名／合 這種很常用的字（幾十萬等級）維持原本
  -- 1.5（選兩次就算數）；志／忑、孑／孒 這種本來就不算常用的字（十萬上下）門檻該
  -- 拉高到 ~2.2（選兩次還不夠，要選到第三次）——回報案例：志/忑 天生同碼 fw，Wilson
  -- 只選過 忑 一次，就被 Rime 內建 userdb 學習機制搶排到 志 前面，但那次選字很可能
  -- 只是隨手測試，門檻該抓嚴一點。
  h.check("min_eff(名) 維持常用字基準 1.5", order_mod._min_eff("名") == 1.5,
    string.format("got %.4f", order_mod._min_eff("名")))
  h.check("min_eff(合) 維持常用字基準 1.5", order_mod._min_eff("合") == 1.5,
    string.format("got %.4f", order_mod._min_eff("合")))
  h.check("min_eff(志) 冷僻字門檻該拉高（> 2）", order_mod._min_eff("志") > 2,
    string.format("got %.4f", order_mod._min_eff("志")))
  h.check("min_eff(忑) 冷僻字門檻該拉高（> 2）", order_mod._min_eff("忑") > 2,
    string.format("got %.4f", order_mod._min_eff("忑")))

  reset("忑")
  order_mod._bump("忑")
  local outFw1 = h.run{
    schema = "aiphabi", code = "fw", options = {},
    cands = { { text = "志" }, { text = "忑" } },
  }
  h.checkAt("打 FW：忑 只選一次——冷僻字門檻更高，手滑不算，志還是第一", outFw1, 1, "志")
  reset("忑")

  order_mod._bump("忑"); order_mod._bump("忑")
  local outFw2 = h.run{
    schema = "aiphabi", code = "fw", options = {},
    cands = { { text = "志" }, { text = "忑" } },
  }
  h.checkAt("打 FW：忑 選兩次——常用字只要兩次，但冷僻字門檻拉高到要三次，兩次還不夠", outFw2, 1, "志")
  reset("忑")

  order_mod._bump("忑"); order_mod._bump("忑"); order_mod._bump("忑")
  local outFw3 = h.run{
    schema = "aiphabi", code = "fw", options = {},
    cands = { { text = "志" }, { text = "忑" } },
  }
  h.checkAt("打 FW：忑 選三次——冷僻字門檻跨過，差距小（log 差 0.05）馬上追過去", outFw3, 1, "忑")
  reset("忑")
end

print()
print("== 四碼快打補全提前到第 2 碼，附「還差幾碼」提示（回報：QQ 只看得到 中庸，誤以為打錯）==")
do
  -- 容祖兒＝QQFL 是靠四碼快打表才找得到的，跟它自己正常的詞組連打碼（qvoqmeffl）完全
  -- 不沾邊——打 QQ 以前完全不會冒出來，候選欄只有不相干的字，會誤以為打錯。門檻降到
  -- 2 碼（不降到 1 碼——1 碼一次要排的候選以千計，見 build_rime.py 的說明），並且用
  -- si4_full 查出完整簽名、標「還差幾碼」，不只是單標「四碼」。
  local out2 = h.run{
    schema = "aiphabi", code = "qq", options = { aiphabi_phrase = true },
    cands = { { text = "中庸", type = "completion" } },
  }
  local found, cmt
  for _, c in ipairs(out2) do
    if c.text == "容祖兒" then found, cmt = true, c.comment end
  end
  h.check("打 QQ：容祖兒（四碼快打 QQFL 的前兩碼）該冒出來，不是只有 中庸",
    found, "容祖兒 not found in candidates")
  h.check("打 QQ：容祖兒 該標「還差幾碼」＝四碼 - FL（不是只有籠統的「四碼」）",
    cmt == "四碼 - FL", string.format("got comment=%s", tostring(cmt)))

  local out3 = h.run{
    schema = "aiphabi", code = "qqf", options = { aiphabi_phrase = true },
    cands = { { text = "中庸", type = "completion" } },
  }
  local cmt3
  for _, c in ipairs(out3) do
    if c.text == "容祖兒" then cmt3 = c.comment end
  end
  h.check("打 QQF：容祖兒 該標 四碼 - L（只差最後一碼）",
    cmt3 == "四碼 - L", string.format("got comment=%s", tostring(cmt3)))

  -- 打滿的四碼（exact 一級）不受這個影響，還是標單純的「四碼」，不是「還差 0 碼」那種怪話。
  local out4 = h.run{
    schema = "aiphabi", code = "qqfl", options = { aiphabi_phrase = true },
    cands = {},
  }
  local cmt4
  for _, c in ipairs(out4) do
    if c.text == "容祖兒" then cmt4 = c.comment end
  end
  h.check("打滿 QQFL：容祖兒 標單純「四碼」（打滿了，不是還差幾碼）",
    cmt4 == "四碼", string.format("got comment=%s", tostring(cmt4)))

  -- 真的有字的完整碼剛好是這兩三碼時，那個字（exact 一級）要贏過四碼補全（pool 一級）——
  -- 真實案例：汏 的主碼就是 ZY，剛好也是「沒什麼」等一串四碼快打詞的前兩碼。
  local outReal = h.run{
    schema = "aiphabi", code = "zy", options = { aiphabi_phrase = true },
    cands = { { text = "汏" } },
  }
  h.checkAt("打 ZY：汏（真的主碼就是 ZY）該贏過 沒什麼 等四碼補全", outReal, 1, "汏")
end

print()
print("== 打繁出簡／打簡出繁帶出來的字，別無條件墊在所有 exact 撞碼字之後 ==")
do
  -- 回報：ZA 撞碼 导(exact，字本身也是簡體，常用度地板打七折後 258602，還是遠贏
  -- 繁體來源 導 打折前的 369432 乘 0.7——見下面「簡體字常用度地板」）／汐(95951)／
  -- 汎(93158)，汎 打繁出簡帶出 泛(98277，贏過 汐/汎)——以前 泛 標 ap_pool，無條件墊在
  -- 這些 exact 一級之後（A B C D E a b c d e 那種盲目分組）；改標 ap_variant，併進
  -- exact 一級照常用度插進正確位置：贏得過的（汐/汎）就插到前面，贏不過的（导，常用度
  -- 打折後仍真的更高）就留在後面，不是無條件衝第一。
  local outZa = h.run{
    schema = "aiphabi", code = "za", options = { aiphabi_t2s = true },
    cands = { { text = "导" }, { text = "汐" }, { text = "汎" } },
  }
  h.checkAt("打 ZA：导（exact，打折後常用度仍真的更高）還是排第一", outZa, 1, "导")
  h.checkAt("打 ZA：泛（打繁出簡，98277）贏過 汐/汎，插到第二", outZa, 2, "泛")

  -- 不是無條件衝第一——常用度沒贏過的字該插在正確的中間位置，不是前面也不是最後。
  -- 市(1159887) 示(638997) 巿(94627) 都是 im 的 exact 撞碼字、都不是簡體字（避免用簡體字
  -- 常用度地板修過的字當基準組，基準組才不會因為地板校正又要跟著調）；众（簡體，繁體
  -- 來源 眾 235241 打七折後 164668.7，這裡用它模擬一個打繁出簡帶出來的字）該插進
  -- 示 跟 巿 中間。
  local outMid = h.run{
    schema = "aiphabi", code = "im", options = { aiphabi_t2s = true },
    cands = { { text = "市" }, { text = "示" }, { text = "巿" }, { text = "众", type = "ap_variant" } },
  }
  h.checkAt("打 IM：众（模擬變體字，235241）該插在 示(638997) 跟 巿(94627) 中間", outMid, 3, "众")
  h.checkAt("打 IM：示 還是第二（沒被插進來的字擠掉排序）", outMid, 2, "示")
end

print()
print("== 碼表裡打滿整段的詞（多字，不在單字碼表 exactSet 裡）該算 exact，不能跟容錯同池 ==")
do
  -- 回報：JQIJ 打出「腳踏車」（ap_si4，四碼快打）跟「不要」（碼表本身就有 jqij 這條
  -- 縮寫碼，weight 98959）都是「打中」的，前者標 ap_si4 沒問題；後者以前沒有任何 ap_* 標記
  -- （table_translator 的普通候選），又不在只收單字碼的 code2chars["jqij"] 裡，掉進最後的
  -- else 分支被當成池子貨——結果跟「手」「丕」這種 ap_pool 容錯猜測（多打一碼／少打一碼）
  -- 同池比字頻，字頻表尺度不同（字頻 vs 詞頻），容錯猜測反而贏，把真的打中的詞擠到後面。
  -- 改法：這個 else 分支現在併進 exact 一級（跟 ap_variant 一樣一律算分，不用等選字次數
  -- 累積），ap_pool 維持在池子——exact 永遠先贏，池子內才比字頻。
  --
  -- 測試字選用注意：這裡選的兩個詞（不要／腳踏車）essay 計次差距夠大（98959 vs 609），
  -- 且對齊到的單字（嗯／亊）都沒有 charfreq.json 計次，不會踩到 freq_w() 的 charfreq
  -- 門檻陷阱（見下面「跟上 build_rime.py 詞頻校準修正」那組測試的說明）；原本這裡用
  -- 研究方向 當例字，essay 計次 3521 遠低於 不要，但對齊到的字「宏」剛好在 charfreq.json
  -- 有計次 2，靠 ×10000 硬是把分數衝到 118519、蓋過 不要 的 99214——這不是這個測試要
  -- 驗證的東西（這裡要驗證的是「exact 一級內部照常用度排」本身的排序邏輯，不是
  -- freq_w() 的資料品質），換一個沒踩到那個陷阱的例字比較乾淨。
  --
  -- 詞頻（M.wordfreq）是 essay.txt 校準出來的（見 build_rime.py），essay.txt 只在原作者
  -- 機器上有——這個沙盒建置時讀不到，wordfreq 全數退回同一個地板值（PLACE_FLOOR），不要／
  -- 腳踏車 在這裡會打平分數，測不出「詞頻內部排序」這件事本身，就算換了不踩 charfreq
  -- 陷阱的例字也一樣。用回報當下量到的真實詞頻（不要 99214、腳踏車 92750）暫時蓋掉，
  -- 讓這個測試不管在哪台機器建置都測得到真正要測的東西，不受這個環境有沒有 essay.txt 影響。
  local savedWF_yao, savedWF_jtc = data.wordfreq["不要"], data.wordfreq["腳踏車"]
  data.wordfreq["不要"], data.wordfreq["腳踏車"] = 99214, 92750
  for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
    local out = h.run{
      schema = schema, code = "jqij", options = {},
      cands = {
        { text = "腳踏車", type = "ap_si4" },
        { text = "手", type = "ap_pool" },
        { text = "丕", type = "ap_pool" },
        { text = "不要" },   -- 碼表本身打滿 jqij 的詞，沒有任何 ap_* 標記
      },
    }
    local pos = {}
    for i, c in ipairs(out) do if not pos[c.text] then pos[c.text] = i end end
    h.check(schema .. " · 不要（碼表打滿 jqij，非容錯）排在 手/丕（ap_pool 容錯猜測）前面",
      pos["不要"] and pos["手"] and pos["丕"] and pos["不要"] < pos["手"] and pos["不要"] < pos["丕"],
      h.fmt(out))
    h.check(schema .. " · 腳踏車（ap_si4，同為 exact）也排在 手/丕 前面",
      pos["腳踏車"] and pos["腳踏車"] < pos["手"] and pos["腳踏車"] < pos["丕"],
      h.fmt(out))
    h.check(schema .. " · exact 一級內部照常用度排：不要（詞頻 99214）該排在 腳踏車（詞頻 92750）前面",
      pos["不要"] and pos["腳踏車"] and pos["不要"] < pos["腳踏車"],
      h.fmt(out))
  end
  data.wordfreq["不要"], data.wordfreq["腳踏車"] = savedWF_yao, savedWF_jtc
end

print()
print("== 多打一碼容錯：最後一鍵如果也是別的詞正在打到一半的合法前綴，別蓋過那些完成候選 ==")
do
  -- 回報：打 NADNN——愉＝NADN，多打一碼容錯砍掉最後那個 N 就對得上；但 nadnn 剛好也是
  -- 愉快（nadnncy）／愉悅（nadnnvl／nadnnvojl）正在打到一半的合法前綴，librime 自己就會
  -- 給出這兩個 completion 候選。連續打兩次同一鍵（打到一半、還沒來得及換下一碼）比「手滑
  -- 多打一鍵」更常見，「最後這鍵是多打的」不該無條件蓋過詞頻更高、真的還在打的 愉快／愉悅。
  for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
    local out = h.run{
      schema = schema, code = "nadnn", options = { aiphabi_fuzzy = true },
      cands = {
        { text = "愉快", type = "completion", comment = "- CY" },
        { text = "愉悅", type = "completion", comment = "- VL" },
      },
    }
    local pos = {}
    for i, c in ipairs(out) do if not pos[c.text] then pos[c.text] = i end end
    h.check(schema .. " · NADNN：愉（容錯，字頻 97019）排在 愉快（完成，149312）之後",
      pos["愉"] and pos["愉快"] and pos["愉快"] < pos["愉"], h.fmt(out))
    h.check(schema .. " · NADNN：愉（容錯）也排在 愉悅（完成，127957）之後",
      pos["愉"] and pos["愉悅"] and pos["愉悅"] < pos["愉"], h.fmt(out))
  end
end

print()
print("== 即時頂（規則頂屏）：這一鍵會不會把碼打死 ==")
do
  local ac = require("aiphabi_autocommit")
  h.check("PPIN+A 打死（開闞之外沒別的路）→ 該頂",
    ac._is_dead_extension("ppina") == true, "expected dead")
  h.check("PPIN+X 沒打死（闞 PPINX 剛好完整）→ 不該頂",
    ac._is_dead_extension("ppinx") == false, "expected alive")
  h.check("PPIN+E 沒打死（還在通往 PPINEX 的路上）→ 不該頂",
    ac._is_dead_extension("ppine") == false, "expected alive")
  h.check("PPINEX 本身沒打死（完整闞碼自己）→ 不該頂",
    ac._is_dead_extension("ppinex") == false, "expected alive")
  h.check("PPINEZ 打死（闞的路走到 E 之後沒有 Z 這條）→ 該頂",
    ac._is_dead_extension("ppinez") == true, "expected dead")
  -- 左簡碼是即時頂最容易誤傷的地方：AGJ 只活在 leftshort_pre／leftshort 兩張表，
  -- 不在主碼表 code2chars 裡——build_index 漏查任一張，這裡就會誤判「打死了」，
  -- 把還在打 AGJK（飫）的人半路頂掉。（原本用魚字旁 SMB／鯉 SMBF；魚 已不在
  -- rules.json left_short 家族名單裡，且 SMB／SMBF 剛好也是別的字真正的主碼，
  -- 沒改的話這條測試會悄悄變成沒在測 leftshort 這條路，改用食字旁 AEG；金 現在
  -- 也整支關掉了，見 LEFTSHORT_ON——關掉時 AGJK 沒有 leftshort 這條路，本來就該打死。）
  if LEFTSHORT_ON then
    h.check("AGJ+K 沒打死（左簡碼 飫 AGJK）→ 不該頂",
      ac._is_dead_extension("agjk") == false, "expected alive")
    h.check("AG+J 沒打死（還在通往左簡碼家族的路上）→ 不該頂",
      ac._is_dead_extension("agj") == false, "expected alive")
  else
    print("  (skip - AGJ+K／AG+J 即時頂案例：左簡碼 enabled:false)")
  end
  -- 約定簡碼／三簡碼也只活在各自的表（shortcode／short3），不在主碼表 code2chars
  -- 裡——漏查會把「N 几/刂/丌」誤判成打死，把還在打 候 的約定簡碼 NK 的人半路頂掉
  -- （2026-08-26 實測 bug：打 NK 被誤頂成「几K」，候 完全打不出來）。
  h.check("N+K 沒打死（候 約定簡碼 NK）→ 不該頂",
    ac._is_dead_extension("nk") == false, "expected alive")

  -- 實測回報的 bug（2026-08-27）：打 W`T，T 誤把 W` 第一個候選頂上屏、自己另起爐灶——
  -- 查不了 W?T／W??T 這種樣式。根因：CODE_INDEX 純 a-z，含反引號的字串永遠不可能是
  -- 任何一條的前綴，is_dead_extension 對萬用鍵組字狀態一律回真。func() 現在遇到
  -- ctx.input 已經有反引號就整段讓開（return 2），不進即時頂那段判斷。
  h.check("含反引號的字串對 is_dead_extension 一律回真（這就是萬用鍵會被誤頂的根因）",
    ac._is_dead_extension("w`t") == true, "expected true (the trap)")

  local function fake_key(repr)
    return { release = function() return false end, repr = function() return repr end }
  end
  local function fake_env(input, autocommit_on)
    local ctx = {
      input = input,
      get_option = function(_, name) return name == "aiphabi_autocommit" and autocommit_on or false end,
    }
    return { engine = { context = ctx } }
  end
  h.check("W`T 的 T：func() 看到 ctx.input 已經有反引號，整段讓開（return 2），不誤頂",
    ac.func(fake_key("t"), fake_env("w`", true)) == 2, "expected 2 (pass through to speller)")
end

print()
print("== 唯一上屏：碼還能接出更長的字就先別收（夜 IYAR 卡在 大 IY 上面）==")
do
  local ac = require("aiphabi_autocommit")
  -- 回報（2026-08-29）：打 IY 直接頂掉 大，夜（IYAR）永遠打不出來——sole_real_candidate
  -- 只看候選欄剩幾個，enable_completion 的補全沒被算進去時就誤判 大 是唯一解。
  h.check("大 IY 上面還有更長的碼（夜 IYAR…）→ has_longer_code 為真",
    ac._has_longer_code("iy") == true, "expected true")
  h.check("夜 IYAR 自己是葉節點（沒有 IYAR* 的單字碼）→ has_longer_code 為假",
    ac._has_longer_code("iyar") == false, "expected false")
  -- ≥6 碼的完整碼不算數：兗 IVOJL 上面只有 競 的完整碼 IVOJLIVOJL（10 碼），
  -- 沒人打 IVOJL 是要去打那條——五碼字打滿就該即收，不必多按一次空白。
  h.check("兗 IVOJL（滿 5 碼，只被 ≥6 的完整碼 IVOJLIVOJL 蓋著）→ has_longer_code 為假",
    ac._has_longer_code("ivojl") == false, "expected false")
  h.check("任何滿 5 碼的碼一律當葉節點（延伸只可能是 ≥6 的完整碼）",
    ac._has_longer_code("yhjuh") == false, "expected false (備 主碼)")

  -- 整段模擬：候選欄「只剩一個」時，has_longer_code 仍該擋下打 IY 的即收
  local committed = nil
  local function mk_env(input, key, sole_text)
    local menu = { prepare = function() end, candidate_count = function() return 1 end }
    local seg = { menu = menu, get_candidate_at = function() return { text = sole_text } end }
    local ctx = {
      input = input,
      get_option = function(_, n) return n == "aiphabi_autocommit" end,
      push_input = function(self, k) self.input = self.input .. k end,
      composition = { back = function() return seg end },
      clear = function(self) self.input = "" end,
    }
    return { engine = { context = ctx, commit_text = function(_, t) committed = t end } }, ctx
  end

  committed = nil
  local env1 = mk_env("i", "y", "大")
  ac.func({ release = function() return false end, repr = function() return "y" end }, env1)
  h.check("打 IY（候選欄只剩 大）→ 不即收，等使用者打完或按空白", committed == nil,
    "expected no commit, got " .. tostring(committed))
  -- 「葉節點還是照樣即收」由檔案最後那組（打 IYAR → 夜）驗證——那條會動 aiphabi_order
  -- 的模組級 LAST_COMMIT，得排在「重複上字」的 nil 檢查之後。
end

print()
print("== 重複上字（連續 N 個 `，N=1~5 排最前）：不吃掉原本萬用鍵，選過就記得住 ==")
do
  local order = require("aiphabi_order")
  local captured_cb
  local fake_ctx = {
    option_update_notifier = { connect = function() return { disconnect = function() end } end },
    commit_notifier = { connect = function(_, cb) captured_cb = cb; return { disconnect = function() end } end },
  }
  order.init({ engine = { context = fake_ctx } })

  h.check("開機、還沒選過任何字：get_last_commit() 是空的",
    order.get_last_commit() == nil, "expected nil")
  h.check("開機、還沒選過任何字：get_last_n(2) 也是空的（不夠 2 個字，不硬湊）",
    order.get_last_n(2) == nil, "expected nil")

  captured_cb({ get_commit_text = function() return "候" end })
  h.check("選過 候 之後：get_last_commit() 記得住",
    order.get_last_commit() == "候", "expected 候")
  h.check("只選過一個字：get_last_n(2) 還是空的（不夠 2 個）",
    order.get_last_n(2) == nil, "expected nil")

  captured_cb({ get_commit_text = function() return "選" end })
  h.check("再選 選：get_last_n(2) 是「候選」（照時間順序接）",
    order.get_last_n(2) == "候選", "expected 候選, got " .. tostring(order.get_last_n(2)))

  -- 一次上屏一個詞（如詞組連打選出「候選人」）要拆成三個字依序推進歷史，
  -- 不是整詞當一筆——不然「N 個 ` = 最近 N 個字」這件事對詞組使用者就不成立。
  captured_cb({ get_commit_text = function() return "候選人" end })
  h.check("上屏一個詞「候選人」後：get_last_n(3) 是「候選人」（拆成三個字）",
    order.get_last_n(3) == "候選人", "expected 候選人, got " .. tostring(order.get_last_n(3)))
  h.check("上屏一個詞「候選人」後：get_last_n(1) 只是最後一個字「人」",
    order.get_last_n(1) == "人", "expected 人, got " .. tostring(order.get_last_n(1)))

  -- 直接呼叫萬用鍵的 translator 本體（不經過 h.run，那個只測 filter 那一段）。
  -- yield 借用、蓋掉再還回去，才不會污染同一支測試檔後面別的 h.run 呼叫。
  local saved_yield = yield
  local wildcard = require("aiphabi_wildcard")

  local function run_wildcard(input)
    local out = {}
    yield = function(c) out[#out + 1] = c end
    wildcard(input, { start = 0, _end = #input }, {})
    yield = saved_yield
    return out
  end

  -- 到這裡歷史是：候、選、候、選、人（HISTORY_MAX=5，剛好裝滿）。
  local single = run_wildcard("`")
  h.check("單獨 ` ：第一個候選是最近 1 個字「人」，不是原本萬用鍵隨便湊到的字",
    single[1] and single[1].type == "ap_repeat" and single[1].text == "人",
    "expected 人 (ap_repeat) first, got " .. h.fmt(single):sub(1, 60))
  h.check("單獨 ` ：原本的萬用鍵（全表一碼以上）沒被拿掉，還在後面",
    #single > 1, "expected more than just the repeat candidate")

  local double = run_wildcard("``")
  h.check("連續兩個 `` ：第一個候選是最近 2 個字「選人」",
    double[1] and double[1].type == "ap_repeat" and double[1].text == "選人",
    "expected 選人 (ap_repeat) first, got " .. h.fmt(double):sub(1, 60))

  local triple = run_wildcard("```")
  h.check("連續三個 ``` ：第一個候選是最近 3 個字「候選人」",
    triple[1] and triple[1].type == "ap_repeat" and triple[1].text == "候選人",
    "expected 候選人 (ap_repeat) first, got " .. h.fmt(triple):sub(1, 60))

  local five = run_wildcard("`````")
  h.check("連續五個（HISTORY_MAX）：第一個候選是全部 5 個字「候選候選人」",
    five[1] and five[1].type == "ap_repeat" and five[1].text == "候選候選人",
    "expected 候選候選人 (ap_repeat) first, got " .. h.fmt(five):sub(1, 60))

  local six = run_wildcard("``````")
  local has_repeat_in_six = false
  for _, c in ipairs(six) do
    if c.type == "ap_repeat" then has_repeat_in_six = true end
  end
  h.check("連續六個（超過 MAX_REPEAT=5）：完全不受影響，純萬用鍵，不混進重複上字",
    not has_repeat_in_six, "expected no ap_repeat candidate in six-backtick output")

  local prefixed = run_wildcard("w`")
  local has_repeat_in_prefixed = false
  for _, c in ipairs(prefixed) do
    if c.type == "ap_repeat" then has_repeat_in_prefixed = true end
  end
  h.check("有帶字母的萬用鍵（W`）完全不受影響，不會混進重複上字",
    not has_repeat_in_prefixed, "expected no ap_repeat candidate in w` output")

  -- 反引號第四種用法「部件字」：`k 撈出以 K 為主碼、被標 componentOnly 的部件字根。
  h.check("部件字不進碼表：code2chars[k] 沒有 扌（只剩正字 水）",
    (function()
      for _, ch in ipairs(data.code2chars["k"] or {}) do
        if ch == "扌" then return false end
      end
      return true
    end)(), "扌 should not be a normal dict entry under k")
  h.check("部件字：component_only[k] = {扌, 爿, 丬}（依常用度）",
    (data.component_only["k"] or {})[1] == "扌"
      and (data.component_only["k"] or {})[2] == "爿"
      and (data.component_only["k"] or {})[3] == "丬",
    "expected 扌/爿/丬, got " .. table.concat(data.component_only["k"] or {}, "/"))
  h.check("部件字：提示碼帶 ` 前綴（char2code[扌] = `k）",
    data.char2code["扌"] == "`k", "expected `k, got " .. tostring(data.char2code["扌"]))

  local compK = run_wildcard("`k")
  h.check("打 `k：第一個候選是 扌（type=ap_component）",
    compK[1] and compK[1].type == "ap_component" and compK[1].text == "扌",
    "expected 扌 (ap_component) first, got " .. h.fmt(compK):sub(1, 60))
  h.check("打 `k：爿／丬 也撈出來，排在 扌 之後",
    compK[2] and compK[2].text == "爿" and compK[3] and compK[3].text == "丬",
    "expected 爿 then 丬, got " .. h.fmt(compK):sub(1, 60))

  local compMulti = run_wildcard("`qri")  -- 多碼部件（疒 主碼 QRI；原本是 QR，Side A 拆碼後多了 I）
  h.check("打 `qri：多碼部件 疒 也撈得到",
    compMulti[1] and compMulti[1].text == "疒" and compMulti[1].type == "ap_component",
    "expected 疒 (ap_component), got " .. h.fmt(compMulti):sub(1, 40))

  h.check("打 k（純主碼、沒有 ` 前綴）：萬用鍵不動作，撈不到任何部件字",
    (function()
      for _, c in ipairs(run_wildcard("k")) do
        if c.text == "扌" or c.text == "爿" or c.text == "丬" then return false end
      end
      return true
    end)(), "扌/爿/丬 must not appear for bare k")

  -- order.lua：`k 走萬用鍵分支，ap_component 釘在標點之後、掃表雜訊之前
  local compOrder = h.run{
    code = "`k",
    cands = {
      { text = "的" },                                       -- 掃表高頻雜訊
      { text = "扌", type = "ap_component", comment = "部件" },
      { text = "爿", type = "ap_component", comment = "部件" },
    },
  }
  h.checkAt("`k → 部件 扌 排在掃表高頻字（的）之前", compOrder, 1, "扌")
  h.checkAt("`k → 部件 爿 緊跟其後", compOrder, 2, "爿")

  -- 防呆：沒打 ` 前綴（打純 K），部件字若因舊碼表殘留／使用者詞典冒出來，壓到候選最後
  for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
    local leaked = h.run{
      schema = schema, code = "k",
      cands = {
        { text = "扌" },                                   -- 殘留的部件字
        { text = "水" },                                   -- 正字
        { text = "大", type = "ap_pool", comment = "偏旁" },
      },
    }
    h.check(schema .. " · 打 K：部件字 扌 被壓到 水／偏旁 之後",
      (function()
        local pShou, pShui, pDa
        for i, c in ipairs(leaked) do
          if c.text == "扌" then pShou = i end
          if c.text == "水" then pShui = i end
          if c.text == "大" then pDa = i end
        end
        return pShou and pShui and pDa and pShou > pShui and pShou > pDa
      end)(), "扌 should sink below 水 and 大   |  " .. h.fmt(leaked))
  end

  -- 實測回報的 bug（2026-08-27）：punct_translator 也認反引號，搶先生出「`」符號本身
  -- 這個候選，排在 translators: 清單裡萬用鍵前面——重複上字排到第二個去了。這裡模擬
  -- 那個排序（punct_translator 的候選先到），過完 order.lua 後：
  --   1. ap_repeat（重複上字）撈到最前面
  --   2. 標點候選（· ` ~，type=punct）緊跟其後、維持 punctuator 的順序——不被萬用鍵
  --      掃出來的整表壓到幾頁之後（打 ` 想打符號的人要找得到）
  local afterOrder = h.run{
    code = "`",
    cands = {
      { text = "·", type = "punct" },                        -- punctuator: ` → [ ·, `, ~ ]
      { text = "`", type = "punct" },
      { text = "~", type = "punct" },
      { text = "候", type = "ap_repeat", comment = "重複" },  -- 萬用鍵：重複上字
      { text = "的" },                                          -- 萬用鍵掃全表的高頻雜訊
      { text = "几" },
    },
  }
  h.checkAt("打 ` → 重複上字排第一", afterOrder, 1, "候")
  h.checkAt("打 ` → · 緊跟在重複上字之後（iOS 注音的預設）", afterOrder, 2, "·")
  h.checkAt("打 ` → 接著是 ` 本身", afterOrder, 3, "`")
  h.checkAt("打 ` → 接著是 ~（同一顆鍵）", afterOrder, 4, "~")
  h.check("打 ` → 符號排在萬用鍵掃出來的高頻字（的）之前",
    (function()
      local pDot, pDe
      for i, c in ipairs(afterOrder) do
        if c.text == "·" then pDot = i end
        if c.text == "的" then pDe = i end
      end
      return pDot and pDe and pDot < pDe
    end)(), "expected · before 的, got " .. h.fmt(afterOrder):sub(1, 80))
end

print()
print("== 互斥開關重入防護：開另一個不能連帶把剛按下去的這個也關掉 ==")
do
  -- 實測回報的 bug（2026-08-27）：自動上屏開著時要開詞組，得按兩次才開得起來。
  -- 根因：ctx:set_option() 本身會再觸發一次 option_update_notifier——「關掉自動
  -- 上屏」這個修正動作，沒有防護的話會被自己的回呼當成「又一次切換」，反過來把
  -- 剛剛才被使用者打開的詞組關掉。這裡真的模擬 Rime 的重入行為（set_option 同步
  -- 呼叫回呼），不是只呼叫 enforce_mutex 一次那種測不出重入問題的假測試。
  local ac = require("aiphabi_autocommit")
  -- 這組測試會真的觸發 enforce_mutex → persist_option 那條路，把路徑指到暫存檔，
  -- 不要動到使用者真正的 user.yaml。
  ac._set_user_yaml_path_for_tests("/tmp/aiphabi_test_user_" .. os.time() .. ".yaml")

  local state = { aiphabi_autocommit = true, aiphabi_phrase = false }
  local notifier_cb
  local fake_ctx
  fake_ctx = {
    get_option = function(_, name) return state[name] or false end,
    set_option = function(_, name, value)
      state[name] = value
      if notifier_cb then notifier_cb(fake_ctx, name) end   -- 模擬 Rime 同步重入
    end,
    option_update_notifier = { connect = function(_, cb) notifier_cb = cb; return { disconnect = function() end } end },
    commit_notifier = { connect = function() return { disconnect = function() end } end },
  }
  ac.init({ engine = { context = fake_ctx } })

  -- 模擬使用者從選單點一次「開詞組」（自動上屏當下是開著的）。
  fake_ctx:set_option("aiphabi_phrase", true)
  h.check("按一次「開詞組」：詞組真的是開的，沒有被自己的修正動作連帶關掉",
    state.aiphabi_phrase == true, "expected true, got " .. tostring(state.aiphabi_phrase))
  h.check("按一次「開詞組」：自動上屏正確被連帶關掉（互斥本來要做的事還是有做到）",
    state.aiphabi_autocommit == false, "expected false, got " .. tostring(state.aiphabi_autocommit))

  -- 反過來：詞組開著時開自動上屏，也要一次到位。
  fake_ctx:set_option("aiphabi_autocommit", true)
  h.check("反過來，按一次「開自動上屏」：自動上屏是開的",
    state.aiphabi_autocommit == true, "expected true, got " .. tostring(state.aiphabi_autocommit))
  h.check("反過來，按一次「開自動上屏」：詞組正確被連帶關掉",
    state.aiphabi_phrase == false, "expected false, got " .. tostring(state.aiphabi_phrase))
end

print()
print("== 互斥開關要把修正寫回 user.yaml，不能只改記憶體 ==")
do
  -- 實測回報的 bug（2026-08-27）：user.yaml 同時存了 aiphabi_autocommit: true
  -- 跟 aiphabi_phrase: true——開機修正只改得動記憶體，檔案沒跟著改，使用者感覺
  -- 「選的開關沒被記住」。這裡只測純字串那段（patch_option_line），不碰真的
  -- user.yaml。
  local ac = require("aiphabi_autocommit")
  local sample = [[var:
  last_build_time: 1787859631
  option:
    aiphabi_autocommit: true
    aiphabi_comp: true
    aiphabi_family: true
    aiphabi_phrase: true
    aiphabi_short100: true
  previously_selected_schema: aiphabi
]]
  local patched = ac._patch_option_line(sample, "aiphabi_phrase", false)
  h.check("aiphabi_phrase 那一行改成 false，其餘原封不動",
    patched and patched:find("aiphabi_phrase: false", 1, true) ~= nil,
    "expected aiphabi_phrase: false present")
  h.check("aiphabi_autocommit 那一行沒被動到，還是 true",
    patched and patched:find("aiphabi_autocommit: true", 1, true) ~= nil,
    "expected aiphabi_autocommit: true untouched")
  h.check("aiphabi_family 這種同一個字首的其他 key 沒被誤中",
    patched and patched:find("aiphabi_family: true", 1, true) ~= nil,
    "expected aiphabi_family untouched (regex must not over-match prefix)")

  local noKey = ac._patch_option_line("var:\n  option:\n    aiphabi_family: true\n", "aiphabi_phrase", false)
  h.check("檔案裡根本沒有這個 key（從沒切過）：回傳 nil，不硬插入",
    noKey == nil, "expected nil, got " .. tostring(noKey))
end

print()
print("== 這個字的第一碼不檢查唯一上屏／即時頂，讓開給 speller（效能）==")
do
  -- 實測回報＋量過的 bug（2026-08-27）：打 I／J 這種根大的字根感覺卡頓——
  -- aiphabi_autocommit_timing.log 量到第一碼（ctx.input 還是空的那一鍵）90～410ms，
  -- 第二碼起都在 20ms 內。根因：sole_real_candidate 呼叫 seg.menu:prepare()，逼
  -- Rime 在這一鍵就把整組候選算出來——單一字母的碼幾乎不可能是唯一解（26 個裡
  -- 只有 5 個真的一碼打完，見下面），檢查根本白做。func() 現在看到 ctx.input=""
  -- 就直接 return 2，不呼叫 seg.menu:prepare()，也不會不小心觸發 seg.composition:back()。
  local ac = require("aiphabi_autocommit")
  local prepared = false
  local function fake_key(repr)
    return { release = function() return false end, repr = function() return repr end }
  end
  local menu = {
    prepare = function() prepared = true end,
    candidate_count = function() return 1 end,
  }
  local seg = { menu = menu, get_candidate_at = function() return { text = "當" } end }
  local ctx = {
    input = "",   -- 這個字的第一碼
    get_option = function(_, name) return name == "aiphabi_autocommit" end,
    push_input = function(self, k) self.input = self.input .. k end,
    composition = { back = function() prepared = "composition_accessed"; return seg end },
    clear = function(self) self.input = "" end,
  }
  local env = { engine = { context = ctx, commit_text = function() end } }
  local r = ac.func(fake_key("i"), env)
  h.check("第一碼：func() 直接 return 2，讓開給 speller",
    r == 2, "expected 2, got " .. tostring(r))
  h.check("第一碼：完全沒碰 seg.menu:prepare()／ctx.composition:back()（真正省下的成本）",
    prepared == false, "expected untouched, got " .. tostring(prepared))
end

print()
print("== 自動上屏也要記選字次數／重複上字，不能只靠 commit_notifier ==")
do
  -- 實測回報的 bug（2026-08-27）：打 當 自動上屏後按 `，重複上字不是 當。根因：
  -- engine:commit_text() 不像正常選字經過 Context:Commit()，commit_notifier 收不到——
  -- aiphabi_autocommit 現在要在 commit_text 之後自己呼叫 order.note_commit()。
  -- 放在這支檔案最後：LAST_COMMIT 是 aiphabi_order 的模組級狀態，跟前面「重複上字」
  -- 那組「開機還沒選過任何字」的 nil 檢查共用同一份記憶體，順序不能顛倒。
  --
  -- 注意：故意不用 ctx.input=""（這個字的第一碼）——那條路現在直接 return 2 讓開
  -- （見 aiphabi_autocommit.lua 的效能修正，2026-08-27），唯一上屏只在第二碼起才會
  -- 檢查。用 "iya"+"r"＝"iyar"（夜）：夜 是葉節點（沒有 IYAR* 的更長單字碼），
  -- 過得了 has_longer_code 那道新關卡，會落到 push_input+sole_real_candidate 那段。
  -- （不用 PPIN 了——闞 PPINX 讓 ppin 不是葉節點，新關卡會擋下，測不到 note_commit。）
  local order = require("aiphabi_order")
  local ac = require("aiphabi_autocommit")

  local committed = nil
  local function fake_key(repr)
    return { release = function() return false end, repr = function() return repr end }
  end
  local cand = { text = "夜", type = nil, comment = nil }
  local menu = { prepare = function() end, candidate_count = function() return 1 end }
  local seg = { menu = menu, get_candidate_at = function(_, i) return i == 0 and cand or nil end }
  local ctx = {
    input = "iya",
    get_option = function(_, name) return name == "aiphabi_autocommit" end,
    push_input = function(self, k) self.input = self.input .. k end,
    composition = { back = function() return seg end },
    clear = function(self) self.input = "" end,
  }
  local env = {
    engine = { context = ctx, commit_text = function(_, text) committed = text end },
  }
  ac.func(fake_key("r"), env)
  h.check("唯一上屏路徑：葉節點（IYAR＝夜）→ engine:commit_text() 真的被呼叫、收到「夜」",
    committed == "夜", "expected 夜, got " .. tostring(committed))
  h.check("唯一上屏路徑：order.note_commit() 有跟著補記，get_last_commit() 是「夜」",
    order.get_last_commit() == "夜", "expected 夜, got " .. tostring(order.get_last_commit()))

  -- 即時頂已停用（見 aiphabi_autocommit.lua 的效能量測說明，2026-08-27）：
  -- seg.menu:prepare() 在「頂之前」那個舊 segment 上時好時壞，同一組碼量到
  -- 10ms 也量到 268ms，找不出規律，犧牲 PPIN/開 這類的零多按換其餘都不卡頓。
  -- 這裡故意用一個「看 ctx.input 當下是什麼再決定回什麼候選」的假 seg，才測得出
  -- 「func() 有沒有在推這一鍵之前，先去查舊那段的候選」——查了就是即時頂還在跑
  -- （不該再發生）；沒查、直接把這一鍵推上去變成 ppina（真正的死路，沒有候選），
  -- 才是現在該有的行為。
  local topcand = { text = "開", type = nil, comment = nil }
  local ctx2
  local menu2 = {
    prepare = function() end,
    candidate_count = function() return ctx2.input == "ppin" and 1 or 0 end,
  }
  local seg2 = {
    menu = menu2,
    get_candidate_at = function(_, i) return (ctx2.input == "ppin" and i == 0) and topcand or nil end,
  }
  ctx2 = {
    input = "ppin",
    get_option = function(_, name) return name == "aiphabi_autocommit" end,
    push_input = function(self, k) self.input = self.input .. k end,
    composition = { back = function() return seg2 end },
    clear = function(self) self.input = "" end,
  }
  local committed2 = nil
  local env2 = { engine = { context = ctx2, commit_text = function(_, text) committed2 = text end } }
  ac.func(fake_key("a"), env2)   -- PPIN+A：以前會被即時頂頂掉，現在該是死路（不該上屏）
  h.check("即時頂已停用：PPIN+A 不再頂上屏，沒有 commit_text 被呼叫",
    committed2 == nil, "expected nil (no commit), got " .. tostring(committed2))
  h.check("即時頂已停用：這一鍵照舊推上去，ctx.input 變成 ppina（死路，留給使用者退格）",
    ctx2.input == "ppina", "expected ppina, got " .. tostring(ctx2.input))
end

print()
print("== 萬用鍵候選也要照常用度排（不能照 pairs() 的雜湊順序）==")
do
  -- 實測回報的 bug（2026-08-27）：打 W`T，第一頁一堆生僻字。根因：
  -- aiphabi_wildcard.lua 用 pairs(data.code2chars) 掃表，Lua 的 pairs() 不保證順序，
  -- 跟常用度完全無關；order.lua 對含反引號的碼原本「不重排，原樣輸出」，等於整段
  -- 排序都是雜湊順序。這裡故意把生僻字放第一個、常用字放最後，確認排序後常用字
  -- 還是會被排到前面。
  local afterOrder = h.run{
    code = "w`t",
    cands = {
      { text = "嶸" },  -- 生僻
      { text = "淅" },  -- 生僻
      { text = "當" },  -- 常用（freq 遠高於前兩個）
    },
  }
  h.check("W`T：常用字（當）該排到生僻字（嶸／淅）前面，不是照原本的雜湊順序",
    afterOrder[1] and afterOrder[1].text == "當",
    "expected 當 first, got " .. h.fmt(afterOrder))

  -- 重複上字（ap_repeat）不吃排序影響，永遠墊最前面，即使字面上比其他候選生僻。
  local afterOrder2 = h.run{
    code = "`",
    cands = {
      { text = "當" },
      { text = "嶸", type = "ap_repeat", comment = "重複" },
    },
  }
  h.check("重複上字不參與常用度排序，永遠排最前面",
    afterOrder2[1] and afterOrder2[1].type == "ap_repeat" and afterOrder2[1].text == "嶸",
    "expected 嶸 (ap_repeat) first, got " .. h.fmt(afterOrder2))
end

print()
print("== aiphabi_plus 的 top bucket 以前整批照常用度重排，把約定簡碼撞碼demote 廢掉了 ==")
do
  -- 回報：aiphabi_order.lua 用插入排序只移動「有算分」的候選，保住 aiphabi_hint 的
  -- 約定簡碼撞碼demote（這/記：開了簡碼、打主碼 IOZ 時故意把 這 擠到 記 後面，逼你改打
  -- 簡碼 IZ）；但 aiphabi_order_plus.lua 以前不管三七二十一，top bucket 整批照 (eu,w)
  -- table.sort，等於無條件把常用度較高的 這 排回第一，demote 形同虛設。Wilson 明講：
  -- 打 IOZ 該看到 記 排第一。修法：跟 aiphabi_order.lua 同一套插入排序，只移動 mover。
  local order_mod = require("aiphabi_order_plus")
  local function reset(ch) order_mod._UF[ch] = nil end
  local function bumpN(ch, n) for _ = 1, n do order_mod._bump(ch) end end

  -- 候選餵入順序模擬真正 librime 的原始 weight 順序（這 489985 比 記 219687 常用，
  -- 這 該先出現）——demote 要能把它「從前面挪到後面」才算真的生效，不是本來就墊底。
  local out1 = h.run{
    schema = "aiphabi_plus", code = "ioz", options = { aiphabi_short100 = true },
    cands = { { text = "這" }, { text = "記" } },
  }
  h.checkAt("打 IOZ（簡碼開）：記 排第一，這 被 demote 擠到後面", out1, 1, "記")

  -- 沒開簡碼開關時，短碼表完全不查（見 aiphabi_hint 開頭），demote 也不該發生——
  -- 常用度較高的 這 照常排第一，這裡是防呆，不是這次修的重點。
  local out2 = h.run{
    schema = "aiphabi_plus", code = "ioz", options = {},
    cands = { { text = "這" }, { text = "記" } },
  }
  h.checkAt("打 IOZ（簡碼關）：demote 不查表，這 常用度較高排第一", out2, 1, "這")

  -- 這/記 都沒被近期選過（effUf<PROMOTE_MIN）時 demote 才有效——這是插入排序「不動
  -- non-mover」的前提，跟 aiphabi_order.lua 那邊「兩個都沒算分」的案例同一個道理。
  reset("這"); reset("記")

  -- 主碼 exact 撞碼字（腳踏車／不要 那組）近期真的被選過、跨過 PROMOTE_MIN(3) 次時，
  -- 照舊能贏過懸殊常用度的對手——跟 aiphabi_order.lua 的 exact_eff／min_eff 是不同一套
  -- （aiphabi_plus 用固定門檻 PROMOTE_MIN=3，不看常用度懸殊，這是既有設計，這次沒改）。
  bumpN("母", 7)   -- 母 149276 vs 紅 104772.5：選 7 次跨過 E_FLOOR(6)，母本來就比較常用
  local out3 = h.run{
    schema = "aiphabi_plus", code = "gi", options = {},
    cands = { { text = "红" }, { text = "母" } },
  }
  h.checkAt("打 GI：母 選 7 次（跨過 E_FLOOR）——本來就比較常用，贏過 红", out3, 1, "母")
  reset("母")

  -- 既有的「選超過 9 次才壓得過簡碼」爬升門檻沒被這次改動動到：池子候選（的）選 7 次
  -- （跨過 exact 的 E_FLOOR=6，但還沒到簡碼的 S_FLOOR=9）還是輸給簡碼（我）。
  local out4 = h.run{
    schema = "aiphabi_plus", code = "jkq", options = { aiphabi_short100 = true },
    cands = { { text = "我", type = "ap_short" }, { text = "的", type = "ap_pool" } },
  }
  h.checkAt("打 JKQ（簡碼開，無選字紀錄）：簡碼 我 排第一", out4, 1, "我")
  bumpN("的", 7)
  local out5 = h.run{
    schema = "aiphabi_plus", code = "jkq", options = { aiphabi_short100 = true },
    cands = { { text = "我", type = "ap_short" }, { text = "的", type = "ap_pool" } },
  }
  h.checkAt("打 JKQ：的 選 7 次——跨過 exact 門檻，但還沒到簡碼的 9 次，我 還是第一", out5, 1, "我")
  bumpN("的", 3)   -- 累計到 10 次，跨過 S_FLOOR(9)
  local out6 = h.run{
    schema = "aiphabi_plus", code = "jkq", options = { aiphabi_short100 = true },
    cands = { { text = "我", type = "ap_short" }, { text = "的", type = "ap_pool" } },
  }
  h.checkAt("打 JKQ：的 選滿 10 次——跨過簡碼的 9 次門檻，贏過簡碼 我", out6, 1, "的")
  reset("的")
end

print()
print("== 只打常用字：白名單只留甲表∪GB一級∪回填（異體／詞庫／姓名／百家姓／粵語／手動）==")
do
  h.check("常用字在白名單裡（的／我／學）",
    data.common["的"] and data.common["我"] and data.common["學"],
    "expected common 的/我/學 = true")
  h.check("常見異體在白名單裡（裏／啓／歎／綫／鷄）",
    data.common["裏"] and data.common["啓"] and data.common["歎"]
      and data.common["綫"] and data.common["鷄"],
    "expected common 裏/啓/歎/綫/鷄 = true")
  h.check("粵語字回填：睇／咁／啲 在白名單裡（canton_common.txt）",
    data.common["睇"] and data.common["咁"] and data.common["啲"],
    "expected common 睇/咁/啲 = true")
  h.check("百家姓罕見姓氏用字在白名單裡（郗／璩／逄）",
    data.common["郗"] and data.common["璩"] and data.common["逄"],
    "expected common 郗/璩/逄 = true")
  h.check("真正的生僻字不在白名單裡（苤／哿／陧，GB 二級也沒被任何回填救到）",
    not data.common["苤"] and not data.common["哿"] and not data.common["陧"],
    "expected common 苤/哿/陧 = nil")
  h.check("兩張表都沒收、也沒被任何回填救到的字一樣濾掉（亶／丏／㐬）",
    not data.common["亶"] and not data.common["丏"] and not data.common["㐬"],
    "expected common 亶/丏/㐬 = nil")

  for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
    -- 模擬：某段碼同時吐出一個常見字（森）跟一個生僻字（苤，GB 二級，沒被回填救到）。
    local cands = { { text = "森" }, { text = "苤" } }
    local off = h.run{ schema = schema, code = "wwwd", options = ALL_ON, cands = cands }
    h.checkPresent(schema .. " · 只打常用字關 → 苤 照常在", off, "苤", true)

    local on = h.run{ schema = schema, code = "wwwd",
      options = { aiphabi_common_only = true }, cands = cands }
    h.checkPresent(schema .. " · 只打常用字開 → 苤 被濾掉", on, "苤", false)
    h.checkPresent(schema .. " · 只打常用字開 → 森 還在", on, "森", true)

    -- 回填的字（睇 粵語、裏 異體）開關開著也留下來
    local kept = h.run{ schema = schema, code = "buhn", options = { aiphabi_common_only = true },
      cands = { { text = "睇" }, { text = "裏" } } }
    h.checkPresent(schema .. " · 只打常用字開 → 粵語字 睇 留著", kept, "睇", true)
    h.checkPresent(schema .. " · 只打常用字開 → 異體 裏 留著", kept, "裏", true)

    -- 多字候選：一個字不在白名單，整條濾掉
    local ph = h.run{ schema = schema, code = "xxxx", options = { aiphabi_common_only = true },
      cands = { { text = "森林" }, { text = "苤苤" } } }
    h.checkPresent(schema .. " · 只打常用字開 → 乾淨的詞（森林）留著", ph, "森林", true)
    h.checkPresent(schema .. " · 只打常用字開 → 含生僻字的詞（苤苤）濾掉", ph, "苤苤", false)

    -- 標點／英數不是漢字，開關開著也不能誤濾
    local pn = h.run{ schema = schema, code = "z", options = { aiphabi_common_only = true },
      cands = { { text = "，" }, { text = "A" } } }
    h.checkPresent(schema .. " · 只打常用字開 → 標點（，）不受影響", pn, "，", true)
    h.checkPresent(schema .. " · 只打常用字開 → 英數（A）不受影響", pn, "A", true)
  end
end

print()
print("== 部件字全體都在只打常用字白名單裡：backtick 前綴本身已是存取門檻，不設雙重擋 ==")
do
  h.check("部件字在白名單裡（扌／氵／艹／忄）",
    data.common["扌"] and data.common["氵"] and data.common["艹"] and data.common["忄"],
    "expected common 扌/氵/艹/忄 = true")
  local all_in = true
  for code, chs in pairs(data.component_only) do
    for _, ch in ipairs(chs) do
      if not data.common[ch] then all_in = false end
    end
  end
  h.check("50 個部件字（M.component_only 收的全部）都在白名單裡，一個都沒漏",
    all_in, "expected every component_only char to be in data.common")

  for _, schema in ipairs({ "aiphabi", "aiphabi_plus" }) do
    -- 模擬打 `k：aiphabi_wildcard 撈出來的部件候選（type=ap_component）
    local cands = { { text = "扌", type = "ap_component" }, { text = "爿", type = "ap_component" } }
    local on = h.run{ schema = schema, code = "`k", options = { aiphabi_common_only = true }, cands = cands }
    h.checkPresent(schema .. " · 只打常用字開 → `k 撈出來的部件 扌 不被雙重擋掉", on, "扌", true)
    h.checkPresent(schema .. " · 只打常用字開 → `k 撈出來的部件 爿 不被雙重擋掉", on, "爿", true)
  end
end

os.exit(h.report() == 0 and 0 or 1)
