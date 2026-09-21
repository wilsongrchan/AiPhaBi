#!/usr/bin/env bash
# 愛發筆一鍵同步：重建碼表 → 裝進 Squirrel → 重新部署 → 推上 GitHub
#
#   ./sync.sh                 # 用預設訊息
#   ./sync.sh "新增取碼字 X Y Z"   # 自訂 commit 訊息
#
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ 1/3 重建碼表＋智慧候選，並裝進 ~/Library/Rime …"
python3 build_rime.py --install

echo "▶ 2/3 叫 Squirrel 重新部署 …"
# --reload 對碼表／資料變動夠用，但 lua/*.lua（filter 邏輯本身）的變動不可靠——
# 舊的 Lua VM／模組有時候不會真的重新載入新檔案，排序邏輯改了卻繼續用舊的跑，
# 而且不會報錯，只會默默照舊排（回報：aiphabi_fuzzy／aiphabi_order 改完、
# sync.sh 跑完也推上去了，Squirrel 裡打起來還是舊行為，重開 Squirrel 才對）。
# 全部重開（kill + 重開 app）比 --reload 保險，且用不到使用者手動確認：
# 選字次數／exact_eff 都寫在 ~/Library/Rime 底下的檔案，不是存在記憶體，重開不會丟。
SQUIRREL_BIN="/Library/Input Methods/Squirrel.app/Contents/MacOS/Squirrel"
if [[ -x "$SQUIRREL_BIN" ]]; then
  pkill -x Squirrel 2>/dev/null || true
  sleep 1
  open -a Squirrel
  sleep 1
  if pgrep -f "Input Methods/Squirrel.app" > /dev/null; then
    echo "   （已整個重開 Squirrel，lua 邏輯改動保證生效）"
  else
    echo "   ⚠️ Squirrel 重開後沒偵測到行程，請自己確認一下。"
  fi
else
  echo "   找不到 Squirrel，請自己在鼠鬚管選單按〈重新部署〉。"
fi

echo "▶ 3/3 推上 GitHub …"
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "${1:-更新取碼字與碼表}"
  git push
  echo "✅ 完成：已推上 GitHub 並重新部署。"
else
  echo "✅ 完成：沒有新變更，已重新部署。"
fi
