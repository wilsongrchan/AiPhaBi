-- 候選排序的離線測試台（Side B）
--
-- 為什麼要有這個：候選怎麼排，以前只能裝好之後自己打打看。改了 order filter 又沒馬上
-- 打到那個字，回歸就這樣溜過去（PROJECT_NOTES「Not started / open」記的就是這件事）。
-- 這支東西把 Rime 那幾個 API 假造出來，讓真正的 rime/lua/*.lua 可以在命令列跑起來，
-- 吃的是 build_rime.py 真的產生的 aiphabi_data.lua —— 測的是要出貨的那份檔案本身，
-- 不是另外抄一份邏輯（抄一份的話，測過了也只證明抄的那份對）。
--
-- 假造的東西只有 librime-lua 的執行環境：Candidate / yield / env.engine.context /
-- input:iter()。filter 本身一行都沒改。
--
-- 測不到的：Rime 自己的碼表查詢、切分（enable_sentence）、實際畫面。所以「打某碼會
-- 冒出哪些原始候選」要自己在測試裡給（模擬碼表吐出來的東西），這支只管「給定這批
-- 候選，我們的 filter 會怎麼加工跟排序」。
--
--   ~/.local/bin/lua tests/run_tests.lua

local M = {}

local ROOT = (arg and arg[0] or ""):match("^(.*)tests[/\\][^/\\]*$") or "./"
package.path = ROOT .. "rime/lua/?.lua;" .. package.path

-- ---- librime-lua 的執行環境（假的） ----------------------------------------

local sink = nil          -- 目前這一輪 yield 收集到哪裡

-- Rime 的 Candidate(type, start, _end, text, comment)
function Candidate(ctype, start, _end, text, comment)
  return { type = ctype, start = start, _end = _end, text = text, comment = comment }
end

function yield(cand)
  if sink then sink[#sink + 1] = cand end
end

local function makeInput(cands)
  return {
    iter = function()
      local i = 0
      return function()
        i = i + 1
        return cands[i]
      end
    end,
  }
end

-- schema_id 決定跑哪一支 order filter，也決定 aiphabi_hint 裡的 phrase_on 判斷
local function makeEnv(schema_id, input_code, options)
  local ctx = {
    input = input_code,
    get_option = function(_, name) return options[name] or false end,
    -- init() 才會用到；測試不呼叫 init（不去碰使用者的 userfreq 檔），這裡給個殼避免意外
    option_update_notifier = { connect = function() return { disconnect = function() end } end },
    commit_notifier = { connect = function() return { disconnect = function() end } end },
  }
  return { engine = { context = ctx, schema = { schema_id = schema_id } } }
end

-- ---- 跑一輪 -----------------------------------------------------------------

-- cands：模擬「碼表＋切分吐出來的原始候選」。每個 {text=, code=, type=, start=, _end=}
-- 沒給 start/_end 就當作吃滿整串碼。
local function normalize(cands, code)
  local out = {}
  for i, c in ipairs(cands) do
    out[i] = {
      text = c.text,
      type = c.type,                       -- nil＝碼表來的一般候選（Rime 的 type 是 ""/nil）
      start = c.start or 0,
      _end = c._end or #code,
      preedit = c.preedit or code:upper(),
      comment = c.comment,
    }
  end
  return out
end

-- 依序跑 aiphabi_hint → aiphabi_order（或 _plus），回傳最後的候選陣列
function M.run(opts)
  local code = opts.code
  local schema = opts.schema or "aiphabi"
  local options = opts.options or {}
  local cands = normalize(opts.cands or {}, code)

  local hint = require("aiphabi_hint")
  local order = require(schema == "aiphabi_plus" and "aiphabi_order_plus" or "aiphabi_order")
  local charset = require("aiphabi_charset")
  local env = makeEnv(schema, code, options)

  sink = {}
  hint.func(makeInput(cands), env)
  local afterHint = sink

  sink = {}
  order.func(makeInput(afterHint), env)
  local afterOrder = sink

  -- schema 的 filter 鏈：order 之後、uniquifier 之前掛 aiphabi_charset（只打常用字）
  sink = {}
  charset(makeInput(afterOrder), env)
  local afterCharset = sink
  sink = nil

  return M.uniquify(afterCharset), afterHint
end

-- schema 的 filter 鏈最後掛了 Rime 內建的 uniquifier，同一個字只會留排最前面的那個。
-- 這裡照做，不然測到的是「使用者看不到的中間狀態」。
--
-- 這件事是有實際作用的，不是形式：aiphabi_hint 的約定簡碼那段「故意不看 seen」
-- （要的是把字提到第一，不是加一個新候選），所以同一個字可能同時以「簡碼」跟
-- 「三簡／左簡」各生一個候選。真機上 uniquifier 會留排最前的那個（簡碼），
-- 使用者看到的是一個。
function M.uniquify(cands)
  local out, seen = {}, {}
  for _, c in ipairs(cands) do
    if not seen[c.text] then
      seen[c.text] = true
      out[#out + 1] = c
    end
  end
  return out
end

-- ---- 斷言 -------------------------------------------------------------------

local failures, checks = 0, 0

local function fmt(cands)
  local parts = {}
  for i, c in ipairs(cands) do
    parts[i] = string.format("%d.%s%s", i, c.text,
      c.comment and (" [" .. c.comment .. "]") or "")
  end
  return table.concat(parts, "  ")
end

function M.check(name, cond, detail)
  checks = checks + 1
  if cond then
    print(string.format("  ok    %s", name))
  else
    failures = failures + 1
    print(string.format("  FAIL  %s", name))
    if detail then print("          " .. detail) end
  end
end

-- 第 n 個候選必須是某個字
function M.checkAt(name, cands, n, text)
  local got = cands[n] and cands[n].text or "(沒有候選)"
  M.check(name, got == text,
    string.format("expected %s at #%d, got %s   |  %s", text, n, got, fmt(cands)))
end

-- 某個字的 comment 必須長這樣
function M.checkComment(name, cands, text, comment)
  local got
  -- 取第一個：uniquifier 留下的就是排最前的那個，後面的使用者看不到
  for _, c in ipairs(cands) do
    if c.text == text then got = c.comment break end
  end
  M.check(name, got == comment,
    string.format("expected %s -> %q, got %q   |  %s", text, comment, tostring(got), fmt(cands)))
end

-- 某個字必須在候選裡（或必須不在）
function M.checkPresent(name, cands, text, want)
  local found = false
  for _, c in ipairs(cands) do if c.text == text then found = true end end
  M.check(name, found == want,
    string.format("expected present=%s for %s   |  %s", tostring(want), text, fmt(cands)))
end

function M.report()
  print()
  if failures == 0 then
    print(string.format("全部通過（%d 項）", checks))
  else
    print(string.format("%d / %d 項失敗", failures, checks))
  end
  return failures
end

M.fmt = fmt
return M
