-- 愛發筆 · 不打表外字（filter）
--
-- aiphabi_no_ext 開關（預設關）：開了之後濾掉「表外字」——日常幾乎不會用到的生僻字
-- （苤 陧 哿 這種）。認定方式是黑名單 data.biaowai：GB 2312 二級漢字為主，扣掉一批
-- 回填（常用姓名用字、粵語字、常見異體、精選詞庫裡出現的字）。名單由 build_rime.py
-- 從 data/standards/ 產生。
--
-- 濾的範圍：正選、補全、同類／偏旁提示、容錯猜測、詞組、拼音帶出來的字，全都算。
-- 多字候選只要有一個字在黑名單裡，整條濾掉。標點／英數不會進黑名單，不受影響。
--
-- 掛在 filter 鏈最後（aiphabi_order 之後）：容錯（aiphabi_fuzzy）會在後面另外生候選，
-- 擺最後才擋得乾淨。非本機建置缺 gb2312.txt 時 biaowai 為空，開關自動失效（不亂濾）。
local data = require("aiphabi_data")

local HAVE_LIST = type(data.biaowai) == "table" and next(data.biaowai) ~= nil

-- UTF-8 逐字（不靠 utf8 函式庫，5.1+ 都能跑）
local function each_char(s)
  return s:gmatch("[\1-\127\194-\244][\128-\191]*")
end

local function has_biaowai(text)
  for ch in each_char(text) do
    if data.biaowai[ch] then return true end
  end
  return false
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
    if not has_biaowai(cand.text) then yield(cand) end
  end
end
