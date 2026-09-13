#!/usr/bin/env python3
"""產生「字根順序核對頁」—— 每個字母、每個取形意圖底下的形狀，照網站實際會顯示
的順序跟代表字列出來，旁邊標上 data/zigen.json 裡的原始序號（跟 intent_notes.md
用的 L1、L2…同一套編號）。

    python3 site/tools/build_site_data.py   # 先確保 site/assets/zigen.json 是新的
    python3 site/tools/review_order.py
    然後開 http://localhost:8099/_review/order.html

為什麼要這個：build_zigen() 會挑代表字（Wilson 2026-08-19 的規則：組內第一個
例字當代表字）、也會照「整個字優先」重新分組——兩件事疊在一起，肉眼很難從
zigen.json 的原始 JSON 看出網站最後排出來的順序對不對。2026-09 抓到一次：
組內按 count 降冪排把 Wilson 排好的順序打散，止／正兩個代表字疊在一起長得
像重複，而「些」看起來像是憑空消失（其實是被換成代表字「止」）。這頁就是
拿掉猜測，把「網站現在真的會顯示什麼順序、什麼代表字」攤開來看。

純文字版，不畫筆畫高亮——只是核對順序跟代表字，不需要。
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "_review"

TIER_ORDER = {"primary": 0, "secondary": 1, "tertiary": 2}
TIER_LABEL = {"primary": "主", "secondary": "次", "tertiary": "三"}
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


def circled(n):
    return CIRCLED[n - 1] if 1 <= n <= len(CIRCLED) else f"({n})"


def raw_positions(zraw):
    """(letter, src, sorted(strokes)) -> (取形意圖序號, 該意圖底下的形狀序號)。

    序號是「同字母底下，取形意圖照等第（主／次／三）由上到下」的順序——
    跟 intent_notes.md 的 L1、L2…同一套算法，Wilson 已經在用那套核對意圖說明了。
    """
    pos = {}
    for L in zraw.get("letters", []):
        letter = L.get("letter")
        ordered = sorted(
            L.get("intentions", []),
            key=lambda it: TIER_ORDER.get(it.get("tier") or "primary", 0))
        for gi, it in enumerate(ordered, 1):
            for si, sh in enumerate(it.get("shapes", []), 1):
                g = sh.get("glyph") or {}
                key = (letter, g.get("src"), tuple(sorted(g.get("strokes") or [])))
                pos[key] = (gi, si)
    return pos


def main():
    site_zigen = ROOT / "site" / "assets" / "zigen.json"
    raw_path = ROOT / "data" / "zigen.json"
    if not site_zigen.exists():
        sys.exit("找不到 site/assets/zigen.json —— 先跑 python3 site/tools/build_site_data.py")

    built = json.loads(site_zigen.read_text("utf-8"))
    zraw = json.loads(raw_path.read_text("utf-8"))
    pos = raw_positions(zraw)

    stale = site_zigen.stat().st_mtime < raw_path.stat().st_mtime
    dup_letters = []

    letters_html = []
    nav = []
    for L in built.get("letters", []):
        letter = L.get("letter", "")
        groups = L.get("groups", [])
        if not groups:
            continue
        nav.append(f'<a href="#L-{letter}">{letter}</a>')

        seen_reps = {}
        rows = []
        for gi, g in enumerate(groups, 1):
            chips = []
            for sh in g["shapes"]:
                key = (letter, sh.get("src0") or sh["src"],
                       tuple(sorted(sh.get("st0") or sh["st"])))
                origin = pos.get(key)
                if origin:
                    tag = f'L{origin[0]}{circled(origin[1])}'
                    mismatch = origin[0] != gi
                else:
                    tag, mismatch = "？找不到", True

                rep = sh["src"]
                seen_reps.setdefault(rep, []).append((gi, tag))

                sub = ""
                if sh.get("src0") and sh["src0"] != sh["src"]:
                    sub = f'<div class="sub">原字 {esc(sh["src0"])}</div>'

                chips.append(
                    f'<div class="chip{" mismatch" if mismatch else ""}">'
                    f'<div class="rep">{esc(rep)}</div>'
                    f'{sub}'
                    f'<div class="meta">{esc(tag)} · {sh["span"]} · {sh["count"]}見</div>'
                    f'<div class="seen">{esc("".join(sh["seen"][:6]))}</div>'
                    f'</div>')
            desc = esc(g.get("desc") or "（無說明）")
            note = g.get("note") or ""
            note_html = f'<div class="note">📝 {esc(note)}</div>' if note else ""
            rows.append(
                f'<div class="group">'
                f'<div class="ghead"><b>L{gi}</b> '
                f'<span class="tier">{TIER_LABEL.get(g.get("tier"), "?")}</span> {desc}</div>'
                f'{note_html}'
                f'<div class="chips">{"".join(chips)}</div>'
                f'</div>')

        for rep, hits in seen_reps.items():
            if len(hits) > 1:
                dup_letters.append((letter, rep, hits))

        letters_html.append(
            f'<section id="L-{letter}"><h2>{letter}</h2>{"".join(rows)}</section>')

    warn = ""
    if stale:
        warn += ('<p class="warn">⚠️ site/assets/zigen.json 比 data/zigen.json 舊——'
                 '先重跑一次 build_site_data.py 再看這頁，不然看到的不是最新排法。</p>')
    if dup_letters:
        items = "".join(
            f'<li><b>{L}</b>：「{rep}」同時是 {", ".join(t for _, t in hits)} 的代表字</li>'
            for L, rep, hits in dup_letters)
        warn += (f'<p class="warn">⚠️ 同一字母底下有代表字重複，畫面上會看起來像同一個'
                  f'形狀出現兩次：</p><ul class="warn">{items}</ul>')

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "order.html").write_text(PAGE.format(
        nav=" ".join(nav), warn=warn, body="".join(letters_html)), "utf-8")
    print("順序核對頁： site/_review/order.html")
    if dup_letters:
        print(f"  ⚠️ {len(dup_letters)} 個代表字重複，見頁面上的警告")
    if stale:
        print("  ⚠️ site/assets/zigen.json 比 data/zigen.json 舊，先重建")


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


PAGE = """<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>字根順序核對 · 內部工具</title>
<style>
:root {{ color-scheme: light dark; }}
body {{ font: 15px/1.5 -apple-system,"PingFang TC","Noto Sans TC",sans-serif;
  margin: 0; padding: 1.4rem 1.4rem 6rem; background: #fafaf8; color: #1a1a1a; }}
@media (prefers-color-scheme: dark) {{ body {{ background: #17181a; color: #e8e6e1; }} }}
h1 {{ font-size: 1.2rem; margin: 0 0 .3rem; }}
.hint {{ color: #777; font-size: .85rem; max-width: 46rem; margin: 0 0 1rem; }}
.warn {{ background: #fff3cd; color: #7a5b00; border-radius: 6px; padding: .5rem .8rem;
  font-size: .85rem; max-width: 46rem; }}
@media (prefers-color-scheme: dark) {{ .warn {{ background: #3a2f00; color: #f0d060; }} }}
.nav {{ position: sticky; top: 0; background: inherit; padding: .5rem 0; z-index: 5;
  display: flex; flex-wrap: wrap; gap: .3rem; border-bottom: 1px solid #ddd; margin-bottom: 1rem; }}
.nav a {{ text-decoration: none; color: #666; font-weight: 600; padding: .1rem .35rem; }}
h2 {{ font-size: 1.6rem; border-bottom: 2px solid #ccc; padding-bottom: .2rem; margin-top: 2rem; }}
.group {{ margin: 1rem 0 1.6rem; }}
.ghead {{ font-size: .95rem; margin-bottom: .4rem; }}
.tier {{ display: inline-block; font-size: .72rem; border-radius: 999px; padding: .05rem .5rem;
  background: #e5e5e5; color: #555; margin-right: .3rem; }}
@media (prefers-color-scheme: dark) {{ .tier {{ background: #333; color: #ccc; }} .ghead {{ color: #ddd; }} }}
.note {{ font-size: .8rem; color: #7a5b00; background: #fff8e1; display: inline-block;
  padding: .1rem .5rem; border-radius: 6px; margin-bottom: .4rem; }}
.chips {{ display: flex; flex-wrap: wrap; gap: .6rem; }}
.chip {{ border: 1px solid #ddd; border-radius: 8px; padding: .4rem .6rem; min-width: 5.5rem;
  text-align: center; background: #fff; }}
@media (prefers-color-scheme: dark) {{ .chip {{ background: #222; border-color: #3a3a3a; }} }}
.chip.mismatch {{ border-color: #d33; box-shadow: 0 0 0 1px #d33; }}
.chip .rep {{ font-size: 1.8rem; line-height: 1.1; }}
.chip .sub {{ font-size: .7rem; color: #b00; }}
.chip .meta {{ font-size: .68rem; color: #888; margin-top: .15rem; }}
.chip .seen {{ font-size: .78rem; color: #555; margin-top: .2rem; letter-spacing: .05em; }}
@media (prefers-color-scheme: dark) {{ .chip .seen {{ color: #aaa; }} }}
</style></head><body>
<h1>字根順序核對頁</h1>
<p class="hint">照網站實際會顯示的順序列出每個字母的取形意圖跟代表字。「L2③」讀作
data/zigen.json 裡 L 字母第 2 個取形意圖（跟 intent_notes.md 的編號同一套）的第 3 個形狀。
紅框代表這個形狀被排到跟原始序號不同的意圖分組底下——正常情況不該出現。「原字」是還沒套用
代表字替換前，zigen.json 裡本來的那個字。這頁不寫檔，純核對用。</p>
{warn}
<div class="nav">{nav}</div>
{body}
</body></html>"""


if __name__ == "__main__":
    main()
