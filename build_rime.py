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

    max_rule = next((r for r in rules["rules"]
                     if r["id"] == "max_code_length" and r.get("enabled")), None)

    # 字 → 它所有打得出來的碼（去重、保持順序）
    entries = []            # (碼, 字, 權重)
    per_char = {}
    for ch, rec in codes.items():
        if not rec.get("code"):
            continue
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
        # 常用字權重大 —— 重碼時排前面，少按一次選字鍵
        w = max(1, 100000 - rank.get(ch, 99999))
        for c in seen:
            entries.append((c.lower(), ch, w))

    entries.sort(key=lambda e: (e[0], -e[2]))

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
  - name: ascii_mode
    reset: 0
    states: [ 中文, 西文 ]
  - name: full_shape
    states: [ 半形, 全形 ]
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
  filters:
    - uniquifier

speller:
  alphabet: zyxwvutsrqponmlkjihgfedcba
  delimiter: " '"

translator:
  dictionary: aiphabi
  enable_charset_filter: false
  enable_sentence: false
  enable_encoder: false
  enable_completion: true      # 碼還沒打完就先給候選
  strict_spelling: false

punctuator:
  import_preset: default

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

由 `python3 build_rime.py` 產生。共 **{len(per_char)} 字**、**{len(entries)} 條碼**
（主碼 + 完整碼 + 手動收的兼容碼）。

## macOS（Squirrel 鼠鬚管）

```sh
brew install --cask squirrel        # 還沒裝的話
python3 build_rime.py --install     # 把 schema 與碼表複製到 ~/Library/Rime
```

然後：

1. 開「鼠鬚管」選單 →〈重新部署〉（或 `~/Library/Rime` 裡跑一次部署）
2. 系統設定 → 鍵盤 → 輸入法 → 加入「鼠鬚管」
3. 鼠鬚管選單 →〈輸入法設定…〉，把 `aiphabi` 加進去；或直接編輯
   `~/Library/Rime/default.custom.yaml`：

```yaml
patch:
  schema_list:
    - schema: aiphabi
```

4. 再〈重新部署〉一次。切到鼠鬚管，用 `F4`（或 `` ` ``）選「愛發筆」。

## 怎麼打

* 一個字最多按 {mx} 個鍵（超過上限的碼會縮短：前 {p.get('head', 4)} 碼 + 末 {p.get('tail', 1)} 碼）。
* 也可以把整個字拆完、每一碼都打出來（完整碼），一樣打得出來。
* 重碼時用數字鍵或空白鍵選字；常用字排前面。

## 目前的重碼（{len(dups)} 組）

裝之前先知道哪些字要多按一次選字鍵：

{chr(10).join(f'* `{c}` → {"".join(chs)}' for c, chs in sorted(dups.items(), key=lambda kv: -len(kv[1]))[:25])}

## 其他平台

同樣兩個檔案（`aiphabi.schema.yaml`、`aiphabi.dict.yaml`）丟進使用者目錄即可：

| 平台 | 目錄 |
|---|---|
| Windows（小狼毫 Weasel） | `%APPDATA%\\Rime` |
| Linux（ibus/fcitx5-rime） | `~/.config/ibus/rime` 或 `~/.local/share/fcitx5/rime` |
| iOS（Hamster） | App 內匯入 |
"""
    (OUT / "README.md").write_text(readme, encoding="utf-8")

    print(f"字 {len(per_char)}　碼 {len(entries)}　重碼組 {len(dups)}")
    print(f"寫出：{OUT}/aiphabi.schema.yaml、aiphabi.dict.yaml、README.md")

    if "--install" in sys.argv:
        if not RIME_USER_DIR.exists():
            print(f"\n找不到 {RIME_USER_DIR} —— 先裝 Squirrel："
                  "\n    brew install --cask squirrel")
            return
        for f in ("aiphabi.schema.yaml", "aiphabi.dict.yaml"):
            shutil.copy(OUT / f, RIME_USER_DIR / f)
        print(f"\n已複製到 {RIME_USER_DIR}")
        print("接著：鼠鬚管選單 →〈重新部署〉，再把 aiphabi 加進 schema_list。")


if __name__ == "__main__":
    main()
