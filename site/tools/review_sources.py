#!/usr/bin/env python3
"""產生「代表字簡化候選」的對照預覽頁 —— 只給 Wilson 看，不是網站內容。

    python3 site/tools/review_sources.py
    open site/_review/sources.html      （或用 preview.py 看 /_review/sources.html）

輸入是 Side A 的 `字根簡化候選.md`（根目錄，275 條，已用比對器驗證過形狀）。
每一條左邊畫現在的代表字、右邊畫提議的，兩個都用同樣的方式畫，一眼看得出差別。

為什麼要畫出來：要判斷的是「這個字讀起來是不是就是這個形狀」，那是視覺問題。
表格只給得出筆序，看不出形狀，而形狀正是要判斷的東西。

⚠️ 產出在 site/_review/，**gitignore、也不會發佈**（pages.yml 上傳前會刪掉整個
資料夾）。這是內部審查工具，不該出現在公開網站上。
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "_review"
SVG_TF = "scale(1,-1) translate(0,-900)"


def graphics():
    """字形資料：優先用 Side A 的 data/graphics.txt，否則用網站快取。"""
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


def icon(strokes, sel, size=44):
    """跟字根表同一套畫法：字身框為上限、放大到至少佔 85%、置中。"""
    xs, ys = [], []
    for i in sel:
        d = strokes[i] if i < len(strokes) else None
        if not d:
            continue
        for m in re.finditer(r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)", d):
            xs.append(float(m.group(1)))
            ys.append(900 - float(m.group(2)))
    if not xs:
        return '<span class="miss">畫不出來</span>'
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    box = min(1024, span / 0.85) if span else 1024
    paths = "".join(f'<path d="{strokes[i]}"/>' for i in sel if i < len(strokes) and strokes[i])
    return (f'<svg width="{size}" height="{size}" viewBox="{cx-box/2} {cy-box/2} {box} {box}">'
            f'<g transform="{SVG_TF}">{paths}</g></svg>')


def parse(md):
    rows = []
    for line in md.splitlines():
        if not line.startswith("|") or line.startswith("|---") or "字母" in line:
            continue
        c = [x.strip().strip("*").strip("`") for x in line.strip("|").split("|")]
        if len(c) < 6:
            continue
        L, cur, prop, d, thr, saved = c[:6]
        a = re.search(r"^(.)\s*第\s*([\d–—-]+)\s*筆（共\s*(\d+)\s*筆）", cur)
        b = re.search(r"^(.)\s*第\s*([\d–—-]+)\s*筆（共\s*(\d+)\s*筆）", prop)
        if not (a and b):
            continue

        def idx(rng):
            p = [int(x) for x in re.findall(r"\d+", rng)]
            return list(range(p[0] - 1, p[-1])) if len(p) > 1 else [p[0] - 1]

        rows.append({
            "L": L, "cur_c": a.group(1), "cur_i": idx(a.group(2)), "cur_lab": cur,
            "prop_c": b.group(1), "prop_i": idx(b.group(2)), "prop_lab": prop,
            "d": d, "thr": thr, "saved": int(saved),
            # 提議的字整個就是這個字根 → 幾乎一定對，排前面先看
            "whole": len(idx(b.group(2))) == int(b.group(3)),
        })
    return rows


def main():
    md = ROOT / "字根辨析候選.md"
    src = ROOT / "字根簡化候選.md"
    if not src.exists():
        sys.exit(f"找不到 {src} —— 那是 Side A 產生的，先 git pull")
    G = graphics()
    rows = parse(src.read_text("utf-8"))
    whole = [r for r in rows if r["whole"]]
    part = [r for r in rows if not r["whole"]]

    def block(rs, title, note):
        out = [f'<h2>{title} <span class="n">{len(rs)} 條</span></h2>', f'<p class="note">{note}</p>']
        out.append('<table><thead><tr><th>字母</th><th>現在</th><th></th><th>提議</th>'
                   '<th>省</th><th>距離</th></tr></thead><tbody>')
        for r in rs:
            cur = icon(G.get(r["cur_c"], []), r["cur_i"])
            prop = icon(G.get(r["prop_c"], []), r["prop_i"])
            out.append(
                f'<tr><td class="key">{r["L"]}</td>'
                f'<td class="cell">{cur}<span class="lab">{r["cur_lab"]}</span></td>'
                f'<td class="arrow">→</td>'
                f'<td class="cell now">{prop}<span class="lab">{r["prop_lab"]}</span></td>'
                f'<td class="num">{r["saved"]}</td>'
                f'<td class="num d">{r["d"]}</td></tr>')
        out.append('</tbody></table>')
        return "\n".join(out)

    html = f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>代表字簡化候選 · 對照預覽</title>
<style>
:root {{ --ink:#23201c; --dim:#6b645b; --line:#e6e1d8; --bg:#fdfcfa; --accent:#d1650a; }}
body {{ margin:0; background:var(--bg); color:var(--ink); padding:2rem 1.5rem 5rem;
  font:15px/1.7 "Noto Sans TC","PingFang TC",system-ui,sans-serif; }}
.wrap {{ max-width:52rem; margin:0 auto; }}
h1 {{ font-size:1.5rem; margin:0 0 .4rem; }}
h2 {{ font-size:1.1rem; margin:2.4rem 0 .3rem; padding-top:1rem; border-top:1px solid var(--line); }}
h2 .n {{ font-size:.85rem; color:var(--dim); font-weight:400; }}
.note {{ color:var(--dim); font-size:.88rem; margin:.2rem 0 1rem; max-width:34rem; }}
table {{ border-collapse:collapse; width:100%; }}
th {{ text-align:start; font-size:.78rem; color:var(--dim); padding:.3rem .5rem;
  border-bottom:1px solid var(--line); }}
td {{ padding:.35rem .5rem; border-bottom:1px solid var(--line); vertical-align:middle; }}
.key {{ font:700 .9rem ui-monospace,Menlo,monospace; color:var(--accent); width:2.5rem; }}
.cell {{ display:flex; align-items:center; gap:.6rem; white-space:nowrap; }}
.cell svg path {{ fill:var(--ink); }}
.now svg path {{ fill:var(--accent); }}
.lab {{ font-size:.78rem; color:var(--dim); }}
.arrow {{ color:var(--dim); width:1.5rem; text-align:center; }}
.num {{ font:.8rem ui-monospace,Menlo,monospace; color:var(--dim); text-align:end; width:3rem; }}
.miss {{ font-size:.75rem; color:#b00; }}
</style></head><body><div class="wrap">
<h1>代表字簡化候選 · 對照預覽</h1>
<p class="note">左邊黑色是現在的代表字，右邊橙色是提議的，兩邊用同一套方式畫。
形狀應該幾乎一樣（Side A 已用比對器驗過）—— 要判斷的是<b>哪一個字比較適合當這個
形狀的代表</b>。這一頁只給你看，不會發佈。</p>
{block(whole, "整個字就是這個字根", "提議的字，整個字就是這個形狀（艹、又、中、小…）。這類幾乎一定對，先看這一段。")}
{block(part, "只取那個字的一部分", "提議的字比較短，但也只是取它的一部分。現在的代表字本來就是有效的實例，換不換是取捨，不急。")}
</div></body></html>"""
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sources.html").write_text(html, "utf-8")
    print(f"對照預覽： site/_review/sources.html")
    print(f"  整個字就是字根 {len(whole)} 條（先看這段）／ 只取一部分 {len(part)} 條")


if __name__ == "__main__":
    main()
