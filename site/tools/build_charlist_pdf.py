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
     注音由 pypinyin 取。GB 一級那節的多音字，另一讀音那組會多一格「重出」
     （字母下點一個小點、依讀音插在該到的位置），不計字數。每頁右上角列出本頁
     涵蓋的注音／字母（仿〈字根表〉PDF）。

分類清單來源：
    甲表          data/standards/tw_common_4808.txt
    GB 2312 一級  data/standards/gb2312.txt 的前 3755 字（拼音序那一段）
    常用粵語字     本檔的 CANTON_GROUPS（Wilson 手挑、依部首分堆的定稿；
                  比 data/standards/canton_common.txt 少幾個生僻字）
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
import io
import json
import math
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
BRAND = "愛發筆輸入法"
TITLE_REST = "常用字表"

# 頁首右上角那個「本頁涵蓋範圍」標籤用的短分類名（仿〈字根表〉PDF）
SECTION_CATS = {"一": "甲表", "二": "GB", "三": "粵語", "四": "百家姓", "五": "取名", "六": "其他"}

# 注音起首符號的標準排序
BOPO_INITIALS = list("ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ")

# 常用粵語字——Wilson 手挑、手分組的定稿（2026-09-10）。大致依部首歸堆
# （口／人／目・言／手／水／火／…），每一堆在 PDF 裡另起一行。用這份的順序
# 排，不重排。data/standards/canton_common.txt（餵輸入法白名單那份）比這裡多
# 收幾個更生僻的（嚡 攋 嗮 掕 咔 呦），那幾個會落到「其他」節。
CANTON_GROUPS = [
    list("吖呃呔咗咁咩咧咯唞啲啡啋喎啩喵啵喏㗎喺喇喔嘅嗰嗌嗒嗲嘥嗟嘢嘞嘈嘜嘑嘟嘛噏嘭嚟嚫嚦嚹嚿囉"),
    list("佢冇冚冧攰"),
    list("睇瞓諗"),
    list("拎拗拃掂掗揸揀揈搲揦搣撩撳揗摷攞"),
    list("氹淰湴潲"),
    list("焗焫煀燶"),
    list("嬲郁慳錫"),
    list("埞孭罅窿"),
    list("靚餸髀齙"),
]

# 「其他」節——前五類沒收、但仍在 M.common 名單裡的字（多半是 codes.json 裡
# 某個核心字的簡化形，經「常見異體」那條規則收進來的）。Wilson 手挑、依部首
# 分堆的定稿（2026-09-10），每堆在 PDF 裡另起一行。名單裡漏掉、但 rest 實際有
# 的字，就近塞進同部首那一行，塞不進去的（㠯 龹 龺）擺最後一行。build() 會再對
# rest 做一次差集當防呆，真有遺漏會補在最末行。Side B 若把某字列進
# common_exclude.txt（薹 鄖 榘 彔 査 輥…），它就不在 rest 裡，這裡列著也會被
# 濾掉——順手從下面拿掉即可。
OTHER_GROUPS = [
    list("丂丄丌丨丬丶丼丿乂乛亠"),
    list("亵亻亼仝仨佈佼侷兖"),
    list("冂冎冖冪冫"),
    list("凵刂剉剮劊勹匚卩厶叻"),
    list("呦咔唑唭啓喆嗮噁噌噻嚡囗圜"),
    list("埗埼墘"),
    list("夂婭媧嫚嫺嬅孃"),
    list("宀崗幺廄廴廾"),
    list("彐彡彳"),
    list("忄忐忑忒忡"),
    list("扌扞掕掰搧摁摳摻撣撾擯攢攋"),
    list("攵旻昱曇曬"),
    list("柾栃栢槿樑檯"),
    list("氵汶洩洵淦淩淼滷漚潟澇濕濰"),
    list("灬烴煲熒燁燼"),
    list("爲爿犭猢猻獼"),
    list("珅甯町"),
    list("疒癟癡癰"),
    list("眈硤碁磡"),
    list("礻禛禰"),
    list("糹纟絛綫緹繮繳纍纔"),
    list("罒翦"),
    list("耂肽腓腩舖"),
    list("舘艷"),
    list("艹芷芸苷荃蒨薦"),
    list("虍蟄衆衊衕"),
    list("衤衹裏"),
    list("讠誹謅謾譭讕"),
    list("蹟躥"),
    list("辶邨鄲"),
    list("钅釒釩釺鈎鉅鉉鉚銑銹鋇鋌鎬鐐"),
    list("阝陞"),
    list("飠饣餚餬饋"),
    list("酯閹歎殭氈竈筲粿糰覈顥顴馗鰂鵰鷄鹵齧"),
]

