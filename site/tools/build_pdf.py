#!/usr/bin/env python3
"""產生〈下載〉頁的兩份字根表 PDF：
    site/assets/downloads/AiPhaBi_ZigenChart.pdf          完整版（取形意圖／字根／字例）
    site/assets/downloads/AiPhaBi_ZigenChart_Compact.pdf  精簡版（拿掉字例欄，字根欄裡
                                                    的形狀從左到右排開，一列＝
                                                    一個取形意圖，不是一個形狀）

不是另外拼一份靜態表：字根圖是 zigen.js 現畫的 SVG（含高亮筆畫），複刻一份
純文字表會失去這個表最有用的部分，而且會有第三份跟網站版本分岔的風險。這裡
直接用 headless Chrome 對**真正的頁面**列印（emulate print media + page.pdf()），
印出來的就是使用者在瀏覽器上會看到的那張表本身。精簡版一樣是這個頁面本身，
只是多帶一個 ?view=compact 的網址參數（見 zigen.js 的 COMPACT），不是另外做
一份靜態表。

⚠️ 這一步**不**掛進 build_site_data.py／CI：Playwright 的 Chromium 有一百多 MB，
Vercel／GitHub Actions 的建置環境沒有裝，硬拉進去會讓每次部署都變慢、還可能
觸發跟 preview.py 那次差不多的環境落差問題。所以產出的 PDF 是**手動跑一次、
直接進版控**的靜態檔案（見 .gitignore 裡的說明），不是「建置時現算」。

字根表大改（新字母、大量新意圖）之後要記得手動重跑、重新提交這兩個檔案。

頁首／頁尾（品牌、這頁涵蓋哪幾個字母、第幾頁、字母跨欄時右欄開頭補一個
接續小標）不是印表機自己排的——Chrome 的 print-to-PDF 沒有可靠支援 CSS 那套
running header（@page 的 margin box／string-set，Chromium 幾乎沒實作），
Playwright 的 header/footer template 又是「每一頁套同一份 HTML」，沒辦法知道
「這一頁實際印到哪個字母、字母在哪裡被切成兩欄」，那些是兩欄版面跑完 Chrome
自己的分頁演算法才知道的結果。所以反過來做：先印出 PDF，再用 PyMuPDF 讀回
每一頁、每一欄實際出現了哪些字母鍵（.zg-key 的字，Menlo-Bold 這個字型只有
字母鍵在用，不會跟表格內文撞形），算出頁首要印的範圍，也算出哪些欄的開頭
沒有字母鍵（代表接著上一欄／上一頁沒印完的字母），最後才把文字寫回頁面的
留白處跟該補接續標的地方。

⚠️ 已知限制：字母理論上該允許跨欄（同一頁左欄印不完接右欄）但不能跨頁
（Wilson 明講兩次）。試過偵測「新的一頁卻是左欄開頭沒有字母鍵」、對那個
字母的第一列強制加 break-before:page 重印——結果沒用：Chrome 把這個表格
放在兩欄容器裡面時，強制換頁的指令似乎被「降級」成只在欄與欄之間生效，
到不了頁與頁那一層（table 在 multicol 容器裡的分頁行為是 Chromium 出了名
不乾淨的一塊，這裡踩到了）。目前沒有再花時間追下去——find_page_splits()
還在（判斷式仍然可用、可以看出哪些字母跨頁），但沒有接到重印流程，只是
留著給下次要繼續查這個問題的人一個起點。目前的字母字母跨頁是**已知、
還沒解決**的狀況，不是這次改動的目標。

用法：

    python3 site/tools/preview.py 8099 &      # 先確保本機有一份最新的網站在跑
    python3 site/tools/build_pdf.py            # 預設打 http://localhost:8099

    pip3 install playwright pymupdf && playwright install chromium   # 第一次跑才需要
"""
import io
import pathlib
import string
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "site" / "assets" / "downloads"
# 完整標誌（四個字母），不是分頁用的簡化版 favicon——頁首夠寬，放得下完整
# 標誌，不必像瀏覽器分頁那樣退而求其次（Wilson：「用 icon 不要用 favicon」）。
LOGO = ROOT / "site" / "assets" / "img" / "logo-512.png"

