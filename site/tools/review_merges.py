#!/usr/bin/env python3
"""把 Side A 的《字根合併候選》畫出來，兩個形狀並排看。

    python3 site/tools/review_merges.py
    然後開 http://localhost:8099/_review/merges.html

清單本身是 Side A 產生並用比對器驗證過的（根目錄 字根合併候選.md）。
這一頁不做任何判斷，只是把「字根 A」和「字根 B」用同一套畫法畫出來 ——
要判斷「這兩個是不是同一個形狀」是視覺問題，表格上的距離數字看不出形狀。

⚠️ 產出在 site/_review/，gitignore、不發佈。
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "_review"
SVG_TF = "scale(1,-1) translate(0,-900)"


def graphics():
    for p in (ROOT / "data" / "graphics.txt", ROOT / "site" / ".cache" / "graphics.txt"):
        if p.exists():
            out = {}
            with p.open(encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        try:
                            o = json.loads(line)
                        except ValueError:
                            continue
                        if o.get("strokes"):
                            out[o["character"]] = o["strokes"]
            return out
    sys.exit("找不到 graphics.txt —— 先跑 python3 site/tools/build_site_data.py")


def icon(strokes, sel, size=52):
    """跟字根表同一套：字身框為上限、放大到至少佔 85%、置中。"""
    xs, ys = [], []
    for i in sel:
        d = strokes[i] if i < len(strokes) else None
        if not d:
            continue
        for m in re.finditer(r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)", d):
            xs.append(float(m.group(1)))
            ys.append(900 - float(m.group(2)))
    if not xs:
        return '<span class="miss">?</span>'
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    sp = max(max(xs) - min(xs), max(ys) - min(ys))
    box = min(1024, sp / 0.85) if sp else 1024
    paths = "".join(f'<path d="{strokes[i]}"/>' for i in sel if i < len(strokes) and strokes[i])
    return (f'<svg width="{size}" height="{size}" viewBox="{cx-box/2} {cy-box/2} {box} {box}">'
            f'<g transform="{SVG_TF}">{paths}</g></svg>')


def side(cell):
    """「目 第 1–4 筆（count=458, …）」→ (字, 筆序索引, 註記)"""
    m = re.match(r"^(.)\s*第\s*([\d–—\-、,\s]+)\s*筆(（.*）)?", cell)
    if not m:
        return None
    nums = [int(x) for x in re.findall(r"\d+", m.group(2))]
    idx = list(range(nums[0] - 1, nums[-1])) if len(nums) > 1 else [nums[0] - 1]
    return m.group(1), idx, (m.group(3) or "").strip("（）")


def main():
    src = ROOT / "字根合併候選.md"
    if not src.exists():
        sys.exit("找不到 字根合併候選.md —— 先 git pull")
    G = graphics()
    rows = []
    for line in src.read_text("utf-8").splitlines():
        if not line.startswith("|") or line.startswith("|---") or "判定" in line:
            continue
        c = [x.strip().strip("*").strip("`") for x in line.strip("|").split("|")]
        if len(c) < 6:
            continue
        verdict, d, L, desc, a, b = c[:6]
        pa, pb = side(a), side(b)
        if pa and pb:
            rows.append({"v": verdict, "d": d, "L": L, "desc": desc, "a": pa, "b": pb})

    def block(rs, title, note):
        out = [f'<h2>{title} <span class="n">{len(rs)} 組</span></h2>', f'<p class="note">{note}</p>',
               '<table><tbody>']
        for r in rs:
            out.append(
                f'<tr><td class="key">{r["L"]}</td>'
                f'<td class="cell">{icon(G.get(r["a"][0], []), r["a"][1])}'
                f'<span class="lab">{r["a"][0]} 第 {r["a"][1][0]+1}–{r["a"][1][-1]+1} 筆<br>'
                f'<em>{r["a"][2]}</em></span></td>'
                f'<td class="eq">＝?</td>'
                f'<td class="cell">{icon(G.get(r["b"][0], []), r["b"][1])}'
                f'<span class="lab">{r["b"][0]} 第 {r["b"][1][0]+1}–{r["b"][1][-1]+1} 筆<br>'
                f'<em>{r["b"][2]}</em></span></td>'
                f'<td class="d">{r["d"]}</td>'
                f'<td class="desc">{r["desc"]}</td></tr>')
        out.append('</tbody></table>')
        return "\n".join(out)

    clean = [r for r in rows if r["v"].startswith("乾淨")]
    edge = [r for r in rows if not r["v"].startswith("乾淨")]
    html = f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>字根合併候選 · 並排看</title><style>
:root {{ --ink:#23201c; --dim:#6b645b; --line:#e6e1d8; --bg:#fdfcfa; --accent:#d1650a; }}
body {{ margin:0; background:var(--bg); color:var(--ink); padding:2rem 1.5rem 5rem;
  font:15px/1.7 "Noto Sans TC","PingFang TC",system-ui,sans-serif; }}
.wrap {{ max-width:56rem; margin:0 auto; }}
h1 {{ font-size:1.5rem; margin:0 0 .4rem; }}
h2 {{ font-size:1.05rem; margin:2.4rem 0 .2rem; padding-top:1rem; border-top:1px solid var(--line); }}
h2 .n {{ font-size:.85rem; color:var(--dim); font-weight:400; }}
.note {{ color:var(--dim); font-size:.88rem; margin:.2rem 0 1rem; max-width:38rem; }}
table {{ border-collapse:collapse; width:100%; }}
td {{ padding:.4rem .5rem; border-bottom:1px solid var(--line); vertical-align:middle; }}
.key {{ font:700 .9rem ui-monospace,Menlo,monospace; color:var(--accent); width:2rem; }}
.cell {{ display:flex; align-items:center; gap:.55rem; white-space:nowrap; }}
.cell svg path {{ fill:var(--ink); }}
.lab {{ font-size:.74rem; color:var(--dim); line-height:1.35; }}
.lab em {{ font-style:normal; font-size:.68rem; opacity:.75; }}
.eq {{ color:var(--dim); text-align:center; width:2.5rem; }}
.d {{ font:.8rem ui-monospace,Menlo,monospace; color:var(--accent); text-align:end; width:4rem; }}
.desc {{ font-size:.76rem; color:var(--dim); max-width:14rem; }}
.miss {{ color:#b00; }}
</style></head><body><div class="wrap">
<h1>字根合併候選 · 並排看</h1>
<p class="note">清單與距離是 Side A 用比對器算的，這一頁只把兩個形狀用同一套方式畫出來
（字身框為上限、放大到至少 85%、置中），讓你直接看「這兩個是不是同一個形狀」。
挑好之後把要合併的告訴 Side A，由他們用 editor.html 的合併功能處理。</p>
{block(clean, "乾淨", "距離在兩邊門檻都放行的範圍內，兩個字根互相都承認對方同形。")}
{block(edge, "臨界", "距離只在比較鬆的那個門檻內。嚴的那個門檻可能是刻意調緊的（沒有裁決紀錄可查），所以要自己看一眼。")}
</div></body></html>"""
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "merges.html").write_text(html, "utf-8")
    print(f"合併候選並排頁： site/_review/merges.html")
    print(f"  乾淨 {len(clean)} 組 / 臨界 {len(edge)} 組")


if __name__ == "__main__":
    main()
