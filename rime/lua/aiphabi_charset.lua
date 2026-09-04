-- 愛發筆 · 不打表外字 ／ 只打常用字（filter）
--
-- 兩個開關，同一份回填（build_rime.py 的 _keep：甲表 ∪ GB 一級 ∪ 常見異體 ∪ 精選詞庫
-- 用字 ∪ 姓名用字 ∪ 百家姓 ∪ 常用粵語字 ∪ 手動白名單），方向相反：
--
--   aiphabi_no_ext（不打表外字，預設關）—— 黑名單 data.biaowai：只擋「正面指認為
--     生僻」的字（GB 2312 二級為主），沒被指名的一律放行。
--   aiphabi_common_only（只打常用字，預設關）—— 白名單 data.biaonei：只放行回填
--     集合本身，其餘一律擋掉——連「兩張表都沒收、沒被任何回填救到」的生僻字
--     （亶 丏 㐬 這種）也擋，比不打表外字更嚴格。
--
-- 兩個開關可以同時開，只打常用字這邊本來就是更緊的那圈，不會互相打架。
--
-- 濾的範圍：正選、補全、同類／偏旁提示、容錯猜測、詞組、拼音帶出來的字，全都算。
-- 多字候選只要有一個字不符合，整條濾掉。標點／英數一律放行（見 is_han）。
--
-- 掛在 filter 鏈最後（aiphabi_order 之後）：容錯（aiphabi_fuzzy）會在後面另外生候選，
-- 擺最後才擋得乾淨。缺 data/standards/ 時對應名單為空，那個開關就自動失效。
local data = require("aiphabi_data")

local HAVE_BIAOWAI = type(data.biaowai) == "table" and next(data.biaowai) ~= nil
local HAVE_BIAONEI = type(data.biaonei) == "table" and next(data.biaonei) ~= nil

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
-- 全形符號都不是漢字 → 只打常用字那條規則不擋它們（黑名單那條不需要這個判斷，
-- data.biaowai 本來就只收漢字）。
local function is_han(cp)
  return (cp >= 0x3400 and cp <= 0x9FFF)
      or (cp >= 0xF900 and cp <= 0xFAFF)
      or (cp >= 0x20000 and cp <= 0x3FFFF)
end

return function(input, env)
  local ctx = env.engine.context
  local ok1, ext_on = pcall(function() return ctx:get_option("aiphabi_no_ext") end)
  local ok2, common_on = pcall(function() return ctx:get_option("aiphabi_common_only") end)
  ext_on = ok1 and ext_on and HAVE_BIAOWAI
  common_on = ok2 and common_on and HAVE_BIAONEI
  if not (ext_on or common_on) then
    for cand in input:iter() do yield(cand) end
    return
  end
  for cand in input:iter() do
    local blocked = false
    for ch in each_char(cand.text) do
      if ext_on and data.biaowai[ch] then
        blocked = true
        break
      end
      if common_on and is_han(codepoint(ch)) and not data.biaonei[ch] then
        blocked = true
        break
      end
    end
    if not blocked then yield(cand) end
  end
end
