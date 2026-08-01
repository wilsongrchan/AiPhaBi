# 愛發筆 · Rime 輸入法

由 `python3 build_rime.py` 產生。共 **3412 字**、**4341 條碼**
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

## 標點（正體全形）

字母鍵全都給字根用了，標點就落在原本的標點鍵上：

| 按鍵 | 出來 | 按鍵 | 出來 | 按鍵 | 出來 |
|---|---|---|---|---|---|
| `,` | ， | `.` | 。 | `?` | ？ |
| `!` | ！ | `;` | ； | `:` | ： |
| `\` `/` | 、 | `(` `)` | （） | `[` `]` | 「」 |
| `{` `}` | 『』 | `<` `>` | 《》 | `^` | …… |
| `_` | —— | `~` | ～ | `-` | － |

`"` 與 `'` 是成對的：連按會輪流出「」與『』的左右半邊。

## 目前的重碼（128 組）

裝之前先知道哪些字要多按一次選字鍵：

* `sj` → 引乃勿弔
* `cj` → 力刀尸
* `cl` → 已巳乜
* `hcc` → 批拒芘
* `hi` → 甘丑扛
* `ihi` → 西亞酉
* `is` → 方巧万
* `jtn` → 利禿秃
* `ot` → 田呆叶
* `tbt` → 桌卓棵
* `tf` → 卡杜杆
* `to` → 古束占
* `wt` → 汁采沫
* `aegym` → 餘飾
* `ao` → 合名
* `b` → 日曰
* `bf` → 里旱
* `bt` → 果早
* `bubt` → 暈暉
* `cc` → 比巨
* `df` → 肝肚
* `dj` → 用盯
* `dl` → 巴甩
* `ekz` → 退逮
* `eye` → 班珍

## 其他平台

同樣兩個檔案（`aiphabi.schema.yaml`、`aiphabi.dict.yaml`）丟進使用者目錄即可：

| 平台 | 目錄 |
|---|---|
| Windows（小狼毫 Weasel） | `%APPDATA%\Rime` |
| Linux（ibus/fcitx5-rime） | `~/.config/ibus/rime` 或 `~/.local/share/fcitx5/rime` |
| iOS（Hamster） | App 內匯入 |
