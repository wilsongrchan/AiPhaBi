-- 愛發筆：載入智慧候選模組（同類字／偏旁碼／打繁出簡／打簡出繁／輸入容錯／萬用鍵）
-- 這個檔要放在 Rime 使用者目錄的「根」（macOS：~/Library/Rime/rime.lua），
-- 模組本身放在 ~/Library/Rime/lua/。若你原本已有 rime.lua，把下面幾行併進去即可。
-- （智能聯想是另一回事，用官方 librime-predict 外掛，不經過這裡。）
aiphabi_hint       = require("aiphabi_hint")
aiphabi_fuzzy      = require("aiphabi_fuzzy")
aiphabi_wildcard   = require("aiphabi_wildcard")
aiphabi_order      = require("aiphabi_order")   -- 候選重排（簡碼→exact→其餘照常用度）
