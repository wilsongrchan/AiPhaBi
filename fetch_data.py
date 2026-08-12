#!/usr/bin/env python3
"""下載／重建字形資料（第一次 clone 之後跑一次）。

    python3 fetch_data.py

會產生：
    data/graphics.txt     makemeahanzi 的筆畫輪廓 + 中線（大陸筆順，9574 字）
    data/dictionary.txt   makemeahanzi 的部件拆分（IDS，例 訴 = ⿰言斥；相關字欄用）
    data/tw_strokes.json  台灣教育部標準筆順（g0v/zh-stroke-data，4847 字）
    data/freq.json        字頻排序（由 rime-essay 統計而來，決定取碼佇列次序）
    data/predict.db       官方 librime-predict 接續資料庫（已編譯，Squirrel 智能聯想直接用）
    data/predict.txt      predict.db 的原始 TSV（純文字，/type 頁面智能聯想模擬用）
    data/opencc.json      繁簡對照（OpenCC；試打的「簡繁兼容」用）

這些是第三方資料，各有授權，所以不放進 git；用時自行下載。
香港教育局的筆順（data/hk_cache.json）由 hk.py 隨用隨抓，同樣不入 git。
"""
import collections
import io
import json
import pathlib
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "data"
MMH = "https://raw.githubusercontent.com/skishore/makemeahanzi/master/graphics.txt"
MMH_DICT = "https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt"
G0V = "https://github.com/g0v/zh-stroke-data/archive/refs/heads/master.zip"
ESSAY = "https://raw.githubusercontent.com/rime/rime-essay/master/essay.txt"
CJ = ["https://raw.githubusercontent.com/rime/rime-cangjie/master/cangjie5.base.dict.yaml",
      "https://raw.githubusercontent.com/rime/rime-cangjie/master/cangjie5.extended.dict.yaml"]
OPENCC = "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/"
PREDICT_DB = "https://github.com/rime/librime-predict/releases/download/data-1.0/predict.db"
PREDICT_TXT = "https://github.com/rime/librime-predict/releases/download/data-1.0/predict.txt"


