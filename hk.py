"""香港教育局筆順 — 從《香港小學學習字詞表》抓取並解碼。

教育局的筆順「動畫」其實是 Adobe Animate（CreateJS）匯出的 JS：
每個 Layer 是一筆，層內最後一個 shape 是寫完的那一筆，
timeline 上出現的影格次序就是筆順。所以不必看動畫，直接解碼即可。

每個字要兩個請求（查 demo 編號、抓該編號的 JS），結果快取在 data/hk_cache.json。
伺服器是隨用隨抓；也可以先批次預抓：

    python3 hk.py prefetch 500      # 依字頻抓前 500 個字
    python3 hk.py 明                # 抓單一個字看看
"""
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CACHE = ROOT / "data" / "hk_cache.json"
BASE = "https://www.edbchinese.hk"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
DELAY = 0.6                       # 對方是公營網站，慢慢來

B64 = {c: i for i, c in enumerate(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}
PARAM_COUNT = [2, 2, 4, 6, 0]
CMD = ["M", "L", "Q", "C", "Z"]

_lock = threading.Lock()
_cache = None


def cache():
    global _cache
    if _cache is None:
        _cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}
    return _cache


def _save():
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache(), ensure_ascii=False), encoding="utf-8")


def decode_path(s):
    """CreateJS Graphics.decodePath 的移植（已對照官方輸出驗證）。"""
    out, i, x, y = [], 0, 0.0, 0.0
    while i < len(s):
        n = B64[s[i]]
        fi = n >> 3
        pl = PARAM_COUNT[fi]
        if fi == 0:
            x = y = 0.0
        i += 1
        char_count = ((n >> 2) & 1) + 2
        params = []
        for p in range(pl):
            num = B64[s[i]]
            sign = -1 if (num >> 5) else 1
            num = ((num & 31) << 6) | B64[s[i + 1]]
            if char_count == 3:
                num = (num << 6) | B64[s[i + 2]]
            num = sign * num / 10.0
            if p % 2:
                y = num = num + y
            else:
                x = num = num + x
            params.append(num)
            i += char_count
        out.append((CMD[fi], params))
    return " ".join(c if c == "Z" else c + " ".join(f"{v:g}" for v in ps) for c, ps in out)


def _get(url, data=None):
    req = urllib.request.Request(
        url, data=data.encode() if data else None,
        headers={"User-Agent": UA,
                 "Content-Type": "application/x-www-form-urlencoded"} if data
        else {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def demo_id(ch):
    """查某字的筆順示範編號（result.jsp 必須用 POST）。"""
    body = urllib.parse.urlencode(
        {"searchMethod": "direct", "searchCriteria": ch, "sortBy": "stroke", "jpC": "jyt"})
    html = _get(f"{BASE}/lexlist_ch/result.jsp", body)
    m = re.search(r"stkdemo_js/([\w\-]+)/(\d+)\.html", html)   # 資料夾可能是 4001-ZC 這種
    return (m.group(1), m.group(2)) if m else None


def strokes_from_js(js):
    """依筆順回傳 [{d, tx, ty}]。

    一筆 = 一條 state tween：`.to({state:[]}).to({state:[{t:this.shapeN}]},F)…`
    F 是該筆出現的影格（＝筆順；檔案裡的排列常是倒序），tween 內最後一個 shape
    是寫完的那一筆（前面幾個是運筆中的半成品）。純 `Tween.get(this.shape_N)`
    那條沒有 state，是整字剪影，不算筆畫。
    （不要靠 // LayerN 註解分段：有些字的匯出檔根本沒有那些註解。）
    """
    shapes = {
        name: (enc, float(tx), float(ty))
        for name, enc, tx, ty in re.findall(
            r'this\.(shape(?:_\d+)?)\.graphics\.f\("[^"]*"\)\.s\(\)\.p\("([^"]+)"\);\s*'
            r"this\.\1\.setTransform\(([-\d.]+),([-\d.]+)\)", js)
    }
    out = []
    for tween in re.findall(r"this\.timeline\.addTween\(([\s\S]*?)\);", js):
        if "state:" not in tween:
            continue
        states = re.findall(r"\.to\(\{state:\[\{t:this\.(shape(?:_\d+)?)\}\]\},(\d+)\)", tween)
        if not states:
            continue
        frame = int(states[0][1])            # 第一次出現＝筆順
        last = states[-1][0]                 # 最後一個 shape＝寫完的那一筆
        if last not in shapes:
            continue
        enc, tx, ty = shapes[last]
        out.append({"frame": frame, "d": decode_path(enc), "tx": tx, "ty": ty})

    out.sort(key=lambda s: s["frame"])
    for s in out:
        s.pop("frame")
    return out


def bbox(strokes):
    xs, ys = [], []
    for s in strokes:
        for m in re.finditer(r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)", s["d"]):
            xs.append(float(m.group(1)) + s["tx"])
            ys.append(float(m.group(2)) + s["ty"])
    if not xs:
        return "0 0 400 400"
    pad = 25
    x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    side = max(x1 - x0, y1 - y0)
    return f"{x0 - (side - (x1 - x0)) / 2:.0f} {y0 - (side - (y1 - y0)) / 2:.0f} {side:.0f} {side:.0f}"


def get(ch):
    """回傳 {'strokes': [...], 'viewBox': str} 或 None（教育局沒有這個字）。"""
    c = cache()
    if ch in c:
        return c[ch] or None
    with _lock:
        if ch in c:
            return c[ch] or None
        try:
            hit = demo_id(ch)
            time.sleep(DELAY)
            if not hit:
                c[ch] = None
                _save()
                return None
            folder, num = hit
            js = _get(f"{BASE}/EmbziciwebRes/stkdemo_js/{folder}/{num}.js")
            strokes = strokes_from_js(js)
            c[ch] = {"strokes": strokes, "viewBox": bbox(strokes)} if strokes else None
            _save()
            return c[ch]
        except Exception as e:                       # 網路錯誤不要寫進快取
            print(f"[hk] {ch}: {e}")
            return None


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "明"
    if arg == "prefetch":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 500
        order = json.loads((ROOT / "data" / "freq.json").read_text())["order"][:n]
        todo = [c for c in order if c not in cache()]
        print(f"預抓 {len(todo)} 個字（每字約 {DELAY * 2:.1f} 秒，估計 {len(todo) * DELAY * 2 / 60:.0f} 分鐘）")
        for i, ch in enumerate(todo, 1):
            r = get(ch)
            print(f"  {i}/{len(todo)} {ch} {'✓ ' + str(len(r['strokes'])) + ' 筆' if r else '（無資料）'}")
            time.sleep(DELAY)
        print(f"完成。快取共 {len(cache())} 字")
    else:
        r = get(arg)
        print(json.dumps(r, ensure_ascii=False)[:400] if r else "沒有資料")
