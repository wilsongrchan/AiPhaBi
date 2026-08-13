#!/usr/bin/env python3
"""愛發筆輸入法 — 本地伺服器。

用法:  python3 server.py     然後開 http://localhost:8777

  /                 字根表
  /annotate         逐字取碼
  /rules            取碼原則
  /stats            碼表分析（字母使用頻率、重碼）

  /api/zigen        GET/PUT  字根表
  /api/codes        GET/PUT  碼表（逐字取碼結果）
  /api/rules        GET/PUT  取碼原則
  /api/learned      GET/PUT  你教過系統的事（筆型糾正等）
  /api/glyph?c=字   GET      筆畫輪廓 + 中線（makemeahanzi，大陸筆順）
  /api/tw?c=字      GET      台灣教育部標準筆順（g0v/zh-stroke-data）
  /api/hk?c=字      GET      香港教育局筆順（隨用隨抓並快取；見 hk.py）
  /api/cangjie      GET      官方倉頡碼表（rime-cangjie，對照用）
  /api/dayi         GET      大易4碼表（rime-dayi，對照用）
  /api/ids          GET      部件拆分（makemeahanzi，例 訴 = ⿰言斥）
  /api/cjmap?c=字   GET      倉頡「哪一筆屬於哪一碼」（見 cangjie_map.py）
  /api/cjimg?c=字   GET      倉頡拆碼圖（倉頡字典.com，隨用隨抓並快取）
  /api/state        GET      各檔 mtime，兩頁靠它互通
"""
import collections
import json
import os
import shutil
import subprocess
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cangjie_map
import extract_text
import hk

ROOT = Path(__file__).parent
# 你的資料在 data/。跑測試時設 AIPHABI_DATA=/tmp/... 用另一份，免得動到真資料。
DATA_DIR = Path(os.environ.get("AIPHABI_DATA", ROOT / "data"))
SHARED = ROOT / "data"                      # 字形資料很大，測試時共用不必複製

DATA = DATA_DIR / "zigen.json"
CODES = DATA_DIR / "codes.json"
RULES = DATA_DIR / "rules.json"
LEARNED = DATA_DIR / "learned.json"
BACKUPS = DATA_DIR / "backups"
FREQ = SHARED / "freq.json"
GRAPHICS = SHARED / "graphics.txt"
DICT = SHARED / "dictionary.txt"        # makemeahanzi：部件拆分（IDS，例 訴 = ⿰言斥）
TW = SHARED / "tw_strokes.json"
CANGJIE = SHARED / "cangjie.json"
DAYI = SHARED / "dayi.json"             # 大易4碼表（對照用；rime-dayi 匯入）
OPENCC = SHARED / "opencc.json"         # 繁簡對照（試打「簡繁兼容」用）
DUAL_USE_MERGED = SHARED / "dual_use_merged.json"  # 歸併字白名單（不打簡體／碼表分析排除簡體 共用）
JP_KANJI = SHARED / "jp_kanji.json"      # 日本漢字（新字體＋國字，扣掉跟簡體字同形的）：取碼進度頁額外標記
PRIORITY = SHARED / "priority.json"     # 未取碼優先序（依台港新聞字頻推導）
VARIANT_GAPS = SHARED / "variant_gaps.json"  # 兼容變體缺口（新聞常用、你取了另一種寫法）
ORDERINGS = SHARED / "orderings.json"   # 未取碼佇列的多種排序（新聞／姓氏／人名用字）
CHARFREQ = SHARED / "charfreq.json"     # 現代（台港新聞）字頻：候選字排序用，比 rime-essay 更貼近實際
PREDICT_TXT = SHARED / "predict.txt"    # 官方 librime-predict 接續資料（predict.db 的純文字版；智能聯想用）
PORT = int(os.environ.get("AIPHABI_PORT", 8777))

GLYPHS: dict[str, dict] = {}     # 大陸筆順：輪廓 + 中線（字根比對靠中線）
TW_STROKES: dict[str, list] = {}  # 台灣教育部筆順：輪廓
_tw_lock = threading.Lock()


