# 左簡碼沒吃到 alts（兼容碼）— 待 Side B 修

**回報者**：Side A（annotation session），2026-08-14
**檔案**：`build_rime.py`（Side B 擁有，Side A 不動手改，只回報）
**位置**：`build_rime.py:236-267`，關鍵在 `line 247`

## 問題

左簡碼（`left_short` 規則）產生候選碼時，只讀該字的主碼：

```python
full = (codes.get(ch) or {}).get("code")   # line 247 —— 只看主碼，沒看 alts
```

但同一份 `build_rime.py` 別的地方（`per_char` 那段，約 line 115-124）對每個字的
**每一條 `alts`** 都會生出自己的完整碼、自己的縮短碼（`shorten()`）、自己的 `[碼]`
提示——alts 在主碼表裡是「完整公民」。左簡碼這段沒有比照辦理，只認主碼，`alts`
完全被忽略。

## 影響範圍（已用現有 249 人工核可名單核對過）

- **沒有整字被漏收**：249 個成員裡，沒有人是「主碼對不上前綴、但 alts 對得上」而被
  `leftshort_skipped` 默默跳過的情況——這點是好消息，現有名單本身沒錯。
- **但有 9 個字的 alts 被閒置**：這 9 個字主碼本來就合資格、正常產生左簡碼，但它們
  同時還有一條「偏旁前綴也對得上」的 alts，這條 alts 卻始終沒有對應的左簡碼被生出來：

  | 偏旁 | 字 | 主碼（有左簡碼） | alts 碼（被忽略） |
  |---|---|---|---|
  | 金 | 銬 | YFVFJS | YFVTXS |
  | 金 | 鋪 | YFVDQ | YFVUHQ |
  | 金 | 鎮 | YFVCDLV | YFVTUEV |
  | 馬 | 駐 | SHMQE | SHMIF |
  | 馬 | 驛 | SHMMEVF | SHMMFVF |
  | 食 | 餵 | AEGOTK | AEGOTCK |
  | 車 | 輔 | IBTDQ | IBTUHQ |
  | 車 | 轄 | IBTQUEO | IBTQUFO |
  | 酉 | 酵 | IHIFJPI | IHITXPI |

即：打這 9 個字的「主碼」路徑會看到左簡碼提示，但打它們的「兼容碼（alts）」路徑
不會——不算錯誤，但跟 alts 在其他地方（主碼表、shorten、`[碼]` 提示）享有的待遇不一致。

## 建議修法（給 Side B 參考，不是 Side A 動手）

`line 247` 附近，把只看 `full` 改成同時掃 `full` 跟每條 `alts[i]["code"]`：

```python
candidates = [full] if full else []
candidates += [a.get("code") for a in rec.get("alts", []) if a.get("code")]
for full_c in candidates:
    if not full_c.startswith(ccode):
        continue
    rest = full_c[len(ccode):]
    ...  # 後面邏輯不變，一樣做 cap 三碼、去重、reverse-hint
```

`leftshort_rev` 那段的假設「一個字只會屬於一個偏旁家族」在加了 alts 之後可能要重新
確認——目前用 `setdefault` 先收先贏，理論上還是安全，但如果同一個字的主碼跟 alts
剛好對到*不同*偏旁家族（目前掃過的 249 個字沒有這種情況，但沒有結構性保證），要
想一下 reverse-hint 該指哪一條。

## 怎麼查出來的

`data/codes.json` 每個字的 `code` + `alts[*].code` 對 `rules.json` → `left_short` →
每個 entry 的 `code`（前綴）+ `members` 名單做交叉比對，篩出「主碼對不上前綴但 alts
對得上」跟「主碼合資格但 alts 也合資格」兩種情況。
