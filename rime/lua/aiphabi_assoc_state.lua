-- 愛發筆 · 智能聯想共用狀態
-- segmentor（監聽選字）跟 translator（生候選）是兩個獨立元件、各自的 env 不共通，
-- 只能靠 require 到同一份模組共享狀態——Lua 的 require 在同一個引擎裡只載入一次、
-- 後面都拿同一份快取（跟 aiphabi_data 被好幾個檔案 require 共用是同一個道理）。
return { last = nil }
