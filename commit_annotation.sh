#!/usr/bin/env bash
# 取碼工作一鍵送出：整理 → commit → pull --rebase → push（→ 可選：讓 IME 跟上）
#
#   ./commit_annotation.sh                 # 自動生訊息（列出改了哪幾個字）
#   ./commit_annotation.sh "自己的訊息"     # 自訂訊息
#   ./commit_annotation.sh -n              # 只看會做什麼，不真的動手
#   ./commit_annotation.sh --build         # 送出之後順便重建碼表、裝進 Squirrel（見文末）
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
#
# 關於 --build：碼表一律在 **Side B 自己的資料夾** 重建，不是在 A 這邊跑一份。
# 這正是 PROJECT_NOTES「Side A never runs build_rime.py / sync.sh」要防的事——
# 從錯的 worktree 重建，會讓另一邊的 ~/Library/Rime 跟它沒建過的 rime/ 悄悄對不上。
# 找不到標記為 B 的 worktree 就停手，絕不退而求其次在 A 這邊建。
set -euo pipefail

DRY=0
BUILD=0
MSG=""
for a in "$@"; do
  case "$a" in
    -n|--dry-run) DRY=1 ;;
    -b|--build|--ime) BUILD=1 ;;
    *) MSG="$a" ;;
  esac
done

# ---- 找出某一側的 worktree（不寫死路徑：資料夾改名過一次了）------------------
# 路徑裡有空白（"Wilson Personal"），所以一路都要引號，也不能用 $(...) 去 word split。
find_side() {                     # $1 = A 或 B；印出對應 worktree 的路徑
  local want="$1" wt
  while read -r wt; do
    [ -n "$wt" ] || continue
    if [ "$(tr -d '[:space:]' < "$wt/.aiphabi-side" 2>/dev/null)" = "$want" ]; then
      printf '%s\n' "$wt"; return 0
    fi
  done < <(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')
  return 1
}

SIDE_A="$(find_side A || true)"

if [ -z "$SIDE_A" ]; then
  echo "找不到標記為 A 的 worktree（每個資料夾根目錄要有 .aiphabi-side）。" >&2
  echo "現有的 worktree：" >&2
  git worktree list >&2
  exit 1
fi
echo "▶ Side A：$SIDE_A"

# ---- --build：到 Side B 那邊拉最新資料、重建碼表、裝進 Squirrel ---------------
run_build() {
  local SIDE_B last picked bmsg
  SIDE_B="$(find_side B || true)"
  if [ -z "$SIDE_B" ]; then
    echo >&2
    echo "⚠ 找不到標記為 B 的 worktree，不重建（不會改在 A 這邊建）。" >&2
    echo "  資料已經推上去了。到 Side B 的資料夾 git pull 再 ./sync.sh 就補得回來。" >&2
    return 1
  fi
  echo "▶ Side B：$SIDE_B"

  # sync.sh 是 git add -A：B 的工作區只要有沒 commit 的東西，都會被一起 commit 掉。
  if [ -n "$(git -C "$SIDE_B" status --porcelain)" ]; then
    echo >&2
    echo "⚠ Side B 工作區有未 commit 的改動，停在這裡不重建：" >&2
    git -C "$SIDE_B" status --short >&2
    echo "  sync.sh 會 git add -A，跑下去會把上面這些一起送出。" >&2
    echo "  先去 $SIDE_B 處理掉，再跑一次： ./commit_annotation.sh --build" >&2
    return 1
  fi

  echo "▶ 4/5 Side B 拉最新資料（不然會拿舊的 codes.json 建）…"
  git -C "$SIDE_B" pull --rebase

  # [rebuilt] 訊息：把這次補上的 [rebuild] 逐條列進 body，之後對帳看得出誰被建過。
  # 標題行保持短，細節放 body —— 不然幾個中文 subject 串起來會長到沒法看。
  local n
  last="$(git -C "$SIDE_B" log -1 --format=%H --grep='^\[rebuilt\]' 2>/dev/null || true)"
  if [ -n "$last" ]; then
    picked="$(git -C "$SIDE_B" log --format='  - %s' "$last"..HEAD --grep='^\[rebuild\]' 2>/dev/null || true)"
  else
    picked="$(git -C "$SIDE_B" log --format='  - %s' -5 --grep='^\[rebuild\]' 2>/dev/null || true)"
  fi
  n="$(printf '%s\n' "$picked" | grep -c '^  - ' || true)"
  if [ "${n:-0}" -gt 0 ]; then
    bmsg="$(printf '[rebuilt] 重建碼表：補上 %s 個 [rebuild]\n\n%s\n' "$n" "$picked")"
  else
    bmsg="[rebuilt] 重建碼表"
  fi
  echo "▶ 5/5 Side B 重建＋部署（跑它自己的 sync.sh）…"
  echo "   commit 訊息：$bmsg"
  ( cd "$SIDE_B" && ./sync.sh "$bmsg" )
}

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
  if [ "$behind" -gt 0 ]; then
    echo "（不過 Side A 落後 origin/main $behind 個 commit，記得 git pull）"
  fi
  # 沒有新取碼，不代表 IME 是新的：之前 commit 過但沒建的照樣要補
  if [ "$BUILD" -eq 1 ]; then
    if [ "$DRY" -eq 1 ]; then
      echo "— dry run：接下來會到 Side B 拉最新資料並跑 sync.sh 重建 —"
      exit 0
    fi
    echo "▶ 沒有新取碼要送，但 --build 還是往下走：舊的 [rebuild] 可能還沒建。"
    run_build
  fi
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
  if [ "$BUILD" -eq 1 ]; then
    sb="$(find_side B || true)"
    echo "— 然後會到 Side B（${sb:-找不到，會停手}）拉最新資料並跑 sync.sh 重建 —"
  fi
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
echo "✅ 資料已送出。"

# ---- 要不要順便讓 IME 跟上 ---------------------------------------------------
if [ "$BUILD" -eq 1 ]; then
  if [ "$NEEDS_REBUILD" -eq 0 ]; then
    # zigen/todo 不是建置輸入，但之前可能有還沒建的 [rebuild]，照樣走一趟
    echo "▶ 這次只動到 zigen/todo（不是建置輸入），還是檢查一下有沒有欠建的。"
  fi
  if run_build; then
    echo "✅ 全部完成：資料推上去了，碼表也重建並部署好，直接就能打新字。"
  else
    echo >&2
    echo "⚠ 資料已經推上去（沒有掉），但碼表沒重建，IME 還是舊的。" >&2
    exit 1
  fi
  exit 0
fi

if [ "$NEEDS_REBUILD" -eq 1 ]; then
  echo "   碼表有變 → 叫 Side B（AiPhaBi-B 那個視窗）pull 之後跑 ./sync.sh 重建，"
  echo "   或者下次直接加 --build，這支腳本會幫你走完。"
fi
exit 0
