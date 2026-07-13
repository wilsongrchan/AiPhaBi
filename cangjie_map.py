"""倉頡「哪一筆屬於哪一碼」—— 從《五色倉頡字典》的拆碼圖解推出來。

倉頡碼表只說「取哪些字根」（明＝日月），沒說「取哪幾筆」。
倉頡字典（https://倉頡字典.com）的拆碼圖每一碼一個顏色，正好補上這一段。
所以這裡不是把人家的圖搬過來，而是：

    抓那張圖 → 沿著我們自己的筆畫中線取色 → 同色的筆畫歸為一組
    → 依「第一筆出現的先後」把顏色組對到倉頡碼的字母

推出來的是「第 N 筆屬於第 M 碼」這種事實，之後用我們自己的筆畫資料重畫。
淺灰(#CCCCCC)＝倉頡沒有取到的筆畫。

結果快取在 data/cangjie_map.json；圖片只是中間產物，不保留、不散布。

    python3 cangjie_map.py 明          # 單字
    python3 cangjie_map.py prefetch 300 # 依字頻預抓
"""
import collections
import io
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CACHE = ROOT / "data" / "cangjie_map.json"
GRAPHICS = ROOT / "data" / "graphics.txt"
CJ = ROOT / "data" / "cangjie.json"
BASE = "https://xn--0vqu8au0tro7d.com"          # 倉頡字典.com
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}
DELAY = 0.7                                      # 對方是小站，慢慢來
UNTAKEN = (204, 204, 204)                        # 淺灰＝倉頡沒取到的筆畫

_lock = threading.Lock()
_cache = None
_medians = None
_codes = None


def cache():
    global _cache
    if _cache is None:
        _cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}
    return _cache


def medians(ch):
    global _medians
    if _medians is None:
        _medians = {}
        for line in GRAPHICS.open(encoding="utf-8"):
            g = json.loads(line)
            _medians[g["character"]] = g["medians"]
    return _medians.get(ch)


def codes():
    global _codes
    if _codes is None:
        _codes = json.loads(CJ.read_text("utf-8"))
    return _codes


def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read()


IMGDIR = ROOT / "data" / "cj_img"


def diagram_bytes(ch):
    """拆碼圖的原始 PNG（快取在 data/cj_img/）。

    倉頡會把一筆切成兩半分屬不同碼（例：田字框的收口筆），
    我們的筆畫資料表達不了這件事 —— 所以直接看人家的圖最誠實。
    """
    IMGDIR.mkdir(parents=True, exist_ok=True)
    f = IMGDIR / f"{ord(ch):x}.png"
    if f.exists():
        return f.read_bytes()
    html = _get(f"{BASE}/char/search?q={urllib.parse.quote(ch)}").decode("utf-8", "replace")
    m = re.search(r"/char2/(\d+)\.png", html)
    if not m:
        return None
    time.sleep(DELAY)
    raw = _get(f"{BASE}/char2/{m.group(1)}.png")
    f.write_bytes(raw)
    return raw


def diagram(ch):
    """回傳拆碼圖（PIL Image），沒有就 None。"""
    raw = diagram_bytes(ch)
    if not raw:
        return None
    from PIL import Image
    return Image.open(io.BytesIO(raw)).convert("RGB")


def derive(ch):
    """回傳 {'code': 'AB', 'groups': [[0,1,2,3],[4,5,6,7]], 'untaken': []} 或 None。"""
    med = medians(ch)
    code = codes().get(ch)
    if not med or not code:
        return None
    im = diagram(ch)
    if im is None:
        return None
    W, H = im.size
    px = im.load()

    def near(x, y, r=6):
        """筆畫中線附近最常見的非背景色（背景是黑的）。"""
        c = collections.Counter()
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                X = int((x + dx * 8) / 1024 * W)
                Y = int((900 - (y + dy * 8)) / 1024 * H)   # 中線 y 向上，圖片 y 向下
                if 0 <= X < W and 0 <= Y < H:
                    v = px[X, Y]
                    if sum(v) > 60:
                        c[v] += 1
        return c.most_common(1)[0][0] if c else None

    colour = []
    for m in med:
        cnt = collections.Counter()
        for (x, y) in m:
            v = near(x, y)
            if v:
                cnt[v] += 1
        colour.append(cnt.most_common(1)[0][0] if cnt else None)

    untaken = [i for i, c in enumerate(colour) if c is None or _close(c, UNTAKEN)]
    seen, groups = {}, []
    for i, c in enumerate(colour):
        if i in untaken:
            continue
        if c not in seen:
            seen[c] = len(groups)
            groups.append([])
        groups[seen[c]].append(i)

    # 顏色組數要跟碼長一致，否則就是取色出了問題 —— 寧可不給，也不要給錯的
    if len(groups) != len(code):
        return {"code": code, "groups": None, "untaken": untaken,
                "why": f"顏色分成 {len(groups)} 組，但碼長是 {len(code)}"}
    return {"code": code, "groups": groups, "untaken": untaken}


def _close(a, b, tol=28):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def get(ch):
    c = cache()
    if ch in c:
        return c[ch] or None
    with _lock:
        if ch in c:
            return c[ch] or None
        try:
            r = derive(ch)
            c[ch] = r
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(c, ensure_ascii=False), encoding="utf-8")
            return r
        except Exception as e:
            print(f"[cangjie_map] {ch}: {e}")
            return None


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "明"
    if arg == "prefetch":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 300
        order = json.loads((ROOT / "data" / "freq.json").read_text())["order"][:n]
        todo = [c for c in order if c not in cache()]
        print(f"預抓 {len(todo)} 字（約 {len(todo) * DELAY * 2 / 60:.0f} 分鐘）")
        ok = bad = 0
        for i, ch in enumerate(todo, 1):
            r = get(ch)
            good = r and r.get("groups")
            ok, bad = ok + bool(good), bad + (not good)
            print(f"  {i}/{len(todo)} {ch} " +
                  (f"✓ {r['code']} {r['groups']}" if good else "（推不出）"))
            time.sleep(DELAY)
        print(f"完成：成功 {ok}、失敗 {bad}")
    else:
        print(json.dumps(get(arg), ensure_ascii=False))
