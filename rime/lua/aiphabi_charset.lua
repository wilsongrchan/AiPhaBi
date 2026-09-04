-- 愛發筆 · 只打常用字（filter）
--
-- aiphabi_common_only 開關（預設關）：開了之後候選只留「常用字」——
--   甲表 4808 ∪ GB 2312 一級 3755
--   ∪ 常見異體（裏 啓 歎 綫 鷄…：跟某個常用字對到同一個簡體）
--   ∪ 精選詞庫（data/phrases_*.txt）裡出現的字
--   ∪〈試打〉頁的常用姓氏／男名／女名用字
--   ∪《百家姓》姓氏用字、常用粵語字、手動補的白名單
-- 以外的漢字（含兩張表都沒收的生僻字，如 亶 丏 㐬，以及真正的生僻字 苤 陧 哿）
-- 整個濾掉：正選、補全、同類／偏旁提示、容錯猜測、詞組、拼音帶出來的字，全都算。
-- 多字候選只要有一個字不在白名單裡，整條濾掉。標點／英數不是漢字，一律放行。
--
-- 掛在 filter 鏈最後（aiphabi_order 之後）：容錯（aiphabi_fuzzy）會在它後面另外生
-- 候選，擺最後才擋得乾淨。
--
-- 白名單（data.common，字→true）由 build_rime.py 從 data/standards/ 產生；非本機
-- 建置缺 data/standards/ 時名單為空，這時本開關自動失效（不會把候選全部濾光）。
local data = require("aiphabi_data")

local HAVE_LIST = type(data.common) == "table" and next(data.common) ~= nil

-- UTF-8 逐字（不靠 utf8 函式庫，5.1+ 都能跑）
local function each_char(s)
  return s:gmatch("[\1-\127\194-\244][\128-\191]*")
end

local function codepoint(ch)
  local b1 = ch:byte(1)
  if b1 < 0x80 then return b1 end
  if b1 < 0xE0 then
    return (b1 - 0xC0) * 0x40 + (ch:byte(2) - 0x80)
  end
  if b1 < 0xF0 then
    return ((b1 - 0xE0) * 0x40 + (ch:byte(2) - 0x80)) * 0x40 + (ch:byte(3) - 0x80)
  end
  return (((b1 - 0xF0) * 0x40 + (ch:byte(2) - 0x80)) * 0x40
    + (ch:byte(3) - 0x80)) * 0x40 + (ch:byte(4) - 0x80)
end

-- 只管漢字（含相容表意文字、擴充區）。CJK 標點（、。「」…U+3000–303F）、英數、
-- 全形符號都不是漢字 → 一律不擋。
local function is_han(cp)
  return (cp >= 0x3400 and cp <= 0x9FFF)
      or (cp >= 0xF900 and cp <= 0xFAFF)
      or (cp >= 0x20000 and cp <= 0x3FFFF)
end

local function all_common(text)
  for ch in each_char(text) do
    if is_han(codepoint(ch)) and not data.common[ch] then
      return false
    end
  end
  return true
end

return function(input, env)
  local ok, on = pcall(function()
    return env.engine.context:get_option("aiphabi_common_only")
  end)
  if not (ok and on and HAVE_LIST) then
    for cand in input:iter() do yield(cand) end
    return
  end
  for cand in input:iter() do
    if all_common(cand.text) then yield(cand) end
  end
end
