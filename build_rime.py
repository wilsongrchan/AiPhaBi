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
    # 不打簡體：只濾掉「一對一純簡化字」（馬→马、魚→鱼），
    # 不動「歸併字」——這些字本身就是獨立傳承字，只是剛好也被拿來簡化別的字
    # （后＝王后／後的簡化，干＝天干／幹乾榦的簡化，咸＝老少咸宜／鹹的簡化…）。
    # s2t_map 光看資料分不出這兩種，只能手動列出已知的歸併字白名單。
    DUAL_USE_MERGED = {
        "后", "干", "里", "谷", "面", "只", "系", "几", "台", "岳", "卜", "出",
        "表", "帘", "郁", "佣", "咸", "折", "云", "余", "松", "家", "术", "苹",
    }
    simp_only = sorted(c for c in s2t_map if c not in DUAL_USE_MERGED)
    by_len = defaultdict(list)
    for code in code2chars:
        by_len[len(code)].append(code)
    # 同類字／簡繁提示要順便顯示該字的正碼：字 → 縮短後的主碼
    char2code = {}
    need = set()
    for sibs in family.values():
        need.update(sibs)
    for chs in comp.values():        # 偏旁碼候選也要顯示正碼
        need.update(chs)
    for vs in t2s_map.values():
        need.update(vs)
    for vs in s2t_map.values():
        need.update(vs)
    for c in sorted(need):
        code = codes.get(c, {}).get("code")
        if code:
            char2code[c] = shorten(code, max_rule).lower()

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
    reset: 0
    states: [ 打繁出簡關, 打繁出簡開 ]
  - name: aiphabi_s2t              # 打簡出繁：候選字順便帶出繁體版
    reset: 0
    states: [ 打簡出繁關, 打簡出繁開 ]
  - name: aiphabi_family          # 同類字提示（形近字家族）
    reset: 1
    states: [ 同類字關, 同類字開 ]
  - name: aiphabi_comp            # 偏旁碼提示
    reset: 1
    states: [ 偏旁關, 偏旁開 ]
  - name: aiphabi_fuzzy           # 輸入容錯
    reset: 1
    states: [ 容錯關, 容錯開 ]
  - name: aiphabi_no_simp          # 不打簡體：候選只留繁體字／傳承字，濾掉簡體專屬字
    reset: 0
    states: [ 不打簡體關, 不打簡體開 ]
  - name: ascii_punct
    states: [ 。，, ．， ]

engine:
  processors:
    - ascii_composer
    - recognizer
    - key_binder
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
    - punct_translator
    - table_translator
    - lua_translator@aiphabi_wildcard   # 萬用鍵 `：某幾碼想不起來就按 `
  filters:
    - lua_filter@aiphabi_hint           # 同類字 + 偏旁碼 + 打繁出簡 + 打簡出繁 提示
    - lua_filter@aiphabi_fuzzy          # 輸入容錯（漏碼/多碼/隔壁鍵/打反）
    - uniquifier

speller:
  alphabet: 'zyxwvutsrqponmlkjihgfedcba`'   # 收 ` 進字母表：萬用鍵才輸入得進來
  delimiter: " '"

translator:
  dictionary: aiphabi
  enable_charset_filter: false
  enable_sentence: false
  enable_encoder: false
  enable_completion: true      # 碼還沒打完就先給候選
  strict_spelling: false
  preedit_format:              # 螢幕上顯示大寫（實際查碼仍用小寫；` 不動）
    - "xlit|abcdefghijklmnopqrstuvwxyz|ABCDEFGHIJKLMNOPQRSTUVWXYZ|"
  comment_format:              # 候選旁邊的碼提示也顯示大寫
    - "xlit|abcdefghijklmnopqrstuvwxyz|ABCDEFGHIJKLMNOPQRSTUVWXYZ|"
    - "xform/~/- /"            # 補碼提示的 ~ 改成「- 」（例 ~K → - K）

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

## 其他平台

把 `aiphabi.schema.yaml`、`aiphabi.dict.yaml`、`rime.lua`、以及整個 `lua/` 目錄
丟進對應的使用者目錄，再〈重新部署〉即可（智慧候選需要該平台的 librime-lua；
Weasel／fcitx5-rime 多半內建，Hamster 亦支援）：

| 平台 | 目錄 |
|---|---|
| Windows（小狼毫 Weasel） | `%APPDATA%\\Rime` |
| Linux（ibus/fcitx5-rime） | `~/.config/ibus/rime` 或 `~/.local/share/fcitx5/rime` |
| iOS（Hamster） | App 內匯入 |

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
        (RIME_USER_DIR / "lua").mkdir(exist_ok=True)
        for f in LUA.glob("*.lua"):           # 智慧候選：資料 + 三個邏輯檔
            shutil.copy(f, RIME_USER_DIR / "lua" / f.name)
        # rime.lua 放根目錄；若使用者已有，就把 require 併進去、不覆蓋
        user_rime_lua = RIME_USER_DIR / "rime.lua"
        block = (OUT / "rime.lua").read_text("utf-8")
        if user_rime_lua.exists():
            existing = user_rime_lua.read_text("utf-8")
            if "require(\"aiphabi_hint\")" not in existing:
                user_rime_lua.write_text(existing.rstrip() + "\n\n" + block, "utf-8")
                print("已把愛發筆的 require 併進你原本的 rime.lua")
        else:
            shutil.copy(OUT / "rime.lua", user_rime_lua)
        # 這兩個是使用者層設定（schema_list、外觀）：沒有才裝，有就別蓋掉他的設定
        for name, what in (("default.custom.yaml", "schema_list（啟用愛發筆）"),
                           ("squirrel.custom.yaml", "外觀（橫排＋橙色高亮）")):
            dst = RIME_USER_DIR / name
            if dst.exists():
                print(f"已存在 {name} —— 保留你的設定，未覆蓋。要套用愛發筆的 {what} 請參考 rime/{name}")
            else:
                shutil.copy(OUT / name, dst)
        print(f"\n已複製到 {RIME_USER_DIR}（碼表 + lua/ 智慧候選 + 啟用與外觀設定）")
        print("接著：鼠鬚管選單 →〈重新部署〉，直接就能用愛發筆（點選單列圖示可勾選各項功能；中英文切換用 Shift）。")


if __name__ == "__main__":
    main()
