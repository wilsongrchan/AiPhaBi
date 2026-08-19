#!/usr/bin/env python3
"""產生「例字編輯頁」—— 長得跟〈字根表〉一樣，但每一列的例字可以直接點進去改。

    python3 site/tools/review_examples.py
    然後開 http://localhost:8099/_review/examples.html

為什麼要這個：手挑例字本來是編 site/content/examples.md（純文字）。但要判斷
「這個字適不適合當例字」是視覺問題 —— 得看到字根在字裡被標出來的樣子。
在表格上直接改、即時看到結果，比在文字檔裡盲寫再重建快得多。

改完之後頁面底下會列出對應的 examples.md 內容，複製回那個檔就生效。
頁面本身不寫檔（瀏覽器不能寫），但會存進 localStorage，關掉再開不會丟。

⚠️ 產出在 site/_review/，gitignore、也不會發佈（pages.yml 上傳前會刪掉）。
這是內部工具，不是網站內容。

字形資料收**全部已取碼的字**（不像網站只收用得到的），因為 Wilson 可能打任何字進去。
檔案較大（約 15MB），但只在本機用，不會上線。
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "_review"


def graphics():
    for p in (ROOT / "data" / "graphics.txt", ROOT / "site" / ".cache" / "graphics.txt"):
        if p.exists():
            out = {}
            with p.open(encoding="utf-8") as fh:
                for line in fh:
                    if not line.strip():
                        continue
                    try:
                        o = json.loads(line)
                    except ValueError:
                        continue
                    if o.get("strokes"):
                        out[o["character"]] = o["strokes"]
            return out
    sys.exit("找不到 graphics.txt —— 先跑 python3 site/tools/build_site_data.py")


def main():
    site_zigen = ROOT / "site" / "assets" / "zigen.json"
    if not site_zigen.exists():
        sys.exit("先跑 python3 site/tools/build_site_data.py")
    zg = json.loads(site_zigen.read_text("utf-8"))
    codes = json.loads((ROOT / "data" / "codes.json").read_text("utf-8"))
    G = graphics()

    # 每個字的分段（字母＋筆序），用來驗證「這個字有沒有用到這個字根」並算高亮
    segs = {ch: [[s["letter"], s["strokes"]] for s in (rec.get("segments") or [])]
            for ch, rec in codes.items() if rec.get("segments")}
    glyphs = {ch: G[ch] for ch in segs if ch in G}

    rows = []
    for L in zg["letters"]:
        for g in L["groups"]:
            for sh in g["shapes"]:
                rows.append({
                    "L": L["letter"], "desc": g["desc"], "src": sh["src"],
                    "st": sh["st"], "span": sh["span"],
                    "ex": [e["c"] for e in sh["ex"]],
                    # ⚠️ key 一定要用 zigen.json 原本的代表字（src0），不能用顯示用的 src。
                    # 顯示用的代表字會隨「改用第一個例字」而變（第 → 笑），一變
                    # localStorage 和 examples.md 的鍵就對不上，先前存的挑選會整批
                    # 變成「沒改過」，再存一次就把它們洗掉。2026-08-19 真的發生過。
                    "key_src": sh.get("src0") or sh["src"],
                    "key_st": sh.get("st0") or sh["st"],
                })

    # 「哪幾筆已經被別的字根認領走」——編輯頁要用它才不會把同一個字裡屬於別的
    # 取形意圖的那一段也塗上。兜＝C(1,2)…C(8,9)，兩段都是 2 筆的 C 但屬於不同意圖；
    # 沒有這份資料的話打 兜 進去會兩段一起亮。跟 build_site_data.py 的規則 2 同源。
    zraw = json.loads((ROOT / "data" / "zigen.json").read_text("utf-8"))
    claims = {}
    for L in zraw.get("letters", []):
        d = claims.setdefault(L.get("letter"), {})
        for it in L.get("intentions", []):
            for sh in it.get("shapes", []):
                for ref in [sh.get("glyph")] + list(sh.get("alts") or []):
                    if ref and ref.get("src") and ref.get("strokes"):
                        d.setdefault(ref["src"], []).append(sorted(ref["strokes"]))

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "data.json").write_text(json.dumps(
        {"rows": rows, "segs": segs, "glyphs": glyphs, "claims": claims},
        ensure_ascii=False, separators=(",", ":")), "utf-8")

    (OUT / "examples.html").write_text(PAGE, "utf-8")
    # JS 放在 site/tools/（進版控），產生時複製過去 —— _review/ 是 gitignore 的，
    # 把程式碼留在那裡會在下一次 clean checkout 消失。
    (OUT / "examples.js").write_text(
        (pathlib.Path(__file__).parent / "review_examples.js").read_text("utf-8"), "utf-8")
    mb = (OUT / "data.json").stat().st_size / 1024 / 1024
    print(f"例字編輯頁： site/_review/examples.html")
    print(f"  {len(rows)} 列 / {len(glyphs)} 個字的字形 / data.json {mb:.1f} MB（只在本機用）")


PAGE = """<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>例字編輯 · 字根表</title>
<link rel="stylesheet" href="../assets/site.css">
<style>
body { padding: 1.5rem 1.4rem 8rem; }
/* 這一頁沒有頁首、也沒有 A–Z 列，但 site.css 的表頭 top 是照那兩層算的（5.9rem），
   照抄會讓表頭黏在畫面往下 5.9rem 的地方。這裡蓋掉成 0。 */
.zg-tbl thead th { top: 0 !important; z-index: 6; }
.wrap { max-width: 62rem; }
.hint { color: var(--ink-dim); font-size: .88rem; max-width: 40rem; }
.ed { min-width: 8rem; outline: none; }
.ed:focus { background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent); border-radius: 4px; }
.ed[data-dirty="1"] { box-shadow: inset 0 0 0 2px var(--accent); border-radius: 4px; }
.bad { color: #b00; font-size: .72rem; margin-inline-start: .3rem; }
/* 這個字裡有不只一段同字母同筆數的形狀，標出來的是推測的 —— 底下畫虛線提醒 */
.guess { border-bottom: 2px dotted var(--accent); }
.out { position: fixed; inset-inline: 0; bottom: 0; background: var(--surface);
       border-top: 2px solid var(--accent); padding: .6rem 1.4rem; z-index: 20; }
.out textarea { width: 100%; height: 5.5rem; font: 12px/1.5 ui-monospace,Menlo,monospace;
       border: 1px solid var(--line); border-radius: 6px; padding: .4rem; background: var(--bg);
       color: var(--ink); }
.out .row { display: flex; align-items: center; gap: .8rem; margin-bottom: .3rem; }
.out button { font: inherit; padding: .2rem .7rem; border-radius: 999px; cursor: pointer;
       border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
</style></head><body><div class="wrap">
<h1>例字編輯</h1>
<p class="hint">點任何一列的「字例」欄就可以直接打字，用空格分隔。每個字會即時畫出來並把
該字根的筆畫標成橙色 —— 沒標到色就代表<b>那個字沒有用到這個字根</b>，旁邊會標紅字。
改過的列會框起來。改完按<b>儲存</b>就會直接寫進 <code>site/content/examples.md</code>（要用 <code>preview.py</code> 開這一頁才有這個功能）。</p>
<div id="t"></div></div>
<div class="out"><div class="row"><b>examples.md</b>
<span id="cnt" class="hint"></span>
<button id="save"><b>儲存到 examples.md</b></button><button id="copy">複製</button><button id="reset">全部還原</button></div>
<textarea id="out" readonly></textarea></div>
<script src="examples.js"></script></body></html>"""


if __name__ == "__main__":
    main()