def _shorten(code, params):
    """實際要按的碼：超過上限就取前 head 碼 + 末 tail 碼。與 build_rime.shorten、前端 Zigen.shorten 一致。"""
    mx, head, tail = params.get("max", 5), params.get("head", 4), params.get("tail", 1)
    if len(code) <= mx:
        return code
    return code[:head] + (code[-tail:] if tail else "")


def _normalize_finals(data):
    """存檔前把每個字的 final 一律重算成 shorten(code)。
    避免程式化填碼（偏旁批量、git 匯入）留下 null 或舊 max 規則的過時 final。"""
    if not isinstance(data, dict):
        return
    try:
        rules = json.loads(RULES.read_text("utf-8"))
        rule = next((r for r in rules.get("rules", [])
                     if r.get("id") == "max_code_length" and r.get("enabled")), None)
        params = (rule or {}).get("params", {})
    except Exception:
        params = {}
    for v in data.values():
        if isinstance(v, dict) and v.get("code"):
            v["final"] = _shorten(v["code"], params)


def load_glyphs():
    if not GRAPHICS.exists():
        print("!! 缺少 data/graphics.txt")
        return
    with GRAPHICS.open(encoding="utf-8") as f:
        for line in f:
            g = json.loads(line)
            GLYPHS[g["character"]] = {"strokes": g["strokes"], "medians": g["medians"]}
    print(f"筆畫資料（大陸筆順）：{len(GLYPHS)} 字")


IDS: dict[str, str] = {}          # 字 → 部件拆分（⿰言斥）
_ids_lock = threading.Lock()


def ids_map():
    """字的「部件」是結構事實，不該用形狀去猜 ——
    猜的下場：訴 的下半在幾何上很像「下」，就真的被當成部件報出來。
    這裡直接用 makemeahanzi 的 IDS 拆分（訴 = ⿰言斥），第一次用到才載入。"""
    with _ids_lock:
        if not IDS and DICT.exists():
            with DICT.open(encoding="utf-8") as f:
                for line in f:
                    g = json.loads(line)
                    d = g.get("decomposition")
                    if d:
                        IDS[g["character"]] = d
            print(f"部件拆分（IDS）：{len(IDS)} 字")
    return IDS


def tw_strokes():
    """台灣筆順資料 23MB，第一次用到才載入。"""
    with _tw_lock:
        if not TW_STROKES and TW.exists():
            TW_STROKES.update(json.loads(TW.read_text("utf-8")))
            print(f"筆畫資料（台灣教育部）：{len(TW_STROKES)} 字")
    return TW_STROKES


# 兼容字型：地區字形與大陸不同的字。中線比對只有大陸這份有，台灣資料只有輪廓，
# 所以自動偵測靠「筆數不同」這個可靠訊號（同筆數的變體抓不到，得靠人補）。走之底(辶)、
# 阜/邑(阝) 是整批系統性差異，另外標出來，好讓一覽表把它們摺起來、突出真正一字一形的。
_WALK = set("辶辵⻍⻌")            # 走之底：這、過、道…（大陸一點、台灣兩點，筆數差 1）
_MOUND = set("阝⻏⻖")             # 阜/邑旁：都、部、防、阿…


# 取碼進度：從 git 提交歷史重建「每天累計取碼多少字」。歷史只有新提交才變，
# 所以用 HEAD 當快取鍵，只在有新 commit 時重跑那串 git（一次幾十個 git show，~1–2 秒）。
_prog_cache = {"head": None, "days": None}


def _git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args],
                          capture_output=True, text=True, timeout=30)


def _load_s2t():
    try:
        return json.loads(OPENCC.read_text("utf-8")).get("s2t", {})
    except (OSError, json.JSONDecodeError):
        return {}


def _load_t2s():
    try:
        return json.loads(OPENCC.read_text("utf-8")).get("t2s", {})
    except (OSError, json.JSONDecodeError):
        return {}