# 頁首品牌列的樣式，跟〈常用字表 PDF〉（build_charlist_pdf.py）同一套數字——
# 小標誌、灰色小字、字母清單改用點號隔開，兩份 PDF 的頁首頁尾看起來才像
# 同一個品牌印出來的東西，不是兩套各自的風格（Wilson）。頁面都是 A4
# （595×842pt），y 座標可以直接照抄，不用另外量。
_HDR_GRAY = (0.55, 0.55, 0.55)
_HDR_LINE_GRAY = (0.86, 0.86, 0.86)
_HDR_SIZE = 7.5
_LETTER_LIST_GRAY = (0.5, 0.5, 0.5)
_FOOT_GRAY = (0.5, 0.5, 0.5)
_DOT_PAD = 1.3   # 點號兩邊留白，字母才不會跟點號黏在一起

_LOGO_CACHE = {}


def _logo_stream(px):
    """把 logo-512.png 攤平在白底、Lanczos 縮到 px 見方，回傳 PNG bytes——
    跟 build_charlist_pdf.py 同一招：直接把半透明大圖塞進小方框，縮出來的
    邊緣會糊、會有雜點，先攤平在白底再高品質縮小才乾淨。沒有 Pillow 就回
    None，呼叫端退回不畫標誌。"""
    if px in _LOGO_CACHE:
        return _LOGO_CACHE[px]
    out = None
    if LOGO.is_file():
        try:
            from PIL import Image
            im = Image.open(LOGO).convert("RGBA")
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

# 頁邊留給頁首／頁尾文字，比純粹排版需要的窄邊多留一點——8mm 太緊，塞不下
# 一行字還跟表格黏在一起；左右也加寬一點，紙本裝訂／打孔要留的邊，貼著
# 表格印到紙的邊緣不好裝訂。
MARGIN = {"top": "15mm", "bottom": "11mm", "left": "11mm", "right": "11mm"}

# 兩欄版面拿來分左欄／右欄的門檻 x 座標——欄距遠大於這個值，不會分錯。
# 兩欄各自實際的 x 不寫死：頁邊距改了（見 MARGIN）欄位置就跟著挪，寫死的
# 話每次調頁邊距都要回來改這個數字，改成從量出來的內容位置直接讀。
COL_SPLIT_X = 150


def render_pdf(page, url, out_path, forced_breaks=None):
    page.goto(url, wait_until="networkidle", timeout=15000)
    # zigen.js 抓 assets/zigen.json 才畫表，networkidle 不保證那次 fetch 的
    # then() 已經跑完——等真正的字母列出現，而不是「載入中……」那個佔位段落。
    page.wait_for_selector(".zg-table tr", timeout=15000)
    # 印表機不該吃使用者的深色模式選擇——強制切回淺色主題，跟 site.js 手動
    # 切換用的是同一個屬性（localStorage 那套，這裡直接寫 DOM 就夠，不用存）。
    page.evaluate("document.documentElement.dataset.theme = 'light'")
    page.emulate_media(media="print")
    if forced_breaks:
        # letterRows()／renderCompactTable() 給每個字母的第一列一個 #L<字母>
        # 錨點，強制換頁只需要選到那一列本身。
        sel = ", ".join(f"#L{L}" for L in sorted(forced_breaks))
        page.add_style_tag(content=f"{sel} {{ break-before: page !important; }}")
    page.pdf(path=str(out_path), format="A4", print_background=True, margin=MARGIN)


