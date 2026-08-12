#!/usr/bin/env python3
"""把碼表打包成 Rime 輸入法（真的可以拿來打字的那種）。

Rime 是跨平台的輸入法引擎：macOS 叫 Squirrel（鼠鬚管）、Windows 叫 Weasel（小狼毫）、
Linux 是 ibus/fcitx5-rime、iOS 有 Hamster。給它一份 schema + 一份碼表就成了一個輸入法。

產出 rime/：
    aiphabi.schema.yaml   輸入法的規格（26 鍵、選字、標點…）
    aiphabi.dict.yaml     碼表（主碼 + 兼容碼 + 完整碼）
    README.md             安裝步驟

碼表裡每個字可能有好幾個碼：
    主碼      實際要按的碼（超過上限就縮短）
    完整碼    整個字每一碼都打出來 —— 一律接受
    兼容碼    你手動收的另一種拆法（以及它的完整碼）
候選字的排序用字頻（rime 的 weight）：常用字排前面，重碼時少按一次選字鍵。

    python3 build_rime.py            # 產生檔案
    python3 build_rime.py --install  # 順便裝進 ~/Library/Rime（macOS）
"""
import json
import pathlib
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import date

ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "data"
OUT = ROOT / "rime"
RIME_USER_DIR = pathlib.Path.home() / "Library" / "Rime"      # macOS / Squirrel


def shorten(code, rule):
    """實際要按的碼：超過上限就取前 head 碼 + 末 tail 碼。與前端 Zigen.shorten 一致。"""
    if not rule:
        return code
    p = rule.get("params", {})
    mx, head, tail = p.get("max", 5), p.get("head", 4), p.get("tail", 1)
    if len(code) <= mx:
        return code
    return code[:head] + (code[-tail:] if tail else "")


