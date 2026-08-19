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
                })

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "data.json").write_text(json.dumps(
        {"rows": rows, "segs": segs, "glyphs": glyphs},
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
body { padding: 1.5rem 1.4rem 6rem; }
.wrap { max-width: 62rem; }
.hint { color: var(--ink-dim); font-size: .88rem; max-width: 40rem; }
.ed { min-width: 8rem; outline: none; }
.ed:focus { background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent); border-radius: 4px; }
.ed[data-dirty="1"] { box-shadow: inset 0 0 0 2px var(--accent); border-radius: 4px; }
.bad { color: #b00; font-size: .72rem; margin-inline-start: .3rem; }
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
