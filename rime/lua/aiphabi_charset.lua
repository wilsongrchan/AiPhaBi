-- 愛發筆 · 不打表外字（filter）
--
-- aiphabi_no_ext 開關（預設關）：候選只留「表內字」——
--   中華民國教育部《常用國字標準字體表》甲表 4808 字
--   ∪ GB 2312 一級漢字 3755 字
--   ＋ 傳承變體回填（裏 啓 歎 綫 鷄 陞…：跟某個表內字對到同一個簡體的異體）
-- 以外的漢字（含 GB 2312 二級漢字、粵語俗字、生僻人名字）整個濾掉：正選、補全、
-- 同類／偏旁提示、容錯猜測、詞組、拼音帶出來的字，全都算。多字候選只要有一個字
-- 落在表外，整條濾掉。
--
-- 掛在 filter 鏈最後（order 之後、uniquifier 之前）：容錯（aiphabi_fuzzy）會在 hint
-- 之後另外生候選，濾表外字得放在它後面才擋得乾淨。標點／英數不是漢字，一律放行。
--
-- 名單（data.biaonei，字→true）由 build_rime.py 從 data/standards/ 產生；非本機建置
-- 缺那兩個檔時名單會是空的，這時本開關自動失效（不會把候選全部濾掉）。
local data = require("aiphabi_data")

local HAVE_LIST = type(data.biaonei) == "table" and next(data.biaonei) ~= nil

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

local function all_in_biao(text)
  for ch in each_char(text) do
    if is_han(codepoint(ch)) and not data.biaonei[ch] then
      return false
    end
  end
  return true
end

return function(input, env)
  local ok, on = pcall(function()
    return env.engine.context:get_option("aiphabi_no_ext")
  end)
  if not (ok and on and HAVE_LIST) then
    for cand in input:iter() do yield(cand) end
    return
  end
  for cand in input:iter() do
    if all_in_biao(cand.text) then yield(cand) end
  end
end