def seed_default_options(path):
    """開關拿掉 reset 後才會真的記得使用者切的狀態，但這樣一來使用者從沒切過的開關
    就會預設關（user.yaml 沒那個 key，Rime 當沒設定過）。這裡只在「使用者從沒設定
    過」（key 不存在，不是存在且為 false）時幫忙種一個好用的初始值——種過一次、或
    使用者自己切過一次之後，往後永遠尊重 user.yaml 裡的值，不會再蓋。"""
    on_by_default = ["aiphabi_family", "aiphabi_comp", "aiphabi_fuzzy", "aiphabi_short100"]
    lines = path.read_text("utf-8").splitlines() if path.exists() else []
    var_i = next((i for i, l in enumerate(lines) if l == "var:"), None)
    if var_i is None:
        lines.append("var:")
        var_i = len(lines) - 1
    opt_i = next((i for i in range(var_i + 1, len(lines)) if lines[i] == "  option:"), None)
    if opt_i is None:
        insert_at = var_i + 1
        while insert_at < len(lines) and lines[insert_at].startswith("  "):
            insert_at += 1
        lines[insert_at:insert_at] = ["  option:"] + [f"    {k}: true" for k in on_by_default]
    else:
        block_end = opt_i + 1
        have = set()
        while block_end < len(lines) and lines[block_end].startswith("    "):
            have.add(lines[block_end].split(":")[0].strip())
            block_end += 1
        missing = [k for k in on_by_default if k not in have]
        if missing:
            lines[block_end:block_end] = [f"    {k}: true" for k in missing]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    codes = json.loads((DATA / "codes.json").read_text("utf-8"))
    rules = json.loads((DATA / "rules.json").read_text("utf-8"))
    freq = json.loads((DATA / "freq.json").read_text("utf-8"))["order"]
    rank = {c: i for i, c in enumerate(freq)}
    # 現代（台港新聞）字頻：候選排序優先看它，rime-essay 只打底。
    # 這一步就是把試打頁的 charfreq 排序搬進輸入法（己/已、名/合… 常用的排前面）。
    try:
        charfreq = json.loads((DATA / "charfreq.json").read_text("utf-8"))
    except FileNotFoundError:
        charfreq = {}

    max_rule = next((r for r in rules["rules"]
                     if r["id"] == "max_code_length" and r.get("enabled")), None)

    # 字 → 它所有打得出來的碼（去重、保持順序）
    NATIVE = 100_000_000     # 自己的碼永遠排在「別的字形借用同一個碼」之前（留足空間給字頻）

    def freq_w(c):
        # 現代字頻優先（每一計次值 10000，主導排序），rime-essay 次序打平手。
        base = max(1, 100000 - rank.get(c, 99999))
        return charfreq.get(c, 0) * 10000 + base

    weight = {}             # (碼, 字) -> 權重（重複時取最大）

    def put(code, char, w):
        key = (code.lower(), char)
        if weight.get(key, -1) < w:
            weight[key] = w

    per_char = {}
    main_out = {}                       # 碼位字 → 主 田字格 字形實際輸出哪個字（預設本字）
    for ch, rec in codes.items():
        if not rec.get("code"):
            continue
        # makemeahanzi 偶爾把字形畫成別的通行體（為 U+70BA 畫成 12 筆的 爲）；
        # display 讓主字形改輸出那個字，碼位（字頻、佇列）仍是本字。
        out = rec.get("display") or ch
        main_out[ch] = out
        seen = []
        def add(c):
            if c and c not in seen:
                seen.append(c)
        full = rec["code"]
        add(shorten(full, max_rule))    # 主碼
        add(full)                       # 完整碼：一律接受
        for a in rec.get("alts", []):   # 手動收的兼容碼（連它的完整碼）
            add(shorten(a["code"], max_rule))
            add(a["code"])
        per_char[ch] = seen
        for c in seen:                  # 這些碼都是主字形（out）自己的（native）
            put(c, out, NATIVE + freq_w(out))

    # 兼容字型：另一種通行字形（為 的台灣字形 → 為）當成另一個字，與主字形輸出互通。
    # 打那個字形的碼，優先出那個字形（native 加成）；主字形的碼也接受它，但排在後面（需要選字）。
    for ch, rec in codes.items():
        out = main_out.get(ch, rec.get("display") or ch)
        for v in rec.get("variants", []):
            disp, vcode = v.get("display"), v.get("code")
            if not disp or not vcode:
                continue
            vseen = []
            for c in (shorten(vcode, max_rule), vcode):
                if c and c not in vseen:
                    vseen.append(c)
            for c in vseen:
                put(c, disp, NATIVE + freq_w(disp))   # 這個字形的碼 → 對它自己是 native
                put(c, out, freq_w(out))              # 也打得出主字形（相容，排後面）
            for c in per_char.get(ch, []):
                put(c, disp, freq_w(disp))            # 主字形的碼 → 也出這個字形（相容，排後面）

    entries = [(code, char, w) for (code, char), w in weight.items()]
    entries.sort(key=lambda e: (e[0], -e[2]))
    char_count = len({char for _, char in weight})

    OUT.mkdir(exist_ok=True)
    today = date.today().isoformat().replace("-", ".")
    p = (max_rule or {}).get("params", {})
    mx = p.get("max", 5)

    # ---- 碼表 ----
    dict_lines = [
        "# 愛發筆碼表（由 build_rime.py 產生，不要手改）",
        f"# 主碼上限 {mx} 碼（前 {p.get('head', 4)} + 末 {p.get('tail', 1)}）；",
        "# 完整碼一律接受；alts 是手動收的兼容碼。",
        "---",
        "name: aiphabi",
        f'version: "{today}"',
        "sort: by_weight",
        "columns:",
        "  - text",
        "  - code",
        "  - weight",
        "...",
        "",
    ]
    for code, ch, w in entries:
        dict_lines.append(f"{ch}\t{code}\t{w}")
    (OUT / "aiphabi.dict.yaml").write_text("\n".join(dict_lines) + "\n", encoding="utf-8")

    # ---- Phase 2：智慧候選用的 Lua 資料（同類字／偏旁碼／輸入容錯／萬用鍵／打繁出簡／打簡出繁）----
    # 邏輯在 rime/lua/*.lua（靜態），資料隨碼表產生，兩者一起裝進 ~/Library/Rime/lua。
    LUA = OUT / "lua"
    LUA.mkdir(exist_ok=True)
    code2chars = defaultdict(list)          # 碼 → [字]（依權重）
    for code, ch, w in sorted(entries, key=lambda e: (e[0], -e[2])):
        if ch not in code2chars[code]:
            code2chars[code].append(ch)
    # 兼容碼提示：這個字用「兼容碼」（手動收的另一種拆法，比主碼略遜一籌）打出來時，
    # Squirrel candidate 旁邊加個 [碼] 提醒——跟主碼路徑分清楚。兼容字型不算，
    # 那是另一地區的正常寫法，不分優劣。
    altcode = defaultdict(set)              # 字（實際輸出的字形）→ 它的兼容碼集合
    for ch, rec in codes.items():
        if not rec.get("code"):
            continue
        out = rec.get("display") or ch
        for a in rec.get("alts", []):
            ac = a.get("code")
            if not ac:
                continue
            altcode[out].add(shorten(ac, max_rule).lower())
            altcode[out].add(ac.lower())

    # 約定簡碼：手動在取碼原則頁挑的字（試過自動抓常用度前 100 名，重碼太多，
    # 改回手動——的、我、是、這、就這種真的常用到不介意撞碼的字才值得收）。
    # 開關 aiphabi_short100 預設開——挑進來的都是真的常用到不在乎撞碼的字。
    short_rule = next((r for r in rules["rules"] if r["id"] == "short_code"), None)
    shortcode = {}      # 簡碼(小寫) -> 字（清單裡撞碼的，先加的贏，跟取碼原則頁的預覽一致）
    shortcode_rev = {}  # 字 -> 簡碼：打了這個字的完整碼（不是簡碼）時，提醒「其實有簡碼可以打」
    if short_rule and short_rule.get("enabled"):
        for entry in short_rule.get("entries", []):
            ch, short = entry.get("c"), (entry.get("short") or "").lower()
            if not ch or not short or ch not in codes or not codes[ch].get("code"):
                continue
            if short not in shortcode:
                shortcode[short] = ch
            if ch not in shortcode_rev:
                shortcode_rev[ch] = short

    # 三簡碼：約定簡碼的自動版——不用手動挑，4 碼以上的字全部適用。打 3 碼
    # 當「頭兩碼＋末一碼」查（等於 AB`C），碰撞其實不多（多數簽名只對到 1～2 個
    # 字），照專案一貫做法：候選多給，不主動幫忙濾掉，讓人自己滑。提示一律秀
    # 主碼（char2code），不是比對到的那個碼——那個可能是完整碼，太長。
    short3 = defaultdict(list)   # 簽名（頭2+末1，小寫）-> [字, ...]（去重）
    for code, chs in code2chars.items():
        if len(code) < 4:
            continue
        sig = code[0] + code[1] + code[-1]
        for ch in chs:
            if ch not in short3[sig]:
                short3[sig].append(ch)

    conv = next((r for r in rules["rules"] if r["id"] == "convention"), None)
    FAM_SKIP = {"數字類", "馬字類"}          # 家族提示跳過數字／馬（非形近字）
    family, comp = {}, defaultdict(list)
    if conv:
        for g in conv.get("groups", []):
            name = g.get("name", "")
            fam_chars = [c["c"] for c in g.get("chars", [])
                         if c.get("c") in codes and codes[c["c"]].get("code")]
            if name.endswith("類") and name not in FAM_SKIP and len(fam_chars) > 1:
                for c in fam_chars:
                    family[c] = fam_chars
            for row in g.get("chars", []):   # 偏旁碼提醒涵蓋整個約定表（含數字類）
                c, cc = row.get("c"), row.get("compCode")
                if not cc or c not in codes or not codes[c].get("code"):
                    continue
                cc_s = shorten(cc, max_rule).lower()      # 對齊碼表：一律小寫
                if cc_s != shorten(codes[c]["code"], max_rule).lower():
                    comp[cc_s].append(c)
    # 打繁出簡／打簡出繁：跟試打頁共用同一份繁簡對照（data/opencc.json）。
    try:
        opencc = json.loads((DATA / "opencc.json").read_text("utf-8"))
    except FileNotFoundError:
        opencc = {"t2s": {}, "s2t": {}}
    t2s_map, s2t_map = opencc.get("t2s", {}), opencc.get("s2t", {})
    # 不打簡體：只濾掉「一對一純簡化字」（馬→马、魚→鱼），不動「歸併字」——
    # 這些字本身就是獨立傳承字，只是剛好也被拿來簡化別的字（后＝王后／後的簡化…）。
    # s2t_map 光看資料分不出這兩種，白名單放在 data/dual_use_merged.json（跟
    # stats.html「碼表分析」共用，避免兩邊各自維護一份、分岔）。
    DUAL_USE_MERGED = set(
        json.loads((DATA / "dual_use_merged.json").read_text("utf-8"))["chars"]
    )
    simp_only = sorted(c for c in s2t_map if c not in DUAL_USE_MERGED)
    by_len = defaultdict(list)
    for code in code2chars:
        by_len[len(code)].append(code)
    # 同類字／簡繁等提示要順便顯示該字的正碼：字 → 縮短後的主碼。乾脆全部codable
    # 的字都收（不再只收 family/comp/altcode 等有牽扯到的），因為「打的是完整碼、
    # 秀主碼」這個修正（見下面 markHints）任何一個字都可能用到，不好再一個個追蹤
    # 「誰需要」。
    char2code = {c: shorten(rec["code"], max_rule).lower()
                 for c, rec in codes.items() if rec.get("code")}

    # ---- 詞組連打：常用詞 = 各字「簡碼（無簡碼則主碼）」串接 ----
    # 例：我的 = 我jkq + 的ja = jkqja；中國人 = 中q + 國oq + 人y = qoqy；香港 = 香jtb + 港whvz = jtbwhvz。
    # 打前綴（jkqj）即由 enable_completion 補出整個詞。詞收進共用碼表：二合一（＋拼音）預設就有；
    # 純愛發筆用 aiphabi_phrase 開關控制（預設關，像三簡碼一樣自己開來用），關掉時由 aiphabi_phrase.lua 濾掉多字候選。
    PHRASE_TOPN = 40000
    # 每字有兩式：主碼；短碼＝簡碼優先、否則三簡碼(主碼≥4，頭2末1)、否則主碼。各字串接即詞組碼。
    #   兩字詞：每字「短/主」任意搭配四式都收（短短、短主、主短、主主）——不用記哪個字該用哪式。
    #           我的＝jkqja（短短）/jkqjba（短主）/jkxqja（主短）/jkxqjba（主主）。
    #   3+字詞：整詞統一三式（main／簡碼優先／三簡碼優先），免得組合爆炸。
    def _pcode(ch, mode):
        mc = char2code.get(ch)                    # 主碼
        if mode == "main":
            return mc
        sc = shortcode_rev.get(ch)                # 簡碼
        if sc:
            return sc
        if mode == "t3" and mc and len(mc) >= 4:
            return mc[0] + mc[1] + mc[-1]         # 三簡碼：頭2+末1
        return mc
    def _char_short(ch):                          # 短碼：簡碼 > 三簡碼(主碼≥4) > 主碼
        sc = shortcode_rev.get(ch)
        if sc:
            return sc
        mc = char2code.get(ch)
        if mc and len(mc) >= 4:
            return mc[0] + mc[1] + mc[-1]
        return mc
    def _word_codes(w):                           # 回傳 {碼,...}；任一字沒取碼就回 None（整詞收不了）
        chs = list(w)
        if any(char2code.get(ch) is None for ch in chs):
            return None
        out = set()
        if len(chs) == 2:
            for a in (_char_short(chs[0]), char2code[chs[0]]):
                for b in (_char_short(chs[1]), char2code[chs[1]]):
                    out.add(a + b)
        else:
            for mode in ("main", "simp", "t3"):
                out.add("".join(_pcode(ch, mode) for ch in chs))
        return out

    phrase_w = {}                                 # 詞 -> 權重（essay 計次；地名沒有就給地板值）
    _pe = {}
    try:
        SS = pathlib.Path("/Library/Input Methods/Squirrel.app/Contents/SharedSupport")
        for _ln in (SS / "essay.txt").read_text("utf-8", "ignore").splitlines():
            _p = _ln.split("\t")
            if len(_p) >= 2 and _p[1].strip().isdigit():
                _n = int(_p[1])
                if _n > 0 and 2 <= len(_p[0]) <= 4:
                    _pe[_p[0]] = _n
        for _w, _n in sorted(_pe.items(), key=lambda kv: -kv[1])[:PHRASE_TOPN]:
            phrase_w[_w] = _n
    except (FileNotFoundError, OSError):
        _pe = {}

    # 精選詞庫：data/phrases_*.txt 每個主題檔（地名／政要／紅星／英文名／常識／成語／飲食／品牌…）
    # 一律收，不管在不在 essay 高頻表。新增主題檔只要照 phrases_ 命名就自動收進來。
    # 沒 essay 計次的給地板權重照樣排得出來；有字沒取碼的整詞收不了，建置時列出來讓人知道。
    # 兩個地板分屬兩把不同的尺，別混用（之前混用害手機把 屬鼠 排在 屬於 前）：
    #   PLACE_DICT_FLOOR：碼表 weight 的尺＝essay「原始計次」（屬於 67100、屬性 22130…）。手機沒 lua
    #     重排，候選就照這個 weight 排，所以專名地板要落在「中等常用詞」以下、別高過常用詞。
    #   PLACE_FLOOR：詞頻表 wordfreq 的尺＝校準到字頻（屬於 569984…），桌面 lua 重排用。兩尺數字不同。
    PLACE_DICT_FLOOR = 12000
    PLACE_FLOOR = 100000
    place_skipped = []
    for _wf in sorted(DATA.glob("phrases_*.txt")):
        for _ln in _wf.read_text("utf-8").splitlines():
            for _w in _ln.split("#", 1)[0].split():
                if len(_w) < 2:
                    continue
                if _word_codes(_w) is None:
                    place_skipped.append(_w)
                elif _w not in phrase_w:
                    phrase_w[_w] = max(_pe.get(_w, 0), PLACE_DICT_FLOOR)
                elif phrase_w[_w] < PLACE_DICT_FLOOR:
                    phrase_w[_w] = PLACE_DICT_FLOOR

    phrase_entries, _seen_wc = [], set()
    for _w, _wt in phrase_w.items():
        for _c in (_word_codes(_w) or ()):
            if (_w, _c) not in _seen_wc:
                _seen_wc.add((_w, _c))
                phrase_entries.append((_w, _c, _wt))
    if phrase_entries:
        with open(OUT / "aiphabi.dict.yaml", "a", encoding="utf-8") as _f:
            for _w, _code, _wt in sorted(phrase_entries, key=lambda e: (e[1], -e[2])):
                _f.write(f"{_w}\t{_code}\t{_wt}\n")
        print(f"詞組 {len(phrase_entries)} 條（essay 前 {PHRASE_TOPN} + 精選詞庫 data/phrases_*.txt）")
    if place_skipped:
        print(f"  ⚠ 地名跳過 {len(place_skipped)} 個（有字沒取碼，收不進去）：{' '.join(place_skipped)}")

    # ---- 四碼連打：3+ 字詞壓成固定 4 碼（開關 aiphabi_si4；不進碼表，靠 Lua 查 M.si4）----
    #   3 字：字1首 + 字2首 + 字3首 + 字3末（末字補末碼消歧）——容祖兒=QQFL
    #   4 字：四字各首碼——光明正大=WBFI
    #   5+ 字：兩式都收——前四字各首碼（從開頭打就行，記得開頭即可）＝中華人民共和國 QHYC；
    #          外加 前三字+末字首碼（記得整句可精準定位，消 中國人民X 那種撞碼）＝解放軍 QOY+軍。
    # 撞碼的照詞頻排（常用在前），每碼上限收 24 個免爆。
    si4 = defaultdict(list)
    for _w, _wt in phrase_w.items():
        _chs = list(_w)
        if len(_chs) < 3 or any(_c not in char2code for _c in set(_chs[:4]) | {_chs[-1]}):
            continue
        _codes4 = []
        if len(_chs) == 3:
            _codes4.append(char2code[_chs[0]][0] + char2code[_chs[1]][0]
                           + char2code[_chs[2]][0] + char2code[_chs[2]][-1])
        elif len(_chs) == 4:
            _codes4.append("".join(char2code[_c][0] for _c in _chs))
        else:  # 5+：前四字首碼 ＋ 前三字+末字首碼
            _codes4.append("".join(char2code[_c][0] for _c in _chs[:4]))
            _codes4.append("".join(char2code[_c][0] for _c in _chs[:3]) + char2code[_chs[-1]][0])
        for _c4 in _codes4:
            si4[_c4].append((_wt, _w))        # 完整四碼
            si4[_c4[:3]].append((_wt, _w))    # 前三碼（打到第三碼就先補全出來，跟拼音簡拼同場競爭）
    for _c in list(si4):                      # 依詞頻排、去重、每碼上限 24
        _seen, _out = set(), []
        for _, _w in sorted(si4[_c], key=lambda x: -x[0]):
            if _w not in _seen:
                _seen.add(_w); _out.append(_w)
        si4[_c] = _out[:24]
    print(f"四碼連打 {sum(len(v) for v in si4.values())} 詞 → {len(si4)} 個四碼")

    # 約定簡碼開關：規則關掉、或算出來根本沒半條時，就別讓這個開關出現在方案選單裡礙眼
    # 注意：這裡不設 reset —— Rime 每次啟動引擎（開機／重新部署）都會用 reset 的值
    # 蓋掉剛從 user.yaml 讀回來的狀態，等於這個開關永遠記不住使用者切過什麼
    # （engine.cc 的 InitializeOptions 在 RestoreSavedOptions 之後執行，會覆蓋回去）。
    # 想要的「預設開」改成在 --install 時只在使用者從沒切過（user.yaml 沒這個 key）時
    # 幫忙種一次初始值，見下面 _seed_default_options。
    short_switch = ""
    if shortcode:
        short_switch = ("  - name: aiphabi_short100          # 約定簡碼：手動挑的常用字，首尾兩碼\n"
                         "    states: [ 簡碼關, 簡碼開 ]\n")
    # 三簡碼開關：新機制，先預設關，讓人自己開來試，覺得沒問題再考慮預設開
    # （跟約定簡碼／智能聯想上線時同一套路數）。
    short3_switch = ""
    if short3:
        short3_switch = ("  - name: aiphabi_short3            # 三簡碼：頭兩碼+末一碼，當 AB`C 查\n"
                          "    states: [ 三簡碼關, 三簡碼開 ]\n")
    # 詞組連打開關（純愛發筆）：先預設關，自己開來用；二合一（＋拼音）不掛這開關、永遠開。
    phrase_switch = ""
    if phrase_entries:
        phrase_switch = ("  - name: aiphabi_phrase            # 詞組連打：常用詞用各字簡碼串接直接打\n"
                          "    states: [ 詞組關, 詞組開 ]\n")
    # 四碼詞組（3+字詞壓成 4 碼）不另設開關——跟著詞組走：詞組開它就有，詞組關就沒。
    # （純愛發筆看 aiphabi_phrase；二合一詞組恆開，故恆有。判斷在 aiphabi_hint 裡做。）
    # 智能聯想開關：用官方 librime-predict 外掛（predictor/predict_translator），
    # 不是自己寫的 segmentor——選完字、完全沒打碼時，Rime 內建機制才有辦法自動彈出候選
    # （lua segmentor 在 input 是空字串時根本不會被呼叫，試過會發現這條路走不通）。
    # data/predict.db 沒抓下來就不出現這個開關。
    prediction_switch = ""
    predictor_processor = ""
    predict_translator = ""
    predictor_config = ""
    if (DATA / "predict.db").exists():
        prediction_switch = ("  - name: prediction                # 智能聯想：選完字，猜下一個字／詞\n"
                              "    states: [ 聯想關, 聯想開 ]\n")
        predictor_processor = "    - predictor\n"
        predict_translator = "    - predict_translator\n"
        predictor_config = ("\npredictor:\n"
                             "  db: predict.db\n"
                             "  max_candidates: 5    # 配 menu.page_size，一頁看得完\n"
                             "  max_iterations: 1    # 選了聯想候選後，最多再連續猜一輪，別一路猜下去\n")
    def lua_str(x):
        return '"' + x.replace("\\", "\\\\").replace('"', '\\"') + '"'
    def lua_arr(xs):
        return "{" + ",".join(lua_str(x) for x in xs) + "}"
    dl = ["-- 愛發筆智慧候選資料（由 build_rime.py 產生，勿手改）", "local M = {}", ""]
    dl.append("M.code2chars = {")
    for code, chs in sorted(code2chars.items()):
        dl.append(f'  [{lua_str(code)}]={lua_arr(chs)},')
    dl += ["}", "M.family = {"]
    for c, sibs in family.items():
        dl.append(f'  [{lua_str(c)}]={lua_arr(sibs)},')
    dl += ["}", "M.comp = {"]
    for code, chs in sorted(comp.items()):
        dl.append(f'  [{lua_str(code)}]={lua_arr(chs)},')
    dl += ["}", "M.by_len = {"]
    for n, cs in sorted(by_len.items()):
        dl.append(f'  [{n}]={lua_arr(cs)},')
    dl += ["}", "M.char2code = {"]
    for c, code in sorted(char2code.items()):
        dl.append(f'  [{lua_str(c)}]={lua_str(code)},')
    dl += ["}", "M.t2s = {"]
    for c, vs in sorted(t2s_map.items()):
        dl.append(f'  [{lua_str(c)}]={lua_arr(vs)},')
    dl += ["}", "M.s2t = {"]
    for c, vs in sorted(s2t_map.items()):
        dl.append(f'  [{lua_str(c)}]={lua_arr(vs)},')
    dl += ["}", "M.simp = {"]           # 不打簡體要濾掉的字（純簡化字，歸併字不算）
    for c in simp_only:
        dl.append(f'  [{lua_str(c)}]=true,')
    dl += ["}", "M.altcode = {"]        # 字 → {碼: true} 集合（candidate 用 [碼] 標示；查表用，不是陣列）
    for c, acs in sorted(altcode.items()):
        inner = "".join(f'[{lua_str(a)}]=true,' for a in sorted(acs))
        dl.append(f'  [{lua_str(c)}]={{{inner}}},')
    dl += ["}", "M.shortcode = {"]      # 簡碼 → [字]（約定簡碼；aiphabi_short100 開關控制）
    for code, ch in sorted(shortcode.items()):
        dl.append(f'  [{lua_str(code)}]={lua_arr([ch])},')
    dl += ["}", "M.shortcode_rev = {"]  # 字 → 簡碼（打完整碼時提醒「其實有簡碼」；aiphabi_short100 開關控制）
    for ch, short in sorted(shortcode_rev.items()):
        dl.append(f'  [{lua_str(ch)}]={lua_str(short)},')
    dl += ["}", "M.short3 = {"]         # 簽名(頭2+末1) → [字]（三簡碼；aiphabi_short3 開關控制，提示一律秀主碼）
    for sig, chs in sorted(short3.items()):
        dl.append(f'  [{lua_str(sig)}]={lua_arr(chs)},')
    dl += ["}", "M.si4 = {"]            # 四碼 → [詞]（四碼連打；aiphabi_si4 開關控制，依詞頻排）
    for sig, ws in sorted(si4.items()):
        dl.append(f'  [{lua_str(sig)}]={lua_arr(ws)},')
    # ---- 詞頻（真語料 essay.txt）：字頻推不出詞頻（無性 兩字常用詞卻冷、武俠 反之），
    #      多字詞一律查真語料計次，再「校準」到單字常用度的同一把尺（跟字頻可直接比大小）：
    #      一個詞的 essay 計次若排在單字的第 R 名，就給它第 R 高的單字分數。
    #      只收最常用的前 N 個多字詞控制檔案大小；沒收進來的罕詞在 Lua 端打折當罕詞處理。
    WORDFREQ_TOPN = 60000
    wordfreq = {}
    try:
        import bisect
        SS = pathlib.Path("/Library/Input Methods/Squirrel.app/Contents/SharedSupport")
        _essay = {}
        for _ln in (SS / "essay.txt").read_text("utf-8", "ignore").splitlines():
            _p = _ln.split("\t")
            if len(_p) >= 2 and _p[1].strip().isdigit():
                _n = int(_p[1])
                if _n > 0:
                    _essay[_p[0]] = _n
        _single = [c for c in _essay if len(c) == 1]
        _neg = sorted(-_essay[c] for c in _single)                 # 單字 essay 計次（升序負值，供 bisect）
        _fw = sorted((freq_w(c) for c in _single), reverse=True)   # 單字 freq_w（降序）
        def _wscore(n):
            R = bisect.bisect_left(_neg, -n)                       # essay 計次 > n 的單字數
            return _fw[min(R, len(_fw) - 1)] if _fw else 0
        _words = [(_n, _w) for _w, _n in _essay.items() if 2 <= len(_w) <= 4]
        _words.sort(reverse=True)                                  # 依計次由高到低，取前 N
        for _n, _w in _words[:WORDFREQ_TOPN]:
            wordfreq[_w] = _wscore(_n)
    except (FileNotFoundError, OSError):
        wordfreq = {}
    # 精選詞庫的專名（容祖兒／莫桑比克／台北車站…）多半不在 essay，補進詞頻表給地板值，
    # 免得排序當罕詞掉後面——讓詞組／四碼詞組候選跟拼音同場競爭。
    for _w in phrase_w:
        if _w not in wordfreq:
            wordfreq[_w] = PLACE_FLOOR

    dl += ["}", "M.freq = {"]           # 字 → 常用度分數（現代字頻主導）；候選重排用
    # 全字覆蓋：aiphabi_plus 的拼音會帶出沒取碼的字（吧／不／到…），排序也要它們的常用度。
    # charfreq（台港新聞高頻）先、freq.json 序補、再補上已取碼字（少數罕用可能都不在）。
    _fseen = set()
    _allchars = list(dict.fromkeys(list(charfreq.keys()) + list(freq)))
    for _chs in code2chars.values():
        _allchars.extend(_chs)
    for _c in _allchars:
        if _c and _c not in _fseen:
            _fseen.add(_c)
            dl.append(f'  [{lua_str(_c)}]={freq_w(_c)},')
    dl += ["}", "M.wordfreq = {"]       # 多字詞 → 常用度分數（essay 真語料，已校準到單字同尺）；aiphabi_plus 池排序用
    for _w, _s in sorted(wordfreq.items()):
        dl.append(f'  [{lua_str(_w)}]={_s},')
    print(f"詞頻 {len(wordfreq)} 條（essay 前 {WORDFREQ_TOPN}）")
    dl += ["}", "return M"]
    (LUA / "aiphabi_data.lua").write_text("\n".join(dl) + "\n", encoding="utf-8")

    # ---- schema ----
    # 注意：不設 speller/max_code_length —— 那會在打滿 N 碼時強制上屏，
    # 但完整碼可以長到 9 碼，設了就永遠打不出完整碼。
    schema = f"""# 愛發筆 AiPhaBi —— 形碼輸入法
# 由 build_rime.py 產生。字根看鍵盤上那個英文字母長什麼樣（山→W、口→O、弓→S…），
# 不必背 A=日 B=月 這種對照表。

schema:
  schema_id: aiphabi
  name: 愛發筆
  version: "{today}"
  author:
    - wilsongrchan
  description: |
    形碼輸入法。字根的形狀就是鍵盤上那個英文字母的形狀。
    主碼最多 {mx} 碼（前 {p.get('head', 4)} 碼 + 末 {p.get('tail', 1)} 碼）；把整個字拆完、
    每一碼都打出來（完整碼）一樣打得出字。

switches:
  # ascii_mode 不放進來：不需要它出現在方案選單／狀態列選單裡——
  # Shift 鍵本來就能切中英文（鼠鬚管內建的 ascii_composer 行為，與這份清單無關）。
  - name: full_shape
    states: [ 半形, 全形 ]
  - name: aiphabi_t2s              # 打繁出簡：候選字順便帶出簡體版
    states: [ 打繁出簡關, 打繁出簡開 ]
  - name: aiphabi_s2t              # 打簡出繁：候選字順便帶出繁體版
    states: [ 打簡出繁關, 打簡出繁開 ]
  - name: aiphabi_family          # 同類字提示（形近字家族）
    states: [ 同類字關, 同類字開 ]
  - name: aiphabi_comp            # 偏旁碼提示
    states: [ 偏旁關, 偏旁開 ]
  - name: aiphabi_fuzzy           # 輸入容錯
    states: [ 容錯關, 容錯開 ]
  - name: aiphabi_no_simp          # 不打簡體：候選只留繁體字／傳承字，濾掉簡體專屬字
    states: [ 不打簡體關, 不打簡體開 ]
{short_switch}{short3_switch}{phrase_switch}{prediction_switch}  - name: ascii_punct
    states: [ 。，, ．， ]

engine:
  processors:
    - ascii_composer
    - recognizer
{predictor_processor}    - key_binder
    - speller
    - punctuator
    - selector
    - navigator
    - express_editor
  segmentors:
    - ascii_segmentor
    - matcher
    - abc_segmentor
    - punct_segmentor
    - fallback_segmentor
  translators:
{predict_translator}    - punct_translator
    - table_translator
    - lua_translator@aiphabi_wildcard   # 萬用鍵 `：某幾碼想不起來就按 `
  filters:
    - lua_filter@aiphabi_phrase         # 詞組連打開關：關掉就濾掉多字候選（詞組）
    - lua_filter@aiphabi_hint           # 同類字 + 偏旁碼 + 打繁出簡 + 打簡出繁 提示
    - lua_filter@aiphabi_fuzzy          # 輸入容錯（漏碼/多碼/隔壁鍵/打反）
    - lua_filter@aiphabi_order          # 候選重排：簡碼 → 主碼exact → 其餘照 選過/常用度
    - uniquifier

speller:
  alphabet: 'zyxwvutsrqponmlkjihgfedcba`'   # 收 ` 進字母表：萬用鍵才輸入得進來
  delimiter: " '"

translator:
  dictionary: aiphabi
  enable_charset_filter: false
  enable_sentence: true        # 打過某詞的碼還繼續打時，靠切分把已知的詞留在候選、並幫忙組出整句
  enable_encoder: false
  enable_completion: true      # 碼還沒打完就先給候選
  strict_spelling: false
  preedit_format:              # 螢幕上顯示大寫（實際查碼仍用小寫；` 不動）
    - "xlit|abcdefghijklmnopqrstuvwxyz|ABCDEFGHIJKLMNOPQRSTUVWXYZ|"
  comment_format:              # 候選旁邊的碼提示也顯示大寫
    - "xlit|abcdefghijklmnopqrstuvwxyz|ABCDEFGHIJKLMNOPQRSTUVWXYZ|"
    - "xform/~/- /"            # 補碼提示的 ~ 改成「- 」（例 ~K → - K）
{predictor_config}
menu:
  page_size: 8                 # 一次顯示 8 個候選

# 標點：正體中文的全形標點。字母鍵全部給字根用，標點就落在原本的標點鍵上。
punctuator:
  import_preset: default
  half_shape:
    ',': '，'
    '.': '。'
    '?': '？'
    '!': '！'
    ';': '；'
    ':': '：'
    '\\': '、'
    '/': '、'
    '(': '（'
    ')': '）'
    '[': '「'
    ']': '」'
    '{{': '『'
    '}}': '』'
    '<': '《'
    '>': '》'
    '~': '～'
    '^': '……'
    '_': '——'
    '-': '－'
    '"': {{ pair: [ '「', '」' ] }}
    "'": {{ pair: [ '『', '』' ] }}
    '@': '＠'
    '#': '＃'
    '%': '％'
    '&': '＆'
    '*': '＊'
    '+': '＋'
    '=': '＝'
    '|': '｜'
    '$': '＄'

key_binder:
  import_preset: default

recognizer:
  import_preset: default
"""
    (OUT / "aiphabi.schema.yaml").write_text(schema, encoding="utf-8")

    # ---- 重碼報告（裝之前先知道哪裡要多按一次選字鍵）----
    by_code = defaultdict(list)
    for code, ch, w in entries:
        by_code[code].append(ch)
    dups = {c: chs for c, chs in by_code.items() if len(chs) > 1}

    readme = f"""# 愛發筆 · Rime 輸入法

由 `python3 build_rime.py` 產生。共 **{char_count} 字**、**{len(entries)} 條碼**
（主碼 + 完整碼 + 手動收的兼容碼）。

## macOS（Squirrel 鼠鬚管）

```sh
brew install --cask squirrel        # 還沒裝的話
python3 build_rime.py --install     # 把 schema 與碼表複製到 ~/Library/Rime
```

`--install` 會一次裝好：碼表、`lua/`＋`rime.lua`（智慧候選），以及
`default.custom.yaml`（啟用愛發筆）與 `squirrel.custom.yaml`（橫排 bar＋橙色高亮）。
後兩個若你已有，會保留你的設定、不覆蓋。

然後：

1. 系統設定 → 鍵盤 → 輸入法 → 加入「鼠鬚管」（第一次裝可能要登出再登入才看得到）
2. 開「鼠鬚管」選單 →〈重新部署〉
3. 切到鼠鬚管，點選單列的鼠鬚管圖示 → 選「愛發筆」；同一個選單下面也能直接點打繁出簡／打簡出繁／同類字／偏旁碼／輸入容錯（每項各自一個可勾選的開關，不用背 F4）。中英文切換固定用 `Shift` 鍵，不在這份選單裡。

## 怎麼打

* 一個字最多按 {mx} 個鍵（超過上限的碼會縮短：前 {p.get('head', 4)} 碼 + 末 {p.get('tail', 1)} 碼）。
* 也可以把整個字拆完、每一碼都打出來（完整碼），一樣打得出來。
* 重碼時用數字鍵或空白鍵選字；常用字排前面（用現代台港新聞字頻排序）。

## 智慧候選（跟試打頁一樣的貼心功能）

都靠鼠鬚管內建的 librime-lua，裝好就能用；點選單列鼠鬚管圖示就能個別勾選開關（打繁出簡／打簡出繁／不打簡體預設關，其餘預設開）：

* **打繁出簡**（`aiphabi_t2s` 開關，預設關）— 候選字順便帶出它的簡體版，標「簡」。
* **打簡出繁**（`aiphabi_s2t` 開關，預設關）— 候選字順便帶出它的繁體版，標「繁」。兩個各自獨立，要單開哪邊都行。
* **不打簡體**（`aiphabi_no_simp` 開關，預設關）— 候選裡的簡體專屬字（純一對一簡化，如 馬→马、魚→鱼）整個濾掉，只留繁體字／傳承字；「歸併字」不算簡體專屬（如 后／干／咸／里／谷／面 這些字本身也是獨立傳承字），不會被濾掉。開了這個會順便把「打簡出繁」關掉——碼表裡沒有簡體本字，那個提示用不到。
* **約定簡碼**（`aiphabi_short100` 開關，預設開）— 手動在「取碼原則」頁挑的常用字（的、我、是、這、就…），打它們主碼的「首尾兩碼」也找得到，標「簡碼」，並排在候選最前面。這幾個字常用到即使簡碼撞到別的字也划算，其餘沒挑的字不受影響。
* **同類字**（`aiphabi_family`）— 打中約定表某形近字家族其一，把整組帶出來（打 `f` → 土 旁邊也給你 士 工 干 上…）。標「同類」。
* **偏旁碼**（`aiphabi_comp`）— 打了某字「作為偏旁時」的碼，提醒你那個字（例 `ii` → 二）。標「偏旁碼」。
* **輸入容錯**（`aiphabi_fuzzy`）— 漏打一碼、多打一碼、打成鍵盤隔壁鍵、相鄰兩碼打反，也照樣找得到，標「可能 …」。
* **萬用鍵 `` ` ``** — 某幾碼想不起來就按 `` ` ``：單一個 = 一碼以上（`` wj`m `` 也找得到 wjstm）；連按 N 個 = 剛好補 N 碼。

## 標點（正體全形）

字母鍵全都給字根用了，標點就落在原本的標點鍵上：

| 按鍵 | 出來 | 按鍵 | 出來 | 按鍵 | 出來 |
|---|---|---|---|---|---|
| `,` | ， | `.` | 。 | `?` | ？ |
| `!` | ！ | `;` | ； | `:` | ： |
| `\\` `/` | 、 | `(` `)` | （） | `[` `]` | 「」 |
| `{{` `}}` | 『』 | `<` `>` | 《》 | `^` | …… |
| `_` | —— | `~` | ～ | `-` | － |

`"` 與 `'` 是成對的：連按會輪流出「」與『』的左右半邊。

## 目前的重碼（{len(dups)} 組）

裝之前先知道哪些字要多按一次選字鍵：

{chr(10).join(f'* `{c}` → {"".join(chs)}' for c, chs in sorted(dups.items(), key=lambda kv: -len(kv[1]))[:25])}

## iOS（仓／Hamster）

裝「仓輸入法」（App Store 搜「仓」，開發者 imfuxiao），librime-lua 內建，
智慧候選跟 macOS 一樣能用。這裡另外準備了 `hamster.custom.yaml`：把主鍵盤的萬用鍵獨立成一顆
真的鍵（Q 正下方、A 左邊，不用長按），符號鍵也換成一頁排滿的數字符號表（仿 iOS 內建鍵盤），
不是「仓」原生那種要先選類別的清單。

**要傳的檔案**：`aiphabi.schema.yaml`、`aiphabi.dict.yaml`、`rime.lua`、整個 `lua/` 目錄、
`default.custom.yaml`、`hamster.custom.yaml`。打包成 zip 時**不要包住一層資料夾**——這幾個
檔案本身就要是 zip 的最外層，不然「仓」的匯入功能讀不到。

**匯入（手機端全部搞定，不用電腦）**：

1. 把 zip 存到手機的「檔案」App。
2. 兩種方式擇一：在「檔案」App 長按 zip →〈分享〉→「仓」（會自動解壓到 Rime 目錄）；
   或在「仓」內「輸入方案設置」→ 右上角「+」→「導入方案」選這個 zip。
3. 到「仓」的「RIME」頁籤，按〈重新部署〉——**這一步一定要做**，且要在「RIME」頁籤裡直接按，
   不能只靠匯入方案那一步順便觸發，不然鍵盤佈局（`hamster.custom.yaml`）不會生效。
4. 「輸入方案設置」裡確認「愛發筆」已勾選。
5. 「鍵盤設置」→「鍵盤佈局」，選「自訂-愛發筆26鍵」。

> 這個 `hamster.custom.yaml` 還多定義了兩顆鍵盤（`AiPhaBiSymbols`、`AiPhaBiSymbols_more`，
> 符號鍵的兩頁）。它們也會各自出現在「鍵盤佈局」清單裡，這是「仓」的正常行為——**不要選它們、
> 也不要刪它們**，它們是給主鍵盤上的「符」「更多」「字母」「返回」這幾顆鍵切換用的，
> 刪掉會連帶讓整組自訂鍵盤從清單消失（親身試過），得靠「RIME」→「RIME 重置」全部重來才救得回來。

## 其他平台

把 `aiphabi.schema.yaml`、`aiphabi.dict.yaml`、`rime.lua`、以及整個 `lua/` 目錄
丟進對應的使用者目錄，再〈重新部署〉即可（智慧候選需要該平台的 librime-lua；
Weasel／fcitx5-rime 多半內建）：

| 平台 | 目錄 |
|---|---|
| Windows（小狼毫 Weasel） | `%APPDATA%\\Rime` |
| Linux（ibus/fcitx5-rime） | `~/.config/ibus/rime` 或 `~/.local/share/fcitx5/rime` |
| iOS（仓／Hamster） | 見上方「iOS（仓／Hamster）」一節 |

> 若沒有 librime-lua，碼表照樣能打字，只是這些智慧候選（打繁出簡／打簡出繁／同類字／偏旁碼／輸入容錯／萬用鍵）不會出現。
"""
    (OUT / "README.md").write_text(readme, encoding="utf-8")

    print(f"字 {char_count}　碼 {len(entries)}　重碼組 {len(dups)}")
    print(f"寫出：{OUT}/aiphabi.schema.yaml、aiphabi.dict.yaml、README.md")

    if "--install" in sys.argv:
        if not RIME_USER_DIR.exists():
            print(f"\n找不到 {RIME_USER_DIR} —— 先裝 Squirrel："
                  "\n    brew install --cask squirrel")
            return
        for f in ("aiphabi.schema.yaml", "aiphabi.dict.yaml"):
            shutil.copy(OUT / f, RIME_USER_DIR / f)
        if (OUT / "aiphabi_plus.schema.yaml").exists():   # 二合一（形碼＋拼音）實驗方案
            shutil.copy(OUT / "aiphabi_plus.schema.yaml", RIME_USER_DIR / "aiphabi_plus.schema.yaml")
        if (DATA / "predict.db").exists():    # 智能聯想資料庫（官方 librime-predict）
            shutil.copy(DATA / "predict.db", RIME_USER_DIR / "predict.db")
        (RIME_USER_DIR / "lua").mkdir(exist_ok=True)
        for f in LUA.glob("*.lua"):           # 智慧候選：資料 + 三個邏輯檔
            shutil.copy(f, RIME_USER_DIR / "lua" / f.name)
        # rime.lua 放根目錄；若使用者已有，就把 require 併進去、不覆蓋
        user_rime_lua = RIME_USER_DIR / "rime.lua"
        def _mod(line):
            return line.split('require("')[1].split('"')[0] if 'require("' in line else None
        if not user_rime_lua.exists():
            shutil.copy(OUT / "rime.lua", user_rime_lua)
        else:
            existing = user_rime_lua.read_text("utf-8")
            have = {_mod(l) for l in existing.splitlines()}
            add = [l for l in (OUT / "rime.lua").read_text("utf-8").splitlines()
                   if _mod(l) and _mod(l) not in have]      # 只補缺的 require，不動使用者其他內容
            if add:
                user_rime_lua.write_text(existing.rstrip() + "\n" + "\n".join(add) + "\n", "utf-8")
                print("已把愛發筆缺的 require 併進 rime.lua：" + ", ".join(_mod(l) for l in add))
        # 這兩個是使用者層設定（schema_list、外觀）：沒有才裝，有就別蓋掉他的設定
        for name, what in (("default.custom.yaml", "schema_list（啟用愛發筆）"),
                           ("squirrel.custom.yaml", "外觀（橫排＋橙色高亮）")):
            dst = RIME_USER_DIR / name
            if dst.exists():
                print(f"已存在 {name} —— 保留你的設定，未覆蓋。要套用愛發筆的 {what} 請參考 rime/{name}")
            else:
                shutil.copy(OUT / name, dst)
        seed_default_options(RIME_USER_DIR / "user.yaml")
        print(f"\n已複製到 {RIME_USER_DIR}（碼表 + lua/ 智慧候選 + 啟用與外觀設定）")
        print("接著：鼠鬚管選單 →〈重新部署〉，直接就能用愛發筆（點選單列圖示可勾選各項功能；中英文切換用 Shift）。")


if __name__ == "__main__":
    main()