def _load_jp_kanji():
    try:
        return set(json.loads(JP_KANJI.read_text("utf-8")).get("chars", []))
    except (OSError, json.JSONDecodeError):
        return set()


def _load_simp_only(s2t):
    """簡體專屬字（跟 simp_only_data／build_rime.py 不打簡體同一份定義）：
    s2t 有列、但不是歸併字（后／干／咸…本身也是獨立傳承字）的那些。"""
    dual_use = set()
    if DUAL_USE_MERGED.exists():
        try:
            dual_use = set(json.loads(DUAL_USE_MERGED.read_text("utf-8")).get("chars", []))
        except json.JSONDecodeError:
            pass
    return {c for c in s2t if c not in dual_use}


def _counts(text, simp_only):
    """回傳 (另計, 不另計)：不另計＝繁體字＋傳承字（總數扣掉簡體專屬字）。
    簡體專屬字才是「另外多打的」——傳承字（后／云／咸…）本身就是獨立的字，
    不是簡體，不能扣。"""
    try:
        d = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    coded = {ch for ch, r in d.items() if isinstance(r, dict) and r.get("code")}
    simp = sum(1 for c in coded if c in simp_only)
    return len(coded), len(coded) - simp


def progress_data():
    s2t = _load_s2t()
    simp_only = _load_simp_only(s2t)
    try:
        head = _git("rev-parse", "HEAD")
        if head.returncode != 0:
            raise RuntimeError("not a git repo")
        head = head.stdout.strip()
    except Exception:
        head = None

    if head and _prog_cache["head"] == head and _prog_cache["days"] is not None:
        days = _prog_cache["days"]
    elif head is None:
        days = []
    else:
        log = _git("log", "--reverse", "--format=%H %ad", "--date=short", "--", "data/codes.json")
        day_last, order = {}, []
        for line in log.stdout.splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            h, date = parts[0], parts[1]
            c = _counts(_git("show", f"{h}:data/codes.json").stdout, simp_only)
            if c is None:
                continue
            if date not in day_last:
                order.append(date)
            day_last[date] = c
        days, prev, prevU = [], 0, 0
        for date in order:
            raw, uniq = day_last[date]
            days.append({"date": date, "cum": raw, "cumUniq": uniq,
                         "add": raw - prev, "addUniq": uniq - prevU})
            prev, prevU = raw, uniq
        _prog_cache["head"], _prog_cache["days"] = head, days

    # 目前（含還沒提交的）取碼字數：直接讀工作區的 codes.json
    cur = _counts(CODES.read_text("utf-8"), simp_only) if CODES.exists() else None
    raw, uniq = cur or (days[-1]["cum"] if days else 0, days[-1]["cumUniq"] if days else 0)

    # 繁體／簡體／傳承字各取了多少：只看現在工作區狀態（不進歷史曲線，沒必要跟著
    # 累計圖那套快取邏輯）。三者互斥、加總＝total：
    #   簡體字＝simp_only（純簡化字，跟「碼表分析」排除簡體同一份白名單）
    #   繁體字＝t2s 有列的（本身有對應簡體字的傳承正字，如 國／魚／雲）
    #   傳承字＝其餘（人／三／天／牛這種本來就沒被簡化過的字，加上 云／后／干／咸
    #   這種本身獨立、只是剛好被拿去當簡化目標的傳承字——見 dual_use_merged.json）
    t2s = _load_t2s()
    jp_kanji = _load_jp_kanji()
    total_simp = total_trad = total_jp = 0
    jp_chars = []
    if CODES.exists():
        try:
            coded_map = json.loads(CODES.read_text("utf-8"))
            coded_chars = {c for c, r in coded_map.items()
                           if isinstance(r, dict) and r.get("code")}
            total_simp = sum(1 for c in coded_chars if c in simp_only)
            total_trad = sum(1 for c in coded_chars if c in t2s)
            # 日本漢字：跟上面三個是分開、可能重疊的額外標記，不併入加總
            jp_chars = sorted(c for c in coded_chars if c in jp_kanji)
            total_jp = len(jp_chars)
        except json.JSONDecodeError:
            pass

    return {"days": days, "total": raw, "totalUniq": uniq,
            "totalSimp": total_simp, "totalTrad": total_trad,
            "totalJp": total_jp, "jpChars": jp_chars}


