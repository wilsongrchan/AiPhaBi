#!/usr/bin/env python3
"""把每一頁的章節清單抽成一份 site/assets/nav.json。

手機版的選單要讓**每一條**有章節的連結都能就地展開（Wilson 2026-09-03：
「if they click that button then it expands, otherwise, if they click the
heading directly, it should navigate」）。可是十二頁的 <nav> 裡各自只寫著
**自己**那一頁的 <ul class="pr-sidenav">，一頁不知道別頁有哪些章節。

三條路：把六份清單複製到十二個檔案裡（會走味）、在 site.js 裡寫死一張表
（同樣會走味）、或是建置時掃一遍現成的 HTML。這裡走第三條 —— 資料只有一份，
就是各頁自己那份 pr-sidenav，抽出來給選單用，不可能對不上。

輸出：{"yuanze.html": [["#pr-1", "1. 筆順"], ...], ...}
"""
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
OUT = SITE / "assets" / "nav.json"

UL = re.compile(r'<ul class="pr-sidenav">(.*?)</ul>', re.S)
LI = re.compile(r'<li><a href="(#[^"]+)">(.*?)</a></li>', re.S)
TAG = re.compile(r"<[^>]+>")


def main():
    out = {}
    for page in sorted(SITE.glob("*.html")):
        m = UL.search(page.read_text("utf-8"))
        if not m:
            continue
        items = [[h, html.unescape(TAG.sub("", t)).strip()]
                 for h, t in LI.findall(m.group(1))]
        if items:
            out[page.name] = items
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"  nav.json：{len(out)} 頁、{sum(len(v) for v in out.values())} 條章節")


if __name__ == "__main__":
    main()
