# 愛發筆 · Rime 輸入法

由 `python3 build_rime.py` 產生。共 **1001 字**、**1165 條碼**
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

* 一個字最多按 5 個鍵（超過上限的碼會縮短：前 4 碼 + 末 1 碼）。
* 也可以把整個字拆完、每一碼都打出來（完整碼），一樣打得出來。
* 重碼時用數字鍵或空白鍵選字；常用字排前面。

## 目前的重碼（24 組）

裝之前先知道哪些字要多按一次選字鍵：

* `uf` → 用再由甲
* `bt` → 果車早
* `ao` → 合名
* `bj` → 甲申
* `cj` → 力刀
* `cl` → 己已
* `di` → 目且
* `ffa` → 持封
* `fj` → 打牙
* `iioz` → 這記
* `iy` → 天夫
* `jh` → 片升
* `jl` → 入八
* `joh` → 面研
* `ooj` → 呵哥
* `ot` → 味田
* `ov` → 只豆
* `rcxq` → 成底
* `rto` → 店居
* `rx` → 反皮
* `tdi` → 相直
* `ti` → 士土
* `xo` → 各右
* `yyf` → 作坐

## 其他平台

同樣兩個檔案（`aiphabi.schema.yaml`、`aiphabi.dict.yaml`）丟進使用者目錄即可：

| 平台 | 目錄 |
|---|---|
| Windows（小狼毫 Weasel） | `%APPDATA%\Rime` |
| Linux（ibus/fcitx5-rime） | `~/.config/ibus/rime` 或 `~/.local/share/fcitx5/rime` |
| iOS（Hamster） | App 內匯入 |
