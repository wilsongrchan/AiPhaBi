#!/usr/bin/env python3
"""下載／重建字形資料（第一次 clone 之後跑一次）。

    python3 fetch_data.py

會產生：
    data/graphics.txt     makemeahanzi 的筆畫輪廓 + 中線（大陸筆順，9574 字）
    data/tw_strokes.json  台灣教育部標準筆順（g0v/zh-stroke-data，4847 字）
    data/freq.json        字頻排序（由 rime-essay 統計而來，決定取碼佇列次序）

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
G0V = "https://github.com/g0v/zh-stroke-data/archive/refs/heads/master.zip"
ESSAY = "https://raw.githubusercontent.com/rime/rime-essay/master/essay.txt"


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
        print("字頻（rime-essay）")
        counts = collections.Counter()
        for line in fetch(ESSAY).decode("utf-8", "replace").splitlines():
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            try:
                w = int(parts[1])
            except ValueError:
                continue
            for ch in parts[0]:
                if ch in chars:
                    counts[ch] += w
        ranked = [c for c, _ in counts.most_common()]
        rest = sorted(chars - set(ranked), key=lambda c: (strokes[c], c))
        freq.write_text(json.dumps({"order": ranked + rest, "with_freq": len(ranked)},
                                   ensure_ascii=False), "utf-8")
        print(f"  {len(ranked) + len(rest)} 字排序完成")

    print("\n完成。啟動： python3 server.py  →  http://localhost:8777")


if __name__ == "__main__":
    main()