def fetch(url):
    print(f"  下載 {url.split('/')[-1]} …")
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def main():
    DATA.mkdir(exist_ok=True)

    graphics = DATA / "graphics.txt"
    if not graphics.exists():
        print("makemeahanzi（大陸筆順）")
        graphics.write_bytes(fetch(MMH))
    dictionary = DATA / "dictionary.txt"
    if not dictionary.exists():
        print("makemeahanzi 部件拆分（IDS，相關字欄用）")
        dictionary.write_bytes(fetch(MMH_DICT))

    chars = {json.loads(l)["character"] for l in graphics.open(encoding="utf-8")}
    strokes = {json.loads(l)["character"]: len(json.loads(l)["strokes"])
               for l in graphics.open(encoding="utf-8")}
    print(f"  {len(chars)} 字")

    tw = DATA / "tw_strokes.json"
    if not tw.exists():
        print("台灣教育部標準筆順（g0v/zh-stroke-data）")
        z = zipfile.ZipFile(io.BytesIO(fetch(G0V)))
        out = {}
        for name in z.namelist():
            if "/json/" not in name or not name.endswith(".json"):
                continue
            try:
                cp = int(pathlib.Path(name).stem, 16)
            except ValueError:
                continue
            try:
                data = json.loads(z.read(name))
            except json.JSONDecodeError:
                continue
            if not isinstance(data, list):
                continue
            paths = []
            for st in data:
                d = []
                for c in st.get("outline", []):
                    if c["type"] == "M":
                        d.append(f"M{c['x']} {c['y']}")
                    elif c["type"] == "L":
                        d.append(f"L{c['x']} {c['y']}")
                    elif c["type"] == "Q":
                        d.append(f"Q{c['begin']['x']} {c['begin']['y']} "
                                 f"{c['end']['x']} {c['end']['y']}")
                if d:
                    paths.append(" ".join(d) + " Z")
            if paths:
                out[chr(cp)] = paths
        tw.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
        print(f"  {len(out)} 字")

    freq = DATA / "freq.json"
    if not freq.exists():
        print("字頻（rime-essay：字詞出現次數 × 單字頻 混合，較穩、涵蓋到尾）")
        # 兩個訊號：wa=字在所有詞裡的加權出現次數（「一」出現在無數詞裡，自然排前，較準）；
        #          sc=單字詞本身的次數。各自取名次百分位再混合（0.55/0.45），
        #          消掉單一來源的怪癖（純單字頻把「一」壓太低、純 makemeahanzi 尾段又噪）。
        wa, sc = collections.Counter(), collections.Counter()
        for line in fetch(ESSAY).decode("utf-8", "replace").splitlines():
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            try:
                w = int(parts[1])
            except ValueError:
                continue
            word = parts[0]
            for ch in word:
                wa[ch] += w
            if len(word) == 1:
                sc[word] += w

        def _han(c):
            return "㐀" <= c <= "鿿" or "豈" <= c <= "﫿"

        wa_rank = {c: i for i, c in enumerate(sorted(wa, key=lambda c: -wa[c]))}
        sc_rank = {c: i for i, c in enumerate(sorted(sc, key=lambda c: -sc[c]))}
        nw, ns = max(1, len(wa_rank)), max(1, len(sc_rank))

        def _blend(c):
            pw = wa_rank[c] / nw if c in wa_rank else 1.0
            ps = sc_rank[c] / ns if c in sc_rank else 1.0
            return 0.55 * pw + 0.45 * ps

        ranked = sorted((c for c in wa if _han(c)), key=_blend)
        rest = sorted(chars - set(ranked), key=lambda c: (strokes[c], c))  # makemeahanzi 有、essay 沒出現的
        freq.write_text(json.dumps({"order": ranked + rest, "with_freq": len(ranked)},
                                   ensure_ascii=False), "utf-8")
        print(f"  {len(ranked) + len(rest)} 字排序完成")

    predict_db = DATA / "predict.db"
    if not predict_db.exists():
        print("智能聯想資料庫（官方 librime-predict，選完字猜下一個字／詞用）")
        predict_db.write_bytes(fetch(PREDICT_DB))
    predict_txt = DATA / "predict.txt"
    if not predict_txt.exists():
        print("智能聯想資料庫（純文字版，/type 頁面模擬用）")
        predict_txt.write_bytes(fetch(PREDICT_TXT))

    cj = DATA / "cangjie.json"
    if not cj.exists():
        print("官方倉頡碼表（rime-cangjie，僅作對照）")
        table = {}
        for url in reversed(CJ):                 # base 後蓋 extended，常用字優先
            body = False
            for line in fetch(url).decode("utf-8", "replace").splitlines():
                if line.strip() == "...":
                    body = True
                    continue
                if not body:
                    continue
                parts = line.split("\t")
                if len(parts) >= 2 and len(parts[0]) == 1 and parts[0] in chars:
                    table[parts[0]] = parts[1].upper()
        cj.write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":")), "utf-8")
        print(f"  {len(table)} 字")

    opencc = DATA / "opencc.json"
    if not opencc.exists():
        print("繁簡對照（OpenCC，試打的「簡繁兼容」用）")

        def load_map(name):
            out = {}
            for line in fetch(OPENCC + name).decode("utf-8", "replace").splitlines():
                p = line.split("\t")
                if len(p) == 2 and len(p[0]) == 1:
                    out[p[0]] = [c for c in p[1].split(" ") if c and c != p[0]]
            return {k: v for k, v in out.items() if v}

        t2s = load_map("TSCharacters.txt")     # 繁 → 簡（多半一對一）
        s2t = load_map("STCharacters.txt")     # 簡 → 繁（一對多常見：发 ← 發／髮）
        opencc.write_text(json.dumps({"t2s": t2s, "s2t": s2t}, ensure_ascii=False,
                                     separators=(",", ":")), "utf-8")
        print(f"  繁→簡 {len(t2s)}、簡→繁 {len(s2t)}")

    print("\n完成。啟動： python3 server.py  →  http://localhost:8777")


if __name__ == "__main__":
    main()
