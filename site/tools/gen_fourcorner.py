#!/usr/bin/env python3
"""重建 site/tools/fourcorner.json —— 〈常用字表 PDF〉第六節「其他常用字」裡
非部件字那批，用四角號碼排序時要查的表。

資料來源：Unicode 的 Unihan 資料庫 kFourCornerCode 欄位。手動跑：

    curl -sSLO https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
    python3 site/tools/gen_fourcorner.py Unihan.zip

只收「其他」節目前實際會用到的字（build_charlist_pdf.py 算出來的 rest 差集）。
名單變了、build_charlist_pdf.py 印出「四角號碼查無」的警告時，就重跑這支。
Unihan 查不到的少數字，手動查好填進下面的 MANUAL（Wilson 給的）；MANUAL
優先於 Unihan。兩邊都查無的（部件字那種、或還沒手動補的冷僻異體），排序時
擺到該區塊最後。
"""
import io
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "tools" / "fourcorner.json"

# Unihan 查無、Wilson 手動查好的（2026-09-10）：格式跟 Unihan 一樣，前 4 碼＋
# 「.」＋第五碼。
MANUAL = {
    "掕": "5404.7",
    "攋": "5708.6",
    "繮": "2191.6",
    "釺": "8214.0",
    "鰂": "2230.0",
}


def _rest_chars():
    """跟 build_charlist_pdf.py 同一套算法求「其他」節的字集。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "_bc", ROOT / "site" / "tools" / "build_charlist_pdf.py")
    bc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bc)
    common = set(json.loads(bc.CHARSET.read_text("utf-8"))["common"])
    inc = lambda s: [c for c in bc._dedup_keep_order(s) if c in common]
    jiabiao = inc(bc._file_chars("tw_common_4808.txt"))
    gb1 = inc(bc._file_chars("gb2312.txt")[:3755])
    canton = [c for g in bc.CANTON_GROUPS for c in inc(g)]
    baijia = inc(bc._file_chars("baijiaxing.txt"))
    names = inc(bc._name_chars("NAME_MALE") + bc._name_chars("NAME_FEMALE"))
    baijia_all = set(baijia) | {c for u in bc.BAIJIA_COMPOUND for c in u if c in common}
    covered = set(jiabiao) | set(gb1) | set(canton) | baijia_all | set(names)
    return sorted(common - covered - bc.DROP_CHARS)


def main(zip_path):
    raw = zipfile.ZipFile(zip_path).read("Unihan_DictionaryLikeData.txt").decode("utf-8")
    fc = {}
    for ln in raw.splitlines():
        if "\tkFourCornerCode\t" not in ln:
            continue
        cp, _, val = ln.split("\t")
        fc[chr(int(cp[2:], 16))] = val.split()[0]   # 第一個碼，保留 .x 第五碼
    fc.update(MANUAL)
    rest = _rest_chars()
    sub = {c: fc[c] for c in rest if c in fc}
    miss = [c for c in rest if c not in fc]
    OUT.write_text(json.dumps(sub, ensure_ascii=False, indent=0, sort_keys=True), "utf-8")
    print(f"寫出 {OUT.relative_to(ROOT)}：{len(sub)} 字（{OUT.stat().st_size} bytes）")
    if miss:
        print(f"  Unihan 查無四角碼、排序時擺最後：{''.join(miss)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("用法：python3 site/tools/gen_fourcorner.py <Unihan.zip 路徑>")
    main(sys.argv[1])
