#!/usr/bin/env python3
"""同一個取形意圖底下、同字母同筆數的字根配對，找出幾何上可能其實是同一形狀的 →
字根合併候選.md（repo 根目錄）。**不自動合併**——只列候選，並標出乾淨／臨界兩種。

    python3 tools/合併候選.py

「臨界」的意思：`thr` 不只由 `meta.distinct` 的裁決算出來，`editor.html:1013-1021`
也能直接手動改 `thr`，不留紀錄。所以一個字根的門檻異常緊，可能是刻意的、只是
沒寫進 meta.distinct——不能假設「沒有裁決紀錄」＝「門檻是隨便設的」。
兩個字根的距離只要落在**兩邊門檻中間**（比較鬆的門檻放行，比較嚴的門檻不放行），
就算臨界，需要人再看一眼，不能當乾淨候選直接合併。

需要 `data/graphics.txt`（gitignored），只有 Side A 跑得動。
"""
import itertools
import json
import pathlib
import sys
import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from retune import medians, stroke_vec, dist          # noqa: E402

DATA = ROOT / "data"
OUT = ROOT / "字根合併候選.md"


def build():
    z = json.loads((DATA / "zigen.json").read_text("utf-8"))
    gthr = z["meta"]["merge_threshold"]

    rows = []
    for L in z["letters"]:
        for it in L["intentions"]:
            by_n = {}
            for sh in it["shapes"]:
                g = sh.get("glyph") or {}
                if not g:
                    continue
                med = medians(g["src"])
                if not med:
                    continue
                try:
                    v = stroke_vec([med[i] for i in g["strokes"]])
                except IndexError:
                    continue
                if not v:
                    continue
                by_n.setdefault(len(g["strokes"]), []).append(
                    {"src": g["src"], "strokes": g["strokes"], "v": v,
                     "thr": sh.get("thr", gthr), "count": sh.get("count", 0),
                     "seen": len(sh.get("seen") or [])})
            for n, group in by_n.items():
                for a, b in itertools.combinations(group, 2):
                    d = dist(a["v"], b["v"])
                    lo, hi = sorted([a["thr"], b["thr"]])
                    if d < lo:
                        kind = "乾淨"
                    elif d < hi:
                        kind = "臨界"
                    else:
                        continue
                    rows.append((kind, d, L["letter"], it.get("desc", "").strip(), a, b))
    rows.sort(key=lambda r: (r[0] == "臨界", r[1]))
    return rows


def span(e):
    s = [i + 1 for i in e["strokes"]]
    pos = f"第 {s[0]}–{s[-1]} 筆" if len(s) > 1 else f"第 {s[0]} 筆"
    return f"{e['src']} {pos}（count={e['count']}, seen={e['seen']}, thr={e['thr']:.4f}）"


def main():
    rows = build()
    clean = [r for r in rows if r[0] == "乾淨"]
    border = [r for r in rows if r[0] == "臨界"]
    L = [
        "# 字根合併候選 —— 同一取形意圖底下可能其實同形的配對\n",
        f"由 `tools/合併候選.py` 於 {datetime.date.today()} 產生。**候選清單，不是合併紀錄**——",
        "沒有一組被這支腳本動過。合併請用 `editor.html` 的合併功能（依 count 決定代表、",
        "alts 收留輸家、seen 取聯集去重上限 24），不要手改 JSON。\n",
        "## 兩種候選\n",
        f"**乾淨（{len(clean)} 組）**——距離在兩邊門檻都放行的範圍內，兩個字根互相都會",
        "承認對方是同一形狀。可以放心合併。\n",
        f"**臨界（{len(border)} 組）**——距離只在比較鬆的那個門檻內，比較嚴的那個不放行。",
        "門檻可能是刻意調緊的、只是沒寫進 `meta.distinct`（`editor.html:1013` 可以直接手改",
        "門檻，不留裁決紀錄）——**先看一眼再決定**，不要當成乾淨候選處理。\n",
        "| 判定 | d | 字母 | 取形意圖 | 字根 A | 字根 B |",
        "|---|---|---|---|---|---|",
    ]
    for kind, d, letter, desc, a, b in rows:
        L.append(f"| {kind} | `{d:.4f}` | **{letter}** | {desc[:24] or '（無）'} "
                 f"| {span(a)} | {span(b)} |")
    OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"{len(clean)} 組乾淨、{len(border)} 組臨界 → {OUT.name}")


if __name__ == "__main__":
    main()