def variants_data():
    tw = tw_strokes()
    ids = ids_map()
    try:
        order = json.loads(FREQ.read_text("utf-8")).get("order", [])
    except (OSError, json.JSONDecodeError):
        order = []
    seen, out = set(), []
    for c in order:
        if c in seen:
            continue
        seen.add(c)
        g = GLYPHS.get(c)
        forms = tw.get(c)
        if not g or not forms:
            continue
        a, b = len(g["strokes"]), len(forms)
        # 差太多不是「另一種字形」，是資料對錯了字（g0v 偶有壞行，如 懂 被記成 32 筆）
        if a == b or abs(a - b) > 8:
            continue
        d = ids.get(c, "")
        grp = ("walk" if any(ch in d for ch in _WALK)
               else "mound" if any(ch in d for ch in _MOUND)
               else "distinct")
        out.append({"c": c, "prc": a, "tw": b, "group": grp})
    return out


def variant_gaps_data():
    """兼容變體缺口，濾掉已補取的（missing 現在已取碼就不再列）。"""
    if not VARIANT_GAPS.exists():
        return {"pairs": []}
    data = json.loads(VARIANT_GAPS.read_text("utf-8"))
    try:
        codes = json.loads(CODES.read_text("utf-8")) if CODES.exists() else {}
    except json.JSONDecodeError:
        codes = {}
    coded = {c for c, v in codes.items() if v.get("code") or v.get("segments")}
    data["pairs"] = [p for p in data.get("pairs", []) if p.get("missing") not in coded]
    return data


def simp_only_data():
    """簡體專屬字（純一對一簡化，如 馬→马）；歸併字（后／干／咸…本身也是獨立傳承字）不算。
    跟 build_rime.py 的「不打簡體」共用同一份白名單（data/dual_use_merged.json）。"""
    if not OPENCC.exists():
        return {"chars": []}
    s2t = json.loads(OPENCC.read_text("utf-8")).get("s2t", {})
    dual_use = set()
    if DUAL_USE_MERGED.exists():
        dual_use = set(json.loads(DUAL_USE_MERGED.read_text("utf-8")).get("chars", []))
    return {"chars": sorted(c for c in s2t if c not in dual_use)}


_predict_cache = None


