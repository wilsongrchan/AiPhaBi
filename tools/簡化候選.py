#!/usr/bin/env python3
"""找「代表字比自己例字複雜」的候選 → 字根簡化候選.md（repo 根目錄）。

    python3 tools/簡化候選.py

背景：Wilson 從網站上看出規律——字根表用某個字當代表，但那個字根的例字欄裡，已經
有更簡單、一看就是這個形狀的字（資→目、把→巴 之類）。這支腳本把同一個規律掃過
全部字根，列出候選給 Wilson 挑，**不自動套用**——「筆畫少」只是候選條件，
「像不像自然的代表字」是人的判斷，兩者不一樣（例：第 比 汽 複雜，但第還是比較好
的代表字，因為它是「竹」字頭這個取形意圖真正常見的字）。

候選條件（兩個都要過）：
1. **用比對器找出來的例字**（不是 seen，理由同 辨析候選.py）當中，有一個字的某個
   單一區段幾何上match 這個字根（`dist < thr`），而且那個字**整字**的總筆畫數比
   現在的代表字少。
2. 匹配不能有歧義：那個字裡剛好只有一個區段對得上這個字根（同字母、同筆數、
   在門檻內），不然換了代表字反而混淆讀者「是哪一筆在對應」。

需要 `data/graphics.txt`（gitignored），所以只有 Side A 跑得動。
"""
import collections
import json
import pathlib
import sys
import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from retune import medians, stroke_vec, dist          # noqa: E402

DATA = ROOT / "data"
OUT = ROOT / "字根簡化候選.md"


def total_strokes(rec):
    return max((s for seg in (rec.get("segments") or []) for s in seg["strokes"]), default=-1) + 1


def build():
    z = json.loads((DATA / "zigen.json").read_text("utf-8"))
    codes = json.loads((DATA / "codes.json").read_text("utf-8"))
    rank = {c: i for i, c in enumerate(json.loads((DATA / "freq.json").read_text("utf-8"))["order"])}
    gthr = z["meta"]["merge_threshold"]

    entries = []
    for L in z["letters"]:
        for it in L["intentions"]:
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
                entries.append({"letter": L["letter"], "n": len(g["strokes"]),
                                "thr": sh.get("thr", gthr), "v": v, "src": g["src"],
                                "strokes": g["strokes"], "desc": (it.get("desc") or "").strip(),
                                "candidates": []})

    by = collections.defaultdict(list)
    for e in entries:
        by[(e["letter"], e["n"])].append(e)

    # 對每個字，找出「這個字裡有幾個區段對得上某個字根候選」，只留恰好一個的（無歧義）
    for ch, rec in codes.items():
        if not rec.get("segments"):
            continue
        med = medians(ch)
        if not med:
            continue
        hits = collections.defaultdict(list)     # entry id -> [seg,...]
        for seg in rec["segments"]:
            try:
                v = stroke_vec([med[i] for i in seg["strokes"]])
            except IndexError:
                continue
            if not v:
                continue
            for e in by.get((seg["letter"], len(seg["strokes"])), ()):
                d = dist(v, e["v"])
                if d < e["thr"]:
                    hits[id(e)].append((seg, d))
        for e in entries:
            hs = hits.get(id(e))
            if hs and len(hs) == 1 and ch != e["src"]:
                seg, d = hs[0]
                e["candidates"].append((ch, seg["strokes"], d, total_strokes(rec)))

    rows = []
    for e in entries:
        src_total = total_strokes(codes.get(e["src"], {}))
        good = [c for c in e["candidates"] if c[3] < src_total]
        if not good:
            continue
        good.sort(key=lambda c: (c[3], rank.get(c[0], 10 ** 9)))
        rows.append((e, good[0], src_total))
    rows.sort(key=lambda r: r[1][3] - r[2])   # 省下的筆畫數，最多的排前面
    return rows


def span(src, strokes):
    s = [i + 1 for i in strokes]
    return f"{src} 第 {s[0]}–{s[-1]} 筆" if len(s) > 1 else f"{src} 第 {s[0]} 筆"


def main():
    rows = build()
    L = [
        "# 字根簡化候選 —— 代表字比例字複雜的地方\n",
        f"由 `tools/簡化候選.py` 於 {datetime.date.today()} 產生。**這是給 Wilson 挑的候選清單，",
        "不是自動改動的紀錄**——目前代表字沒有一個被這支腳本動過。\n",
        "## 這份清單怎麼來的\n",
        "起因：資／瞞／然／貓／儕／把 六個字根，代表字比自己例字欄裡已經有的字（目／相／炙／",
        "豹／齊／巴）複雜。這支腳本把同一個檢查掃過全部字根：**例字裡有沒有筆畫更少、",
        "且對應區段沒有歧義的字**。\n",
        "**筆畫少不等於自然。** 候選只保證「比較簡單」，不保證「讀起來就是這個形狀」——",
        "第 比 汽 複雜，但「竹」字頭這個取形意圖，第 才是自然的代表；汽 不會有人直覺想到",
        "竹字頭。這份清單只篩出候選，挑不挑、挑哪個由 Wilson 決定，不要整批套用。\n",
        f"**{len(rows)} 個候選**，依「省下幾筆」排序，省最多的在最上面。改動前跟之前一樣",
        "先用比對器驗證過（`d` 欄），但那只保證形狀一樣，不保證是好的代表字。\n",
        "| 字母 | 現在的代表字 | 候選（更簡單） | d | thr | 省筆畫 |",
        "|---|---|---|---|---|---|",
    ]
    for e, (cand, cstrokes, d, ctotal), src_total in rows:
        L.append(f"| **{e['letter']}** | {span(e['src'], e['strokes'])}（共 {src_total} 筆） "
                 f"| {span(cand, cstrokes)}（共 {ctotal} 筆） | `{d:.4f}` | `{e['thr']:.4f}` "
                 f"| {src_total - ctotal} |")
    OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"{len(rows)} 個候選 → {OUT.name}")


if __name__ == "__main__":
    main()
