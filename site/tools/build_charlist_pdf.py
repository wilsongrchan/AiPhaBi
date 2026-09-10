#!/usr/bin/env python3
"""產生〈常用字表 PDF〉頁（changyongzi.html）內嵌／可下載的那份 PDF：
    site/assets/downloads/changyongzi.pdf

「只打常用字」開啟時選字列會保留的那批字，分門別類列一遍。刻意樸素——
一個字一格、內建 sans 字型——給想確認「我要打的字會不會被濾掉」的人一份
可以搜、可以印的東西。

字的**集合**以 site/assets/charset.json 的 common 為準（build_site_data.py
從 rime/lua/aiphabi_data.lua 抄的，跟輸入法實際在用的同一份）。這裡多做兩件事：

  1. 分類：甲表 / GB 2312 一級 / 常用粵語字 / 百家姓 / 常用取名用字 / 其他，
     各自一節、標出字數。分類**不互斥**（大部分姓氏也在甲表），每節列出該類
     的全部，不是「扣掉前面的」——只有最後「其他」那節是收尾用的差集。
  2. 甲表與 GB 一級兩節再依**注音**（ㄅㄆㄇ…）分小節，仿台灣甲表的編排習慣。
     注音由 pypinyin 取（多音字取第一個讀音）。

分類清單來源：
    甲表          data/standards/tw_common_4808.txt
    GB 2312 一級  data/standards/gb2312.txt 的前 3755 字（拼音序那一段）
    常用粵語字     data/standards/canton_common.txt
    百家姓        data/standards/baijiaxing.txt
    常用取名用字   site/assets/try.js 的 NAME_MALE ／ NAME_FEMALE（跟〈線上試打〉
                  自由試打那一排字卡同一份，_name_chars() 也讀這裡）
    其他          common 裡以上都沒收到的字（含 common_extra.txt、常見異體、
                  精選詞庫用字…那些沒有獨立清單檔的來源）

⚠️ 跟 build_pdf.py 一樣：**手動跑、產出直接進版控**（CI 不跑這支）。
common 變了、甲表清單更新了、或 try.js 的名字清單改了，就要重跑、重新提交。

    pip3 install pymupdf pypinyin
    python3 site/tools/build_site_data.py       # 先確保 charset.json 是新的
    python3 site/tools/build_charlist_pdf.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHARSET = ROOT / "site" / "assets" / "charset.json"
STD = ROOT / "data" / "standards"
TRY_JS = ROOT / "site" / "assets" / "try.js"
OUT = ROOT / "site" / "assets" / "downloads" / "changyongzi.pdf"

PAGE_W, PAGE_H = 595.0, 842.0
ML, MR, MT, MB = 42.0, 42.0, 46.0, 30.0
COLS = 26
CELL = (PAGE_W - ML - MR) / COLS
ROW_H = 18.5
CHAR_SIZE = 12.5
TITLE = "愛發筆輸入法　常用字表"

# 注音起首符號的標準排序
BOPO_INITIALS = list("ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ")

# 字型全用 PyMuPDF 內建的 CJK sans（Droid Sans Fallback，不必內嵌系統字、不綁
# 平台）。但要分兩款：
#   china-ts（繁）——甲表／粵語／姓氏／取名／其他這些繁體字身走這款
#   china-s（簡）——GB 2312 一級是簡化字，china-ts 走 insert_text 時會**默默
#                  不畫**近千個簡化字（欄位照移，字表出現一格格空洞），china-s
#                  對這 3755 字則零缺字（實測）
FONT_TRAD = "china-ts"
FONT_SIMP = "china-s"


def _cjk_list(text):
    out = []
    for c in text:
        o = ord(c)
        if 0x3400 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x2FA1F:
            out.append(c)
    return out


def _file_chars(name):
    p = STD / name
    if not p.is_file():
        return []
    body = "\n".join(l for l in p.read_text("utf-8").splitlines() if not l.startswith("#"))
    return _cjk_list(body)


def _name_chars(var):
    if not TRY_JS.is_file():
        return []
    m = re.search(r"var\s+%s\s*=\s*'([^']*)'" % var, TRY_JS.read_text("utf-8"))
    return _cjk_list(m.group(1)) if m else []


def _bopo(pinyin_fn, ch):
    try:
        from pypinyin import Style
        r = pinyin_fn(ch, style=Style.BOPOMOFO, errors="ignore")
        return r[0][0] if r and r[0] else ""
    except Exception:
        return ""


def _dedup_keep_order(seq):
    seen, out = set(), []
    for c in seq:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


class Flow:
    """從上到下擺內容的簡單版面引擎：section 標題、注音小標、一格一個字的方陣。"""

    def __init__(self, doc):
        import pymupdf as fitz
        self.fitz = fitz
        self.doc = doc
        self.page = None
        self.y = 0.0
        self._new_page()

    def _new_page(self):
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.y = MT

    def _room(self, h):
        if self.y + h > PAGE_H - MB:
            self._new_page()

    def title(self, text, subtitle):
        self.page.insert_text((ML, self.y + 15), text, fontname="china-ts",
                              fontsize=17, color=(0.1, 0.1, 0.1))
        self.y += 26
        self.page.insert_text((ML, self.y + 9), subtitle, fontname="china-ts",
                              fontsize=8.5, color=(0.42, 0.42, 0.42))
        self.y += 24

    def section(self, text):
        self._room(40)
        self.y += 14
        self.page.draw_line((ML, self.y), (PAGE_W - MR, self.y),
                            color=(0.75, 0.75, 0.75), width=0.6)
        self.y += 4
        self.page.insert_text((ML, self.y + 11), text, fontname="china-ts",
                              fontsize=12, color=(0.12, 0.12, 0.12))
        self.y += 20

    def subhead(self, text):
        self._room(ROW_H + 16)
        self.y += 6
        self.page.insert_text((ML, self.y + 8.5), text, fontname="china-ts",
                              fontsize=9, color=(0.055, 0.486, 0.451))
        self.y += 13

    def grid(self, chars, font=FONT_TRAD):
        col = 0
        for ch in chars:
            if col == 0:
                self._room(ROW_H)
            x = ML + col * CELL + (CELL - CHAR_SIZE) / 2
            self.page.insert_text((x, self.y + CHAR_SIZE), ch, fontname=font,
                                  fontsize=CHAR_SIZE, color=(0.13, 0.13, 0.13))
            col += 1
            if col == COLS:
                col = 0
                self.y += ROW_H
        if col:
            self.y += ROW_H

    def footers(self):
        total = len(self.doc)
        for n, page in enumerate(self.doc, start=1):
            foot = f"{n} / {total}"
            tw = self.fitz.get_text_length(foot, fontname="helv", fontsize=8)
            page.insert_text(((PAGE_W - tw) / 2, PAGE_H - 16), foot,
                             fontname="helv", fontsize=8, color=(0.5, 0.5, 0.5))


def build():
    try:
        import pymupdf as fitz
    except ImportError:
        try:
            import fitz
        except ImportError:
            sys.exit("沒裝 pymupdf —— 跑：pip3 install pymupdf")
    try:
        from pypinyin import pinyin as pinyin_fn, Style
    except ImportError:
        sys.exit("沒裝 pypinyin —— 跑：pip3 install pypinyin")

    def _pyletter(ch):
        r = pinyin_fn(ch, style=Style.NORMAL, errors="ignore")
        s = r[0][0] if r and r[0] else ""
        return s[0].upper() if s and s[0].isascii() and s[0].isalpha() else None

    if not CHARSET.is_file():
        sys.exit("找不到 site/assets/charset.json —— 先跑 python3 site/tools/build_site_data.py")

    common = set(json.loads(CHARSET.read_text("utf-8"))["common"])
    incommon = lambda seq: [c for c in _dedup_keep_order(seq) if c in common]

    jiabiao = incommon(_file_chars("tw_common_4808.txt"))
    gb1 = incommon(_file_chars("gb2312.txt")[:3755])
    canton = incommon(_file_chars("canton_common.txt"))
    baijia = incommon(_file_chars("baijiaxing.txt"))
    names = incommon(_name_chars("NAME_MALE") + _name_chars("NAME_FEMALE"))

    covered = set(jiabiao) | set(gb1) | set(canton) | set(baijia) | set(names)
    rest = sorted(common - covered)

    # 注音分組
    def by_bopo(chars):
        buckets = {k: [] for k in BOPO_INITIALS}
        other = []
        for c in chars:
            b = _bopo(pinyin_fn, c)
            key = b[0] if b and b[0] in buckets else None
            (buckets[key] if key else other).append(c)
        for k in buckets:
            buckets[k].sort(key=lambda c: (_bopo(pinyin_fn, c), c))
        return buckets, other

    doc = fitz.open()
    flow = Flow(doc)
    flow.title(TITLE,
               f"「只打常用字」開啟時選字列保留的字，共 {len(common)} 個。分類不互斥"
               f"（多數姓氏亦在甲表），各節列出該類全部。")

    def bopo_section(title, chars):
        flow.section(f"{title}（{len(chars)} 字）")
        buckets, other = by_bopo(chars)
        for k in BOPO_INITIALS:
            if buckets[k]:
                flow.subhead(f"{k}（{len(buckets[k])}）")
                flow.grid(buckets[k])
        if other:
            flow.subhead(f"查無注音（{len(other)}）")
            flow.grid(other)

    def pinyin_section(title, chars, note=""):
        # GB 2312 一級漢字本來就是拼音序（檔案裡的順序），完全**照它排**、不重排，
        # 只在拼音首字母往前推進時（A→B→C…）插一個小標當索引。字身用 china-s。
        #
        # 每個字的「主小標」＝它前後共 5 個字的 pypinyin 首字母多數決——用鄰居
        # 蓋掉單字誤判，early-in-a-run 的字也不會被往後拉。多音字（畜 xù／chù、
        # 厦 shà／xià、长 cháng／zhǎng…）除了排在它 GB 位置的主小標，另一個常用
        # 讀音的首字母那一節也**再收一次**（Wilson），該節字數標「其中 N 字為
        # 多音字重複收錄」。
        AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        rank = lambda k: AZ.index(k) if k and k in AZ else -1
        letters = [_pyletter(c) for c in chars]

        def stable(i):
            win = [x for x in letters[max(0, i - 2):i + 3] if x]
            return max(win, key=win.count) if win else None

        groups = {}        # 主小標 -> [字]（檔案順序）
        extras = {}        # 小標 -> [多音字]（另一讀音落在這裡）
        cur = None
        for i, c in enumerate(chars):
            k = stable(i)
            if k and rank(k) > rank(cur):
                cur = k
            groups.setdefault(cur, []).append(c)
            alt = letters[i]
            if alt and alt != cur and alt in AZ:
                extras.setdefault(alt, []).append(c)

        flow.section(f"{title}（{len(chars)} 字{('，' + note) if note else ''}）")
        for L in AZ:
            base = groups.get(L, [])
            ex = extras.get(L, [])
            if not base and not ex:
                continue
            head = f"{L}（{len(base) + len(ex)} 字"
            if ex:
                head += f"，其中 {len(ex)} 字為多音字重複收錄"
            head += "）"
            flow.subhead(head)
            flow.grid(base + ex, font=FONT_SIMP)

    def flat_section(title, chars, note=""):
        label = f"{title}（{len(chars)} 字{('，' + note) if note else ''}）"
        flow.section(label)
        flow.grid(chars)

    bopo_section("一、教育部《常用國字標準字體表》甲表", jiabiao)
    pinyin_section("二、GB 2312 一級漢字", gb1, note="拼音序")
    flat_section("三、常用粵語字", canton)
    flat_section("四、百家姓", baijia)
    flat_section("五、常用取名用字", names, note="男名／女名，跟〈線上試打〉那一排字卡同一份")
    flat_section("六、其他", rest, note="前五類未收、但仍在名單裡的字")

    flow.footers()
    pages = len(doc)
    # 每頁都 insert_font 一次同一個 CJK 檔，不 subset 的話整份會 10 MB 以上。
    # subset_fonts()：合併重複、只留真的用到的字身，砍到 1 MB 上下。
    try:
        doc.subset_fonts()
    except Exception as e:
        print(f"  ⚠️ subset_fonts 失敗（{e}）——檔案會偏大")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT), deflate=True, garbage=4)
    doc.close()
    kb = OUT.stat().st_size / 1024
    print(f"寫出：{OUT.relative_to(ROOT)}"
          f"（{len(common):,} 字 / {pages} 頁 / {kb:.0f} KB）")
    print(f"  甲表 {len(jiabiao)}、GB一級 {len(gb1)}、粵語 {len(canton)}、"
          f"百家姓 {len(baijia)}、取名 {len(names)}、其他 {len(rest)}")


if __name__ == "__main__":
    build()
