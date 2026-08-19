#!/bin/bash
# 拉取最新的字根／取碼資料。可以在 annotate 頁面開著、甚至有還沒存檔的編輯時執行——
# 有未提交的改動會先暫存、拉完再放回去；沒有的話就直接拉。
set -e
cd "$(dirname "$0")"

DIRTY=$(git status --porcelain data/*.json 2>/dev/null)
if [ -n "$DIRTY" ]; then
  echo "偵測到 annotate 頁面有未提交的改動，先暫存："
  echo "$DIRTY"
  git stash push -m "pull.sh 自動暫存 $(date '+%Y-%m-%d %H:%M')" -- data/*.json
  STASHED=1
fi

git pull --rebase origin main

if [ "$STASHED" = "1" ]; then
  echo "放回剛才暫存的改動…"
  git stash pop
fi

echo "✓ 完成。目前狀態："
git status -sb