# 《百家姓》宋本的複姓（雙字姓）。baijiaxing.txt 的複姓段把共用的首字（公冶／
# 公孫／公羊 的「公」）省成一個，逐字讀會錯位，Wilson 看到「軒轅」「令狐」被
# 欄縫切開。這裡按完整雙字重排，PDF 裡每個複姓當一個不可切的單位。
BAIJIA_COMPOUND = [
    "萬俟", "司馬", "上官", "歐陽", "夏侯", "諸葛", "聞人", "東方", "赫連", "皇甫",
    "尉遲", "公羊", "澹台", "公冶", "宗政", "濮陽", "淳于", "單于", "太叔", "申屠",
    "公孫", "仲孫", "軒轅", "令狐", "鍾離", "宇文", "長孫", "慕容", "鮮于", "閭丘",
    "司徒", "司空", "亓官", "司寇", "仉督", "子車", "顓孫", "端木", "巫馬", "公西",
    "漆雕", "樂正", "壤駟", "公良", "拓跋", "夾谷", "宰父", "穀梁", "晉楚", "閆法",
    "汝鄢", "涂欽", "段干", "百里", "東郭", "南門", "呼延", "歸海", "羊舌", "微生",
    "岳帥", "緱亢", "況郈", "有琴", "梁丘", "左丘", "東門", "西門", "商牟", "佘佴",
    "伯賞", "南宮", "墨哈", "譙笪", "年愛", "陽佟", "第五", "言福",
]

# 字身用 PyMuPDF 內建的 CJK sans（Droid Sans Fallback，不必內嵌系統字、不綁
# 平台）。全部走 china-s 這一款：它繁簡都收（繁體碼位給繁體字形，實測 說車馬龍
# 國學鐵譽廣關 都對），對整份 6,500 字只有 4 個字畫不出來。相對地 china-ts 走
# insert_text 會**默默不畫**近千個簡化字（欄位照移、字表出現一格格空洞），不能用。
FONT = "china-s"

# china-s 畫不出來的字（實測：字碼有進去、欄位照移，但完全沒有墨）：
#   㗎 U+35CE  粵語句末助詞，Wilson 粵語表裡就有，不能空 → 內嵌 STHeiti 補畫
#   ㄧ U+3127  注音符號「一」，甲表 y 起首那節的小標會用到 → 同樣走 STHeiti
#   㠯 U+382F、龹 U+9FB9、龺 U+9FBA  三個罕見部件；STHeiti 有字身但畫出來像
#     「巳 / 关 / 卓」，簡體樣子擺在繁體表裡反而誤導 → 直接不列，另在節末註明
FALLBACK = "STHeiti"
FALLBACK_FILE = "/System/Library/Fonts/STHeiti Medium.ttc"
FALLBACK_CHARS = set("㗎ㄧ")
DROP_CHARS = set("㠯龹龺")


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


_LOGO_CACHE = {}


def _logo_stream(px):
    """把 logo-512.png 攤平在白底、用 Lanczos 縮到 px 見方，回傳 PNG bytes。
    直接把 512px 的半透明 PNG 塞進小方框，PyMuPDF 縮出來邊緣會糊、會有雜點
    （Wilson 說「blotchy、邊緣怪怪的」）。沒有 Pillow 就回 None，title() 改走純文字。"""
    if px in _LOGO_CACHE:
        return _LOGO_CACHE[px]
    src = ROOT / "site" / "assets" / "img" / "logo-512.png"
    out = None
    if src.is_file():
        try:
            from PIL import Image
            im = Image.open(src).convert("RGBA")
            bg = Image.new("RGB", im.size, "white")
            bg.paste(im, mask=im.split()[3])
            bg = bg.resize((px, px), Image.LANCZOS)
            buf = io.BytesIO()
            bg.save(buf, "PNG")
            out = buf.getvalue()
        except Exception:
            out = None
    _LOGO_CACHE[px] = out
    return out