def _letter_badges(page):
    """這一頁所有字母鍵：[(欄, y, 字母), ...]，欄是 'L' 或 'R'。"""
    d = page.get_text("dict")
    out = []
    for block in d["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                t = span["text"].strip()
                if len(t) == 1 and t in string.ascii_uppercase and span["font"] == "Menlo-Bold":
                    col = "L" if span["bbox"][0] < COL_SPLIT_X else "R"
                    out.append((col, span["bbox"][1], t))
    return out


# 表頭那一列的文字——Chromium 把整張表放進兩欄容器時，每一欄的開頭都會
# 重印一次 <thead>，那不是內容。_col_tops 要把它連同頁首品牌字一起跳過，
# 不然「這一欄開頭沒有字母鍵」永遠成立（表頭不是字母鍵），就會在每一頁
# 每一欄的最上面亂補一個接續小標——就是頁首左右冒出來的那兩個怪字母。
_HEAD_LABELS = ("字母", "取形意圖", "字例")
_HEADER_BAND = 40   # 這個 y 以上是頁首留白（MARGIN top 15mm ≈ 42.5pt）


def _badge_x(page):
    """這一頁左／右欄的字母鍵 x 座標 {欄: x}——補接續標時對齊真正的字母欄，
    不是對齊量到的內容左緣（那會落在取形意圖欄的文字上）。"""
    out = {}
    d = page.get_text("dict")
    for block in d["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                t = span["text"].strip()
                if len(t) == 1 and t in string.ascii_uppercase and span["font"] == "Menlo-Bold":
                    col = "L" if span["bbox"][0] < COL_SPLIT_X else "R"
                    out.setdefault(col, span["bbox"][0])
    return out


# 真字母鍵印出來的量測值（兩份 PDF 一致）：8pt 的字，外面一個 13.5×13.5pt、
# 圓角、淡綠底、重點色描邊的藥丸。接續標要一模一樣（Wilson），不是隨手寫個字。
_ACCENT = (0x0e / 255, 0x7c / 255, 0x73 / 255)
_KEY_FILL = (0.933, 0.965, 0.961)
_KEY_PILL = 13.5
_KEY_CX = {"L": 42.2, "R": 315.2}   # 沒有真字母鍵可抄 x 時的預設欄中心


def _stamp_key_badge(page, cx, top_y, letter):
    """在 (cx, top_y) 補一個跟真字母鍵同款的藥丸標——字母跨欄／跨頁時，
    接續的那一欄開頭本來沒有字母鍵，補這個讓它看起來就像原本就在那。"""
    import fitz

    y0 = top_y - 2.0
    r = fitz.Rect(cx - _KEY_PILL / 2, y0, cx + _KEY_PILL / 2, y0 + _KEY_PILL)
    # 真字母鍵是 border-radius: 6px（.zg-key）÷ 印出來約 13.5pt 的框 ≈ 0.38
    page.draw_rect(r, color=_ACCENT, fill=_KEY_FILL, width=0.75, radius=0.38)
    tl = fitz.get_text_length(letter, fontname="hebo", fontsize=8)
    page.insert_text((cx - tl / 2, y0 + 11.3), letter,
                     fontname="hebo", fontsize=8, color=_ACCENT)


def _col_tops(page):
    """這一頁左／右欄，各自第一塊**內容**（跳過重印的表頭與頁首文字）的
    {欄: (y, x)}。用來判斷「這一欄最上面那一小塊有沒有字母鍵」——沒有的話
    就是接著上一欄／上一頁還沒印完的字母；x 順便記下來，補接續標時直接
    貼著那欄實際的內容邊界，不用另外猜兩欄各自的 x 座標。"""
    d = page.get_text("dict")

    head_ys = []
    for block in d["blocks"]:
        for line in block.get("lines", []):
            joined = "".join(s["text"] for s in line.get("spans", []))
            if any(lbl in joined for lbl in _HEAD_LABELS):
                head_ys.append(line["bbox"][1])

    def skip(y0):
        return y0 < _HEADER_BAND or any(abs(y0 - hy) < 12 for hy in head_ys)

    tops = {}
    for block in d["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if not span["text"].strip():
                    continue
                x0, y0 = span["bbox"][0], span["bbox"][1]
                if skip(y0):
                    continue
                col = "L" if x0 < COL_SPLIT_X else "R"
                if col not in tops or y0 < tops[col][0]:
                    tops[col] = (y0, x0)
    return tops


def find_page_splits(pdf_path):
    """讀一份已經印好的 PDF，抓出「左欄開頭沒有字母鍵」的頁——這個特徵只有
    真的跨頁才會出現（跨欄的話沒有字母鍵的是右欄開頭），回傳這些頁各自
    接的是哪個字母（也就是需要強制換頁的字母集合）。"""
    import fitz

    doc = fitz.open(pdf_path)
    bad = set()
    current_letter = None
    for pageno, page in enumerate(doc, start=1):
        badges = _letter_badges(page)
        tops = _col_tops(page)
        for col in ("L", "R"):
            if col not in tops:
                continue
            top_y, _top_x = tops[col]
            fresh = any(c == col and abs(y - top_y) < 20 for (c, y, _t) in badges)
            if not fresh and current_letter and col == "L" and pageno > 1:
                bad.add(current_letter)
            col_letters = sorted({t for (c, _, t) in badges if c == col})
            if col_letters:
                current_letter = col_letters[-1]
    doc.close()
    return bad


def stamp_pdf(path, show_letter_list=True, stamp_continuation=True):
    """讀回剛印出來的 PDF（已經沒有跨頁字母了），補三件事：頁首品牌、
    頁首字母清單、頁尾頁碼；另外把「這一欄開頭沒有字母鍵」的地方補一個
    接續小標。

    show_letter_list=False：精簡版只有一頁，右上角再列一次「這頁有哪些
    字母」＝整個字母表，純粹是雜訊，關掉（Wilson）。

    stamp_continuation：精簡表（zigen.js renderCompactTable）現在只在一個
    字母的**第一個**等級列畫字母鍵，後面幾等級列的儲存格是空的（Wilson：
    三列都畫字母鍵，看起來像三個不同字母）——所以字母被瀏覽器的 CSS 分欄
    硬生生切開時（M 常常這樣，優等留在左欄、三等擠到右欄開頭），右欄開頭
    那一列本身沒有字母鍵可看，這裡一樣要補接續標，跟完整版同一套邏輯，
    不能再假設精簡表「每一列都自帶字母鍵」而關掉。

    字母鍵的簽名很乾淨：.zg-key 是 `font: 650 ... ui-monospace` 印出來就是
    Menlo-Bold，不管實際字級是多少，兩份 PDF（完整版字級不同、精簡版又不
    一樣）都吃得下，不用為每份各寫一個容許值。
    """
    import fitz

    doc = fitz.open(path)
    total = len(doc)
    current_letter = None   # 一路往下讀，記住「目前印到哪個字母」
    for i, page in enumerate(doc, start=1):
        badges = _letter_badges(page)
        # ⚠️ 量欄頂**要在補任何頁首文字之前**——不然 _col_tops 會抓到我們自己
        # 剛寫上去的品牌字（y≈20、x≈40，落在左欄）跟右上角的字母清單，把它們
        # 當成「這一欄開頭沒有字母鍵」，於是又在頁首左右各補一個接續小標，
        # 就是左上／右上冒出來的那兩個怪字母。
        tops = _col_tops(page)
        letters_here = sorted({t for (_, _, t) in badges})
        w, h = page.rect.width, page.rect.height

        # 頁首左邊：小標誌＋品牌名，每一頁都有，讀者單獨列印某幾頁時也認得出
        # 是哪份文件。樣式（標誌大小、灰色、字級、china-s、底下那條分隔線）
        # 照抄〈常用字表 PDF〉的 running_header()——兩份 PDF 頁首看起來才像
        # 同一個品牌印的，不是各自一套（Wilson）。中文走 PyMuPDF 內建的 CJK
        # 對應字型（china-s，Droid Sans Fallback），不依賴這台機器裝了哪些
        # 系統字型，其他人重跑這支腳本也一樣印得出來（china-s 不是 china-ts：
        # 後者會把將近一千個簡化字默默印成空白，見 build_charlist_pdf.py 檔頭）。
        x = 20
        logo = _logo_stream(36)
        if logo is not None:
            try:
                page.insert_image(fitz.Rect(x, 20, x + 9, 29), stream=logo)
                x += 12
            except Exception:
                pass
        brand = "愛發筆輸入法　字根表"
        for ch in brand:
            page.insert_text((x, 28), ch, fontname="china-s", fontsize=_HDR_SIZE,
                              color=_HDR_GRAY)
            x += fitz.get_text_length(ch, fontname="china-s", fontsize=_HDR_SIZE)
        page.draw_line((20, 33), (w - 20, 33), color=_HDR_LINE_GRAY, width=0.4)

        # 頁首右邊：這一頁出現的每一個字母，逐個列出來，不縮寫成「A–D」
        # 這種範圍——縮寫要讀者自己在腦裡展開字母表才知道中間有哪些字母
        # 真的在這頁（Wilson：「H 在 G 跟 J 中間」不是一眼看得出來的事），
        # 全部列出來就不用猜。字母中間用點號隔開（不是兩個空格），跟〈常用
        # 字表 PDF〉頁首範圍標籤同一套分隔符號（Wilson）。
        if show_letter_list and letters_here:
            gap = fitz.get_text_length(".", fontname="helv", fontsize=_HDR_SIZE)
            dotw = gap + _DOT_PAD * 2
            total_w = (sum(fitz.get_text_length(t, fontname="hebo", fontsize=_HDR_SIZE)
                           for t in letters_here)
                       + dotw * (len(letters_here) - 1))
            lx = w - 20 - total_w
            ly = 28
            for k, t in enumerate(letters_here):
                page.insert_text((lx, ly), t, fontname="hebo", fontsize=_HDR_SIZE,
                                  color=_LETTER_LIST_GRAY)
                lx += fitz.get_text_length(t, fontname="hebo", fontsize=_HDR_SIZE)
                if k < len(letters_here) - 1:
                    lx += _DOT_PAD
                    page.insert_text((lx, ly), "·", fontname="helv",
                                      fontsize=_HDR_SIZE, color=_LETTER_LIST_GRAY)
                    lx += gap + _DOT_PAD

        # 字母跨欄／跨頁：這一欄開頭（跳過重印的表頭之後）如果沒有字母鍵，
        # 代表接著上一欄／上一頁還沒印完的字母，在這一欄的字母欄補印一次
        # 那個字母，讀者才不會翻到一欄劈頭就是一排沒有名字的字根。
        # 補印的位置對齊這一欄真正的字母鍵中心：同一頁有真字母鍵就抄它的
        # x（glyph 左緣 + 半個字寬），沒有就用實測預設欄中心。樣式（藥丸、
        # 底色、描邊、字級、重點色）全部照真字母鍵複刻，見 _stamp_key_badge。
        badge_x = _badge_x(page)
        for col in ("L", "R"):
            if col not in tops:
                continue
            top_y, _top_x = tops[col]
            # 「這一欄開頭就是新字母」＝字母鍵跟欄頂在同一列（差幾 pt）。
            # 容許值要小於一列的高度，不然精簡版裡 M 的三等列（欄頂）跟它
            # 下面那個 N 的字母鍵（差約 19pt）會被算成同一列，M 跨欄就補不到
            # 接續標。完整版新字母落在欄頂時兩者只差約 3pt，12 綽綽有餘。
            fresh = any(c == col and abs(y - top_y) < 12 for (c, y, _t) in badges)
            if stamp_continuation and not fresh and current_letter:
                cx = badge_x[col] + 2.4 if col in badge_x else _KEY_CX[col]
                _stamp_key_badge(page, cx, top_y, current_letter)
            col_letters = sorted({t for (c, _, t) in badges if c == col})
            if col_letters:
                current_letter = col_letters[-1]

        # 頁尾：頁碼，置中，貼在下邊距的留白裡——跟〈常用字表 PDF〉同一個
        # y 座標（兩份都是 A4），數字看起來印在紙上同一條線上。
        foot = f"{i} / {total}"
        tw = fitz.get_text_length(foot, fontname="helv", fontsize=8)
        page.insert_text(((w - tw) / 2, h - 16), foot, fontname="helv", fontsize=8,
                          color=_FOOT_GRAY)
    doc.saveIncr()
    doc.close()


def build_one(page, url, out_path, label, compact=False):
    try:
        render_pdf(page, url, out_path, forced_breaks=None)
    except Exception as e:
        sys.exit(f"打不開 {url} —— 本機預覽有在跑嗎？"
                  f"（python3 site/tools/preview.py 8099）\n{e}")
    splits = find_page_splits(out_path)
    if splits:
        print(f"  ⚠️ {label}：{'、'.join(sorted(splits))} 被印到跨頁——已知限制，"
              f"見檔頭說明，先這樣印出來")
    stamp_pdf(out_path, show_letter_list=not compact, stamp_continuation=True)
    kb = out_path.stat().st_size / 1024
    print(f"寫出：{out_path.relative_to(ROOT)}（{label}，{kb:.0f} KB）")


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8099"
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("沒裝 playwright —— 跑：pip3 install playwright && playwright install chromium")
    try:
        import fitz  # noqa: F401  只是先確認裝了，stamp_pdf 才會真的 import
    except ImportError:
        sys.exit("沒裝 pymupdf —— 跑：pip3 install pymupdf")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = [
        (f"{base}/zigen.html", OUT_DIR / "AiPhaBi_ZigenChart.pdf", "完整版", False),
        (f"{base}/zigen.html?view=compact", OUT_DIR / "AiPhaBi_ZigenChart_Compact.pdf", "精簡版", True),
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for url, out_path, label, compact in targets:
            build_one(page, url, out_path, label, compact=compact)
        browser.close()


if __name__ == "__main__":
    main()