def assoc_data():
    """智能聯想：字 → 接續建議清單。跟 Squirrel 用同一份官方 librime-predict 資料
    （data/predict.txt，predict.db 的純文字版）——選了直接上屏，不用碼，所以不像
    以前那樣篩「現在打得出來的」；/type 頁面看到的建議跟真正輸入法一致。"""
    global _predict_cache
    if _predict_cache is None:
        _predict_cache = {}
        if PREDICT_TXT.exists():
            pairs = collections.defaultdict(list)
            for line in PREDICT_TXT.read_text("utf-8", "replace").splitlines():
                parts = line.split("\t")
                if len(parts) < 3:
                    continue
                head, cont = parts[0], parts[1]
                try:
                    w = float(parts[2])
                except ValueError:
                    continue
                pairs[head].append((cont, w))
            for head, lst in pairs.items():
                lst.sort(key=lambda x: -x[1])
                _predict_cache[head] = [c for c, _ in lst[:5]]   # 配 Squirrel 的 predictor/max_candidates
    return _predict_cache


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"      # keep-alive：頁面切換時省下重複握手

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # 字形資料是不變的，讓瀏覽器快取；其餘不快取，否則兩頁看不到對方的改動
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _page(self, name):
        self._send(200, (ROOT / name).read_text("utf-8"), "text/html; charset=utf-8")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path in ("/", "/index.html"):
            return self._page("editor.html")
        if u.path == "/annotate":
            return self._page("annotate.html")
        if u.path == "/rules":
            return self._page("rules.html")
        if u.path == "/stats":
            return self._page("stats.html")
        if u.path == "/type":
            return self._page("type.html")      # 試打：真的用愛發筆打字
        if u.path == "/variants":
            return self._page("variants.html")   # 兼容字型一覽：地區字形與大陸不同的字
        if u.path == "/progress":
            return self._page("progress.html")    # 取碼進度：逐日累計曲線

        if u.path.startswith("/assets/") and u.path.endswith(".js"):
            f = (ROOT / u.path.lstrip("/")).resolve()
            if not f.is_file() or ROOT.resolve() not in f.parents:
                return self._send(404, "not found", "text/plain; charset=utf-8")
            return self._send(200, f.read_text("utf-8"), "application/javascript; charset=utf-8")

        if u.path == "/api/zigen":
            return self._send(200, DATA.read_text("utf-8"))
        if u.path == "/api/codes":
            return self._send(200, CODES.read_text("utf-8") if CODES.exists() else "{}")
        if u.path == "/api/rules":
            return self._send(200, RULES.read_text("utf-8") if RULES.exists() else "{}")
        if u.path == "/api/learned":
            return self._send(200, LEARNED.read_text("utf-8") if LEARNED.exists()
                              else '{"stroke_kinds":[]}')
        if u.path == "/api/freq":
            return self._send(200, FREQ.read_text("utf-8"), cache=True)
        if u.path == "/api/cangjie":
            return self._send(200, CANGJIE.read_text("utf-8"), cache=True)
        if u.path == "/api/dayi":
            return self._send(200, DAYI.read_text("utf-8") if DAYI.exists() else '{}', cache=True)
        if u.path == "/api/opencc":
            return self._send(200, OPENCC.read_text("utf-8") if OPENCC.exists() else '{"t2s":{},"s2t":{}}',
                              cache=True)
        if u.path == "/api/simp-only":
            return self._send(200, json.dumps(simp_only_data(), ensure_ascii=False), cache=True)
        if u.path == "/api/assoc":
            return self._send(200, json.dumps(assoc_data(), ensure_ascii=False))
        if u.path == "/api/ids":
            return self._send(200, json.dumps(ids_map(), ensure_ascii=False), cache=True)
        if u.path == "/api/variants":
            return self._send(200, json.dumps(variants_data(), ensure_ascii=False), cache=True)
        if u.path == "/api/variant-gaps":
            return self._send(200, json.dumps(variant_gaps_data(), ensure_ascii=False))
        if u.path == "/api/priority":
            return self._send(200, PRIORITY.read_text("utf-8") if PRIORITY.exists()
                              else '{"order":[]}')
        if u.path == "/api/orderings":
            return self._send(200, ORDERINGS.read_text("utf-8") if ORDERINGS.exists()
                              else '{"news":[],"surname":[],"given":[]}')
        if u.path == "/api/charfreq":
            return self._send(200, CHARFREQ.read_text("utf-8") if CHARFREQ.exists()
                              else '{}', cache=True)
        if u.path == "/api/progress":
            return self._send(200, json.dumps(progress_data(), ensure_ascii=False))
        if u.path == "/api/state":
            # 一律用字串：mtime_ns 是 19 位數，超過 JavaScript 的安全整數範圍，
            # 當成 JSON 數字送出去會被瀏覽器悄悄四捨五入，版本就永遠對不上，
            # 於是每存一次檔都自己跟自己 409。
            stamp = lambda f: str(f.stat().st_mtime_ns) if f.exists() else "0"
            return self._send(200, json.dumps(
                {"zigen": stamp(DATA), "codes": stamp(CODES), "rules": stamp(RULES),
                 "learned": stamp(LEARNED)}))

        if u.path == "/api/cjimg":
            c = (q.get("c") or [""])[0]
            try:
                c = c.encode("latin-1").decode("utf-8")
            except (UnicodeDecodeError, UnicodeEncodeError):
                pass
            try:
                raw = cangjie_map.diagram_bytes(c)
            except Exception:
                raw = None
            if not raw:
                return self._send(404, json.dumps({"error": "no image"}))
            return self._send(200, raw, "image/png", cache=True)

        if u.path == "/api/cjmap":
            c = (q.get("c") or [""])[0]
            try:
                c = c.encode("latin-1").decode("utf-8")
            except (UnicodeDecodeError, UnicodeEncodeError):
                pass
            m = cangjie_map.get(c)
            if not m:
                return self._send(404, json.dumps({"error": "no data", "c": c}))
            return self._send(200, json.dumps({"c": c, **m}, ensure_ascii=False), cache=True)

        if u.path == "/api/hk":
            c = (q.get("c") or [""])[0]
            try:
                c = c.encode("latin-1").decode("utf-8")
            except (UnicodeDecodeError, UnicodeEncodeError):
                pass
            data = hk.get(c)
            if not data:
                return self._send(404, json.dumps({"error": "no data", "c": c}))
            return self._send(200, json.dumps({"c": c, **data}, ensure_ascii=False), cache=True)

        if u.path == "/api/extract":
            url = (q.get("url") or [""])[0]
            try:
                url = url.encode("latin-1").decode("utf-8")
            except (UnicodeDecodeError, UnicodeEncodeError):
                pass
            try:
                text = extract_text.text_from_url(url)
            except Exception as e:
                return self._send(400, json.dumps({"error": str(e)}, ensure_ascii=False))
            return self._send(200, json.dumps({"text": text}, ensure_ascii=False))

        if u.path in ("/api/glyph", "/api/tw"):
            c = (q.get("c") or [""])[0]
            table = GLYPHS if u.path == "/api/glyph" else tw_strokes()
            # http.server 把請求行當 latin-1 解，未經百分號編碼的中文要救回來
            if c and c not in table:
                try:
                    c = c.encode("latin-1").decode("utf-8")
                except (UnicodeDecodeError, UnicodeEncodeError):
                    pass
            g = table.get(c)
            if g is None:
                return self._send(404, json.dumps({"error": "no data", "c": c}), cache=True)
            body = {"c": c, **g} if isinstance(g, dict) else {"c": c, "strokes": g}
            return self._send(200, json.dumps(body, ensure_ascii=False), cache=True)

        self._send(404, "not found", "text/plain; charset=utf-8")

    def do_PUT(self):
        path = urlparse(self.path).path
        target = {"/api/zigen": (DATA, "zigen"),
                  "/api/codes": (CODES, "codes"),
                  "/api/rules": (RULES, "rules"),
                  "/api/learned": (LEARNED, "learned")}.get(path)
        if not target:
            return self._send(404, json.dumps({"error": "not found"}))
        dest, stem = target

        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            return self._send(400, json.dumps({"error": str(e)}))

        # 樂觀鎖：分頁送出它「讀到的版本」，若檔案在那之後被別人改過就擋下來。
        # 不然一個開著舊資料的分頁，autosave 一下就把別處的修改整個蓋掉。
        base = self.headers.get("X-Base-Stamp")
        now = str(dest.stat().st_mtime_ns) if dest.exists() else "0"
        if base and base != now:
            return self._send(409, json.dumps({
                "error": "stale", "current": now,
                "message": "檔案已被別的分頁或程式改過"}))

        # codes.json：存檔前一律讓 final == shorten(code)，程式化填碼也擋得住
        if stem == "codes":
            _normalize_finals(data)

        BACKUPS.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            shutil.copy2(dest, BACKUPS / f"{stem}-{stamp}.json")
            for old in sorted(BACKUPS.glob(f"{stem}-*.json"))[:-200]:
                old.unlink()

        dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # 把寫入後的新版本回給前端 —— 前端若自己再去 /api/state 撈，
        # 併發寫入時會撈到另一個檔案「還沒寫完」的舊值，下次存檔就自己跟自己 409。
        self._send(200, json.dumps({"ok": True, "stamp": str(dest.stat().st_mtime_ns)}))

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    load_glyphs()
    print(f"資料目錄：{DATA_DIR}")
    print(f"愛發筆  →  http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
