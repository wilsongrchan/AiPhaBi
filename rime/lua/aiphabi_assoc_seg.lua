-- 愛發筆 · 智能聯想（segmentor）
-- 監聽「剛剛上屏了什麼字」（commit_notifier）；選完字、還沒打任何碼、又有接續建議
-- 可以給時，另外開一段空白區間給 aiphabi_assoc（translator）接手生候選。
-- 由 aiphabi_assoc 開關控制（預設關）。
local data = require("aiphabi_data")
local state = require("aiphabi_assoc_state")

local function init(env)
  local ctx = env.engine.context
  env.aiphabi_assoc_notifier = ctx.commit_notifier:connect(function(context)
    local text = context:get_commit_text()
    if not text or text == "" then return end
    -- 取最後一個 UTF-8 字元（漢字都是多 byte，這樣抓才不會抓到半個字）
    state.last = text:match("([\1-\127\194-\244][\128-\191]*)$")
  end)
end

local function fini(env)
  if env.aiphabi_assoc_notifier then env.aiphabi_assoc_notifier:disconnect() end
end

local function segmentor(segmentation, env)
  local ctx = env.engine.context
  if ctx.input ~= "" then return end             -- 只在完全沒打字時介入
  if not ctx:get_option("aiphabi_assoc") then return end
  if not state.last or not data.assoc[state.last] then return end
  local seg = Segment(0, 0)
  seg.tags = Set({"aiphabi_assoc"})
  segmentation:add_segment(seg)
end

return { init = init, fini = fini, func = segmentor }
