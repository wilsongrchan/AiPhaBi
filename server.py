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
  /api/cjmap?c=字   GET      倉頡「哪一筆屬於哪一碼」（見 cangjie_map.py）
  /api/cjimg?c=字   GET      倉頡拆碼圖（倉頡字典.com，隨用隨抓並快取）
  /api/state        GET      各檔 mtime，兩頁靠它互通
"""
import json
import os
import shutil
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cangjie_map
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
TW = SHARED / "tw_strokes.json"
CANGJIE = SHARED / "cangjie.json"
PORT = int(os.environ.get("AIPHABI_PORT", 8777))

GLYPHS: dict[str, dict] = {}     # 大陸筆順：輪廓 + 中線（字根比對靠中線）
TW_STROKES: dict[str, list] = {}  # 台灣教育部筆順：輪廓
_tw_lock = threading.Lock()


def load_glyphs():
    if not GRAPHICS.exists():
        print("!! 缺少 data/graphics.txt")
        return
    with GRAPHICS.open(encoding="utf-8") as f:
        for line in f:
            g = json.loads(line)
            GLYPHS[g["character"]] = {"strokes": g["strokes"], "medians": g["medians"]}
    print(f"筆畫資料（大陸筆順）：{len(GLYPHS)} 字")


def tw_strokes():
    """台灣筆順資料 23MB，第一次用到才載入。"""
    with _tw_lock:
        if not TW_STROKES and TW.exists():
            TW_STROKES.update(json.loads(TW.read_text("utf-8")))
            print(f"筆畫資料（台灣教育部）：{len(TW_STROKES)} 字")
    return TW_STROKES


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
        if u.path == "/api/state":
            stamp = lambda f: f.stat().st_mtime_ns if f.exists() else 0
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

        BACKUPS.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            shutil.copy2(dest, BACKUPS / f"{stem}-{stamp}.json")
            for old in sorted(BACKUPS.glob(f"{stem}-*.json"))[:-200]:
                old.unlink()

        dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self._send(200, json.dumps({"ok": True}))

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    load_glyphs()
    print(f"資料目錄：{DATA_DIR}")
    print(f"愛發筆  →  http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