class Flow:
    """從上到下擺內容的簡單版面引擎：section 標題、注音小標、一格一個字的方陣。"""

    def __init__(self, doc):
        import pymupdf as fitz
        self.fitz = fitz
        self.doc = doc
        self.page = None
        self.y = 0.0
        self._fb = pathlib.Path(FALLBACK_FILE).exists()
        self._cat = None          # 目前所在的分類短名
        self._marks = []          # (頁碼, 分類, 小標) —— 給頁首右上角的範圍標籤
        self._new_page()

    def _new_page(self):
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        if self._fb:
            try:
                self.page.insert_font(fontname=FALLBACK, fontfile=FALLBACK_FILE)
            except Exception:
                pass
        self.y = MT

    def _room(self, h):
        if self.y + h > PAGE_H - MB:
            self._new_page()

    def _text(self, xy, s, size, color, bold=False):
        """一行混排字。逐字挑字型：
          ・ASCII（數字、半形標點、空格）走 helv／hebo —— china-s 會把它們畫成
            全形，數字之間、字數後面就多出一大塊空白（Wilson 指出的「weird spaces」）
          ・china-s 畫不出的 4 個字走內嵌的 STHeiti
          ・其餘 CJK 走 china-s
        bold＝再錯開 0.3pt 疊一次（內建 CJK 無粗體，這是假粗）。"""
        x, y = xy
        for ch in s:
            o = ord(ch)
            if 0x20 <= o <= 0x7E:
                fn = "hebo" if bold else "helv"
                self.page.insert_text((x, y), ch, fontname=fn, fontsize=size, color=color)
                x += self.fitz.get_text_length(ch, fontname=fn, fontsize=size)
                continue
            fn = FALLBACK if (self._fb and ch in FALLBACK_CHARS) else FONT
            self.page.insert_text((x, y), ch, fontname=fn, fontsize=size, color=color)
            if bold:
                self.page.insert_text((x + 0.3, y), ch, fontname=fn,
                                      fontsize=size, color=color)
            x += self.fitz.get_text_length(ch, fontname=FONT, fontsize=size)
        return x

    def title(self, brand, rest, subtitle):
        top = self.y
        x = ML
        s = 19.0
        logo = _logo_stream(round(s * 4))       # 先在白底攤平＋高品質縮到 4×
        if logo is not None:
            try:
                self.page.insert_image(self.fitz.Rect(x, top, x + s, top + s), stream=logo)
                x += s + 7
            except Exception:
                pass
        x = self._text((x, top + 15.5), brand, 17, (0.1, 0.1, 0.1), bold=True)
        self._text((x + 6, top + 15.5), rest, 17, (0.28, 0.28, 0.28))
        self.y = top + 26
        self._text((ML, self.y + 9), subtitle, 8.5, (0.42, 0.42, 0.42))
        self.y += 24

    def section(self, text):
        self._room(40)
        self._cat = SECTION_CATS.get(text[:1], text[:1])
        self._marks.append((len(self.doc) - 1, self._cat, None))
        self.y += 14
        self.page.draw_line((ML, self.y), (PAGE_W - MR, self.y),
                            color=(0.75, 0.75, 0.75), width=0.6)
        self.y += 4
        self._text((ML, self.y + 11), text, 12, (0.12, 0.12, 0.12))
        self.y += 20

    def subhead(self, text, sub=None):
        self._room(ROW_H + 16)
        if sub:
            self._marks.append((len(self.doc) - 1, self._cat, sub))
        self.y += 6
        self._text((ML, self.y + 8.5), text, 9, (0.055, 0.486, 0.451))
        self.y += 13

    def _cell(self, x, y_top, ch, anno=None, dup=False):
        """在 (x, y_top) 這一格畫一個字，x 是格子左緣。
        anno＝右上角一個小綠字母，指這個多音字另一個讀音落在哪一組。
        dup=True＝這格是同一個多音字在該讀音組的「重出」（本尊、字數都算在
        anno 指的那組）：字母下面點一個小點。"""
        fn = FALLBACK if (self._fb and ch in FALLBACK_CHARS) else FONT
        self.page.insert_text((x + (CELL - CHAR_SIZE) / 2, y_top + CHAR_SIZE), ch,
                              fontname=fn, fontsize=CHAR_SIZE, color=(0.13, 0.13, 0.13))
        if anno:
            green = (0.055, 0.486, 0.451)
            ax = x + CELL - 3.4
            ay = y_top + 4.6
            self.page.insert_text((ax, ay), anno, fontname="hebo", fontsize=5.6, color=green)
            if dup:
                self.page.draw_circle((ax + 1.5, ay + 1.7), 0.72,
                                      color=green, fill=green, width=0.3)

    def grid(self, chars, annos=None):
        annos = annos or {}
        self.grid_cells([(c, annos.get(c), False) for c in chars])

    def grid_cells(self, items):
        """items＝(字, anno 或 None, dup 布林) 的序列，26 格一列。"""
        col = 0
        for ch, anno, dup in items:
            if col == 0:
                self._room(ROW_H)
            self._cell(ML + col * CELL, self.y, ch, anno, dup)
            col += 1
            if col == COLS:
                col = 0
                self.y += ROW_H
        if col:
            self.y += ROW_H

    def grid_units(self, units, per_row=5, unit_gap=None, tight=False):
        """一個 unit（1–4 個字）當一個不可切的整體畫。《百家姓》用。
        tight=False：unit 內每字佔一格（單姓四字一句照原文韻腳）。
        tight=True：unit 內兩字緊貼、不留格（複姓「司馬」不寫成「司　馬」，省寬）。"""
        gap = CELL * 0.55 if unit_gap is None else unit_gap
        step = CHAR_SIZE * 1.04 if tight else CELL
        for r in range(0, len(units), per_row):
            self._room(ROW_H)
            x = ML
            for u in units[r:r + per_row]:
                for ch in u:
                    off = 0 if tight else (CELL - CHAR_SIZE) / 2
                    fn = FALLBACK if (self._fb and ch in FALLBACK_CHARS) else FONT
                    self.page.insert_text((x + off, self.y + CHAR_SIZE), ch, fontname=fn,
                                          fontsize=CHAR_SIZE, color=(0.13, 0.13, 0.13))
                    x += step
                x += gap
            self.y += ROW_H

    def multi_col(self, groups, ncols=2, subcols=13, row_h=None):
        """把一串「部首堆」排成 ncols 直欄（每欄 subcols 格寬），高度盡量均分。
        〈其他〉節用，塞得進一頁——這節是密排的檢索表，行距收一點（row_h 預設
        比一般列矮 2pt）才擠得下同一頁。堆內滿 subcols 換行，每堆一定另起一行。"""
        rh = ROW_H - 2.0 if row_h is None else row_h
        grouprows = []
        for g in groups:
            rows = [g[i:i + subcols] for i in range(0, len(g), subcols)] or [[]]
            grouprows.append(rows)
        total = sum(len(r) for r in grouprows)
        per_col = max(1, math.ceil(total / ncols))
        self._room(per_col * rh)
        y0 = self.y
        colw = (PAGE_W - ML - MR) / ncols
        col, yrow = 0, 0
        for rows in grouprows:
            if yrow and yrow + len(rows) > per_col and col < ncols - 1:
                col += 1
                yrow = 0
            for r in rows:
                x = ML + col * colw
                for ch in r:
                    self._cell(x, y0 + yrow * rh, ch)
                    x += CELL
                yrow += 1
        last = yrow if col == ncols - 1 else per_col
        self.y = y0 + max(1, last) * rh

    def running_header(self, text):
        """第 2 頁起，頁首放一行小小的「愛發筆輸入法　常用字表」。第 1 頁有大標題
        就不放。"""
        for n, page in enumerate(self.doc):
            if n == 0:
                continue
            logo = _logo_stream(36)
            x = ML
            if logo is not None:
                try:
                    page.insert_image(self.fitz.Rect(x, 20, x + 9, 29), stream=logo)
                    x += 12
                except Exception:
                    pass
            for ch in text:
                fn = FALLBACK if (self._fb and ch in FALLBACK_CHARS) else FONT
                page.insert_text((x, 28), ch, fontname=fn, fontsize=7.5,
                                 color=(0.55, 0.55, 0.55))
                x += self.fitz.get_text_length(ch, fontname=FONT, fontsize=7.5)
            page.draw_line((ML, 33), (PAGE_W - MR, 33), color=(0.86, 0.86, 0.86), width=0.4)

    def _fmt_coverage(self, seq):
        """seq＝依閱讀順序的 (分類, 小標) 串，壓成「甲表 ㄍ ㄎ ㄏ ㄐ ㄑ　GB A B C」
        這種標籤——把本頁涵蓋的每個小標都列出來（不用 X-Y 區間，中間隔了誰不
        直覺）。"""
        out, i = [], 0
        while i < len(seq):
            cat = seq[i][0]
            subs = []
            while i < len(seq) and seq[i][0] == cat:
                s = seq[i][1]
                if s and (not subs or subs[-1] != s):
                    subs.append(s)
                i += 1
            if subs:
                out.append(f"{cat} " + " ".join(subs))
            elif cat:
                out.append(cat)
        return "　".join(out)

    def coverage_labels(self):
        """每頁右上角標一行「本頁涵蓋範圍」（仿〈字根表〉PDF）。範圍＝這頁開頭
        還在延續的那段，加上這頁裡新起的每個 section／小標。"""
        by_page = {}
        for pg, cat, sub in self._marks:
            by_page.setdefault(pg, []).append((cat, sub))
        carry = None
        for n, page in enumerate(self.doc):
            here = by_page.get(n, [])
            seq = ([carry] if carry else []) + here
            if here:
                carry = here[-1]
            label = self._fmt_coverage(seq)
            if not label:
                continue
            tw = sum(self.fitz.get_text_length(
                ch, fontname=("helv" if ord(ch) <= 0x7E else FONT), fontsize=7.5)
                for ch in label)
            x = PAGE_W - MR - tw
            for ch in label:
                fn = "helv" if ord(ch) <= 0x7E else (
                    FALLBACK if (self._fb and ch in FALLBACK_CHARS) else FONT)
                page.insert_text((x, 28), ch, fontname=fn, fontsize=7.5,
                                 color=(0.5, 0.5, 0.5))
                x += self.fitz.get_text_length(
                    ch, fontname=("helv" if ord(ch) <= 0x7E else FONT), fontsize=7.5)

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
    canton_groups = [incommon(g) for g in CANTON_GROUPS]
    canton = [c for g in canton_groups for c in g]
    baijia = incommon(_file_chars("baijiaxing.txt"))
    names = incommon(_name_chars("NAME_MALE") + _name_chars("NAME_FEMALE"))

    baijia_all = set(baijia) | {c for u in BAIJIA_COMPOUND for c in u if c in common}
    covered = set(jiabiao) | set(gb1) | set(canton) | baijia_all | set(names)
    rest = sorted(common - covered - DROP_CHARS)

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
    flow.title(BRAND, TITLE_REST,
               f"「只打常用字」開啟時選字列保留的字，共 {len(common)} 個。分類不互斥"
               f"（多數姓氏亦在甲表），各節列出該類全部。")

    def bopo_section(title, chars):
        flow.section(f"{title}（{len(chars)} 字）")
        buckets, other = by_bopo(chars)
        for k in BOPO_INITIALS:
            if buckets[k]:
                flow.subhead(f"{k}（{len(buckets[k])} 字）", sub=k)
                flow.grid(buckets[k])
        if other:
            flow.subhead(f"查無注音（{len(other)} 字）", sub="查無注音")
            flow.grid(other)

    def pinyin_section(title, chars, note=""):
        # GB 2312 一級漢字本來就是拼音序（檔案裡的順序），完全**照它排**、不重排，
        # 只在拼音首字母往前推進時（A→B→C…）插一個小標當索引。字身用 china-s。
        #
        # 每個字的「主小標」＝它前後共 5 個字的 pypinyin 首字母多數決——用鄰居
        # 蓋掉單字誤判，early-in-a-run 的字也不會被往後拉。字數就算在這一組、
        # 算一次。多音字（畜 xù／chù、厦 shà／xià、曾 zēng／céng…）另一個常用
        # 讀音的首字母那一節會**再出現一格**（Wilson）：
        #  ・本尊那格：右上角小綠字母，指向另一讀音所在組。
        #  ・重出那格：那個字母下點一個小點，依讀音插進該到的位置（曾 céng 排在
        #    层 蹭 中間，不再丟到組末），不計入字數。
        AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        rank = lambda k: AZ.index(k) if k and k in AZ else -1
        letters = [_pyletter(c) for c in chars]

        def stable(i):
            win = [x for x in letters[max(0, i - 2):i + 3] if x]
            return max(win, key=win.count) if win else None

        def reading_in(ch, L):
            # ch 以字母 L 起首的那個讀音（帶調號數字），拿來替重出字排位
            try:
                rs = pinyin_fn(ch, heteronym=True, style=Style.TONE3, errors="ignore")
                cand = sorted(r for r in (rs[0] if rs else []) if r[:1].upper() == L)
                return cand[0] if cand else None
            except Exception:
                return None

        groups = {}        # 主小標 -> [字]（檔案順序）
        extras = {}        # 小標 -> [多音字]（另一讀音落在這裡）
        char_primary = {}  # 多音字 -> 它 GB 位置的主小標
        char_alt = {}      # 多音字 -> 另一讀音的首字母
        cur = None
        for i, c in enumerate(chars):
            k = stable(i)
            if k and rank(k) > rank(cur):
                cur = k
            groups.setdefault(cur, []).append(c)
            alt = letters[i]
            if alt and alt != cur and alt in AZ:
                extras.setdefault(alt, []).append(c)
                char_primary[c] = cur
                char_alt[c] = alt

        flow.section(f"{title}（{len(chars)} 字{('，' + note) if note else ''}）")
        flow._room(ROW_H)
        flow._text((ML, flow.y + 6),
                   "多音字：右上角綠字母指另一讀音所在組；字母下帶一點者代表該字已在"
                   "另一讀音計算過，在此處不再重複計算。", 7, (0.42, 0.42, 0.42))
        flow.y += 11
        for L in AZ:
            base = groups.get(L, [])
            ex = extras.get(L, [])
            if not base and not ex:
                continue
            # base 照 GB 序；ex（多音字重出）依讀音插進該到的位置
            items = [[c, char_alt.get(c), False] for c in base]
            keys = [reading_in(c, L) or "" for c in base]
            for c in ex:
                kc = reading_in(c, L) or ""
                pos = len(items)
                for j, kj in enumerate(keys):
                    if kc and kj and kc < kj:
                        pos = j
                        break
                items.insert(pos, [c, char_primary[c], True])
                keys.insert(pos, kc)
            head = f"{L}（{len(base)} 字"
            if ex:
                head += f"＋{len(ex)} 個多音字重出"
            head += "）"
            flow.subhead(head, sub=L)
            flow.grid_cells([tuple(it) for it in items])

    def flat_section(title, chars, note=""):
        label = f"{title}（{len(chars)} 字{('，' + note) if note else ''}）"
        flow.section(label)
        flow.grid(chars)

    def grouped_section(title, groups, note=""):
        # 每個 group 另起一行（flow.grid 收尾一定把 y 推到列邊界），組內照排、
        # 滿 26 格才換行。用來呈現 Wilson 依部首分好的字堆（粵語）。
        total = sum(len(g) for g in groups)
        flow.section(f"{title}（{total} 字{('，' + note) if note else ''}）")
        for g in groups:
            if g:
                flow.grid(g)

    def baijia_section():
        raw = (STD / "baijiaxing.txt").read_text("utf-8")
        pre = raw.split("# 複姓")[0]
        singles = [c for c in _cjk_list("\n".join(
            l for l in pre.splitlines() if not l.startswith("#"))) if c in common]
        seg = raw.split("# 古本未收")
        if len(seg) > 1:
            singles += [c for c in _cjk_list(seg[1]) if c in common]
        singles = _dedup_keep_order(singles)
        comp = [u for u in BAIJIA_COMPOUND if all(ch in common for ch in u)]
        miss = [u for u in BAIJIA_COMPOUND if u not in comp]
        if miss:
            print(f"  ⚠️ 百家姓：複姓 {miss} 有字不在 common，跳過")
        uniq = len(set(singles) | set("".join(comp)))
        flow.section(f"四、百家姓（{uniq} 字，宋本；單姓四字一句照原文韻腳，複姓兩字一組）")
        flow.grid_units([singles[i:i + 4] for i in range(0, len(singles), 4)], per_row=6)
        flow.subhead(f"複姓（{len(comp)} 個）", sub="複姓")
        flow.grid_units(comp, per_row=12, unit_gap=CELL * 0.7, tight=True)

    def other_section():
        restset = set(rest)
        groups = [[c for c in g if c in restset] for g in OTHER_GROUPS]
        placed = {c for g in groups for c in g}
        leftover = [c for c in rest if c not in placed]
        if leftover:
            groups.append(leftover)
            print(f"  ⚠️ 其他：{len(leftover)} 個字沒排進 OTHER_GROUPS，補最後：{''.join(leftover)}")
        # DROP_CHARS（㠯 龹 龺）：內建字型畫不出、擺著像簡體字反而誤導，直接不列。
        flow.section(f"六、其他常用字（{len(rest)} 字，包括部件字、常見的異體字等，"
                     f"約略依部首分堆）")
        flow.multi_col([g for g in groups if g], ncols=2)

    bopo_section("一、教育部《常用國字標準字體表》甲表", jiabiao)
    pinyin_section("二、GB 2312 一級漢字", gb1, note="拼音序")
    grouped_section("三、常用粵語字", canton_groups, note="約略依部首分堆")
    baijia_section()
    flat_section("五、常用取名用字", names, note="男名／女名，跟〈線上試打〉那一排字卡同一份")
    other_section()

    flow.running_header(f"{BRAND}　{TITLE_REST}")
    flow.coverage_labels()
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
