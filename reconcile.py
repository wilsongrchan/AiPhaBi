#!/usr/bin/env python3
"""字根表 × 碼表對帳：用碼表把字根的「例字／計次／定義來源」重算一遍。

字根表與碼表是兩份資料。你把「天」從 FL 改成 IY，F 底下那條「天[1,2,3]」不會自己消失：
例字裡還留著「天」，定義來源也還是「天」—— 字根表上就看到天的前三筆被當成 F。

作法不是「逐條刪掉對不上的例字」（那會漏掉「這個字其實改用同字母的另一條字根」的情況，
例如「時」的日，後來配到 曰 那一條去了），而是：

  1. 把所有字根的 seen / count 歸零
  2. 把碼表跑一遍：每個字的每一碼，去找它「真正配上」的那條字根（同字母、同筆數、距離最近
     且在該字根自己的門檻內），把這個字記到那條字根的例字上
  3. 定義來源若已經沒在用它 → 改用一個仍在用它的字重新錨定
  4. 完全沒有字在用的字根 → 列出來（加 --delete-orphans 才刪）
  5. 配不上任何字根的碼 → 也列出來（那是字根表缺了東西，或門檻太緊）

    python3 reconcile.py                       # 只報告
    python3 reconcile.py --apply               # 寫回
    python3 reconcile.py --apply --delete-orphans
"""
import collections
import json
import pathlib
import sys

from retune import dist, medians, stroke_vec

ROOT = pathlib.Path(__file__).parent
ZIGEN = ROOT / "data" / "zigen.json"
CODES = ROOT / "data" / "codes.json"


def main():
    apply = "--apply" in sys.argv
    delete_orphans = "--delete-orphans" in sys.argv

    z = json.loads(ZIGEN.read_text("utf-8"))
    codes = json.loads(CODES.read_text("utf-8"))
    global_thr = z["meta"].get("merge_threshold", 0.25)

    # 每條字根算出向量（含合併過的變體 alts）
    entries = []
    for L in z["letters"]:
        for it in L["intentions"]:
            for sh in it["shapes"]:
                g = sh.get("glyph")
                if not g:
                    continue
                thr = sh.get("thr", global_thr)
                forms = [g] + sh.get("alts", [])
                vecs = []
                for f in forms:
                    med = medians(f["src"])
                    if not med:
                        continue
                    try:
                        v = stroke_vec([med[i] for i in f["strokes"]])
                    except IndexError:
                        continue
                    if v:
                        vecs.append(v)
                if vecs:
                    entries.append({"L": L, "it": it, "sh": sh, "letter": L["letter"],
                                    "n": len(g["strokes"]), "thr": thr, "vecs": vecs})

    before = {id(e["sh"]): (e["sh"].get("count", 0), list(e["sh"].get("seen", []))) for e in entries}
    for e in entries:
        e["users"] = []          # [(字, 那一碼的筆畫)]

    unmatched = []
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
            for e in entries:
                if e["letter"] != seg["letter"] or e["n"] != len(seg["strokes"]):
                    continue
                d = min(dist(v, ev) for ev in e["vecs"])
                if d < e["thr"] and (bd is None or d < bd):
                    best, bd = e, d
            if best:
                best["users"].append((ch, seg["strokes"]))
            else:
                unmatched.append((ch, seg["letter"], [i + 1 for i in seg["strokes"]]))

    # 重新填 seen / count；順便重新錨定定義來源
    reanchored, orphans, changed = [], [], 0
    for e in entries:
        sh, g = e["sh"], e["sh"]["glyph"]
        users = e["users"]
        chars = list(dict.fromkeys(ch for ch, _ in users))
        old_count, old_seen = before[id(sh)]
        sh["count"] = len(users)
        sh["seen"] = chars[:24]
        if sh["count"] != old_count or sh["seen"] != old_seen[:24]:
            changed += 1

        if not users:
            orphans.append(e)
            continue
        # 定義來源還在用它嗎？
        if not any(ch == g["src"] and list(st) == list(g["strokes"]) for ch, st in users):
            ch, st = users[0]
            old = f"{g['src']}[{''.join(str(i+1) for i in g['strokes'])}]"
            sh["glyph"] = {"src": ch, "strokes": list(st)}
            sh["ex"] = ch
            reanchored.append((e["letter"], old,
                               f"{ch}[{''.join(str(i+1) for i in st)}]"))

    print(f"字根 {len(entries)} 條，碼表 {len([c for c,r in codes.items() if r.get('segments')])} 字\n")
    print(f"例字／計次有變動：{changed} 條")
    print(f"\n重新錨定定義來源：{len(reanchored)} 條（原本用的字已經不再使用該字根）")
    for letter, old, new in reanchored:
        print(f"   {letter}: {old} → {new}")
    print(f"\n沒有任何字在用的字根：{len(orphans)} 條")
    for e in orphans:
        g = e["sh"]["glyph"]
        print(f"   {e['letter']} {g['src']}[{''.join(str(i+1) for i in g['strokes'])}]")
    print(f"\n配不上任何字根的碼：{len(unmatched)} 個")
    for ch, letter, st in unmatched[:15]:
        print(f"   {ch} 的 {letter}（第 {','.join(map(str, st))} 筆）")
    if len(unmatched) > 15:
        print(f"   …還有 {len(unmatched) - 15} 個")

    if delete_orphans:
        for e in orphans:
            if e["sh"] in e["it"]["shapes"]:
                e["it"]["shapes"].remove(e["sh"])
        print(f"\n已刪除 {len(orphans)} 條沒人用的字根")

    if apply:
        ZIGEN.write_text(json.dumps(z, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("\n已寫回 data/zigen.json")
    else:
        print("\n（只是報告；加 --apply 才會寫回）")


if __name__ == "__main__":
    main()
