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
SQUIRREL="/Library/Input Methods/Squirrel.app/Contents/MacOS/Squirrel"
if [[ -x "$SQUIRREL" ]]; then
  "$SQUIRREL" --reload && echo "   （已重新部署，直接就能打新字）"
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
