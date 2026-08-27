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
  -- 左簡碼是即時頂最容易誤傷的地方：SMB 只活在 leftshort_pre／leftshort 兩張表，
  -- 不在主碼表 code2chars 裡——build_index 漏查任一張，這裡就會誤判「打死了」，
  -- 把還在打 SMBF（鯉）的人半路頂掉。
  h.check("SMB+F 沒打死（左簡碼 鯉 SMBF）→ 不該頂",
    ac._is_dead_extension("smbf") == false, "expected alive")
  h.check("SM+B 沒打死（還在通往左簡碼家族的路上）→ 不該頂",
    ac._is_dead_extension("smb") == false, "expected alive")
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

  -- 實測回報的 bug（2026-08-27）：punct_translator 也認反引號，搶先生出「`」符號本身
  -- 這個候選，排在 translators: 清單裡萬用鍵前面——重複上字排到第二個去了。這裡模擬
  -- 那個排序（punct_translator 的候選先到），過完 order.lua 後 ap_repeat 該被撈到最前面。
  local afterOrder = h.run{
    code = "`",
    cands = {
      { text = "`" },                                       -- punct_translator：符號本身，搶第一
      { text = "候", type = "ap_repeat", comment = "重複上字" },  -- 萬用鍵：重複上字
      { text = "几" },
    },
  }
  h.check("punct_translator 的「`」符號搶先，order.lua 還是要把重複上字撈到最前面",
    afterOrder[1] and afterOrder[1].type == "ap_repeat" and afterOrder[1].text == "候",
    "expected 候 (ap_repeat) first, got " .. h.fmt(afterOrder):sub(1, 60))
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
  -- 檢查。這裡用 "ppi"+"n"＝"ppin"，沿用上面 PPIN 那組已經驗證過「不是死路」的碼，
  -- 確保會落到 push_input+sole_real_candidate 那段，不會半路被即時頂攔走。
  local order = require("aiphabi_order")
  local ac = require("aiphabi_autocommit")

  local committed = nil
  local function fake_key(repr)
    return { release = function() return false end, repr = function() return repr end }
  end
  local cand = { text = "當", type = nil, comment = nil }
  local menu = { prepare = function() end, candidate_count = function() return 1 end }
  local seg = { menu = menu, get_candidate_at = function(_, i) return i == 0 and cand or nil end }
  local ctx = {
    input = "ppi",
    get_option = function(_, name) return name == "aiphabi_autocommit" end,
    push_input = function(self, k) self.input = self.input .. k end,
    composition = { back = function() return seg end },
    clear = function(self) self.input = "" end,
  }
  local env = {
    engine = { context = ctx, commit_text = function(_, text) committed = text end },
  }
  ac.func(fake_key("n"), env)
  h.check("唯一上屏路徑：engine:commit_text() 真的被呼叫、收到「當」",
    committed == "當", "expected 當, got " .. tostring(committed))
  h.check("唯一上屏路徑：order.note_commit() 有跟著補記，get_last_commit() 是「當」",
    order.get_last_commit() == "當", "expected 當, got " .. tostring(order.get_last_commit()))

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
      { text = "嶸", type = "ap_repeat", comment = "重複上字" },
    },
  }
  h.check("重複上字不參與常用度排序，永遠排最前面",
    afterOrder2[1] and afterOrder2[1].type == "ap_repeat" and afterOrder2[1].text == "嶸",
    "expected 嶸 (ap_repeat) first, got " .. h.fmt(afterOrder2))
end

os.exit(h.report() == 0 and 0 or 1)
