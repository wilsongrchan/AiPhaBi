#!/usr/bin/env python3
"""把「一個全域門檻」改成「全域寬鬆 + 個別字根收緊」。

你每次裁決「這兩個確實不同」，之前的做法是把全域合併門檻往下調 ——
結果門檻掉到 0.025，連「日」跟「日」都不算同形，預測就再也找不到字根可用。

正確的做法是：門檻本來就該因字根而異。
「小點」與「捺」差 0.03，那是這兩個字根需要嚴格；
「日」跟別的字根差得遠，它大可寬鬆。

所以這支程式：
  1. 把你標成「確實不同」的每一組配對，算出它們的實際距離
  2. 給這些字根各自一個 thr（＝該組距離的 0.9 倍），只有它們變嚴格
  3. 全域門檻回到寬鬆的預設值

Shape.strokeVec / Shape.dist 的 Python 移植，公式與 assets/shape.js 完全一致。
"""
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).parent
ZIGEN = ROOT / "data" / "zigen.json"
GRAPHICS = ROOT / "data" / "graphics.txt"
SAMPLES = [0, 0.25, 0.5, 0.75, 1]
GLOBAL_THR = 0.25          # 全域回到寬鬆

_med = None


def medians(ch):
    global _med
    if _med is None:
        _med = {}
        for line in GRAPHICS.open(encoding="utf-8"):
            g = json.loads(line)
            _med[g["character"]] = g["medians"]
    return _med.get(ch)


def resample(m, t):
    if len(m) == 1:
        return m[0]
    seg, total = [], 0.0
    for i in range(1, len(m)):
        d = math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1])
        seg.append(d)
        total += d
    if total == 0:
        return m[0]
    want = t * total
    for i, s in enumerate(seg):
        if want <= s or i == len(seg) - 1:
            f = want / s if s else 0.0
            return [m[i][0] + (m[i + 1][0] - m[i][0]) * f,
                    m[i][1] + (m[i + 1][1] - m[i][1]) * f]
        want -= s
    return m[-1]


def stroke_vec(meds):
    if not meds:
        return None
    xs = [p[0] for m in meds for p in m]
    ys = [p[1] for m in meds for p in m]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = max(x1 - x0, 1), max(y1 - y0, 1)
    sx, sy = max(w, h * 0.08), max(h, w * 0.08)
    v = []
    for m in meds:
        for t in SAMPLES:
            x, y = resample(m, t)
            v += [(x - x0) / sx, (y - y0) / sy]
    ar = max(-1.0, min(1.0, math.log(w / h) / math.log(8)))
    v.append(ar * 0.6)
    k = math.sqrt(len(meds))
    return [x / k for x in v]


def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def vec_of(shape):
    g = shape.get("glyph")
    if not g:
        return None
    med = medians(g["src"])
    if not med:
        return None
    try:
        return stroke_vec([med[i] for i in g["strokes"]])
    except IndexError:
        return None


def main():
    z = json.loads(ZIGEN.read_text("utf-8"))
    meta = z["meta"]
    old_thr = meta.get("merge_threshold")

    # 同字母的「確實不同」沒有意義：兩條字根取出來的碼一模一樣。
    # 留著只會白白把門檻收緊，害預測認不出東西。丟掉。
    before = meta.get("distinct", [])
    distinct = [p for p in before if p[0].split(":")[0] != p[1].split(":")[0]]
    dropped = len(before) - len(distinct)
    meta["distinct"] = distinct

    # 門檻全部重算（先清掉舊的，只由跨字母的裁決決定）
    for L in z["letters"]:
        for it in L["intentions"]:
            for s in it["shapes"]:
                s.pop("thr", None)

    # key（字母:定義） → 字根物件
    index = {}
    for L in z["letters"]:
        for it in L["intentions"]:
            for s in it["shapes"]:
                if not s.get("glyph"):
                    continue
                key = f"{L['letter']}:{s['glyph']['src']}#{','.join(map(str, s['glyph']['strokes']))}"
                index[key] = s

    tightened = {}
    unmatched = 0
    for pair in distinct:
        a, b = index.get(pair[0]), index.get(pair[1])
        if not a or not b:
            unmatched += 1
            continue
        va, vb = vec_of(a), vec_of(b)
        if not va or not vb or len(va) != len(vb):
            unmatched += 1
            continue
        d = dist(va, vb)
        thr = max(0.01, round(d * 0.9, 4))
        for s, key in ((a, pair[0]), (b, pair[1])):
            cur = s.get("thr")
            if cur is None or thr < cur:
                s["thr"] = thr
            tightened[key] = s["thr"]
        print(f"  {pair[0]}  ×  {pair[1]}   距離 {d:.3f} → thr {thr}")

    meta["merge_threshold"] = GLOBAL_THR
    meta.setdefault("note_thresholds",
                    "merge_threshold 是全域門檻；個別字根可用 thr 收緊（由「確實不同」的裁決自動設定）。")
    ZIGEN.write_text(json.dumps(z, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"\n丟掉同字母的裁決：{dropped} 組（碼一樣，收緊門檻毫無意義）")
    print(f"保留跨字母的裁決：{len(distinct)} 組")
    print(f"全域門檻：{old_thr} → {GLOBAL_THR}")
    print(f"個別收緊的字根：{len(tightened)} 個" + (f"（{unmatched} 組配對找不到字根，略過）" if unmatched else ""))


if __name__ == "__main__":
    main()
