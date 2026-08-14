#!/usr/bin/env bash
# 取碼工作一鍵送出：整理 → commit → pull --rebase → push
#
#   ./commit_annotation.sh                 # 自動生訊息（列出改了哪幾個字）
#   ./commit_annotation.sh "自己的訊息"     # 自訂訊息
#   ./commit_annotation.sh -n              # 只看會 commit 什麼，不真的動手
#
# 從哪個資料夾跑都可以（A、B 都行）——它自己找出哪個 worktree 是 Side A，
# 只 commit 那邊的取碼資料。放這裡是因為兩邊都看得到；它一個字都不會改，
# 只下 git 指令。
#
# 它幫你記住三件很容易漏的事：
#   1. 只 stage 取碼資料四個檔，不像 sync.sh 那樣 git add -A 把整個工作區掃進來
#   2. [rebuild] 前綴只有在 codes.json / rules.json 有動時才加（zigen.json 不是建置輸入）
#   3. 先 commit 再 pull --rebase 再 push —— 反過來會失敗：有未 commit 的改動時
#      pull --rebase 會拒絕跑，而落後 origin 時 push 會被打回來
set -euo pipefail

DRY=0
MSG=""
for a in "$@"; do
  case "$a" in
    -n|--dry-run) DRY=1 ;;
    *) MSG="$a" ;;
  esac
done

# ---- 找出 Side A 的 worktree（不寫死路徑：資料夾改名過一次了）----------------
SIDE_A=""
while read -r wt; do
  [ -n "$wt" ] || continue
  if [ "$(tr -d '[:space:]' < "$wt/.aiphabi-side" 2>/dev/null)" = "A" ]; then
    SIDE_A="$wt"; break
  fi
done < <(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')

if [ -z "$SIDE_A" ]; then
  echo "找不到標記為 A 的 worktree（每個資料夾根目錄要有 .aiphabi-side）。" >&2
  echo "現有的 worktree：" >&2
  git worktree list >&2
  exit 1
fi
echo "▶ Side A：$SIDE_A"

FILES=(data/codes.json data/zigen.json data/rules.json data/todo_chars.txt)

# ---- 有東西要送嗎 ------------------------------------------------------------
CHANGED=()
for f in "${FILES[@]}"; do
  if ! git -C "$SIDE_A" diff --quiet -- "$f" 2>/dev/null \
     || ! git -C "$SIDE_A" diff --cached --quiet -- "$f" 2>/dev/null; then
    CHANGED+=("$f")
  fi
done

if [ ${#CHANGED[@]} -eq 0 ]; then
  echo "✅ 取碼資料沒有未送出的改動，不用 commit。"
  # 落後 origin 的話還是講一聲，不然下次 push 又會被打回來
  git -C "$SIDE_A" fetch -q origin || true
  behind=$(git -C "$SIDE_A" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  [ "$behind" -gt 0 ] && echo "（不過 Side A 落後 origin/main $behind 個 commit，記得 git pull）"
  exit 0
fi
echo "▶ 有改動：${CHANGED[*]}"

# ---- 改了哪些字（給人看的摘要，也拿來當預設訊息）-----------------------------
SUMMARY=$(cd "$SIDE_A" && python3 - <<'PY'
import json, subprocess
def load_head(p):
    r = subprocess.run(['git', 'show', 'HEAD:' + p], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else {}
try:
    old, new = load_head('data/codes.json'), json.load(open('data/codes.json'))
except Exception:
    print(''); raise SystemExit
added = [c for c in new if c not in old]
gone = [c for c in old if c not in new]
recoded = [c for c in new if c in old and old[c].get('code') != new[c].get('code')]
bits = []
if added:   bits.append(f"新增 {len(added)} 字（{''.join(added[:12])}{'…' if len(added) > 12 else ''}）")
if recoded: bits.append(f"改碼 {len(recoded)} 字（{''.join(recoded[:12])}{'…' if len(recoded) > 12 else ''}）")
if gone:    bits.append(f"刪除 {len(gone)} 字（{''.join(gone[:12])}）")
print('、'.join(bits))
PY
) || SUMMARY=""

[ -n "$SUMMARY" ] && echo "▶ $SUMMARY"

# ---- 訊息：[rebuild] 只在 codes.json / rules.json 有動時才加 ------------------
NEEDS_REBUILD=0
for f in "${CHANGED[@]}"; do
  case "$f" in data/codes.json|data/rules.json) NEEDS_REBUILD=1 ;; esac
done

if [ -z "$MSG" ]; then
  MSG="${SUMMARY:-更新取碼資料}"
fi
# 已經自己加了前綴就不重複加
if [ "$NEEDS_REBUILD" -eq 1 ] && [[ "$MSG" != \[rebuild\]* ]]; then
  MSG="[rebuild] $MSG"
fi
echo "▶ commit 訊息：$MSG"
[ "$NEEDS_REBUILD" -eq 1 ] \
  && echo "  （codes/rules 有動 → 加了 [rebuild]，Side B 看到就會重建碼表）" \
  || echo "  （只動到 zigen/todo，不是建置輸入 → 不加 [rebuild]）"

if [ "$DRY" -eq 1 ]; then
  echo "— dry run，到此為止，什麼都沒動 —"
  git -C "$SIDE_A" diff --stat -- "${CHANGED[@]}"
  exit 0
fi

# ---- commit → pull --rebase → push ------------------------------------------
echo "▶ 1/3 commit …"
git -C "$SIDE_A" add -- "${CHANGED[@]}"
git -C "$SIDE_A" commit -m "$MSG"

echo "▶ 2/3 pull --rebase（先接上別人推的東西，不然 push 會被打回來）…"
if ! git -C "$SIDE_A" pull --rebase; then
  echo >&2
  echo "⚠ rebase 沒過（大概是撞到了）。你的 commit 已經在了，沒有掉。" >&2
  echo "  處理完衝突後 git rebase --continue，再自己 git push；" >&2
  echo "  想放棄這次 rebase 就 git rebase --abort。" >&2
  echo "  注意 zigen.json 不能用文字合併硬解（count/seen 是算出來的），" >&2
  echo "  要整份取一邊，見 PROJECT_NOTES 的 hazard 6。" >&2
  exit 1
fi

echo "▶ 3/3 push …"
git -C "$SIDE_A" push
echo "✅ 完成。"
[ "$NEEDS_REBUILD" -eq 1 ] && echo "   碼表有變 → 叫 Side B（AiPhaBi-B 那個視窗）pull 之後跑 ./sync.sh 重建。"
exit 0
