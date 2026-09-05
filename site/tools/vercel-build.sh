#!/usr/bin/env bash
# Vercel 的建置步驟 —— 跟 .github/workflows/pages.yml 做同一件事。
#
# 為什麼不能直接把 site/ 丟上去就好：**網站要用的資料檔一個都不在 git 裡**
# （dict.json、zigen.json、t2s.json、glyphs.json、pinyin.json、phrase_dict.json…
# 十三條 .gitignore 規則），它們是 build_site_data.py 在部署時現算的。少了它們，
# 每一頁的 fetch 都會失敗：字根表沒有字根、拆碼查詢查不到東西、試打頁打不了字。
#
# ⚠️ 授權義務也在這裡把關，跟 GitHub Actions 那邊同一套：散布 Arphic 字形資料就
# 必須隨附 ARPHICPL.txt，用到教育部標準筆順就必須隨附 TWSTROKE.txt。這兩條是
# **硬性失敗**，不是警告 —— 少了授權全文而把字形發佈出去是違反授權。
#
# ⚠️ 中文訊息裡的變數一律寫成 ${x} 而不是 $x：全形括號緊接在 $x 後面時，bash
# 會把多位元組字元的第一個位元組吃進變數名（實測 "unbound variable: produced?"）。
set -euo pipefail

echo "→ 安裝建置依賴"
# ⚠️ Vercel 的建置環境用 uv 管 Python，pip 會依 PEP 668 拒絕直接裝套件
# （externally-managed-environment）。建置容器用完即丟，覆寫它沒有任何後果，
# 但只在**真的被拒絕時**才覆寫 —— 這樣在自己機器上跑這支腳本仍然走正常路徑，
# 不會莫名其妙改動系統 Python。
if ! python3 -m pip install --quiet -r requirements.txt 2>/dev/null; then
  echo "  系統 Python 受 uv 管控，改用 --break-system-packages（容器用完即丟）"
  python3 -m pip install --quiet --break-system-packages -r requirements.txt
fi

echo "→ 產生網站資料"
python3 site/tools/build_site_data.py
python3 site/tools/build_nav.py

echo "→ 確認必要產出存在"
for f in dict.json t2s.json zigen.json; do
  if [ ! -s "site/assets/${f}" ]; then
    echo "✗ ${f} 沒產出來，網站會是空殼"
    exit 1
  fi
done

# 字形資料是選配的（要下載 29MB 的第三方資料，網路出問題就會沒有）。沒有它
# 字根表會自動退回純文字版，其餘頁面不受影響，所以不擋部署 —— 但**有**的時候，
# 授權全文就必須跟著發佈出去。
echo "→ 檢查授權義務"
for f in glyphs.json practice.json phrases.json; do
  path="site/assets/${f}"
  [ -s "${path}" ] || continue
  if grep -q '"glyphs"' "${path}"; then
    if [ ! -s site/ARPHICPL.txt ]; then
      echo "✗ ${f} 帶著 Arphic 字形資料，卻少了 site/ARPHICPL.txt —— 違反授權"
      exit 1
    fi
  fi
  if grep -q '"tw_glyph_source"' "${path}"; then
    if [ ! -s site/TWSTROKE.txt ]; then
      echo "✗ ${f} 帶著教育部筆順資料，卻少了 site/TWSTROKE.txt —— 違反使用條件"
      exit 1
    fi
  fi
done
echo "  授權檔齊全"

echo "→ 完成，輸出目錄 site/"
