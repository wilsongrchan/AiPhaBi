#!/usr/bin/env python3
"""Generate the data files the public site needs, from the repo's own source of truth.

    site/assets/dict.json   碼 → 候選字（線上試打用）
    site/assets/t2s.json    繁 → 簡 單字對照（繁簡切換用）
    site/assets/zigen.json  字根表（取形意圖 ＋ 例字），給 zigen.html 用
    site/assets/jianma.json 簡碼表（約定簡碼／三簡碼／左簡碼），給 jianma.html 用
    site/assets/phrases.json 詞組連打／四碼快打，給 cizu.html 用
    site/assets/phrase_dict.json 試打頁的詞庫（碼 → 詞），詞組開關打開才抓

All outputs are **generated, never hand-edited, and gitignored**. They are rebuilt in the
Pages workflow right before deploy, so the published demo can never drift from `data/codes.json`
the way a committed copy would — every newly coded character is live the next time the site
deploys.

Run it by hand before previewing locally:

    python3 site/tools/build_site_data.py

Reading Side A's data is fine from any side (the guard never blocks reads). Writing stays inside
`site/`, which is Side C's. This script must not write anywhere else.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "site" / "assets"


def shorten(code, rule):
    """Must stay identical to build_rime.py:36 — the demo is a lie if it disagrees with the IME."""
    if not rule:
        return code
    p = rule.get("params", {})
    mx, head, tail = p.get("max", 5), p.get("head", 4), p.get("tail", 1)
    if len(code) <= mx:
        return code
    return code[:head] + (code[-tail:] if tail else "")


def load(name):
    path = DATA / name
    if not path.exists():
        sys.exit(f"missing {path} — run this from a full checkout")
    return json.loads(path.read_text("utf-8"))


GRAPHICS_URL = "https://raw.githubusercontent.com/skishore/makemeahanzi/master/graphics.txt"
CACHE = ROOT / "site" / ".cache"


# ── 教育部標準字體：makemeahanzi 收成別種字形的那幾個字 ────────────────────
#
# makemeahanzi 的「為」畫的其實是「爲」——12 筆、爫 字頭。教育部標準的「為」是 9 筆
# （丶 丿 橫折 橫折 橫折鉤 四點），Wilson 寫的、網站正文字型顯示的都是這一個。
# codes.json 的取碼 YJJCM 也是照 9 筆那個字形取的，所以拿 12 筆的圖來畫，段號對不上，
# 田字格還會畫出一個跟正文不一樣的字。
#
# 這幾個字改用 g0v/zh-stroke-data（教育部《常用國字標準字體筆順學習網》的資料）。
# 每個字一支 JSON，抓下來放 site/.cache/，跟 graphics.txt 同樣不進版控。
#
# ⚠️ 授權：g0v 作者放棄自己那部分的著作權，但**明確排除資料檔**。筆順資料的著作權
# 屬中華民國教育部，其 README 寫明「不得為商業目的使用」，g0v 依著作權法第 50 條
# （中央機關公開發表之著作，供非營利教育目的合理範圍內重製）散布。
# 愛發筆網站免費、非商業、教學用途，Wilson 於 2026-08-25 在這個前提下決定採用。
# 出處與條件寫在 site/TWSTROKE.txt，跟 ARPHICPL.txt 一樣要隨網站一起發佈。
#
# 「爲」(U+7228) 不在這份資料裡，也不在 makemeahanzi 裡 —— 兩邊都畫不出來，
# 所以它仍然沒有田字格。要補得先有一份畫得出來、而且進得了版控的字形。
TW_FORM = {"為": 0x70BA}

# makemeahanzi 把「爲」的字形放在「為」那個碼位上（就是上面說的 12 筆、爫 字頭那個）。
# 「為」既然改用教育部標準的 9 筆字形，那份 12 筆的字形正好就是「爲」缺的那一份 ——
# Wilson 在標註頁標的 W[0,1,2,3] J[4] J[5] J[6] C[7] M[8,9,10,11] 就是照著它標的。
# 所以這裡把它接到「爲」名下：一份資料，兩個碼位各拿各該拿的那一個。
GLYPH_ALIAS = {"爲": "為"}
TW_JSON = "https://raw.githubusercontent.com/g0v/zh-stroke-data/master/json/{:x}.json"
_ALIAS_SRC = set(GLYPH_ALIAS.values())


def _tw_convert(data):
    """g0v 的一個字 → {"strokes": [SVG path], "medians": [[[x, y], …]]}。

    座標換算到 makemeahanzi 那一套，網站上現成的 transform 就不必動：
    g0v 是 2048 em、y 向下；makemeahanzi 是 1024 em、y 向上（網站畫的時候套
    `scale(1,-1) translate(0,-900)`，等於螢幕 y = 900 - y）。所以 x/2、900-y/2。
    ⚠️ y 一定要翻。stroke_vec() 會把座標正規化，位置和大小都無所謂，但**方向有所謂**
    ——不翻的話每一條字根都是上下顛倒的，比對會配到別的字根去。

    medians 取 g0v 的 `track`（下筆走的中線），正好就是字根比對要的那個東西，
    所以這幾個字照樣有取形意圖，不必退成「只給筆畫和字母」。
    """
    def fx(x):
        return round(x / 2, 1)

    def fy(y):
        return round(900 - y / 2, 1)

    strokes, medians = [], []
    for st in data:
        d = []
        for c in st.get("outline", []):
            if c["type"] == "M":
                d.append(f"M{fx(c['x'])} {fy(c['y'])}")
            elif c["type"] == "L":
                d.append(f"L{fx(c['x'])} {fy(c['y'])}")
            elif c["type"] == "Q":
                d.append(f"Q{fx(c['begin']['x'])} {fy(c['begin']['y'])} "
                         f"{fx(c['end']['x'])} {fy(c['end']['y'])}")
        if not d:
            return None
        strokes.append(" ".join(d) + " Z")
        medians.append([[fx(p["x"]), fy(p["y"])] for p in st.get("track", ())])
    return {"strokes": strokes, "medians": medians} if strokes else None


_tw_forms = None


def tw_forms():
    """TW_FORM 那幾個字的 {strokes, medians}。抓不到就回傳沒有它的字典 ——
    那個字會沿用 makemeahanzi 的字形（畫出來是別種寫法，但總比整頁壞掉好）。"""
    global _tw_forms
    if _tw_forms is not None:
        return _tw_forms
    _tw_forms = {}
    for ch, cp in TW_FORM.items():
        f = CACHE / f"tw_{cp:x}.json"
        try:
            if not f.exists():
                import urllib.request
                CACHE.mkdir(parents=True, exist_ok=True)
                print(f"  下載 {ch} 的教育部標準筆順（g0v/zh-stroke-data）…")
                with urllib.request.urlopen(TW_JSON.format(cp), timeout=60) as r:
                    f.write_bytes(r.read())
            g = _tw_convert(json.loads(f.read_text("utf-8")))
        except Exception as e:
            print(f"  ⚠️ 拿不到 {ch} 的教育部標準筆順（{e}）—— 這個字沿用 makemeahanzi 的字形")
            continue
        if g:
            _tw_forms[ch] = g
    return _tw_forms


def _graphics_path():
    """找 makemeahanzi 的筆畫輪廓，找不到就下載到 site/.cache/（不寫 data/，那是 Side A 的）。

    優先用 data/graphics.txt（Side A 跑過 fetch_data.py 的話就在），因為那是同一份資料，
    沒必要在同一台機器上放兩份 29MB。CI 上是全新 checkout，一定是走下載那條路。
    """
    local = DATA / "graphics.txt"
    if local.exists():
        return local
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / "graphics.txt"
    if cached.exists() and cached.stat().st_size > 1_000_000:
        return cached
    import urllib.request
    print(f"  下載 graphics.txt（約 29MB）…")
    with urllib.request.urlopen(GRAPHICS_URL, timeout=300) as r:
        cached.write_bytes(r.read())
    return cached


def build_glyphs(chars):
    """把字根表要用到的字的**筆畫輪廓**抽出來，寫成 site/assets/glyphs.json。

    這是讓〈字根表〉能像標註工具那樣畫出字根本身的資料：每個字一組 SVG path，
    網站把屬於該字根的筆畫塗深、其餘塗淺（跟 editor.html 的 glyphSvg 同一套做法）。
    收的是 graphics.txt 的 `strokes` 欄。**那一欄就是字形輪廓本身**（SVG path 指令，
    直接衍生自 Arphic 字型）；沒收的 `medians` 是 makemeahanzi 另外算出來的中線座標。
    所以「不收 medians」不代表footprint比較小 —— 留下的正好是受授權規範的那一半，
    這也正是必須遵守 Arphic Public License 的原因。任何說法都不要寫成好像少拿了什麼。

    ⚠️ 授權：這份資料源自 makemeahanzi，其 graphics.txt 依 **Arphic Public License**
    散布（該授權允許再散布與格式轉換，條件是隨附授權全文、註明改了什麼，並以同樣
    條款提供）。所以：
      - site/ARPHICPL.txt 是授權全文，必須跟著網站一起發佈，不要刪。
      - 下面的 note 欄就是「註明改了什麼」，也不要拿掉。
    Wilson 於 2026-08-17 決定接受這個義務，以換取字根表能真的畫出字根。

    抓不到資料時回傳 None，網站會自動退回純文字版（「取自『名』第 1–3 筆」），
    不會因為沒網路就整頁壞掉。
    """
    try:
        path = _graphics_path()
    except Exception as e:                      # 沒網路、GitHub 掛了、逾時
        print(f"  ⚠️ 拿不到 graphics.txt（{e}）—— 字根表退回純文字版")
        return None

    want = set(chars)
    out, raw = {}, {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            c = o.get("character")
            if c in want and o.get("strokes"):
                out[c] = o["strokes"]
            if c in _ALIAS_SRC and o.get("strokes"):
                raw[c] = o["strokes"]
    for a, src in GLYPH_ALIAS.items():       # 見 GLYPH_ALIAS：爲 用 makemeahanzi 的 為
        if a in want and raw.get(src):
            out[a] = raw[src]
    # 教育部標準字體優先（見 TW_FORM）：makemeahanzi 那一筆畫的是別種字形。
    # 要在 alias 之後，不然會把 爲 也換成 9 筆的那個。
    for c, g in tw_forms().items():
        if c in want:
            out[c] = g["strokes"]

    payload = {
        "note": "generated by site/tools/build_site_data.py — do not edit",
        "source": "makemeahanzi (https://github.com/skishore/makemeahanzi) graphics.txt",
        "license": "Arphic Public License — 全文見 ARPHICPL.txt，隨網站一併發佈",
        "modifications": (
            "自 graphics.txt 取出本站用得到的 1375 個字元，保留其 strokes 欄（即字形輪廓，"
            "SVG path 指令），未修改任何路徑資料；捨棄 medians（makemeahanzi 計算的中線）"
            "與其餘欄位，並將結果轉存為單一 JSON 物件。變更日期 2026-08-17。"
        ),
        "glyphs": out,
    }
    (OUT / "glyphs.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return len(out)


# 少數辨析想額外畫一張「正確拆法 vs 錯誤拆法」的大圖對照（例：失 該拆 JIY，
# 不是 YK）。兩邊都整段手寫，不從 data/codes.json 自動推——錯的那邊 codes.json
# 當然沒有（失根本不是那樣取碼），對的那邊也乾脆一起手寫，兩邊格式才會一致，
# 也才有辦法處理「對照的不是同一個字」這種情況（合 vs 余：討論的是根 A 站不站得住，
# 不是同一個字的兩種拆法，所以兩邊各畫各的字，其餘筆畫不畫、不假裝是完整拆法）。
# key 是 (shape, 正確的字母)，跟 similar.md 那一列對得上就會畫圖，其餘列不受影響。
WRONG_BREAKDOWN = {
    ("失", "JIY"): {
        "correct": {"char": "失", "code": "JIY", "groups": [[0], [1, 2], [3, 4]]},
        "wrong":   {"char": "失", "code": "YK",  "groups": [[0, 1], [2, 3, 4]]},
    },
    # similar.md 原文：「與失字同理，因為第二筆的橫被豎劃相交，所以不能取 Y，只能
    # 分開先取一撇為 J…全字取 JH，不取 YT」——跟失一樣是「撇+橫」想取 Y 沒取成，
    # 剩下的橫、豎湊成 T，所以錯誤分組直接比照失的 YK（1-2 / 3-4-…）。
    ("牛", "JH"): {
        "correct": {"char": "牛", "code": "JH", "groups": [[0], [1, 2, 3]]},
        "wrong":   {"char": "牛", "code": "YT", "groups": [[0, 1], [2, 3]]},
    },
    # 合#1,2,3 這一列舉余當反例：余的頭三筆乍看像合、可以整段取 A，但第三筆的橫劃
    # 碰到豎劃，所以那個假設是錯的——真正的拆法是 YIM（Y 1-2、I 3-4、M 5-7，
    # 對過 data/codes.json）。畫的是余自己的「對 vs 錯」兩種拆法，不是余跟合對照
    # （Wilson：不用畫合）。AT 是示範用的錯誤假設，不是真的存在的碼。
    ("合#1,2,3", "A"): {
        "correct": {"char": "余", "code": "YIM", "groups": [[0, 1], [2, 3], [4, 5, 6]]},
        "wrong":   {"char": "余", "code": "AT",  "groups": [[0, 1, 2], [3, 4, 5, 6]]},
    },
    # 矢：「注意，因第三筆的橫劃被其他筆劃觸碰，所以不能將首三筆取為 A，全字不取 AY。」
    # 錯誤那邊推得回去：A 的筆數由原文直接指定（首三筆），剩下的第 4、5 筆是一撇一捺
    # ＝「人」，Y 底下真的收了這個形狀（人 whole、化 1–2…），筆數也對得上。
    ("矢", "YK"): {
        "correct": {"char": "矢", "code": "YK", "groups": [[0, 1], [2, 3, 4]]},
        "wrong":   {"char": "矢", "code": "AY", "groups": [[0, 1, 2], [3, 4]]},
    },
    # 午：「首兩筆可以取為 Y，全字取 YT，不取 AJ。」同樣是首三筆取 A 的那個誘惑，
    # 剩下的第 4 筆是末劃的一豎——J 底下確實有「首劃或末劃的豎劃，沒有鉤」這個
    # 單筆字根（卜 1、凸 1），筆數也對得上，所以 AJ 畫得出來。
    ("午", "YT"): {
        "correct": {"char": "午", "code": "YT", "groups": [[0, 1], [2, 3]]},
        "wrong":   {"char": "午", "code": "AJ", "groups": [[0, 1, 2], [3]]},
    },
    # 豕 沒有錯誤示範可畫——原文沒說它「不取」什麼，只描述怎麼分（J 1–2、K 其餘）。
    # 這種只有正確拆法的列 wrong 就留空，渲染那邊會只畫一張圖、不加勾也不加叉
    # （硬湊一個錯誤示範等於自己發明一條原文沒講的規則）。groups 對過 codes.json。
    ("豕", "JK"): {
        "correct": {"char": "豕", "code": "JK", "groups": [[0, 1], [2, 3, 4, 5, 6]]},
    },
    # 豖：分組一律照 data/codes.json，**不照原文的筆序**，兩者差一筆——
    # makemeahanzi 的 豖 第 5 筆是那一長撇、第 6 筆才是那一點（量過每一筆的外框：
    # 第 6 筆只有 152×145，全字最小的一筆就是點），所以 codes.json 的
    # X＝第 4、6 筆（撇與點相交）、J＝第 5 筆（孤筆一撇）是對著字形來的。
    # 原文寫的是「第四、五筆…取 X，第六筆孤筆一撇」，數字剛好相反。
    # 圖一定要跟著字形畫，不然顏色會塗在錯的筆畫上；文字照 Wilson 的原文，
    # 已回報給他。等他決定要不要改文字，這裡不用動。
    #
    # 錯誤示範 JKQ 就是原文說的「不可取 KQ」：K 想整段吃下 豕 的那五筆
    # （第 3、4、5、7、8 筆），剩下那一點另外取 Q——但點是第 6 筆，夾在 K 中間，
    # 碼排成 J→K→Q 就跟筆順對不上，正是原文要說的「否則違反筆順」。
    ("豖", "JJXJK"): {
        "correct": {"char": "豖", "code": "JJXJK",
                    "groups": [[0, 1], [2], [3, 5], [4], [6, 7]]},
        "wrong":   {"char": "豖", "code": "JKQ",
                    "groups": [[0, 1], [2, 3, 4, 6, 7], [5]]},
    },
}

# 〈取碼原則〉頁的例字對照圖。正確拆法一律從 data/codes.json 的 segments 直接算，
# 不手寫——手寫兩次同一個字的碼，遲早會有一次跟出貨的碼對不上。
#
# 錯誤拆法只收錄推得回去的：Wilson 的說明文字直接寫了筆序（雨、美），或者用剩法
# 唯一推得回去（便、東），或者能在〈字根表〉裡找到那個字母底下真的收了那個形狀、
# 筆數也對得上的字根（石的「J·撇劃」單筆字根、天的「I·兩橫」「K·類似大的字形」、
# 昊乾脆是套用天自己的 IXR 到昊的下半部）——每一條的依據寫在該條上面。
# 陳的 TBP／TPB 沒有列在這裡：那是跟正確拆法完全相同的三組筆畫、只是排列順序不同，
# 圖會長得一模一樣，畫了也看不出差別。區、樞、火目前想不出站得住腳的筆畫分法，
# 錯誤的碼照樣用文字列出，先不畫圖，好過亂猜。
#
# 每個字可以有多個錯誤示範（一個 list），例：天在文件裡「不取 IK 或 IY」兩個都要畫。
PRINCIPLE_WRONG = {
    # 火的兩個錯誤示範，筆序由 Wilson 直接給：YK 是 Y(1,3)／K(2,4)——兩個字根
    # 各自隔筆交錯，不連續；QYJ 是 Q(1)／Y(3,4)／J(2)——碼的順序 Q→Y→J 跟筆順
    # 1→2→3、4 對不上（J 對應的第 2 筆排在 Y 對應的第 3、4 筆後面），正是這一條
    # 筆順原則要說的：碼要跟著筆順排，不能為了湊字根打亂順序。
    "火": [
        {"code": "YK", "groups": [[0, 2], [1, 3]]},
        {"code": "QYJ", "groups": [[0], [2, 3], [1]]},
    ],
    "雨": [{"code": "MQQQQ", "groups": [[0, 1, 2, 3], [4], [5], [6], [7]]}],
    # 便的錯誤拆法：把「更」的第一筆橫劃當成孤立橫劃取 I（孤筆略過原則：第一筆不
    # 略過），其餘照舊——正解是略過這一筆，因為在「便」裡它已經不是全字的第一筆。
    "便": [{"code": "YIBX", "groups": [[0, 1], [2], [3, 4, 5, 6], [7, 8]]}],
    "美": [{"code": "VFK", "groups": [[0, 1, 2], [3, 4, 5], [6, 7, 8]]}],
    # 川 是〈原則套用順序〉那一節的完整示範：三種拆法逐條原則比下來。
    # A JJJ 三筆各自取碼；B NJ 把第 1、2 筆組成 N（違反 N2「豎劃不比撇劃短」，
    # 川 的第二筆明顯較短）；正解是 C JN，第 2、3 筆組成 N1「兩豎並立，右豎比左豎長」。
    "川": [
        {"code": "JJJ", "groups": [[0], [1], [2]]},
        {"code": "NJ", "groups": [[0, 1], [2]]},
    ],
    "東": [{"code": "IBM", "groups": [[0], [1, 2, 3, 4], [5, 6, 7]]}],
    # 字根表裡 J 底下有一條獨立的單筆字根「撇劃」（例字：白、力），跟「一橫加一撇」
    # 那條是分開的兩個字根，同一個字母。錯誤拆法就是把石的第 1 筆（橫）當孤立橫劃
    # 取 I（孤筆略過原則：第一筆不略過），第 2 筆（撇）單獨套上面那條「撇劃」字根取 J。
    "石": [{"code": "IJO", "groups": [[0], [1], [2, 3, 4]]}],
    # 天的錯誤拆法，兩條都在字根表裡找得到對應字根，不是憑空湊的：
    #   IK：I 用「首劃或末劃的橫劃」（第 1 筆孤立橫劃，不略過），K 用「類似『大』的
    #       字形」（K 底下真的有一條這個字根，例字尖、奈都是 3 筆）——天扣掉第 1 筆之後
    #       剩下的橫、撇、捺正好是「大」的形狀。
    #   IY：I 用「兩橫」字根（把第 1、2 筆兩個橫劃合看成一個字根，例字方、元），
    #       Y 用「人」字本身（第 3、4 筆的撇捺正是「人」的形狀）。
    "天": [
        {"code": "IK", "groups": [[0], [1, 2, 3]]},
        {"code": "IY", "groups": [[0, 1], [2, 3]]},
    ],
    # 昊的錯誤拆法沿用天自己真正的碼 IXR，套在昊的下半部（第 5–8 筆，形狀跟天
    # 的四筆一樣）：I 孤立橫劃取第 5 筆，X「一橫和一撇交叉」取第 6、7 筆，
    # R 捺劃取第 8 筆——跟天寫錯的時候如果沒寫錯（天正確答案就是 IXR）是同一個邏輯，
    # 只是這裡是昊的下半部，不該套用天自己的答案，因為這裡的橫是「兩橫」的一部分。
    "昊": [{"code": "BIXR", "groups": [[0, 1, 2, 3], [4], [5, 6], [7]]}],
    # 區的「匚」是兩筆：第 1 筆單獨一橫（頂），最後一筆是豎折（左邊＋底部合成一筆，
    # 標準筆順就是這樣寫的）。先取外框原則不適用的話，第 1 筆孤立橫劃取 I（第一筆
    # 不略過），最後一筆的豎折正是 L 底下「豎折、豎彎鉤、或豎提」那條字根，取 L；
    # 中間三個「囗」框不受影響，一樣是三個 O。
    "區": [{"code": "IOOOL", "groups": [[0], [1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]}],
    # 孤筆略過原則本身舉的反例：文字說明白寫了每一組是什麼——點劃取 Q、橫劃當成
    # 「沒辦法跟其他筆畫組成字根」略過不取、撇捺交叉取 X。code 只寫兩個真的字母
    # （Q、X），略過的那一筆不佔位——skip 這個欄位仍然要留著：build_principles() 用它
    # 驗證正確／錯誤兩側涵蓋的筆畫是同一組，圖示也是靠它（不在任何 group 裡）把那一筆
    # 畫成灰色，只是不會在 code 字串裡另外放一個佔位字元。
    "文": [{"code": "QX", "groups": [[0], [2, 3]], "skip": [1]}],
}

# 這一頁提到的所有例字，不管有沒有畫錯誤拆法對照圖，正確拆法都要能畫出來。
PRINCIPLE_CHARS = [
    "火", "雨", "更", "便", "石", "美", "區", "樞", "東", "陳", "藍", "天", "昊", "文", "川",
]


def _code_groups(segs, max_rule):
    """groups／codeGroups 的共用算法（principles.json 跟 conventional.json 都要用）。

    groups 一律是完整未砍的段（圖示要照真正的取碼順序上色，包括超過上限、顯示碼裡
    沒印出來的那幾段——例如「藍」的圖示仍然要畫出「M」那一段的紫色，「裊」也是同一
    情況：完整碼 JSEIJK 六段，顯示碼 JSEIK 砍掉第 5 段「J」只留第 6 段「K」）。
    rec["final"] 才是砍過的碼，字母個數可能少於 groups 的段數——codeGroups 記每個
    字母對應 groups 裡第幾段，讓被砍過的碼，最後一個字母仍然對到它真正的段（而不是
    誤認成緊鄰它、其實已經被砍掉的那一段）——Wilson 2026-08-21 抓到「藍」HCKAI 的
    「I」被塗成第 5 段（紫）的顏色，其實它是第 6 段（該是粉）。
    """
    groups = [s["strokes"] for s in segs]
    code_groups = list(range(len(segs)))
    if max_rule:
        p = max_rule.get("params", {})
        mx, head, tail = p.get("max", 5), p.get("head", 4), p.get("tail", 1)
        if len(segs) > mx:
            code_groups = list(range(head)) + (
                list(range(len(segs) - tail, len(segs))) if tail else [])
    return groups, code_groups


def build_principles(codes, max_rule=None):
    """〈取碼原則〉頁的例字拆法對照——見 PRINCIPLE_WRONG 上面的註解。"""
    out = {}
    for ch in PRINCIPLE_CHARS:
        rec = codes.get(ch)
        if not rec:
            continue
        segs = rec["segments"]
        groups, code_groups = _code_groups(segs, max_rule)
        correct = {"code": rec["final"], "groups": groups, "codeGroups": code_groups}
        entry = {"correct": correct}
        wrongs = PRINCIPLE_WRONG.get(ch)
        if wrongs:
            # 兩邊涵蓋的筆畫必須是同一組，不然錯誤拆法多算或漏算了幾筆自己都不知道。
            # 正確拆法自己不一定涵蓋全部筆畫——孤筆略過原則跳過的那一筆（孔的第 3 筆）
            # 不屬於任何字根，但仍然是這個字真實存在的一筆，要算進「這個字有幾筆」，
            # 所以正確側另外加上 codes.json 的 skipped 清單，兩側筆畫集合才比得起來。
            skipped = set(rec.get("skipped") or [])
            correct_idx = {i for g in correct["groups"] for i in g} | skipped
            for wrong in wrongs:
                wrong_idx = {i for g in wrong["groups"] for i in g} | set(wrong.get("skip") or [])
                assert correct_idx == wrong_idx, (
                    f"principles: {ch} 正確拆法筆畫 {sorted(correct_idx)}，"
                    f"{wrong['code']} 錯誤拆法筆畫 {sorted(wrong_idx)}，對不上")
            entry["wrongs"] = wrongs
        out[ch] = entry
    return out


def build_practice_hints(chars, codes, zigen_raw, max_rule):
    """一批字每個字的「這一段是哪一個字根」—— 給 `/` 提示鏈、拼音查字共用。

    為什麼要算：`codes.json` 的 segments 只記字母，不記是哪一條字根。而同一個
    字母底下常有好幾條筆數相同的字根（J 的 1 筆字根就有五條：撇劃、橫撇、豎鉤、
    末劃的豎、橫鉤），光靠「字母＋筆數」猜，1527 個字段裡有 25% 猜不準 ——
    而且猜不準的正好是〈相近字形辨析〉在講的那幾組（人字頭 vs 人字變形在左上角）。
    提示要是指錯字根，比不給提示還糟。

    所以直接用 repo 自己的比對器 `retune.py`（Side A 的 tools/辨析候選.py 也是用它），
    規則照抄：同字母、同筆數、`min(dist) < thr`，thr 取該字根的門檻、沒有就取
    `meta.merge_threshold`。字根的參考向量含 alts。

    需要 graphics.txt 的 medians。Side C 沒有 data/graphics.txt，但 build_glyphs()
    下載的快取（site/.cache/）是同一份檔案，所以把 retune 的路徑指過去就好 ——
    medians **不會**輸出到網站，只在建置時用來判斷哪一段是哪一條字根。

    比對器載不進來（沒有 retune.py、沒有 graphics.txt）就回傳 {}，
    `/` 提示會退成「只標筆畫、只給字母」，中間那一步不出現。
    """
    try:
        import sys
        sys.path.insert(0, str(ROOT))
        import retune
        retune.GRAPHICS = _graphics_path()
        retune._med = None                      # 換過路徑，清掉可能已經載好的快取
        from retune import medians, stroke_vec, dist
    except Exception as e:
        print(f"  ⚠️ 載不進比對器（{e}）—— `/` 提示不會有取形意圖那一步")
        return {}

    gthr = zigen_raw.get("meta", {}).get("merge_threshold")
    if gthr is None:
        return {}

    by = {}
    for L in zigen_raw.get("letters", []):
        for it in L.get("intentions", []):
            for sh in it.get("shapes", []):
                g = sh.get("glyph") or {}
                if not g:
                    continue
                vecs = []
                for f in [g] + (sh.get("alts") or []):
                    med = medians(f.get("src"))
                    if not med:
                        continue
                    try:
                        v = stroke_vec([med[i] for i in f["strokes"]])
                    except (IndexError, KeyError):
                        continue
                    if v:
                        vecs.append(v)
                if not vecs:
                    continue
                by.setdefault((L["letter"], len(g["strokes"])), []).append(
                    {"thr": sh.get("thr", gthr), "vecs": vecs,
                     "desc": (it.get("desc") or "").strip()})

    # 「頭四尾一」：碼超過 max 就只打頭 head 段加尾 tail 段，中間那幾段不用打。
    # 主碼、兼容碼各自算各自的（兩套拆法段數常常不一樣）。
    p = (max_rule or {}).get("params", {}) if max_rule else {}
    mx, head, tail = p.get("max", 5), p.get("head", 4), p.get("tail", 1)

    def order_of(n):
        if not max_rule or n <= mx:
            return list(range(n))
        return list(range(head)) + ([n - tail + i for i in range(tail)] if tail else [])

    def one_path(segments, skipped_raw):
        """一套拆法（主碼或某一條兼容碼）→ {"s": 每段, "c": 主碼用到第幾段}。

        每一段標三件事：字母、哪幾筆、比對到的字根取形意圖。再加一個 k：
        孤筆略過原則（rules.json 的 skip_isolated_hv，全表唯一會略過筆畫的規則）
        在**這一段前面**丟掉了一筆。學的人打到那裡最容易補一個 I 或 J 上去
        （教 = TXPX，很多人會打成 TXPIX），試打頁靠這個旗標才講得出是哪一條
        原則絆到人（Wilson）。
        """
        nonlocal unmatched
        skipped = set(skipped_raw or ())
        segs = []
        for si, seg in enumerate(segments):
            try:
                v = stroke_vec([med[i] for i in seg["strokes"]])
            except IndexError:
                v = None
            best, bd = None, None
            if v:
                for e in by.get((seg["letter"], len(seg["strokes"])), ()):
                    d = min(dist(v, ev) for ev in e["vecs"])
                    if d < e["thr"] and (bd is None or d < bd):
                        best, bd = e, d
            if not best:
                unmatched += 1
            one = {"L": seg["letter"], "st": seg["strokes"],
                   "d": best["desc"] if best else ""}
            if skipped and seg["strokes"]:
                prev = max(segments[si - 1]["strokes"]) if si else -1
                lo = min(seg["strokes"])
                if any(prev < x < lo for x in skipped):
                    one["k"] = 1
            segs.append(one)
        return {"s": segs, "c": order_of(len(segs))}

    tw = tw_forms()
    out, unmatched = {}, 0
    for ch in sorted(chars):
        rec = codes.get(ch)
        if not rec or not rec.get("segments"):
            continue
        # 教育部標準字體那幾個字（TW_FORM）用 g0v 的 track 當中線 —— makemeahanzi
        # 那一筆畫的是別種字形，拿它的中線去比對這個字的段，配到的字根全是錯的。
        #
        # ⚠️ 只換**這個字自己**的中線，不要去動 retune._med。zigen.json 裡有一條 J 的
        # 參考向量就是「為 第 5 筆」，那個 5 指的是 makemeahanzi 那個 12 筆字形；全域
        # 蓋掉的話，那條參考向量會變成 9 筆字形的第 5 筆（四點的第一點），於是整張表
        # 凡是一筆的 J 都可能誤配到它。字根的參考向量一律維持 makemeahanzi。
        med = tw.get(ch, {}).get("medians") or medians(GLYPH_ALIAS.get(ch, ch))
        if not med:
            continue
        # ⚠️ 提示要照**主碼**走，不是照分段走：親 分段是 I V T D J … L，主碼卻是
        # IVTDL，第五碼是最後那一段的 L，不是第五段的 J。照分段給提示會叫人打 J，
        # 而 J 打下去是錯的（Wilson 抓到）。order_of() 就是在算這個。
        ent = one_path(rec["segments"], rec.get("skipped"))
        # 兼容碼是**另一套拆法**，段跟主碼對不上（教 主碼 T[0,1] X[2,3] P[4,5] X[7…]，
        # 兼容碼 F[0,1,2] J[3] P[4,5] X[7…]）。所以各存一套，試打頁才知道使用者
        # 現在打的是哪一套、該把哪幾筆上色（Wilson：打兼容碼時完全沒有回饋）。
        alts = [one_path(a["segments"], a.get("skipped"))
                for a in (rec.get("alts") or []) if a.get("segments")]
        if alts:
            ent["a"] = alts
        out[ch] = ent
    if unmatched:
        print(f"  （{unmatched} 個字段比對不到字根，那幾段的 `/` 只給筆畫和字母）")
    return out


def build_practice(main, codes, zigen_raw, max_rule, conv_chars):
    """試打頁的參考文章：site/content/practice.md，`---` 底下的正文。

    每一篇用一行 `@ 篇名｜作者` 開頭，底下空行分段。回傳
    {"texts": [ {title, author, paras, chars, missing}, … ], "glyphs": …, "segs": …}
    —— 字形與字根分段是**所有篇共用一份**，兩篇重疊的字才不會各存一份。

    檔案不存在或沒有任何一篇就回傳 None，那一整塊（參考文章＋田字格）不出現，
    試打框本身照常能用。

    `main` 是 dict.json 的「字 → 主碼」，這裡只拿來數有幾個字還沒取碼：
    沒取碼的字打不出來，頁面會標成「尚未取碼」讓人跳過去，但**建置時就要講**，
    不然只有真的練到那一格的人才會發現。
    """
    path = ROOT / "site" / "content" / "practice.md"
    if not path.exists():
        return None
    raw = path.read_text("utf-8")
    # 檔頭的說明到第一個單獨成行的 --- 為止，底下才是正文
    m = re.search(r"^---\s*$", raw, flags=re.M)
    body = raw[m.end():] if m else raw

    texts, cur = [], None
    for block in body.split("\n\n"):
        block = block.strip()
        if not block or block.startswith("#"):
            continue
        if block.startswith("@"):
            head = block[1:].strip()
            title, _, author = head.partition("｜")
            cur = {"title": title.strip(), "author": author.strip(), "paras": []}
            texts.append(cur)
            continue
        if cur is not None:
            cur["paras"].append(block)
    texts = [t for t in texts if t["paras"]]
    if not texts:
        return None

    all_paras = [p for t in texts for p in t["paras"]]
    for t in texts:
        hans = [c for p in t["paras"] for c in p if "\u4e00" <= c <= "\u9fff"]
        t["chars"] = len(hans)
        t["missing"] = sorted({c for c in hans if c not in main})

    all_hans = {c for p in all_paras for c in p if "\u4e00" <= c <= "\u9fff"}
    # 字形跟文章放在同一個檔：田字格一次只畫一個字，但那個字隨時會換，
    # 沒辦法逐字抓。抓不到 graphics.txt 就沒有 glyphs，田字格退回系統字型 ——
    # 練習照樣能練，只是格子裡不是筆畫輪廓。
    glyphs = _practice_glyphs(all_hans)
    hints = build_practice_hints(all_hans, codes, zigen_raw, max_rule)
    _check_segs_fit(hints, glyphs)
    return {
        "note": "generated by site/tools/build_site_data.py — 內容見 site/content/practice.md",
        "source": "zh.wikisource.org",
        "texts": texts,
        # 字形資料的授權跟 glyphs.json 完全一樣，而且這個檔也會隨網站發佈出去，
        # 所以義務也一樣：ARPHICPL.txt 必須跟著發佈，這三欄不要拿掉。
        "glyph_source": "makemeahanzi (https://github.com/skishore/makemeahanzi) graphics.txt",
        **_tw_credit(glyphs),
        "glyph_license": "Arphic Public License — 全文見 ARPHICPL.txt，隨網站一併發佈",
        "glyph_modifications": (
            "自 graphics.txt 取出參考文章用得到的字元，保留其 strokes 欄"
            "（字形輪廓，SVG path 指令），未修改任何路徑資料；捨棄 medians 與其餘欄位。"),
        "glyphs": glyphs,
        "segs": hints,
        # 約定字（rules.json 的 convention 規則，見〈約定字表〉）不是照筆畫拆碼，
        # 是整字背下來的——練字時打到這種字，前面幾條規則的推理方式完全不適用，
        # 不標出來的話，人會以為自己看不出字根、其實是這個字本來就不歸那套推理管
        # （Wilson，2026-08-24：像 上、一 這種字要讓學的人知道「這個特殊」）。
        "conv": sorted(all_hans & conv_chars),
    }


def _tw_credit(glyphs):
    """這一份資料裡真的有用到教育部標準字體的字，就把出處寫進去。

    不是裝飾：g0v/zh-stroke-data 的資料著作權屬教育部，條件是非商業、教育用途、
    註明出處（見 site/TWSTROKE.txt）。CI 靠這個欄位判斷該不該要求 TWSTROKE.txt
    跟著發佈，所以沒用到就不要寫 —— 寫了會逼 CI 檢查一個其實不需要的檔案。"""
    used = sorted(c for c in tw_forms() if c in glyphs)
    if not used:
        return {}
    return {"tw_glyph_source": "g0v/zh-stroke-data (https://github.com/g0v/zh-stroke-data)"
                               " — 教育部《常用國字標準字體筆順學習網》，非商業教育用途，"
                               "見 site/TWSTROKE.txt",
            "tw_glyph_chars": "".join(used)}


def _check_segs_fit(segs, glyphs):
    """段號必須指得到字形裡真的存在的筆畫。

    這不是杞人憂天：「爲」的取碼段號一路到 11（照 12 筆的字形標的），可是手上那份
    字形只有 9 筆 —— 標的時候看到的圖跟事後拿得到的圖不是同一個，而且沒有任何地方
    會叫出來。段號對不上的話，田字格會把顏色塗到不存在的筆畫上（看起來就是「按了
    提示卻沒有筆畫亮起來」），非常難查。所以這裡直接印出來。"""
    bad = []
    for ch, e in segs.items():
        n = len(glyphs.get(ch) or ())
        if not n:
            continue                      # 沒有字形是另一回事，田字格會退回系統字型
        mx = max((i for sg in e["s"] for i in sg["st"]), default=-1)
        if mx >= n:
            bad.append(f"{ch}（段號到 {mx}，字形只有 {n} 筆）")
    if bad:
        print("  ⚠️ 取碼段號超出字形筆數，這幾個字的田字格會塗到不存在的筆畫："
              + "、".join(bad))


def _practice_glyphs(want):
    """參考文章用得到的字形，直接從 graphics.txt 撈 —— 跟 build_glyphs() 同一份
    來源、同一個授權（Arphic PL，見那邊的說明與 site/ARPHICPL.txt）。
    分開撈是因為兩邊的收字集合不一樣，合起來只會讓字根表白白變大。"""
    try:
        path = _graphics_path()
    except Exception as e:
        print(f"  ⚠️ 參考文章拿不到字形（{e}）—— 田字格會退回系統字型")
        return {}
    out, raw = {}, {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            c = o.get("character")
            if c in want and o.get("strokes"):
                out[c] = o["strokes"]
            if c in _ALIAS_SRC and o.get("strokes"):
                raw[c] = o["strokes"]
    for a, src in GLYPH_ALIAS.items():       # 同 build_glyphs()
        if a in want and raw.get(src):
            out[a] = raw[src]
    for c, g in tw_forms().items():          # 教育部標準字體優先，要排在 alias 之後
        if c in want:
            out[c] = g["strokes"]
    return out


# 拼音查字（自由試打用）：收現代字頻最高的這麼多字。500→3000（Wilson，
# 2026-08-22，覺得堪用後擴大範圍）。
PINYIN_TOP_N = 3000


def build_pinyin(codes, zigen_raw, max_rule, charfreq, conv_chars):
    """拼音查字：〈自由試打〉頁想到一個字的讀音、不知道怎麼拆碼時查——輸入拼音
    （不分聲調），列出候選字，選了就看它的拆碼圖跟碼。跟〈跟著打〉互補：那邊是
    照著文章一字一字打，這邊是想到哪個字就查哪個字，兩邊共用同一套拆碼圖畫法
    （site/assets/try.js 的 paintGlyph／segsFrom）。

    先從**已經取碼**的字裡挑，再照現代字頻（data/charfreq.json，台港新聞用字，
    跟 rime-essay 的 freq.json 不一樣——那份常把冷字排前面）排序取前 PINYIN_TOP_N
    個——不是反過來從字頻表前 N 名裡挑有碼的字：Wilson 已取碼 6587 字，但字頻表
    前 3000 名裡只有 1643 個字有碼（其餘 1357 個還沒排到），先過字頻表會把「已取碼
    但字頻表排不進前 3000」的字全部漏掉，明明有碼卻查不到（Wilson 2026-08-22 發現：
    設 3000 卻只查得到 1640 字，原因就是這個）。沒進字頻表的字排序上退到最後
    （charfreq.get(c, 0)），但只要碼表裡還有位置就收得進來。多音字全收
    （heteronym=True）：查「彈」不管想找 tán 還是 dàn，兩個讀音都該找得到。

    拼音來自 pypinyin（MIT，pip install -r requirements.txt 才有），沒裝就跳過整塊，
    〈自由試打〉的拼音查字框會顯示載入失敗，其餘功能不受影響。
    """
    try:
        import pypinyin
    except ImportError as e:
        print(f"  ⚠️ 沒裝 pypinyin（{e}）—— 不產生拼音查字，跑 pip install -r requirements.txt 補上")
        return None, None

    coded = [c for c, rec in codes.items() if rec.get("segments")]
    top = sorted(coded, key=lambda c: -charfreq.get(c, 0))[:PINYIN_TOP_N]
    chars = set(top)
    if not chars:
        return None, None

    index = {}
    for ch in chars:
        readings = pypinyin.pinyin(ch, style=pypinyin.Style.NORMAL, heteronym=True)
        for py in set(readings[0]):
            py = py.lower()
            if py:
                index.setdefault(py, []).append(ch)
    for bucket in index.values():
        bucket.sort(key=lambda c: -charfreq.get(c, 0))

    segs = build_practice_hints(chars, codes, zigen_raw, max_rule)
    glyphs = _practice_glyphs(chars)
    # ⚠️ 拆成兩份，因為兩份的**下載時機**不一樣（Wilson 2026-08-24）：
    #   pinyin.json        —— 查得到什麼字。約 30KB，載入頁面時就抓。
    #   pinyin_glyphs.json —— 那些字長什麼樣、怎麼拆。約 7.9MB，等使用者真的
    #                          點進查字框才抓。
    # 合成一份的時候，每個開試打頁的人都要先下載 7.9MB 才能開始打字，而其中
    # 絕大多數人根本不會用到查字。碼本身不在這裡面 —— dict.json 的 main 已經
    # 有每個字的主碼，所以「輸入 wo → 我 JKXQ」只靠 index 就成立。
    meta = {
        "note": "generated by site/tools/build_site_data.py",
        # 字形資料的授權跟 practice.json／glyphs.json 完全一樣，一樣要隨附授權全文。
        "glyph_source": "makemeahanzi (https://github.com/skishore/makemeahanzi) graphics.txt",
        **_tw_credit(glyphs),
        "glyph_license": "Arphic Public License — 全文見 ARPHICPL.txt，隨網站一併發佈",
        "glyph_modifications": (
            "自 graphics.txt 取出拼音查字用得到的字元，保留其 strokes 欄"
            "（字形輪廓，SVG path 指令），未修改任何路徑資料；捨棄 medians 與其餘欄位。"),
    }
    return {
        "note": meta["note"],
        "index": index,
        # 跟 practice.json 同一個理由：約定字不是照筆畫拆的，查到這種字要標出來。
        "conv": sorted(chars & conv_chars),
    }, dict(meta, segs=segs, glyphs=glyphs)


def build_similar(codes):
    """相近字形辨析：全部來自 site/content/similar.md，Wilson 手寫。

    資料裡沒有這種東西 —— 「哪兩個形狀容易認錯」是取碼的人腦袋裡的知識，zigen.json
    只知道兩個形狀不一樣（meta.distinct），不知道它們**像**。所以這一節不產生內容，
    只負責把手寫的檔案讀進來。檔案不存在或全空就回傳空 list，那一節整段不出現。

    格式（詳見 similar.md 檔頭）：
        ## 標題
        - 形 | 字母 | 例字 | 特徵
        > 整組說明
    """
    path = ROOT / "site" / "content" / "similar.md"
    if not path.exists():
        return []

    text = path.read_text("utf-8")
    # <!-- --> 之間是候選清單，不要當成內容
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    # ``` 圍起來的是格式說明本身（檔頭那段範例），不是資料 —— 不擋掉的話
    # 範例裡的「## 標題（隨便寫…）」會變成網站上真的一組辨析
    text = re.sub(r"^```.*?^```", "", text, flags=re.S | re.M)

    groups, cur = [], None
    for raw in text.splitlines():
        line = raw.strip()
        # Wilson 會很自然地寫 **粗體**；這裡不做 markdown，把星號去掉就好
        line = re.sub(r"\*\*(.+?)\*\*", r"\1", line)
        if line.startswith("## "):
            if cur and cur["items"]:
                groups.append(cur)
            cur = {"title": line[3:].strip(), "items": [], "note": ""}
        elif line.startswith("- ") and cur is not None:
            parts = [p.strip() for p in line[2:].split("|")]
            if len(parts) < 4:
                continue                      # 欄位不夠就跳過，不要半條爛資料上線
            shape, letter, ex, trait = parts[0], parts[1], parts[2], " ".join(parts[3:])
            if shape == "？" or not letter:
                continue                      # 還沒填的候選
            # Wilson 的說明文字裡經常會點名「不取哪個碼」（不取 YK、不取 DIV…），
            # 抓出來給網站畫一個淡化＋刪除線的對照，不用另外在格式裡加一欄。
            m_wrong = re.search(r"不取\s*([A-Z]{1,8})", trait)
            wrong = m_wrong.group(1) if m_wrong else None
            # 例字畫出來並高亮。比對的是**整串取碼**，不是只比第一個字母：
            # 目 的取碼是 DI，那 相 裡要亮的是 D 段加 I 段（＝整個目），不是只有 D。
            # 做法是在例字的分段裡找「連續一段、字母串起來剛好等於取碼」的區間。
            #
            # 這樣同時解掉一個舊問題：秩 = J T J I Y，取碼 JIY 只會對到後面那三段
            # （＝失），不會把前面「禾」的那個 J 也一起亮起來。
            # 「DI（D）」→「DI」：括號裡是「作偏旁時的碼」，要先整段拿掉，
            # 只留非括號的字母；否則會變成「DID」，什麼都對不上。
            wanted = re.sub(r"[^A-Z]", "", re.sub(r"[（(].*?[）)]", "", letter))
            items = []
            for c in ex.split():
                if not c:
                    continue
                segs = codes.get(c, {}).get("segments") or []
                letters = [sg.get("letter") for sg in segs]
                # 找不到完整的碼時，逐步砍掉尾巴再找。這是必要的，因為取碼原則本來就
                # 會讓某些筆劃在特定字裡被略過：目 是 DI，但 眼 取 DEK ——「目」的末筆
                # 橫劃因為不再是全字末筆而略過，所以 眼 裡只找得到 D。整串對不上就
                # 退而求其次，仍然標出那個字裡真正對應的部分。
                runs = []
                probe = wanted
                while probe and not runs:
                    n = len(probe)
                    for i in range(len(letters) - n + 1):
                        if "".join(letters[i:i + n]) == probe:
                            runs.append([k for sg in segs[i:i + n]
                                         for k in (sg.get("strokes") or [])])
                    if not runs:
                        probe = probe[:-1]
                items.append({"c": c,
                              "st": sorted({k for r in runs for k in r}),
                              "segs": [sorted(r) for r in runs]})
            alt = WRONG_BREAKDOWN.get((shape, letter))
            cur["items"].append({
                "shape": shape,
                "letter": letter,
                "ex": items,
                "trait": trait,
                "wrong": wrong,
                "alt": alt,
            })
        elif line.startswith(">") and cur is not None:
            cur["note"] = (cur["note"] + " " + line[1:].strip()).strip()

    if cur and cur["items"]:
        groups.append(cur)
    return groups


# 每個字根列幾個例字。3–4 是 Wilson 定的：一個取形意圖底下最多 13 個形狀，
# 掛在意圖上會讓每一列分不到；掛在字根上、每列 4 個，版面才平均。
# 調這個數字會連帶改變 glyphs.json 的大小（3→2.8MB、4→3.2MB、5→3.7MB）。
EX_PER_SHAPE = 4


def load_example_picks(dupes):
    """讀 site/content/examples.md —— Wilson 手挑的例字，覆蓋自動挑的結果。

    回傳 {(字母, 來源字): [字…]} 與 {(字母, 來源字, 筆序tuple): [字…]}。
    後者只有四個字根用得到（同一字母下兩個字根取自同一個來源字：F 學、K 鼎、
    P 們、R 所），其餘寫「字母 來源字」就夠。
    """
    path = ROOT / "site" / "content" / "examples.md"
    picks = {}
    if not path.exists():
        return picks
    text = re.sub(r"^```.*?^```", "", path.read_text("utf-8"), flags=re.S | re.M)
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, rest = line.partition("=")
        parts = key.split()
        if len(parts) != 2:
            continue
        letter, src = parts[0].strip(), parts[1].strip()
        if not re.fullmatch(r"[A-Z]", letter):
            continue
        st = None
        if "#" in src:
            src, _, nums = src.partition("#")
            st = tuple(sorted(int(n) - 1 for n in re.findall(r"\d+", nums)))
        chars = [c for c in rest.split() if c]
        if not chars:
            continue
        key = (letter, src.strip(), st)
        if key in picks:
            # 同一個字根寫了兩次，後面的會蓋掉前面的。不出聲的話，改了半天
            # 卻看不到效果（因為底下還有一行舊的）會很難查。
            dupes.append(f"{letter} {src.strip()}：寫了不只一次，只有最後一行生效")
        picks[key] = chars
    return picks


def _rank_within_src(L, g, it):
    """這個字根在「同一個來源字、同字母、同筆數」的字根裡排第幾，共有幾個。

    們 底下有兩個 4 筆的 P（第 3–6 與第 7–10，門的左右半），回傳 (0, 2) 和 (1, 2)。
    只有一個時回傳 (0, 1)，規則 3 就不會啟動。
    """
    src, st = g.get("src"), g.get("strokes") or []
    if not src or not st:
        return (0, 1)
    sibs = []
    for it2 in L.get("intentions", []):
        for sh2 in it2.get("shapes", []):
            g2 = sh2.get("glyph") or {}
            if g2.get("src") == src and len(g2.get("strokes") or []) == len(st):
                sibs.append(tuple(sorted(g2["strokes"])))
    sibs = sorted(set(sibs))
    key = tuple(sorted(st))
    return (sibs.index(key), len(sibs)) if key in sibs else (0, 1)


def _examples(seen, nstroke, letter, codes, limit, picked=None, warn=None, label="",
              freq=None,
              own=None, claims=None, owners=None, rank=None, primary=None,
              standard=None, nstrokes=None):
    """挑例字，並算出每個例字裡哪幾筆屬於這個字根（用來高亮）。

    高亮的筆序是**建置時**用 codes.json 的 segments 反查的：取該字裡「字母相同、
    筆數也對得上」的段。標註工具是用中線做形狀比對，那需要 medians，而網站畫圖
    用不到它。同一個字裡有兩段都符合時，**不能**一律全部高亮 —— 那兩段有可能屬於不同的字根。
    髻 就是這樣：F(1,2,3) 屬「下」字類、F(11,12,13) 屬「土」字類，兩段都是 3 筆的 F。
    全部塗會讓「土」那一列看起來像是在宣稱前三筆也是它，那是錯的。

    用兩條規則分辨，都只靠手上的資料，不需要幾何：
      1. own —— 這個字就是本字根的來源字，直接用字根自己記的筆序，這是權威答案。
         髻 是「土」類字根的來源字，所以那一列只塗 11–13。
      2. claims —— 否則扣掉「別的字根以這個字為來源字」所宣告的筆序。髻 出現在
         「下」類那一列時，11–13 已被「土」類認領，扣掉後剩 1–3，正好正確。
    兩條都用不上才全部高亮（朋＝D[1-4]D[5-8]，那兩段確實是同一個字根）。
    """
    own = own or {}
    claims = claims or {}
    owners = owners or {}

    if picked:
        chosen = picked
    else:
        # 來源字排最前面。字根就是從那個字上圈出來的，它是這個字根的定義實例——
        # 尤其是「整個字」型的字根（王、月、小、夕），把 王 排在 全、主 後面很怪。
        # 來源字不一定在 seen 裡（seen 是取碼時遇到的字），沒有就補進去。
        #
        # ⚠️ 只提**主要**來源字（glyph.src），不要連 alts 一起提。alts 是同一個形狀的
        # 其他定義出處，不是好例字：K 跳#12,13 的 alts 是 率／衆／菡，全提上來就把
        # 四個位置佔滿，把 seen 裡的 挑 逃 函 涵 兆 全擠掉了。
        # 來源字一定要在候選裡（它按定義含有這個字根，seen 不一定收了它），
        # 但**不再強制排第一**——排序交給下面的「愈單純愈前面」。
        # 原本強制來源字第一，會讓 A:名 那一列排成 名 夕 外 多，把 夕 壓在 名 後面；
        # 夕 就是整個字根本身，最能說明這個字根長什麼樣。
        # 「整個字」型的字根（王）本來就同時是來源字又最單純，照樣排第一。
        head = []
        seen_rest = list(seen)
        if primary and primary in codes and primary not in seen_rest:
            seen_rest.append(primary)

        # 其餘的優先挑「同字母同筆數之下只有這一個字根用到」的字。多個字根都用到的字
        # （等：竹 和 寸 都是 3 筆的 A）分不出哪一段是哪一個，塗下去有一半機率
        # 塗到別人的字根上。字根平均有幾十個例字可選，跳過幾個完全不吃虧。
        # 例字愈單純愈好：字根佔整個字的比例愈大，愈看得出「這個字根長這樣」。
        # 夕（字根就是整個字）勝過 多、名；兆 勝過 跳、挑；成 勝過 城；貝 勝過 資。
        # 實作上就是「整個字筆畫少的排前面」—— 字根筆數固定，字愈短佔比就愈高。
        # 字頻只當同筆畫數時的次要條件：光看字頻會把 跳(13筆) 排在 兆(6筆) 前面。
        ns = nstrokes or {}
        fq = freq or {}
        std = standard or set()

        def simplicity(c):
            # 主要：整個字的筆畫數（少＝字根佔比大）。次要：字頻，同筆畫數時取常見的。
            return (ns.get(c, 99), fq.get(c, 10 ** 9))

        clean, variant, murky = [], [], []
        for c in seen_rest:
            if len(owners.get((letter, nstroke, c), ())) > 1:
                murky.append(c)
            elif std and c not in std:
                variant.append(c)      # 異體字（衆）往後，甲表才是標準寫法
            else:
                clean.append(c)
        clean.sort(key=simplicity)
        variant.sort(key=simplicity)
        chosen = (head + clean + variant + murky)[:limit]

        # 「字根」欄寫的是「把 第 4–6 筆」，那個字理當看得到。排序照單純度走之後，
        # 來源字常常被更單純的字擠出前四名（實測 158 條），欄位指著一個看不到的字
        # 很奇怪。所以保留一個名額給它 —— 位置仍由單純度決定，只是保證在場。
        if primary and primary in codes and primary not in chosen:
            chosen = sorted(chosen[:limit - 1] + [primary], key=simplicity)
    out = []
    for c in chosen:
        if c in own:                      # 規則 1：這個字就是本字根的來源字
            out.append({"c": c, "st": sorted(own[c]), "segs": [sorted(own[c])]})
            continue
        cand = []
        for seg in (codes.get(c, {}).get("segments") or []):
            if seg.get("letter") == letter and len(seg.get("strokes") or []) == nstroke:
                cand.append(tuple(sorted(seg["strokes"])))
        taken = claims.get(c, set())      # 規則 2：扣掉別的字根認領走的段
        rest = [t for t in cand if t not in taken]

        # 規則 3（位置對應）：同一個來源字底下有好幾個同字母同筆數的字根時
        # （們 第3–6 是門的左半、第7–10 是右半），它們的先後次序跟例字裡各段的
        # 先後次序是對得起來的 —— 第 n 個字根對到第 n 段。開＝P(1-4) P(5-8)，
        # 左半字根拿 1–4、右半字根拿 5–8，而不是兩段都拿。
        if rank is not None and len(rest) > 1 and rank[1] > 1 and rank[1] == len(rest):
            rest = [sorted(rest)[rank[0]]]
        # 同一個字根在一個字裡出現兩次（朋＝月月、夠＝夕夕）時，分開記每一次出現，
        # 網站才能把第二次塗成深一點的橙色 —— 讓人看出「是這個字根出現兩次」，
        # 而不是「這個字根就是整個朋」。
        segs = [list(t) for t in (rest if rest else cand)]
        hi = [i for t in segs for i in t]
        # 手挑的字要驗：查不到對應的段，代表這個字沒有用到這個字根（或還沒取碼）。
        # 它照樣會顯示，但不會高亮 —— 不出聲的話就會悄悄擺一個舉錯的例子在網站上。
        if picked and not hi and warn is not None:
            why = "還沒取碼" if c not in codes else f"拆碼裡沒有 {letter} 且筆數為 {nstroke} 的一段"
            warn.append(f"{label}：例字「{c}」{why}，不會高亮")
        out.append({"c": c, "st": sorted(set(hi)), "segs": segs})
    return out



def _pick_for(picks, letter, src, st, warn):
    """找這個字根有沒有被手挑例字。先比 (字母, 來源字, 筆序)，再退回 (字母, 來源字)。"""
    if not picks:
        return None
    exact = picks.get((letter, src, tuple(sorted(st))))
    if exact:
        return exact
    loose = picks.get((letter, src, None))
    return loose or None


def load_intent_notes(warn):
    """讀 site/content/intent_notes.md —— 少數取形意圖的額外說明，Wilson 手寫。

    key 是「字母＋該字母底下取形意圖的順序」（A3 ＝ A 的第三個意圖），跟字根表上
    看到的順序一致。序號會隨 Side A 合併意圖而移動，所以建置時把每一條對到的意圖
    原文印出來，對不上一眼就看得到。
    """
    path = ROOT / "site" / "content" / "intent_notes.md"
    if not path.exists():
        return {}
    text = re.sub(r"^```.*?^```", "", path.read_text("utf-8"), flags=re.S | re.M)
    notes = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        m = re.fullmatch(r"([A-Z])\s*(\d+)", k.strip())
        if m and v.strip():
            notes[(m.group(1), int(m.group(2)))] = v.strip()
    return notes


# 三簡碼沒有挑字清單（全碼表通用），這裡只現算幾個例字做示範。挑的是常見字、
# 主碼四碼以上、而且不在約定簡碼的 63 字名單裡——兩種機制分開示範，不要用同一個字
# 讓人搞混「這是約定簡碼還是三簡碼」。
SHORT3_DEMO_CHARS = ["於", "最", "高", "本", "心"]

# 少數字是「manual」取碼（code 直接手打，沒有逐筆拆的 segments），筆劃數反推不出來，
# 只能另外查證後手填。**不要**退回用 makemeahanzi 的 SVG 筆畫段落數當筆劃數——那是
# 字型的畫法，不是教育部筆順標準，這兩個字剛好就是反例：makemeahanzi 把「為」畫成
# 「爲」的複雜字形（12 段路徑），「爲」本身在那份資料裡則整條缺席，兩個字都會算錯。
# 目前只有這兩個字在 63 個約定簡碼名單裡撞到這個問題（Wilson 2026-08-21 核過筆劃數）。
MANUAL_STROKE_COUNT = {"為": 9, "爲": 12}


def build_jianma(codes, rules):
    """〈簡碼〉頁：三種縮短取碼的機制，資料全部從 rules.json＋codes.json 現算。

    約定簡碼、左簡碼的清單都是 Wilson 手核的名單（rules.json 的 entries／members），
    這裡照抄，只補上從 codes.json 查到的主碼；三簡碼是全碼表通用的規則，沒有清單，
    只現算幾個例字做示範（算法見 SHORT3_DEMO_CHARS 上面的註解）。
    """
    rules_by_id = {r["id"]: r for r in rules.get("rules", [])}
    warn = []

    def stroke_count(ch, rec):
        # 筆劃數優先從 segments 反推（跟 build_zigen 的 nstrokes 同一招）：
        # codes.json 沒有獨立存筆劃總數這個欄位。manual 取碼的字沒有 segments，
        # 查 MANUAL_STROKE_COUNT；兩邊都沒有就回傳 None，讓呼叫端自己決定怎麼辦，
        # 不要悄悄印出一個看似正常、其實是 0 的假數字。
        mx = -1
        for seg in rec.get("segments") or []:
            for s in seg.get("strokes") or []:
                if s > mx:
                    mx = s
        if mx >= 0:
            return mx + 1
        if ch in MANUAL_STROKE_COUNT:
            return MANUAL_STROKE_COUNT[ch]
        warn.append(f"簡碼頁：「{ch}」是 manual 取碼、沒有 segments，也不在 "
                     f"MANUAL_STROKE_COUNT 裡——筆劃數查不出來，先填 0")
        return 0

    convention = []
    sc = rules_by_id.get("short_code")
    if sc:
        for e in sc.get("entries", []):
            ch, short = e.get("c"), e.get("short")
            rec = codes.get(ch)
            if not ch or not short or not rec:
                continue
            convention.append({
                "c": ch, "code": rec["final"], "short": short,
                "strokes": stroke_count(ch, rec),
            })
    for w in warn:
        print(f"  ⚠️ {w}")

    short3_examples = []
    for ch in SHORT3_DEMO_CHARS:
        rec = codes.get(ch)
        if not rec:
            continue
        f = rec["final"]
        if len(f) < 4:
            continue
        short3_examples.append({"c": ch, "code": f, "short": f[0] + f[1] + f[-1]})
    eligible = sum(1 for rec in codes.values() if len(rec.get("final") or "") >= 4)

    left_short = []
    ls = rules_by_id.get("left_short")
    if ls:
        for e in ls.get("entries", []):
            comp = e.get("comp")
            if not comp:
                continue
            left_short.append({
                "comp": comp,
                "alias": e.get("alias") or [comp],
                "code": e.get("code"),
                "short": e.get("short"),
                "ok": e.get("ok") or [],
                "no": e.get("no"),
                "members": e.get("members") or [],
            })

    return {
        "note": "generated by site/tools/build_site_data.py — do not edit",
        "convention": convention,
        "short3": {"examples": short3_examples, "eligible": eligible},
        "left_short": left_short,
    }


# 「偏旁另有取法」這組先不上（Wilson 2026-08-21）：這組字單獨成字取一個碼，當偏旁時
# 卻取另一個完全不同的碼（如 金 單獨 YFV、當偏旁 YFV 不變但 左簡碼 才截短——這組其實
# 是「同一形狀兩種語境」，跟其他七組「這個字的碼是手動指定、不是拆出來的」性質不同，
# 页面呈现方式还没定案，先只收其余七组。
CONVENTIONAL_SKIP_GROUPS = {"偏旁另有取法"}

# 頁面上的組別順序是 Wilson 指定的，跟 rules.json 裡的原始順序不同（土字類／大字類
# 對調了）——rules.json 那邊的順序沒有特別含義，不必跟著改。
CONVENTIONAL_GROUP_ORDER = ["數字類", "木字類", "土字類", "大字類", "甲字類", "馬字類", "己字類"]


def build_conventional(codes, rules, max_rule=None):
    """〈約定字〉頁：rules.json「約定原則」表內的字——不照筆順拆碼，直接照表給碼。

    這跟 build_jianma() 的「約定簡碼」是兩回事：約定簡碼是**額外多一條**更短的路，
    主碼不變；約定字是這個字的**主碼本身**就是手動指定的（凌駕孤筆略過／能合不分／
    筆順等原則）。

    每個字的「單獨成字」碼一律從 codes.json 現查（不信任 rules.json 自己抄的 code
    欄，那欄只是給人看的備註，真正出貨的碼一律以 codes.json 為準）；「作為偏旁」碼
    （compCode）目前沒有另一份資料可以反查，照抄 rules.json——跟 build_jianma() 的
    left_short／short_code 是同一種信任等級（Wilson 手核的名單，不是算出來的）。
    """
    rules_by_id = {r["id"]: r for r in rules.get("rules", [])}
    conv = rules_by_id.get("convention")
    if not conv:
        return {"note": "generated by site/tools/build_site_data.py — do not edit",
                "desc": "", "groups": []}

    warn = []
    groups = []
    for g in conv.get("groups", []):
        name = g.get("name")
        if not name or name in CONVENTIONAL_SKIP_GROUPS:
            continue
        chars = []
        for c in g.get("chars", []):
            ch = c.get("c")
            rec = codes.get(ch)
            if not ch or not rec:
                warn.append(f"約定字：「{ch}」查不到 codes.json 紀錄，跳過")
                continue
            segs = rec.get("segments") or []
            grp, code_grp = _code_groups(segs, max_rule)
            chars.append({
                "c": ch,
                "code": rec["final"],
                "comp": c.get("compCode"),
                # 逐字上色用，跟 build_principles() 共用 _code_groups()：groups 是
                # 完整未砍的段，codeGroups 記 code 每個字母對應 groups 裡第幾段——
                # 53 個字裡「裊」的碼超過上限（完整碼 JSEIJK 六段，顯示碼 JSEIK
                # 砍掉第 5 段只留第 6 段），沒有這條就會跟「藍」同樣的方式塗錯色。
                "groups": grp,
                "codeGroups": code_grp,
            })
        if chars:
            groups.append({"name": name, "note": g.get("note") or "", "chars": chars})
    order = {name: i for i, name in enumerate(CONVENTIONAL_GROUP_ORDER)}
    groups.sort(key=lambda g: order.get(g["name"], len(order)))
    for w in warn:
        print(f"  ⚠️ {w}")

    return {
        "note": "generated by site/tools/build_site_data.py — do not edit",
        "desc": conv.get("desc") or "",
        "groups": groups,
    }


# ---------------------------------------------------------------------------
# 〈詞組〉頁：詞組連打 ＋ 四碼快打
#
# ⚠️ 這一段是**唯一**在 Side C 這邊複製 build_rime.py 取碼邏輯的地方，因為詞組碼
# 不在 codes.json 裡 —— 它是 build_rime.py 在建置時算出來的，只存在於出貨碼表
# （rime/aiphabi.dict.yaml）和 rime/lua/aiphabi_data.lua 的 M.si4 裡。
#
# 複製邏輯就會走鐘，所以每一條例詞算完之後都**拿出貨碼表對一次**（_ship_words /
# _ship_si4）：對不上就在建置紀錄裡印出來，例詞旁邊也會標「碼表還沒重建」。
# 對不上通常不是這裡算錯，而是 Side A 改了取碼、Side B 還沒重建碼表 —— 那是
# 正常的暫時狀態（見 CLAUDE.md 硬規則二），不該擋住建置。
#
# 下面四個函式（_pcode / _char_options / _word_codes / _si4_*）是
# build_rime.py:364-509 的搬運，改動那邊就要改這邊。
# ---------------------------------------------------------------------------

# 例詞是手挑的，挑的標準寫在每一組旁邊。碼一律現算，不手抄。
PHRASE_TWO = [
    # 兩字詞：每字「簡碼／三簡碼／主碼／兼容碼」任意搭配都收進碼表。
    ("香港", "港 沒有約定簡碼，落到三簡碼 WHZ —— 首尾相接就是最短的那條"),
    ("我的", "兩個字都有約定簡碼，四種搭配全部打得出來"),
    ("城市", "市 有一條兼容碼 IM，它也算一條路，一樣接得上"),
]
PHRASE_MULTI = "廣東話"      # 三字以上：四式剛好各不相同的詞（另一個是 普通話）
# 四碼快打的例詞。挑的時候避開**一碼字**（人 Y、山 W）和**約定字**（大、上）——
# 它們的碼不是照筆順拆出來的，拿來示範「取首碼」會讓人看不出那個字母是哪一條字根
# （Wilson）。每一式各一個詞就夠，同一條規則不重複示範。
PHRASE_SI4 = [
    ("劉德華", "三字：前兩字首碼 ＋ 末字的首碼和末碼"),
    ("守株待兔", "四字：各取首碼"),
    ("聯合國教科文組織", "五字以上：前四字首碼，另加「前三字＋末字」一式"),
]
PHRASE_SENTENCE = ("香港", "新界")   # 智能分詞示範：前半是收錄詞、後半不是

KIND_LABEL = {"short": "約定簡碼", "t3": "三簡碼", "main": "主碼", "alt": "兼容碼"}


_SHIP_CACHE = {}


def _ship_read():
    """出貨碼表的多字詞：(詞 -> {碼}, 詞 -> 權重)。整份 118k 行只讀一次。

    ⚠️ 這是 **Side B 的建置產物**，Side C 只讀不寫。讀它的理由只有一個：
    那 42,676 個詞的**名單**在別處拿不到 —— build_rime.py 的詞源是 Squirrel 裝在
    /Library/Input Methods 底下的 essay.txt，那是每台機器各自的東西，不在 repo 裡，
    CI 上更沒有。所以名單取自這裡，**碼一律重算**（見 build_phrase_dict）：
    碼表可能比 codes.json 舊，而網站上「打得出來的碼」必須跟同一頁教的拆法一致。
    """
    if "w" in _SHIP_CACHE:
        return _SHIP_CACHE["w"]
    path = ROOT / "rime" / "aiphabi.dict.yaml"
    if not path.exists():
        _SHIP_CACHE["w"] = (None, None)
        return _SHIP_CACHE["w"]
    codes, weight = {}, {}
    for line in path.read_text("utf-8", "ignore").splitlines():
        parts = line.split("\t")
        if len(parts) < 2 or len(parts[0]) < 2 or not parts[1].isalpha():
            continue
        codes.setdefault(parts[0], set()).add(parts[1])
        if len(parts) >= 3 and parts[2].strip().isdigit():
            n = int(parts[2])
            if n > weight.get(parts[0], 0):
                weight[parts[0]] = n
    _SHIP_CACHE["w"] = (codes, weight)
    return _SHIP_CACHE["w"]


def _ship_words():
    """出貨碼表裡的多字詞 -> {碼}。拿來對例詞，也拿來算「收錄幾個詞」。"""
    return _ship_read()[0]


def _ship_si4():
    """rime/lua/aiphabi_data.lua 的 M.si4：四碼 -> [詞]。四碼快打不進碼表，只在這裡。"""
    path = ROOT / "rime" / "lua" / "aiphabi_data.lua"
    if not path.exists():
        return None
    out = {}
    inside = False
    for line in path.read_text("utf-8", "ignore").splitlines():
        if line.startswith("M.si4 = {"):
            inside = True
            continue
        if inside:
            if line.startswith("}"):
                break
            m = re.match(r'\s*\["([a-z]+)"\]=\{(.*)\},\s*$', line)
            if m:
                out[m.group(1)] = re.findall(r'"([^"]+)"', m.group(2))
    return out or None


class _PhraseCoder:
    """詞組取碼：build_rime.py:333-509 的搬運，改那邊就要改這邊。

    〈詞組〉頁的例詞（build_phrases）和試打頁的詞庫（build_phrase_dict）共用這一份 ——
    複製兩份必然走鐘，而走鐘的症狀是「網站教的打法打不出字」，最難發現。
    """

    def __init__(self, codes, rules, max_rule):
        self.char2code = {c: shorten(rec["code"], max_rule).lower()
                          for c, rec in codes.items() if rec.get("code")}
        self.alt_codes = {}
        for ch, rec in codes.items():
            mc = self.char2code.get(ch)
            if not mc:
                continue
            got = []
            for a in rec.get("alts", []):
                ac = shorten(a.get("code", ""), max_rule).lower()
                if ac and ac != mc and ac not in got:
                    got.append(ac)
            if got:
                self.alt_codes[ch] = got
        self.short_rev = {}
        sc = next((r for r in rules.get("rules", []) if r["id"] == "short_code"), None)
        if sc:
            for e in (sc.get("params", {}).get("entries") or sc.get("entries") or []):
                ch, t = e.get("c"), (e.get("short") or "").lower()
                if ch and t and ch in codes:
                    self.short_rev.setdefault(ch, t)

    def piece(self, ch, mode):
        """回傳 (碼, 這條碼是哪一種)。mode 對應 build_rime.py 的 _pcode。"""
        mc = self.char2code.get(ch)
        if mode == "main":
            return mc, "main"
        if mode == "alt":
            got = self.alt_codes.get(ch)
            return (got[0], "alt") if got else (mc, "main")
        s = self.short_rev.get(ch)
        if s:
            return s, "short"
        if mode == "t3" and mc and len(mc) >= 4:
            return mc[0] + mc[1] + mc[-1], "t3"
        return mc, "main"

    def char_options(self, ch):
        """兩字詞用：這個字所有值得串進詞組的碼，[(碼, 種類), ...]。"""
        mc = self.char2code.get(ch)
        if not mc:
            return []
        opts = []
        s = self.short_rev.get(ch)
        if s:
            opts.append((s, "short"))
        elif len(mc) >= 4:
            opts.append((mc[0] + mc[1] + mc[-1], "t3"))
        opts.append((mc, "main"))
        for ac in self.alt_codes.get(ch, ()):
            if ac not in [o[0] for o in opts]:
                opts.append((ac, "alt"))
        return opts

    def word_codes(self, w):
        chs = list(w)
        if any(self.char2code.get(c) is None for c in chs):
            return None
        if len(chs) == 2:
            return {a[0] + b[0]
                    for a in self.char_options(chs[0]) for b in self.char_options(chs[1])}
        return {"".join(self.piece(c, m)[0] for c in chs)
                for m in ("main", "simp", "t3", "alt")}

    def _si4_letters(self, ch, want_last):
        out = []
        mc = self.char2code.get(ch)
        if mc:
            out.append(mc[-1] if want_last else mc[0])
        for ac in self.alt_codes.get(ch, ()):
            L = ac[-1] if want_last else ac[0]
            if L not in out:
                out.append(L)
        return out

    def _si4_sigs(self, positions):
        base = [self._si4_letters(c, last)[0] for c, last in positions]
        sigs = ["".join(base)]
        for i, (c, last) in enumerate(positions):
            for L in self._si4_letters(c, last)[1:]:
                v = list(base)
                v[i] = L
                sigs.append("".join(v))
        return list(dict.fromkeys(sigs))

    def si4_forms(self, w):
        """四碼快打的**每一式**：[(positions, [簽名…]), …]。

        三字、四字只有一式；五字以上有兩式（前四字首碼／前三字＋末字首碼）。
        每一式的簽名第一個是 base（每格取主碼那個字母），其餘是兼容碼換出來的。
        ⚠️ 兩式要分開拿，不能把簽名接成一串再取第二個 —— 那樣拿到的是「第一式的
        兼容碼變體」，不是第二式（聯合國教科文組織：NAOT／NAOF 都是第一式，
        第二式是 NAOG）。
        """
        chs = list(w)
        if len(chs) < 3 or any(c not in self.char2code for c in set(chs[:4]) | {chs[-1]}):
            return []
        if len(chs) == 3:
            pos = [(chs[0], False), (chs[1], False), (chs[2], False), (chs[2], True)]
            return [(pos, self._si4_sigs(pos))]
        if len(chs) == 4:
            pos = [(c, False) for c in chs]
            return [(pos, self._si4_sigs(pos))]
        head = [(c, False) for c in chs[:4]]
        tail = [(c, False) for c in chs[:3]] + [(chs[-1], False)]
        return [(head, self._si4_sigs(head)), (tail, self._si4_sigs(tail))]

    def si4_of(self, w):
        """回傳 (第一式的 positions, [全部簽名…])。碼表那一側只在乎有哪些簽名。"""
        forms = self.si4_forms(w)
        if not forms:
            return None, []
        sigs = []
        for _pos, ss in forms:
            for x in ss:
                if x not in sigs:
                    sigs.append(x)
        return forms[0][0], sigs


def build_phrases(codes, rules, max_rule, zigen_raw):
    """〈詞組〉頁：詞組連打的拼碼規則 ＋ 四碼快打的四個位置，逐字算給頁面畫。

    四碼快打的每一格還附字形與「取到的是哪幾筆」，頁面畫得出彩色筆畫 ——
    「取首碼」講的其實是「取第一條字根的字母」，看到那幾筆亮起來才懂（Wilson）。
    """
    warn = []
    pc = _PhraseCoder(codes, rules, max_rule)
    char2code, alt_codes, short_rev = pc.char2code, pc.alt_codes, pc.short_rev
    piece, char_options, word_codes, si4_of = (
        pc.piece, pc.char_options, pc.word_codes, pc.si4_of)

    ship = _ship_words()
    ship_si4 = _ship_si4()

    def check(w, got):
        """例詞的碼跟出貨碼表對一次。回傳 True＝對得上（或無從對起）。"""
        if ship is None:
            return True
        have = ship.get(w)
        if have is None:
            warn.append(f"詞組頁：出貨碼表裡沒有「{w}」，例詞旁邊會標「碼表還沒收」")
            return False
        if have != got:
            warn.append(f"詞組頁：「{w}」現算 {sorted(got)}，出貨碼表是 {sorted(have)}"
                        f" —— 多半是 Side A 改了取碼、碼表還沒重建")
            return False
        return True

    def parts_of(w, mode):
        out = []
        for ch in w:
            c, kind = piece(ch, mode)
            out.append({"c": ch, "code": (c or "").upper(), "kind": kind,
                        "label": KIND_LABEL[kind]})
        return out

    # ---- 兩字詞：所有搭配 ----
    two = []
    for w, note in PHRASE_TWO:
        opts = [char_options(ch) for ch in w]
        if not all(opts):
            warn.append(f"詞組頁：「{w}」有字還沒取碼，跳過")
            continue
        rows = []
        for a in opts[0]:
            for b in opts[1]:
                rows.append({
                    "code": (a[0] + b[0]).upper(),
                    "parts": [{"c": w[0], "code": a[0].upper(), "kind": a[1],
                               "label": KIND_LABEL[a[1]]},
                              {"c": w[1], "code": b[0].upper(), "kind": b[1],
                               "label": KIND_LABEL[b[1]]}],
                })
        rows.sort(key=lambda r: len(r["code"]))
        two.append({"w": w, "note": note, "rows": rows,
                    "ok": check(w, {r["code"].lower() for r in rows})})

    # ---- 三字以上：四式 ----
    multi = None
    if all(c in char2code for c in PHRASE_MULTI):
        modes = []
        seen = set()
        for mode, label, why in [
            ("main", "主碼式", "每個字都打主碼，最長但最不用想"),
            ("simp", "簡碼式", "有約定簡碼的字用簡碼，沒有的用主碼"),
            ("t3", "三簡碼式", "先看約定簡碼；沒有簡碼、主碼又有四碼以上，就用三簡碼"),
            ("alt", "兼容碼式", "有兼容碼的字用第一條兼容碼，沒有的用主碼"),
        ]:
            code = "".join(piece(c, mode)[0] for c in PHRASE_MULTI)
            modes.append({"id": mode, "label": label, "why": why,
                          "code": code.upper(), "parts": parts_of(PHRASE_MULTI, mode),
                          "dup": code in seen})
            seen.add(code)
        multi = {"w": PHRASE_MULTI, "modes": modes,
                 "ok": check(PHRASE_MULTI, seen)}

    # ---- 四碼快打 ----
    # 例字的字形與拆碼段：每一格要畫出「取到的是哪幾筆」。跟參考文章、拼音查字
    # 同一份來源、同一個授權（Arphic PL／教育部標準筆順），所以 meta 那邊要一起
    # 標出處，CI 也要對 phrases.json 查一次授權檔在不在。
    si4_chars = {c for w, _ in PHRASE_SI4 for c in w}
    si4_glyphs = _practice_glyphs(si4_chars)
    si4_segs = build_practice_hints(si4_chars, codes, zigen_raw, max_rule)

    def slot_strokes(ch, last):
        """這一格取到的是哪幾筆。首碼＝主碼第一個字母那一段，末碼＝最後一個字母
        那一段 —— 「頭四尾一」砍過之後，末碼對到的一定是最後一段，所以照 c 的
        頭尾取就對了（c 記的正是主碼每個字母用的是第幾段）。"""
        e = si4_segs.get(ch)
        if not e or not e.get("s") or not e.get("c"):
            return None
        idx = e["c"][-1] if last else e["c"][0]
        seg = e["s"][idx] if idx < len(e["s"]) else None
        return seg.get("st") if seg else None

    si4 = []
    for w, note in PHRASE_SI4:
        forms = pc.si4_forms(w)
        if not forms:
            warn.append(f"詞組頁：「{w}」湊不出四碼快打，跳過")
            continue
        pos, sigs = forms[0]
        def slots_of(positions):
            """四個位置 → 要畫幾個格子。

            連著的同一個字合成一格（劉德華 的末字 華 同時被取首碼和末碼）——
            兩個 華 並排會看成「劉德華華」，而且那個字的首尾兩條字根本來就該在
            同一張圖上一起看（Wilson）。所以一格可以帶好幾個 pick，i 記的是它
            在四碼裡的第幾位，顏色跟底下那個字母對得起來。
            """
            out = []
            for i, (ch, last) in enumerate(positions):
                pick = {"i": i, "letter": (char2code[ch][-1] if last
                                           else char2code[ch][0]).upper(), "last": last}
                st = slot_strokes(ch, last)
                if st and si4_glyphs.get(ch):
                    pick["on"] = st
                if out and out[-1]["c"] == ch:
                    out[-1]["picks"].append(pick)
                else:
                    out.append({"c": ch, "code": char2code[ch].upper(), "picks": [pick]})
            return out
        slots = slots_of(pos)
        # 五字以上收兩式，第二式是「前三字＋末字」——兩式都要畫，不然頁面只講了一半
        slots2 = slots_of(forms[1][0]) if len(forms) > 1 else None
        wc = word_codes(w) or set()
        # more＝兼容碼換出來的額外簽名（兩式的都算），不含第二式的 base
        more = [x for x in sigs[1:]]
        if slots2:
            more += [x for x in forms[1][1][1:] if x not in more]
        entry = {"w": w, "n": len(w), "note": note,
                 "code": sigs[0].upper(),
                 "more": [x.upper() for x in more],
                 "slots": slots,
                 "slots2": slots2,
                 "code2": forms[1][1][0].upper() if slots2 else "",
                 # 「省了幾碼」：四碼 vs 平常最短的打法。si4_rev 只在真的比較短時才提醒。
                 "full": min(wc, key=len).upper() if wc else "",
                 "hint": bool(wc) and min(len(c) for c in wc) > 4}
        all_sigs = [sigs[0]] + more + ([forms[1][1][0]] if slots2 else [])
        if ship_si4 is not None:
            missing = [x for x in all_sigs if w not in (ship_si4.get(x) or [])]
            entry["ok"] = not missing
            if missing:
                warn.append(f"詞組頁：「{w}」的四碼 {[m.upper() for m in missing]} "
                            f"在 aiphabi_data.lua 的 M.si4 裡對不上（碼表還沒重建？）")
        else:
            entry["ok"] = True
        # 同碼還有誰：四碼很短，撞碼是常態，頁面要老實講
        if ship_si4 is not None:
            entry["share"] = [x for x in (ship_si4.get(sigs[0]) or []) if x != w][:3]
        si4.append(entry)

    # ---- 智能分詞：前半是收錄詞、後半不是 ----
    sentence = None
    head, tail = PHRASE_SENTENCE
    hc, tc = word_codes(head), word_codes(tail)
    if hc and tc:
        joined = head + tail
        sentence = {
            "head": head, "tail": tail,
            "headCode": min(hc, key=len).upper(),
            "tailCode": min(tc, key=len).upper(),
            "whole": joined,
            # 整串打下去到底收不收得到？收錄了就換一個例子，不然頁面在說謊
            "listed": bool(ship and joined in ship),
            # 後半段本身是不是收錄詞組。它**不是**才對——這個例子要示範的正是
            # 「詞庫收不完」，頁面因此只敢說剩下的碼接著打，不敢說剩下的還能選成一個詞。
            "tailListed": bool(ship and tail in ship),
        }
        if sentence["listed"]:
            warn.append(f"詞組頁：「{joined}」其實**有**收錄，智能分詞的例子要換一個")
        # tailListed 兩種情況頁面都講得出來（cizu.js 的 renderSentence），不必再警告

    corpus = build_corpus(pc, ship, _ship_read()[1] or {}, warn, codes) if ship else None

    stats = {}
    if ship is not None:
        stats["words"] = len(ship)
        stats["entries"] = sum(len(v) for v in ship.values())
    if ship_si4 is not None:
        # M.si4 同時收「完整四碼」和「前三碼」兩種鍵（打到第三碼就先補全出來），
        # 對外要講的是四碼那一種 —— 把三碼的前綴也算進去會虛報一半。
        four = {k: v for k, v in ship_si4.items() if len(k) == 4}
        stats["si4Codes"] = len(four)
        stats["si4Words"] = len({w for v in four.values() for w in v})
    stats["shortCodes"] = len(short_rev)

    for w in warn:
        print(f"  ⚠️ {w}")

    meta = {}
    if si4_glyphs:
        # 字形資料的授權跟 practice.json／pinyin_glyphs.json 完全一樣，
        # 一樣要隨附授權全文（site/ARPHICPL.txt，教育部那份是 TWSTROKE.txt）。
        meta = {
            "glyph_source": "makemeahanzi (https://github.com/skishore/makemeahanzi) graphics.txt",
            **_tw_credit(si4_glyphs),
            "glyph_license": "Arphic Public License — 全文見 ARPHICPL.txt，隨網站一併發佈",
            "glyph_modifications": (
                "自 graphics.txt 取出四碼快打例字用得到的字元，保留其 strokes 欄"
                "（字形輪廓，SVG path 指令），未修改任何路徑資料；捨棄 medians 與其餘欄位。"),
        }

    return {
        "note": "generated by site/tools/build_site_data.py — do not edit",
        **meta,
        "glyphs": si4_glyphs,
        "corpus": corpus,
        "stats": stats,
        "two": two,
        "multi": multi,
        "si4": si4,
        "sentence": sentence,
        # 出貨碼表拿不到（極少見：rime/ 不在）就別讓頁面畫「已核對」的字樣
        "checked": ship is not None and ship_si4 is not None,
    }


# 〈詞組〉頁的「詞庫收錄了什麼」：每一組的名字，以及它由哪幾個精選檔／哪幾節組成。
#
# 分組是**為了讀者**分的，不是照檔案分的 —— data/phrases_places.txt 一個檔裡
# 同時有兩岸三地和世界各地，讀者要看的是這兩件事分開。所以用檔案裡的
# 「# ===== 中文 English =====」小節標題來對，對不到就在建置紀錄裡喊，
# 不要無聲少掉一整節（Side B 改了小節名字，這裡就該知道）。
#
# sections=None 表示整個檔都算這一組。
# 小節名前面加 "~" 表示**整節攤開來挑**（等距取樣），不從頭挑：四字成語那一節是照
# 首字排的，從頭挑會挑出 一心一意、一石二鳥、一舉兩得、一帆風順… 整排都是「一」
# 開頭（Wilson）。人手排過重要性的節（國家：中國、日本、南韓）不能這樣挑。
# 小節名前面加 "-" 表示**算進數字、但不舉例**
# ——「國家全名」那一節的頭兩條是 中華人民共和國／中華民國，並排放在例詞第一行
# 會讀成一句話，而這一段要講的只是「詞庫收了什麼」（Wilson 提過政治敏感的字眼
# 不要當招牌例子）。那一節的詞照樣打得出來，只是不拿來當門面。
CORPUS_GROUPS = [
    # 順序有兩個作用，改的時候兩個都要想：
    #   1. 網站上就照這個順序排 —— 地名 → 人名（古到今）→ 機構品牌 → 語文與生活。
    #   2. **先認領先贏**：同一個詞常常兩節都有（北京 既是中國省級行政區、也是
    #      世界各國首都），排前面的那一組收走它。所以 兩岸三地 一定要在 世界地名 前面。
    ("兩岸三地地名", [("places", ("中國省級行政區", "中國主要城市",
                                  "台灣縣市", "台灣景點", "台北捷運車站",
                                  "香港三大區域", "香港十八區", "香港港鐵車站",
                                  "澳門地區"))]),
    ("世界地名", [("places", ("國家", "-國家全名", "世界各國首都", "世界主要城市",
                              "日本都道府縣", "美國各州", "大區域／半島"))]),
    # phrases_history.txt 一個檔裡混了四種東西，分開才看得懂：帝王將相是一回事，
    # 思想家文人科學家是另一回事，而朝代與神話根本不是「人物」（Wilson）。
    # 現代政治人物（phrases_politicians.txt，含 總統／首相 這類職稱）併進來 ——
    # 帝王將相跟當代政要本來就是同一件事的古今兩端，分兩組讀者只會問差在哪（Wilson）。
    ("古今中外歷史政治人物", [("history", ("帝王／年號", "名將／歷史人物",
                                            "近代政治／戰爭人物")),
                              ("politicians", None)]),
    ("古今中外科學文學人物", [("history", ("諸子百家／思想家", "文人詩詞",
                                            "世界歷史／科學／藝術名人"))]),
    # 朝代整節**算數字、不自動舉例**（前綴 -）：那一節從 夏商周西周東周春秋戰國…
    # 一路排到民國，自動挑會挑到 夏朝、商朝、西周 這種細分期，而且一口氣佔掉八格，
    # 這一組另外兩件事（神話、宗教）就沒位置了。改由 CORPUS_PIN 指名幾個代表朝代
    # （Wilson：朝代太多，要有代表性）。
    ("朝代、宗教與神話", [("history", ("-朝代", "神話人物", "宗教人物"))]),
    # 虛構角色（郭靖、黃蓉、小龍女…）算數字、不當例子：這一組講的是「名人」，
    # 混進虛構角色會讓人以為詞庫分不清（Wilson 指出 郭靖 不是真人）。
    ("影視歌與體壇名人", [("people", ("香港明星", "台灣明星", "中國大陸明星",
                                      "日本紅星", "韓國紅星", "國際影視歌星",
                                      "體壇紅星", "-虛構角色"))]),
    ("常見英名中譯", [("english_names", None)]),
    # 政黨與各地政府機關**算進數字、不當例子**（前綴 -）：中國共產黨、中華民國總統府、
    # 香港特別行政區政府 並排在同一行，讀起來就不是在講輸入法了。這一頁的網站面向
    # 兩岸三地的中文使用者，政治聯想要留給讀者自己，不要由範例清單擺出來（Wilson
    # 2026-08-26）。那些詞照樣打得出來、照樣算在 220 個詞裡，只是不拿來當門面。
    ("機構與組織", [("orgs", ("國際組織", "-中國機關／政黨", "-台灣機關", "-香港機關")),
                    ("common", ("-政府機構", "大學"))]),
    ("品牌與公司", [("brands", None)]),
    ("成語俗語諺語", [("idioms", ("~四字成語", "俗語／諺語／長成語",
                                  "新聞語料高頻四字成語", "-異體寫法"))]),
    # 星座整節**算數字、不自動舉例**（前綴 -）：那一節是 白羊／白羊座／牡羊／牡羊座／
    # 金牛／金牛座… 台港兩種叫法交錯排，自動挑會挑出三個星座、其中兩個還是同一個
    # （白羊座＝牡羊座，連碼都一樣 JVRF）。改由 CORPUS_PIN 指名兩個代表就好（Wilson）。
    ("日常文化", [("common", ("節日", "生肖", "-星座", "顏色")), ("food", None)]),
    ("科目與職業", [("common", ("學科", "職業"))]),
    ("國際交流", [("common", ("貨幣", "語言／文字"))]),
]

CORPUS_PICKS = 10          # 每一組秀幾個例詞。多了會變成清單，這一段是「舉例」不是「目錄」

# 指名要舉的例詞（Wilson 點的）。照檔案順序挑不一定挑得到最有代表性的那幾個：
# 朝代那節從 夏商周 開始排，挑前四個就是 夏朝、商朝、周朝、西周；文人詩詞挑到
# 司馬相如 而不是 李白。這裡指名的會排在它那一節最前面，而且一定佔得到位置。
CORPUS_PIN = {
    # 兩岸三地先舉四個代表城市，其餘照小節順序補（Wilson）
    # 四個代表城市開頭，再帶到省／縣／景點／港澳分區 —— 這一組要看得出行政層級
    # 和地理都涵蓋（Wilson）。九龍 與 新界 同質，只留一個。
    # ⚠️「桃園縣」查無此詞不是漏收：桃園 2014 年改制成 桃園市，檔案裡是 桃園／桃園市。
    "兩岸三地地名": ("北京", "台北", "香港", "澳門",
                      "江蘇省", "南京", "高雄", "宜蘭縣",
                      "阿里山", "九龍", "中環", "氹仔"),
    # 這一組叫「古今中外」，就要真的涵蓋古今中外（Wilson）。照小節順序挑會挑出
    # 秦始皇、嬴政、項羽、韓信、總統、首相…，全是中國＋現代職稱，一個外國人都沒有。
    # 拿破崙／凱撒／林肯 在 history 的「世界歷史／科學／藝術名人」那一節，那一節整節
    # 歸給了科學文學那一組 —— 指名可以跨組把單一個詞認領過來（見下面 pin 的說明）。
    # 照**卒年**排，不是照小節，也不是照生年（Wilson）。中外混在同一條時間軸上，
    # 這一組才真的是「古今中外」；而排序基準寫死成卒年，是為了不必為任何一組人物
    # 決定「誰算開始得比較早」——生年、在位、掌權都要挑一個說法，卒年只有一個日期。
    #   秦始皇／嬴政 −210　項羽 −202　凱撒 −44　曹操 220　諸葛亮 234
    #   拿破崙 1821　林肯 1865　邱吉爾 1965　蔣介石 1975　毛澤東 1976
    # ⚠️ 兩件事都是刻意的，不要「順手修掉」：
    #   · 秦始皇 與 嬴政 是同一個人的兩種叫法，兩個都收也都打得出來，所以都舉。
    #   · 毛澤東 與 蔣介石 一起出現，不是漏了誰（Wilson：兩個都放才平衡）。
    # 加人進來的時候，位置照卒年插，不要接在最後面。
    "古今中外歷史政治人物": ("秦始皇", "嬴政", "項羽", "凱撒", "曹操", "諸葛亮",
                              "拿破崙", "林肯", "邱吉爾", "蔣介石", "毛澤東"),
    # 五個代表朝代：秦（第一個大一統）、漢、唐（盛世）、明、清（最後一個王朝）。
    # 不收 宋朝／元朝 不是排它們，是這一組還要留位置給神話與宗教。
    "朝代、宗教與神話": ("秦朝", "漢朝", "唐朝", "明朝", "清朝"),
    "古今中外科學文學人物": ("李白", "莎士比亞"),
    # 星座只寫 白羊／牡羊 看不出是星座（Wilson）——「座」字要在
    "日常文化": ("白羊座", "金牛座"),
    # 世界地名不必再舉 中國（兩岸三地那組已經整組在講）；國名舉 日本／美國，
    # 全名舉 美利堅合眾國 —— 全名那一節是靜音的，指名可以把它撈出來（見下面）
    # 舉例要涵蓋各洲，不要只有英美日（Wilson）。
    # ⚠️ 不舉「南韓」：那個國名本身有稱呼爭議（韓國／南韓／南朝鮮），
    # 三種寫法碼表都收得到，但拿它當範例等於替讀者選了一種叫法。
    "世界地名": ("日本", "印度", "埃及", "巴西", "美國", "美利堅合眾國", "英國",
                  "華盛頓", "開羅", "紐約", "非洲", "巴拿馬運河"),
    # 港台各舉一男一女（Wilson：要有香港女藝人、台灣男藝人）。自動挑會照檔案順序
    # 挑到 劉德華、張學友（港男兩個）跟 林志玲、蔡依林（台女兩個），剛好兩邊都偏一邊。
    # 一格一種：港男、港女、台男、台女、陸女、日男、韓男、國際、體壇。自動挑會照
    # 檔案順序挑到 劉德華、張學友（港男兩個）跟 林志玲、蔡依林（台女兩個），兩邊都偏；
    # 而且會挑到 郭靖（虛構角色，已整節靜音）。體壇那一節排在最後，不指名就永遠挑不到。
    "影視歌與體壇名人": ("劉德華", "梅艷芳", "周杰倫", "林志玲", "周迅",
                          "木村拓哉", "孔劉", "安祖蓮娜", "麥可喬丹"),
    # 機構舉國際組織與大學就好（理由見 CORPUS_GROUPS 裡「機構與組織」那條註解）。
    # ⚠️ 同質性（Wilson）：檔案順序開頭連著七條「聯合國X」再連著三條「世界X組織」，
    # 照順序挑會挑出一整排長得一樣的名字，也會挑出一整排台灣的大學。所以指名時
    # 一個系統只取一個代表，並且橫跨聯合國／區域聯盟／軍事／體育／人道／金融，
    # 大學也橫跨台港中與歐美日。
    "機構與組織": ("聯合國", "歐盟", "東協", "北約", "國際奧委會", "紅十字會",
                    "世界衛生組織", "世界銀行",
                    "台大", "香港中文大學", "北京大學", "牛津大學"),
}

# 這幾組的例詞排完之後再重排：先照字數、再照首字筆劃（Wilson）。成語那組長短不一，
# 照小節順序排會四字五字六字交錯，看起來沒有章法；排過之後由短到長、同長度由簡到繁。
# 其他組的詞長度差不多（地名、人名），重排反而會打亂「由近而遠／由古而今」那條線。
CORPUS_SORT_BY_LEN = {"成語俗語諺語"}

# 這一組不要舉的詞（照樣算進數字）。目前只有一條：世界地名不重複舉 中國。
CORPUS_SKIP = {
    # 「國文」是台灣的說法，港澳與大陸不這樣叫，拿它當學科的第一個例子太偏（Wilson）
    "科目與職業": ("國文",),
    # 中國：兩岸三地那組已經整組在講，不重複舉。
    # 朝鮮半島那幾個國名有稱呼爭議（韓國／南韓／南朝鮮），照樣打得出來、
    # 照樣算進數字，只是不拿來當範例（Wilson 2026-08-26）。
    "世界地名": ("中國", "南韓", "韓國", "北韓", "朝鮮"),
}


def _first_strokes(ch, codes):
    """這個字幾筆。跟 build_jianma 的 stroke_count 同一招：codes.json 沒有筆劃數
    這個欄位，從 segments 的最大筆序反推。manual 取碼的字沒有 segments，查
    MANUAL_STROKE_COUNT；都查不到就回一個很大的數，排到最後而不是排到最前
    （排到最前等於謊稱它筆劃最少）。"""
    rec = codes.get(ch) or {}
    mx = -1
    for seg in rec.get("segments") or []:
        for st in seg.get("strokes") or []:
            if st > mx:
                mx = st
    if mx >= 0:
        return mx + 1
    return MANUAL_STROKE_COUNT.get(ch, 99)


def _sec_key(title):
    """小節標題 → 拿來對照的名字：中文那一段，切在第一個空白或全形括號之前。

    標題長什麼樣都有：「國家 Countries（繁體，台港用法）」「俗語／諺語／長成語（5 字
    以上）」「美國各州 US states（繁體）：全名＋「州」兩式都收…」。只比第一段中文，
    英文說明與括號註記怎麼改都不影響對照。
    """
    head = re.split(r"[\s（(]", title.strip(), 1)[0]
    return head


def _phrase_files():
    """data/phrases_*.txt → {檔名去掉前綴: [(小節標題, [詞, …]), …]}。

    ⚠️ 讀的是 **Side B 的詞源檔**，只讀不寫。格式見各檔檔頭：空白分隔、
    `#` 註解，其中 `# ===== 中文 English ===== ` 這種是小節標題。
    """
    out = {}
    for path in sorted(DATA.glob("phrases_*.txt")):
        name = path.stem[len("phrases_"):]
        sections, cur = [], ("", [])
        for line in path.read_text("utf-8", "ignore").splitlines():
            head = re.match(r"#\s*=+\s*(.+?)\s*=+\s*$", line)
            if head:
                if cur[1]:
                    sections.append(cur)
                cur = (head.group(1), [])
                continue
            words = line.split("#")[0].split()
            cur[1].extend(words)
        if cur[1]:
            sections.append(cur)
        out[name] = sections
    return out


def build_corpus(pc, ship, weight, warn, codes):
    """詞庫收錄了什麼：每一組幾個詞、舉幾個例。

    例詞照詞頻挑最高的幾個 —— 舉例要舉認得出來的，挑到冷門詞等於沒舉。
    每個詞的碼都現算並確認它真的收進了出貨碼表，不然就換下一個。
    """
    files = _phrase_files()
    if not files:
        return None

    def rank(w):
        return -weight.get(w, 0)

    def entry(w):
        got = pc.word_codes(w)
        if not got or w not in ship:
            return None
        _pos, sigs = pc.si4_of(w)
        return {"w": w, "code": min(got, key=len).upper(),
                "si4": sigs[0].upper() if sigs else ""}

    groups, claimed, taken = [], {}, set()
    pinned_extra = set()          # 指名時從 essay 高頻詞撈進來的，日常用語那組要扣掉
    for name, parts in CORPUS_GROUPS:
        buckets = []          # [(小節, [詞…]), …]，例詞從各小節輪流挑
        for fname, wanted in parts:
            secs = files.get(fname)
            if secs is None:
                warn.append(f"詞庫分組「{name}」：找不到 data/phrases_{fname}.txt")
                continue
            if wanted is None:
                hits = [(t, ws, False, False) for t, ws in secs]
            else:
                hits = []
                for key in wanted:
                    quiet = key.startswith("-")
                    wide = key.startswith("~")            # 整節攤開來挑
                    # 全等比對，不是用 in 比子字串 ——「國家」是「國家全名」的
                    # 前綴，用 in 比會讓 -國家全名 那一節被「國家」也認領一次，
                    # 靜音就失效了（實際踩過）。
                    want = key.lstrip("-~")
                    got = [(t, ws, quiet, wide) for t, ws in secs if _sec_key(t) == want]
                    if not got:
                        warn.append(f"詞庫分組「{name}」：{fname}.txt 裡找不到"
                                    f"「{key.lstrip('-')}」那一節"
                                    f"（小節標題改過？這一節的詞不會出現在網站上）")
                    hits += got
            for title, ws, quiet, wide in hits:
                claimed.setdefault(fname, set()).add(title)
                buckets.append((title, ws, quiet, wide))

        # 同一個詞常常兩節都有（北京 既是中國省級行政區、也是世界各國首都），
        # 先認領先贏 —— 分組的順序就是決定它歸誰的順序，所以 CORPUS_GROUPS 裡
        # 兩岸三地排在世界地名前面。不去重的話 北京 會在兩組裡各出現一次。
        all_words = []
        for title, ws, quiet, _wide in buckets:
            for w in ws:
                if w in ship and w not in taken:
                    taken.add(w)
                    all_words.append((title, w, quiet))
        by_sec = {}
        for title, w, quiet in all_words:
            if not quiet:
                by_sec.setdefault(title, []).append(w)

        # 標了 ~ 的小節：等距攤開再排到前面，取樣才會散開（四字成語照首字排，
        # 從頭挑會挑出一整排「一」開頭的）。攤開的排前面，其餘照原順序接在後面。
        for title, _ws, _q, wide in buckets:
            pool = by_sec.get(title)
            if not wide or not pool or len(pool) <= CORPUS_PICKS:
                continue
            step = max(1, len(pool) // CORPUS_PICKS)
            spread = pool[::step]
            by_sec[title] = spread + [w for w in pool if w not in spread]

        # 不舉的詞：照樣算進數字，只是不當例子（見 CORPUS_SKIP）
        for w in CORPUS_SKIP.get(name, ()):
            for title in by_sec:
                if w in by_sec[title]:
                    by_sec[title].remove(w)

        # ---- 指名的例詞：照**指名的順序**排在最前面（見 CORPUS_PIN）----
        # 順序由指名的人決定，不再照小節排 —— Wilson 指定「北京 台北 香港 澳門」
        # 就是要看到這個順序，而這四個分屬三個小節，照小節排會變成
        # 北京、香港、澳門…台北。指名之外的名額才回去照小節順序補。
        have = {w for _t, w, _q in all_words}
        picks, chosen = [], []
        for w in CORPUS_PIN.get(name, ()):
            if w not in have:
                # 跨組認領：這個詞在別的小節（拿破崙 在「世界歷史／科學／藝術名人」，
                # 那一節整節歸科學文學那組），或者根本不在精選檔裡、只在出貨碼表的
                # essay 高頻詞裡（九龍）。指名是人挑過的，就讓它跨過來，並登記進
                # taken，後面那一組不會再舉同一個詞。
                if w in ship and w not in taken:
                    taken.add(w)
                    pinned_extra.add(w)
                    all_words.append(("", w, False))
                    have.add(w)
                else:
                    warn.append(f"詞庫分組「{name}」：指名的例詞「{w}」舉不出來"
                                f"（{'已被前面的組收走' if w in taken else '碼表裡沒有這個詞'}）")
                    continue
            e = entry(w)
            if not e:
                warn.append(f"詞庫分組「{name}」：指名的例詞「{w}」算不出碼，跳過")
                continue
            picks.append(e)
            chosen.append(w)
            for pool in by_sec.values():          # 後面補的時候別再舉一次
                if w in pool:
                    pool.remove(w)

        # ---- 其餘名額：照小節順序整段補 ----
        # 例詞照**檔案裡的順序**挑，不照詞頻。精選檔是人手排的，排在前面的就是
        # 那一節最該舉的（港鐵那節開頭是 中環、香港、金鐘）。照詞頻挑會挑出
        # 大學、幸福 —— 它們確實是港鐵／捷運站名，但當普通詞太常見所以排最前面，
        # 讀者看不出那是地名。日常用語那一組沒有檔案可循，才照詞頻。
        #
        # 名額在各小節之間輪流分配（每次給目前拿最少的那一節），但**輸出照小節
        # 順序整段排**，不是輪流交錯 —— 交錯出來看起來像亂數（Wilson）。
        order = list(dict.fromkeys(b[0] for b in buckets if by_sec.get(b[0])))
        avail = [len(by_sec[t]) for t in order]
        quota = [0] * len(order)
        left = max(0, CORPUS_PICKS - len(picks))
        while left > 0 and any(quota[i] < avail[i] for i in range(len(order))):
            i = min((i for i in range(len(order)) if quota[i] < avail[i]),
                    key=lambda i: (quota[i], i))
            quota[i] += 1
            left -= 1

        # 前綴／包含重複的不再舉：精選檔常把「簡稱＋全名」並排收（北京／北京市、
        # 生肖／十二生肖、聯合國／聯合國安理會），兩條並排在網站上只是佔位置。
        # 只擋這種，不擋異體與異譯（臺北／台北、瑪麗／瑪莉）—— 兩種都收正是詞庫
        # 的賣點之一，讀者看到才知道兩種寫法都打得出來。指名的不受這條管。
        def dup(w, seen):
            return any(x in w or w in x for x in seen)

        for i, title in enumerate(order):
            pool = by_sec[title]
            got = 0
            while pool and got < quota[i]:
                w = pool.pop(0)
                if dup(w, chosen):
                    continue
                e = entry(w)
                if e:
                    picks.append(e)
                    chosen.append(w)
                    got += 1
        if name in CORPUS_SORT_BY_LEN:
            # 穩定排序：同字數同筆劃的維持原本挑出來的順序
            picks.sort(key=lambda e: (len(e["w"]), _first_strokes(e["w"][0], codes)))
        if picks:
            groups.append({"name": name, "n": len(all_words), "picks": picks})

    # 精選檔裡沒被任何一組認領的小節 —— 讀者看不到，通常是分組表沒跟上檔案
    for fname, secs in files.items():
        for title, ws in secs:
            if ws and title not in claimed.get(fname, ()):
                warn.append(f"詞庫分組：{fname}.txt 的「{title or '（無標題）'}」"
                            f"沒有分到任何一組，那 {len(ws)} 個詞不會出現在網站上")

    # 精選檔以外的詞＝rime-essay 高頻詞表那一批（日常用語），量最大的一塊。
    # 它沒有分類可言，所以只按詞頻舉例；數字是「總數減掉精選檔收得到的」。
    curated = {w for secs in files.values() for _t, ws in secs for w in ws}
    daily = [w for w in ship if w not in curated and w not in pinned_extra]
    picks = []
    for w in sorted(daily, key=rank):
        e = entry(w)
        if e:
            picks.append(e)
        if len(picks) >= CORPUS_PICKS:
            break
    if picks:
        groups.insert(0, {"name": "日常用語", "n": len(daily), "picks": picks,
                          "src": "rime-essay 高頻詞表"})
    return {"total": len(ship), "groups": groups}


# 試打頁的詞庫上限：每個碼最多留幾個候選。跟 try.js 的 MAX_CANDS 一樣是 9 ——
# 候選列本來就只排得下九個，多存的永遠看不到，只會讓檔案變大。
PDICT_PER_CODE = 9


def build_phrase_dict(codes, rules, max_rule):
    """試打頁的詞庫：詞組連打 ＋ 四碼快打，碼 → 詞（依詞頻排）。

    **名單**取自出貨碼表（那 42,676 個詞的來源 essay.txt 不在 repo 裡，見
    _ship_read 的說明），**碼一律用 codes.json 重算**。這兩件事要分開看：

      · 照抄碼表的碼會讓試打頁跟同一個網站的〈取碼原則〉〈簡碼〉頁互相矛盾 ——
        Side A 改了某個字的取碼之後，單字查得到新碼、詞組卻還是舊碼，而
        「同一頁裡兩種說法」是最難發現的那種錯。
      · 重算之後跟碼表對一次，把差異的數量和肇因的字印出來，Side B 就知道
        該重建了（硬規則二：Side C 不自己跑 build_rime.py）。

    檔案不小（詞組連打的開關預設關，try.js 只在使用者第一次打開時才抓）。
    """
    ship, weight = _ship_read()
    if not ship:
        print("  ⚠️ 讀不到 rime/aiphabi.dict.yaml，試打頁的詞組詞庫略過")
        return None

    pc = _PhraseCoder(codes, rules, max_rule)
    # 詞頻決定候選順序。碼表的 weight 欄是 essay 原始計次（跟 lua 那份校準過的
    # wordfreq 不是同一個尺度，不要混用 —— 見 PROJECT_NOTES 的 Weights 那一節）。
    # 這裡只拿它排序，不輸出數值，所以尺度不會外流到別的地方去。
    order = sorted(ship, key=lambda w: -weight.get(w, 0))
    rank = {w: i for i, w in enumerate(order)}

    by_code = {}
    by_si4 = {}
    rev = {}
    drift = []
    skipped = 0
    for w in order:
        got = pc.word_codes(w)
        if not got:                      # 有字還沒取碼：整個詞收不了（跟 IME 一致）
            skipped += 1
            continue
        if got != ship[w]:
            drift.append(w)
        for c in got:
            by_code.setdefault(c, []).append(w)
        _, sigs = pc.si4_of(w)
        for c in sigs:
            by_si4.setdefault(c, []).append(w)
        # 四碼反向提醒：只有「四碼真的比平常打法短」才提醒，跟 build_rime.py 一致
        if sigs and min(len(c) for c in got) > 4:
            rev[w] = sigs[0]

    for table in (by_code, by_si4):
        for c in table:
            if len(table[c]) > PDICT_PER_CODE:
                table[c] = table[c][:PDICT_PER_CODE]

    if drift:
        # 肇因通常是少數幾個字改過取碼，列出來比列詞有用（詞是果，字是因）
        blame = _drift_blame(drift, ship, pc)
        print(f"  ⚠️ 詞庫：{len(drift)} 個詞（{len(drift) * 100 / len(order):.2f}%）"
              f"重算的碼跟出貨碼表不一樣，多半是這幾個字改過取碼、碼表還沒重建："
              + "、".join(f"{ch}×{n}" for ch, n in blame[:8]))
    if skipped:
        print(f"  ⚠️ 詞庫：{skipped} 個詞有字還沒取碼，整個詞收不了（跟 IME 一致）")

    return {
        "note": "generated by site/tools/build_site_data.py — do not edit",
        "codes": by_code,
        "si4": by_si4,
        "rev": rev,
        "stats": {"words": len(order) - skipped, "codes": len(by_code),
                  "si4": len(by_si4), "drift": len(drift)},
    }


def _drift_blame(drift, ship, pc):
    """哪幾個字害得重算的詞碼跟碼表對不上。回傳 [(字, 幾個詞), …] 由多到少。

    判準：把這個字換成它在碼表裡「看起來像」的碼太麻煩，直接數 —— 對不上的詞裡，
    哪些字的**現行碼**沒有出現在碼表給那個詞的任何一條碼裡。粗但夠用：肇因通常
    只有一兩個字（例如 兒 從 FEJL 改成 FFJL），列出來就找得到人。
    """
    count = {}
    for w in drift:
        for ch in w:
            mc = pc.char2code.get(ch)
            if mc and not any(mc in c for c in ship[w]):
                count[ch] = count.get(ch, 0) + 1
    return sorted(count.items(), key=lambda kv: -kv[1])


def build_zigen(zigen, codes, rank, far, picks=None, warn=None, standard=None, notes=None):
    """字根表：把 zigen.json 攤成網站要的形狀。

    ⚠️ 純文字版，刻意不畫字根。一個字根存的是「某個字的第幾筆到第幾筆」
    （glyph = {src, strokes}），筆畫幾何在 data/graphics.txt（makemeahanzi）裡，
    而那個檔 **gitignore、不隨本專案散布**，CI 上也不存在。所以這裡只輸出文字：
    取形意圖（desc）、取自哪個字的第幾筆、以及例字。要畫出字根、在例字上高亮，
    得先解決字形資料的授權與取得——那是另一個決定，不要偷偷在這裡引入相依。

    例字（seen）依字頻排序後截斷：常用字排前面，學的人才認得出來。
    """
    # 筆畫總數只能從 codes.json 的 segments 反推（union 出來的最大索引 + 1）。
    # 有了它才能分辨「整個字」和「字的前幾筆」——沒有 graphics.txt 就只有這條路。
    nstrokes = {}
    for ch, rec in codes.items():
        mx = -1
        for seg in rec.get("segments") or []:
            for s in seg.get("strokes") or []:
                if s > mx:
                    mx = s
        if mx >= 0:
            nstrokes[ch] = mx + 1

    def span(src, strokes):
        """人看得懂的說法：整個「名」字 / 名 的第 1–3 筆 / 名 的第 1、3、4 筆"""
        if not strokes:
            return ""
        ss = sorted(strokes)
        total = nstrokes.get(src)
        if total and len(ss) == total and ss == list(range(total)):
            return "whole"
        if ss == list(range(ss[0], ss[-1] + 1)):
            return f"{ss[0] + 1}–{ss[-1] + 1}" if len(ss) > 1 else f"{ss[0] + 1}"
        return "、".join(str(s + 1) for s in ss)

    # 每個字根都「認領」它的來源字（含 alts）的某幾筆。同一個字母底下，另一個字根
    # 若以某個字為來源字，那幾筆就確定不屬於這一個 —— 髻 的 F(11,12,13) 被「土」類
    # 認領，所以「下」類拿到 髻 當例字時就不該把那幾筆也塗上。
    claimed = {}     # letter -> char -> set(筆序 tuple)
    for L in zigen.get("letters", []):
        d = claimed.setdefault(L.get("letter"), {})
        for it in L.get("intentions", []):
            for sh in it.get("shapes", []):
                for ref in [sh.get("glyph")] + list(sh.get("alts") or []):
                    if ref and ref.get("src") and ref.get("strokes"):
                        d.setdefault(ref["src"], set()).add(tuple(sorted(ref["strokes"])))

    # 同字母、同筆數之下，一個字被幾個「不同的字根」列為例字。>1 就代表這個字裡
    # 有好幾段長得像但屬於不同字根（等 的 竹 和 寸 都是 3 筆的 A），我沒有幾何
    # 資料分不出哪一段是哪一個 —— 這種字乾脆不要拿來當例字，換下一個就好。
    owners = {}
    for L in zigen.get("letters", []):
        for it in L.get("intentions", []):
            for sh in it.get("shapes", []):
                g0 = sh.get("glyph") or {}
                zid = (g0.get("src"), tuple(g0.get("strokes") or []))
                key0 = (L.get("letter"), len(g0.get("strokes") or []))
                for c in (sh.get("seen") or []):
                    owners.setdefault(key0 + (c,), set()).add(zid)

    letters, n_shapes, n_nodesc = [], 0, 0
    for L in zigen.get("letters", []):
        groups = []
        # 同一個字母底下，「第一個例字當代表字」這條規則是逐個字根獨立決定的，
        # 彼此不知道對方選了誰——兩個本來就長得像的字根（字根本身是分開的，
        # 只是湊巧都在 seen 裡放了同一個很純的字）因此可能選到同一個代表字，
        # 字根表看起來就像同一個字母下同一個字重複了兩次（Wilson 2026-08-24
        # 抓到：K 底下衣出現兩次——手挑 K 蜃＝衣…是其一，另一個是「還」那組的
        # 自動選字，兩邊互不知情）。這裡記錄「這個字母已經用掉的代表字」，
        # 撞到的那一個維持原本的代表字，不搶（誰先處理到誰留著，字根表裡的
        # 順序跟 zigen.json 一致，所以是自然而然、不必額外排序的先來後到）。
        used_reps = set()
        for it in L.get("intentions", []):
            shapes = []
            for sh in it.get("shapes", []):
                g = sh.get("glyph") or {}
                src = g.get("src") or sh.get("ex") or ""
                seen = [c for c in (sh.get("seen") or []) if c in codes]
                seen.sort(key=lambda c: rank.get(c, far))
                st = g.get("strokes") or []
                shapes.append({
                    "src": src,
                    # 原始筆畫索引：畫字根要用它去 glyphs.json 挑出哪幾筆塗深。
                    # span 是給人看的文字（「第 1–3 筆」），沒有字形資料時的退路。
                    "st": st,
                    "span": span(src, st),
                    "count": sh.get("count", 0),
                    "seen": seen,
                    # 例字掛在**每個字根**上，不是掛在取形意圖上：一個意圖底下最多有
                    # 13 個形狀（平均 3.6），整組只給 5 個的話每一列都分不到。
                    "ex": _examples(
                        seen, len(st), L.get("letter"), codes, EX_PER_SHAPE,
                        picked=_pick_for(picks, L.get("letter"), src, st, warn),
                        warn=warn, label=f"{L.get('letter')} {src}",
                        # own：本字根自己的來源字（含 alts）→ 那幾筆是權威答案
                        own={r["src"]: r["strokes"]
                             for r in [g] + list(sh.get("alts") or [])
                             if r and r.get("src") and r.get("strokes")},
                        # claims：同字母下所有字根認領的筆序，扣掉不屬於自己的
                        claims=claimed.get(L.get("letter"), {}),
                        owners=owners, rank=_rank_within_src(L, g, it),
                        primary=g.get("src"), standard=standard,
                        nstrokes=nstrokes, freq=rank),
                })
                n_shapes += 1
            if not shapes:
                continue
            desc = (it.get("desc") or "").strip()
            if not desc:
                n_nodesc += 1

            # 原形先、衍生後（倉頡的輔助字形表也是這個順序）。整個字構成的字根就是原形，
            # 先看到「日」再看到「提 的第 4–7 筆」才讀得懂；純照 count 排會把衍生形頂到最前面。
            # 「字根」欄改用**第一個例字**當代表字（Wilson 2026-08-19）。
            # 例字已經照單純度排過，第一個就是最能說明這個形狀的字：zigen.json 說
            # 「資 第 7–10 筆」，但例字第一個是 目，寫成「目 第 1–4 筆」好懂得多。
            #
            # 只在**該例字裡這個字根只出現一次**時改（segs 長度為 1），否則筆序不唯一。
            # 原本的來源字保留在 src0 欄，需要時查得回去。
            for sh in shapes:
                first = (sh["ex"] or [None])[0]
                if not first or not (first.get("segs") or []):
                    continue
                # 字根在這個字裡出現不只一次時（笑 的竹頭是兩個「个」、羽 是兩個「习」、
                # 回 是口中有口），取**第一次出現**當代表 —— 「笑 第 1–3 筆」指得很明確，
                # 不會有歧義。先前這種情況整個跳過，結果 笑、羽、回 這些好代表字都用不上。
                if first["c"] == sh["src"]:
                    continue

                # 一律用第一個例字當代表字（Wilson 2026-08-19：「for all the description,
                # use the first characters of the 4 samples」）。第一個例字要嘛是他手挑的、
                # 要嘛是照單純度排出來的，兩者都比 zigen.json 原本的代表字適合。
                #
                # 只留一道門檻：**代表字不能是異體字或簡體專屬字**（不在教育部甲表的）。
                # 那不是品味問題而是正確性問題 —— 這是繁體優先的網站，拿 鸟 當「島」類
                # 字根的代表字是錯的。擋掉的話就維持原本的代表字。
                #
                # 先前還有一道「字根要佔代表字 60% 以上」的門檻，已移除：它會擋掉
                # 衣（3/6）、初（4/7）、逐（5/10）、笑（3/10），而那些正是 Wilson 要的
                # ——尤其 豬→逐、第→笑 是他手挑的例字，門檻等於推翻他的決定。
                cand, cst = first["c"], list(first["segs"][0])
                # 唯一的門檻：**不要把繁體代表字換成簡體／異體字**。
                # 但如果現在的代表字本來就不是甲表字（岛、错、给、师…那些字根本來就
                # 取自簡體字），那換成另一個同樣是簡體的第一個例字並不會更糟，
                # 照 Wilson 的規則走即可 —— 門檻是防降級，不是防平移。
                if standard and cand not in standard and sh["src"] in standard:
                    continue
                # 這個字母底下已經有別的字根搶先用了同一個代表字——不要換，
                # 維持原本的代表字，免得字根表上同一個字母下出現兩個一模一樣的字
                # （見上面 used_reps 的說明）。
                if cand in used_reps:
                    continue

                sh["src0"], sh["st0"] = sh["src"], sh["st"]
                sh["src"] = cand
                sh["st"] = cst
                sh["span"] = span(cand, cst)
            for sh in shapes:
                used_reps.add(sh["src"])

            shapes.sort(key=lambda s: (s["span"] != "whole", -s["count"]))
            groups.append({"desc": desc, "tier": it.get("tier") or "primary",
                           "shapes": shapes,
                           "note": (notes or {}).get((L.get("letter"), len(groups) + 1), "")})
        letters.append({"letter": L.get("letter", ""), "groups": groups})

    return {
        "note": "generated by site/tools/build_site_data.py — do not edit",
        "tiers": (zigen.get("meta") or {}).get("tiers") or {},
        "shapes": n_shapes,
        "no_desc": n_nodesc,
        "letters": letters,
    }


def main():
    codes = load("codes.json")
    rules = load("rules.json")
    freq_order = load("freq.json").get("order", [])
    t2s_raw = load("opencc.json").get("t2s", {})
    charfreq = load("charfreq.json")

    max_rule = next((r for r in rules.get("rules", [])
                     if r["id"] == "max_code_length" and r.get("enabled")), None)

    # 約定字（〈試打文本〉〈拼音查字〉共用）：rules.json 的 convention 規則收的
    # 所有字，不分「約定字表」頁展不展示（那邊排除了「偏旁另有取法」那組——
    # 那組是講偏旁碼、不是講單獨成字要不要照約定，這裡不管展不展示，只要是
    # 約定取碼、不是照筆畫拆，就該在試打頁標出來）。
    conv_rule = next((r for r in rules.get("rules", []) if r["id"] == "convention"), None)
    conv_chars = {c["c"] for g in (conv_rule.get("groups", []) if conv_rule else [])
                  for c in g.get("chars", []) if c.get("c")}

    # 字頻決定候選順序，跟 IME 的候選列一致；沒進字頻表的字排最後、彼此照碼表順序。
    rank = {c: i for i, c in enumerate(freq_order)}
    far = len(rank) + 1

    table = {}          # code(lower) -> [chars]
    main = {}           # char -> 主碼(lower)，萬用鍵的候選標註要用

    def add(code, ch):
        if not code:
            return
        bucket = table.setdefault(code.lower(), [])
        if ch not in bucket:
            bucket.append(ch)

    for ch, rec in codes.items():
        full = rec.get("code")
        if not full:
            continue
        # display：makemeahanzi 偶爾把字形畫成別的通行體（為 → 爲），碼表輸出的是那個字形。
        out = rec.get("display") or ch
        add(shorten(full, max_rule), out)       # 主碼：實際要按的
        main.setdefault(out, shorten(full, max_rule).lower())
        add(full, out)                          # 完整碼：拆完每一碼也一律接受
        for alt in rec.get("alts", []):         # 兼容碼：手動收的另一條路（連它的完整碼）
            ac = alt.get("code")
            if ac:
                add(shorten(ac, max_rule), out)
                add(ac, out)

    for bucket in table.values():
        bucket.sort(key=lambda c: rank.get(c, far))

    # 約定簡碼：60 個手挑的常用字。這是網站要示範的核心設計，所以一起輸出。
    short, short_rev = {}, {}
    sc = next((r for r in rules.get("rules", []) if r["id"] == "short_code"), None)
    if sc:
        for e in (sc.get("params", {}).get("entries") or sc.get("entries") or []):
            ch, s = e.get("c"), (e.get("short") or "").lower()
            if not ch or not s or ch not in codes:
                continue
            short.setdefault(s, ch)             # 撞碼時第一個贏，與 rules 頁預覽一致
            short_rev.setdefault(ch, s)

    # 官方字表覆蓋率：網站首頁的數字由這裡算，不手抄。手抄的數字每次取碼都會過期，
    # 而過期的進度數字在對外網站上比沒有數字更糟。
    stats = {"chars": len(codes)}
    for sid, label, fname in [("tw4808", "教育部常用國字", "tw_common_4808.txt"),
                              ("gb2312", "GB 2312", "gb2312.txt")]:
        path = DATA / "standards" / fname
        if not path.exists():
            continue
        chars = {c for line in path.read_text("utf-8").splitlines()
                 if not line.startswith("#") for c in line.strip()}
        done = len(chars & set(codes))
        stats[sid] = {"label": label, "done": done, "total": len(chars),
                      "pct": round(done * 100 / len(chars), 1)}

    # 重碼率：首 2000 常用字裡，有多少字跟別的字共用同一個主碼。這是對外會被引用的數字，
    # 所以定義寫死在這裡、每次重算 —— 「涉及重碼的字 ÷ 2000」，跟文案講的是同一件事。
    top = [c for c in freq_order if c in codes][:2000]
    groups = {}
    for ch in top:
        groups.setdefault(shorten(codes[ch]["code"], max_rule), []).append(ch)
    clashed = sum(len(v) for v in groups.values() if len(v) > 1)
    if top:
        stats["clash"] = {"pool": len(top), "chars": clashed,
                          "pct": round(clashed * 100 / len(top), 1)}

    dict_out = {
        "note": "generated by site/tools/build_site_data.py — do not edit",
        "chars": len(codes),
        "stats": stats,
        "codes": {k: "".join(v) for k, v in sorted(table.items())},
        "short": short,
        "short_rev": short_rev,
        "short_enabled": bool(sc and sc.get("enabled")),
        # 下面兩欄是萬用鍵 ` 要用的，其餘功能用不到：
        #   main  —— 字 → 主碼。候選旁邊標的一律是主碼，不是比對到的那個碼，
        #            因為萬用鍵很常比對到長得看不完的完整碼（跟 rime/lua/
        #            aiphabi_wildcard.lua 的 data.char2code 同一個東西、同一個理由）。
        #   order —— 字頻順序的字串，rank = 在字串裡的位置。萬用鍵是掃全表比對，
        #            命中的字散在各個碼底下，沒有這個就只能照碼的字母順序排，
        #            結果是候選列開頭一堆罕見字。codes 各桶內部已經照字頻排了，
        #            但桶跟桶之間沒有順序，所以那個排序救不了萬用鍵。
        "main": main,
        "order": "".join(c for c in freq_order if c in codes),
    }

    # 值是候選陣列，取第一個（標準簡化字）；51 個多候選字的其餘寫法用不到。
    t2s = {k: (v[0] if isinstance(v, list) else v) for k, v in t2s_raw.items()}
    t2s = {k: v for k, v in t2s.items() if k != v}

    zigen_raw = load("zigen.json")
    warn = []
    picks = load_example_picks(warn)
    # 教育部常用國字甲表 —— 用來把異體字（衆、丽）往後排，繁體優先的網站
    # 不該拿異體字當示範。檔案不在就退回原本純字頻的排法。
    std_path = DATA / "standards" / "tw_common_4808.txt"
    standard = set()
    if std_path.exists():
        standard = {c for line in std_path.read_text("utf-8").splitlines()
                    if not line.startswith("#") for c in line.strip()}
    notes = load_intent_notes(warn)
    zg = build_zigen(zigen_raw, codes, rank, far, picks=picks, warn=warn,
                     standard=standard, notes=notes)

    # 每一條意圖說明對到哪一個意圖，把原文印出來 —— 序號會隨 Side A 合併意圖而移動，
    # 印出來才看得出有沒有對錯位置。找不到的直接警告。
    if notes:
        idx = {}
        for L in zg["letters"]:
            for i, g in enumerate(L["groups"], 1):
                idx[(L["letter"], i)] = g["desc"] or "（沒有取形意圖）"
        for k in sorted(notes):
            d = idx.get(k)
            if d is None:
                warn.append(f"意圖說明 {k[0]}{k[1]}：{k[0]} 底下沒有第 {k[1]} 個取形意圖")
            else:
                print(f"  意圖說明 {k[0]}{k[1]} → 「{d[:30]}」")
    zg["similar"] = build_similar(codes)

    # 字根表要畫出字根本身，需要這些字的筆畫輪廓。先只收字根的**來源字**（含 alts）：
    # 695 字約 1.6MB。例字的高亮還要再 2000 字／+4.5MB，等這一版看過再決定。
    glyph_chars = set()
    for L in zigen_raw.get("letters", []):
        for it in L.get("intentions", []):
            for sh in it.get("shapes", []):
                g = sh.get("glyph") or {}
                if g.get("src"):
                    glyph_chars.add(g["src"])
                for a in sh.get("alts") or []:
                    if a.get("src"):
                        glyph_chars.add(a["src"])
    for L in zg["letters"]:
        for g in L["groups"]:
            for sh in g["shapes"]:
                for e in sh["ex"]:
                    glyph_chars.add(e["c"])
    # 辨析表用到的字全部收進來 —— 形、例字都要能畫。先前只收了寫成「石#1,2」
    # 那種的來源字，於是只出現在辨析表裡的字（朋、涯、督、俱…）沒有字形資料，
    # 在頁面上退回用系統字型顯示，跟旁邊畫出來的字混在一起很不一致。
    for grp in zg["similar"]:
        for item in grp["items"]:
            m = re.match(r"^(.)#[\d,、\s]+$", item["shape"])
            if m:
                glyph_chars.add(m.group(1))
            elif len(item["shape"]) == 1:
                glyph_chars.add(item["shape"])      # 形本身就是一個字（日、月、丶…）
            for e in item["ex"]:
                glyph_chars.add(e["c"])
            # 正確/錯誤拆法大圖對照用的字，不一定是「形」本身（合#1,2,3 那一列畫的
            # 是余，不是合）——漏收就會沒有筆畫資料，畫面上悄悄退回系統字型純文字，
            # 顏色和分組全部不見，看起來像這個功能沒做，其實是資料沒收全。
            if item.get("alt"):
                # wrong 是選配的（豕 只有正確拆法），用 .get 才不會少一邊就整個爆掉
                for side in ("correct", "wrong"):
                    if item["alt"].get(side):
                        glyph_chars.add(item["alt"][side]["char"])
    principles = build_principles(codes, max_rule)
    glyph_chars.update(principles.keys())
    jianma = build_jianma(codes, rules)
    conventional = build_conventional(codes, rules, max_rule)
    phrases = build_phrases(codes, rules, max_rule, zigen_raw)
    phrase_dict = build_phrase_dict(codes, rules, max_rule)
    for g in conventional["groups"]:
        glyph_chars.update(c["c"] for c in g["chars"])
    # 孤筆略過原則說明裡就地畫出來的字（「言」的第 1、2 筆），不是例字本身。
    glyph_chars.add("言")
    # 參考文章的字形**不**併進 glyphs.json —— 那個檔是字根表在用的，而字根表
    # 一個字也用不到這篇文章。併進去等於每個看字根表的人白白多下載 400KB。
    # 文章自己的字形直接放進 practice.json，只有試打頁會抓。
    practice = build_practice(dict_out["main"], codes, zigen_raw, max_rule, conv_chars)
    pinyin, pinyin_glyphs = build_pinyin(codes, zigen_raw, max_rule, charfreq, conv_chars)
    # 手挑清單裡有沒有寫錯字母／來源字，對不到任何一個字根的要講出來
    # 代表字可能已經被「顯示層改用第一個例字」換過（提 → 旦），而手挑清單是照
    # **原本的**代表字比對的。所以兩個都算數，否則會誤報「找不到這個字根」。
    used = set()
    for L in zg["letters"]:
        for grp in L["groups"]:
            for sh in grp["shapes"]:
                for src, st in [(sh["src"], sh["st"]),
                                (sh.get("src0"), sh.get("st0"))]:
                    if not src:
                        continue
                    used.add((L["letter"], src, tuple(sorted(st or []))))
                    used.add((L["letter"], src, None))
    # 手挑的鍵必須是 zigen.json **原本的**代表字。用顯示用的代表字寫（例如把
    # 「A 會」寫成「A 太」）雖然在 used 裡找得到、不會報「找不到字根」，但比對是在
    # 換代表字之前做的，那條手挑其實不會生效 —— 靜靜地沒作用是最糟的失敗方式。
    display_only = set()
    for L in zg["letters"]:
        for grp in L["groups"]:
            for sh in grp["shapes"]:
                if sh.get("src0") and sh["src0"] != sh["src"]:
                    display_only.add((L["letter"], sh["src"]))
    for key in picks:
        if (key[0], key[1]) in display_only:
            warn.append(f"{key[0]} {key[1]}：這是**顯示用**的代表字，手挑要寫原本的那個"
                        f"（這一條不會生效）")
            continue
        if key not in used:
            st = "#" + ",".join(str(i + 1) for i in key[2]) if key[2] else ""
            warn.append(f"{key[0]} {key[1]}{st}：找不到這個字根（字母或來源字寫錯？或已被合併）")

    n_glyph = build_glyphs(glyph_chars)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "dict.json").write_text(
        json.dumps(dict_out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "t2s.json").write_text(
        json.dumps(t2s, ensure_ascii=False, separators=(",", ":")), "utf-8")
    if practice:
        (OUT / "practice.json").write_text(
            json.dumps(practice, ensure_ascii=False, separators=(",", ":")), "utf-8")
    if pinyin:
        (OUT / "pinyin.json").write_text(
            json.dumps(pinyin, ensure_ascii=False, separators=(",", ":")), "utf-8")
        (OUT / "pinyin_glyphs.json").write_text(
            json.dumps(pinyin_glyphs, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "zigen.json").write_text(
        json.dumps(zg, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "principles.json").write_text(
        json.dumps(principles, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "jianma.json").write_text(
        json.dumps(jianma, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "conventional.json").write_text(
        json.dumps(conventional, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "phrases.json").write_text(
        json.dumps(phrases, ensure_ascii=False, separators=(",", ":")), "utf-8")
    if phrase_dict:
        (OUT / "phrase_dict.json").write_text(
            json.dumps(phrase_dict, ensure_ascii=False, separators=(",", ":")), "utf-8")

    print(f"dict.json  {len(dict_out['codes'])} 碼 / {len(codes)} 字 / {len(short)} 簡碼")
    if practice:
        print(f"practice.json 參考文章 {len(practice['texts'])} 篇 / "
              f"{len(practice['glyphs'])} 字有字形")
        for t in practice["texts"]:
            miss = t["missing"]
            print(f"  〈{t['title']}〉{len(t['paras'])} 段 / {t['chars']} 字"
                  + (f"　⚠️ {len(miss)} 個字還沒取碼（{''.join(miss)}），"
                     f"頁面會標成「尚未取碼」並讓人跳過" if miss else ""))
    if pinyin:
        kb = (OUT / "pinyin.json").stat().st_size / 1024
        mb = (OUT / "pinyin_glyphs.json").stat().st_size / 1024 / 1024
        print(f"pinyin.json {len(pinyin['index'])} 個拼音 / {kb:.0f} KB（載入就抓）")
        print(f"pinyin_glyphs.json {len(pinyin_glyphs['segs'])} 字有拆碼圖 / {mb:.1f} MB"
              f"（點進查字框才抓；已取碼的字裡，現代字頻最高的前 {PINYIN_TOP_N} 個）")
    print(f"t2s.json   {len(t2s)} 組繁簡對照")
    if n_glyph:
        kb = (OUT / "glyphs.json").stat().st_size / 1024
        print(f"glyphs.json {n_glyph} 字的筆畫輪廓 / {kb:.0f} KB  （Arphic PL，見 site/ARPHICPL.txt）")
    if picks:
        print(f"examples.md {len(picks)} 條手挑例字")
    for w in warn:
        print(f"  ⚠️ {w}")
    print(f"zigen.json {zg['shapes']} 個字根 / {len(zg['letters'])} 個字母"
          + f" / {len(zg['similar'])} 組相近字形辨析"
          + (f"  ⚠️ {zg['no_desc']} 組還沒寫取形意圖" if zg["no_desc"] else ""))
    n_wrong = sum(1 for v in principles.values() if "wrongs" in v)
    print(f"principles.json {len(principles)} 個取碼原則例字"
          + f"（{n_wrong} 個有正確/錯誤拆法對照圖）")
    n_left = sum(len(f["members"]) for f in jianma["left_short"])
    print(f"jianma.json {len(jianma['convention'])} 個約定簡碼"
          + f" / {len(jianma['left_short'])} 組左簡碼家族（{n_left} 字）")
    n_conv_chars = sum(len(g["chars"]) for g in conventional["groups"])
    print(f"conventional.json {len(conventional['groups'])} 組約定字（{n_conv_chars} 字）")
    ps = phrases["stats"]
    print(f"phrases.json {len(phrases['two'])} 個兩字例詞 / {len(phrases['si4'])} 個四碼例詞"
          + (f"；出貨碼表 {ps['words']} 詞 / {ps['entries']} 條，"
             f"四碼快打 {ps.get('si4Words', 0)} 詞 / {ps.get('si4Codes', 0)} 個四碼"
             if "words" in ps else "；⚠️ 讀不到 rime/，數字與核對都略過"))
    if phrase_dict:
        mb = (OUT / "phrase_dict.json").stat().st_size / 1024 / 1024
        pd = phrase_dict["stats"]
        print(f"phrase_dict.json {pd['words']} 詞 / {pd['codes']} 個詞組碼 / "
              f"{pd['si4']} 個四碼 / {mb:.1f} MB（詞組連打預設關，打開才抓）")


if __name__ == "__main__":
    main()
