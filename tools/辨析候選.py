#!/usr/bin/env python3
"""產生〈相近字形辨析〉的候選配對清單 → 字根辨析候選.md（repo 根目錄）。

    python3 tools/辨析候選.py

種子是 `zigen.json` 的 `meta.distinct`：每一組都代表**有人實際判斷過**這兩個字形容易混淆、
但必須分開。這比任何自動算出來的相似度都更貼近「值得跟讀者解釋的混淆」。

三個刻意的取捨，改動前先讀：

1. **只收跨字母。** 同字母的兩條字根取出來的碼一模一樣，讀者沒有任何可以行動的差別，
   `retune.py:105` 也會把它們丟掉。日／曰 正是這種：有名，但在這裡沒有意義。

2. **例字用比對器算，不讀 `seen`。** `seen` 上限 24 筆，缺席從來不代表沒用到
   （PROJECT_NOTES →「Checking a zigen offline」）。這裡照 `reconcile.py` 的規則重跑：
   同字母、同筆數、`min(dist) < thr`。

3. **例字優先給繁體。** 網站是繁體優先，而 `codes.json` 涵蓋 GB 2312，所以例字裡會混進
   簡體專屬字（迟 绿 错 钅 丽 俪）。判別法不能只看 opencc —— 家（傢→家）、困（睏→困）、
   台、后、里 都是 t2s 的「值」，卻也都是正當的繁體字。要三個條件同時成立：
   **是 t2s 的值、不在教育部甲表、且本身不是 t2s 的鍵。**（判別法由 Side C 提出並驗證。）

需要 `data/graphics.txt`（gitignored，跑 `fetch_data.py` 取得），所以只有 Side A 跑得動。
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
OUT = ROOT / "字根辨析候選.md"
N_EXAMPLES = 6


def simplified_only(codes):
    """簡體專屬字：打繁出簡的產物，不該當繁體頁面的例字。"""
    t2s = json.loads((DATA / "opencc.json").read_text("utf-8"))["t2s"]
    vals = {v[0] if isinstance(v, list) else v for v in t2s.values()}
    tw = {c for ln in (DATA / "standards" / "tw_common_4808.txt").read_text("utf-8").splitlines()
          if not ln.startswith("#") for c in ln.strip()}
    return {c for c in codes if c in vals and c not in tw and c not in t2s}


def build():
    z = json.loads((DATA / "zigen.json").read_text("utf-8"))
    codes = json.loads((DATA / "codes.json").read_text("utf-8"))
    rank = {c: i for i, c in enumerate(json.loads((DATA / "freq.json").read_text("utf-8"))["order"])}
    gthr = z["meta"]["merge_threshold"]
    simp = simplified_only(codes)

    key = lambda L, s, st: f"{L}:{s}#{','.join(map(str, st))}"        # noqa: E731
    entries, tok2e = [], {}
    for L in z["letters"]:
        for it in L["intentions"]:
            for sh in it["shapes"]:
                g = sh.get("glyph") or {}
                if not g:
                    continue
                vecs = []
                for f in [g] + (sh.get("alts") or []):
                    med = medians(f["src"])
                    if not med:
                        continue
                    try:
                        v = stroke_vec([med[i] for i in f["strokes"]])
                    except IndexError:
                        continue
                    if v:
                        vecs.append(v)
                if not vecs:
                    continue
                e = {"letter": L["letter"], "n": len(g["strokes"]), "thr": sh.get("thr", gthr),
                     "has_thr": sh.get("thr") is not None, "vecs": vecs, "src": g["src"],
                     "strokes": g["strokes"], "desc": (it.get("desc") or "").strip(),
                     "users": []}
                entries.append(e)
                for t in [key(L["letter"], g["src"], g["strokes"])] + \
                         [key(L["letter"], a["src"], a["strokes"]) for a in (sh.get("alts") or [])]:
                    tok2e.setdefault(t, e)

    by = collections.defaultdict(list)
    for e in entries:
        by[(e["letter"], e["n"])].append(e)
    for ch, rec in codes.items():
        if not rec.get("segments"):
            continue
        med = medians(ch)
        if not med:
            continue
        for seg in rec["segments"]:
            try:
                v = stroke_vec([med[i] for i in seg["strokes"]])
            except IndexError:
                continue
            if not v:
                continue
            best, bd = None, None
            for e in by.get((seg["letter"], len(seg["strokes"])), ()):
                d = min(dist(v, ev) for ev in e["vecs"])
                if d < e["thr"] and (bd is None or d < bd):
                    best, bd = e, d
            if best:
                best["users"].append(ch)

    for e in entries:
        us = sorted(set(e["users"]), key=lambda c: rank.get(c, 10 ** 9))
        trad = [c for c in us if c not in simp]
        e["examples"] = (trad + [c for c in us if c in simp])[:N_EXAMPLES]
        e["simp_flag"] = [c for c in e["examples"] if c in simp]
        e["total"] = len(us)

    rows, seen = [], set()
    for p in z["meta"]["distinct"]:
        if p[0].split(":")[0] == p[1].split(":")[0]:
            continue
        a, b = tok2e.get(p[0]), tok2e.get(p[1])
        if not a or not b:
            continue
        pair = tuple(sorted([id(a), id(b)]))
        if pair in seen:                     # 不同 token 常解析到同一對字根
            continue
        cands = [dist(va, vb) for va in a["vecs"] for vb in b["vecs"] if len(va) == len(vb)]
        if not cands:
            continue
        seen.add(pair)
        rows.append((min(cands), a, b))
    rows.sort(key=lambda r: r[0])
    return rows


def span(e):
    s = [i + 1 for i in e["strokes"]]
    return f"{e['src']} 第 {s[0]}–{s[-1]} 筆" if len(s) > 1 else f"{e['src']} 第 {s[0]} 筆"


def main():
    rows = build()
    flagged = sum(1 for _, a, b in rows if a["simp_flag"] or b["simp_flag"])
    L = [
        "# 相近字形辨析 —— 候選配對（Side A → Side C）\n",
        f"由 `tools/辨析候選.py` 於 {datetime.date.today()} 產生。**這是給人挑的清單，不是網站內容**；",
        "辨析的文字由 Wilson 自己寫。要更新就重跑那支腳本（需要 `data/graphics.txt`，只有 Side A 有）。\n",
        "## 這份清單怎麼來的\n",
        "種子是 `zigen.json` 的 `meta.distinct` ——「確實不同」的裁決紀錄。每一組都代表*有人實際",
        "判斷過*這兩個字形容易混淆、但必須分開，所以比任何自動算的相似度都更貼近「值得解釋的混淆」。\n",
        "**只收跨字母。** 同字母的兩條字根碼一模一樣，讀者沒有可以行動的差別（`retune.py:105`",
        "本來就丟掉這種）。日／曰 正是這類：有名，但在這裡沒意義。\n",
        f"**{len(rows)} 組**，依中線幾何距離 `d` 由近到遠排 —— d 越小越容易混淆，從最上面看起。",
        "`thr` 欄標示該字根是否帶收緊過的門檻（由這些裁決自動設定）。\n",
        "例字由**比對器**算出（不是 `seen`，那個上限 24 筆會漏），依現代字頻排序，"
        "**優先給繁體字**：",
        f"簡體專屬字（迟 绿 错 钅 丽 俪 之類）只在繁體例字不夠時才補上，補到的會標 ⚠️（目前 {flagged} 組）。\n",
        "> ⚠️ 取碼會變。任何要放上網站的碼，發布前對 `rime/aiphabi.dict.yaml` 再查一次。\n",
        "| # | d | 字母 | 字形位置 | 取形意圖 | 例字 | 用到 | thr |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for i, (d, a, b) in enumerate(rows, 1):
        for first, e in ((True, a), (False, b)):
            ex = "".join(e["examples"]) + (" ⚠️" if e["simp_flag"] else "")
            L.append(f"| {i if first else ''} | {f'`{d:.5f}`' if first else ''} | **{e['letter']}** "
                     f"| {span(e)} | {e['desc'] or '（取形意圖待補）'} | {ex} | {e['total']} "
                     f"| {'✔' if e['has_thr'] else '—'} |")
    OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"{len(rows)} 組 → {OUT.name}（含簡體例字的 {flagged} 組）")


if __name__ == "__main__":
    main()
