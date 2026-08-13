# PROJECT_NOTES · 愛發筆 AiPhaBi

Working reference for Claude sessions. The goal is to let any session get oriented fast and
to keep the project mentally split into its two halves so we can work on one without dragging
the other in.

> **The one-line thesis.** AiPhaBi is a form-code (形碼) Chinese IME where every 字根 (zigen)
> takes its shape from an English letter it resembles (B = 日, D = 月, so 明 = BD). Its design
> stance is *"be your friend"*: codes are **derivable**, never rote; when you type something
> imperfect the IME tries to figure out what you meant instead of going blank; every convenience
> (簡碼, 三簡碼, 詞組) is opt-in and dismissable, so it can never become a trap.

---

## The two sub-ecosystems

The repo is one codebase but splits cleanly into two problems that rarely touch each other.
When starting a task, figure out which side it's on first.

| | **A · Designer side** (字根/取碼) | **B · User side** (IME/候選) |
|---|---|---|
| **Question it answers** | "What code does this character get, and why?" | "When I type a code, what shows up and in what order?" |
| **Who it's for** | Wilson (the designer), building the code table | End users typing on Mac / iOS |
| **Source of truth** | `data/zigen.json`, `data/codes.json`, `data/rules.json` | `rime/` (schemas, dict, lua) |
| **Tools** | `annotate.html`, `rules.html`, `/` 字根表, `server.py` | Squirrel (macOS), Hamster (iOS) |
| **Build step** | edit in browser → writes back to `data/*.json` | `build_rime.py` → `rime/` → install |
| **The bridge** | `build_rime.py` reads A's JSON | and emits B's schema/dict/lua |

`build_rime.py` is the **only** seam between the two. Side A produces character→code decisions
as JSON; `build_rime.py` consumes that JSON and generates everything Side B needs. Changing how
codes are *decided* is a Side-A task; changing what the *candidate bar does* with those codes is
a Side-B task.

---

## A · Designer side — zigen & character coding

### What a zigen is
A zigen is **not** a Unicode character — it's *a set of strokes taken from some character*.
Many zigen (the bamboo-top-left of 笑, the first three strokes of 制) have no codepoint at all.
So a zigen is stored as a glyph reference plus stroke indices:

```json
{ "glyph": { "src": "笑", "strokes": [0,1,2] }, "count": 3, "seen": ["笑","第","筆"] }
```

Zigen are matched by **stroke midline**, not bitmap (a component gets squashed/stretched in
different characters; bitmap comparison can't tell same-zigen apart, midline can). Global merge
threshold `0.25`. See README "字根怎麼表示" for the two-radius subtlety (merge radius vs match
radius) — don't collapse the global threshold to make one pair distinct.

### `data/zigen.json` — the zigen table (the "learned" alphabet)
```
{ "meta": {...}, "letters": { "A": [...zigen...], "B": [...], ... } }
```
- `meta`: version, `max_code_length: 4` nominal (but see 碼長上限 rule → final can be 5),
  `wildcard_key: "Z"`, `merge_threshold`, tier names, and `distinct` = manually-asserted
  "these two zigen are NOT the same" pairs (e.g. 日 vs 曰, 卜 vs 上) that tighten only those pairs.
- Each letter holds zigen grouped by **取形意圖 (shape-intent group)** and **等級 (tier:
  優/次/三 = primary/secondary/tertiary)**. Tiers feed the 優次等 rule when predicting splits.

Zigen are **learned from per-character coding**, not hand-authored: annotate a character, and the
shapes you circle become zigen under their letters (same shape auto-merges + increments count).
Once enough zigen accumulate, the table runs **in reverse** to *predict* the breakdown of
characters you haven't coded yet.

### `data/codes.json` — the per-character breakdown & final code (5104 chars as of writing)
```json
"的": { "segments": [ {"strokes":[0],"letter":"J"}, {"strokes":[1,2,3,4],"letter":"B"},
                      {"strokes":[5,6,7],"letter":"A"} ], "code": "JBA", "final": "JBA" }
```
- `segments`: the actual stroke→letter decomposition.
- `code`: raw concatenation of segment letters.
- `final`: the **code the IME actually uses** after the 碼長上限 rule (≥5 letters → keep first 4
  + last 1). `code` may be longer; `final` is what ships. **Always read `final`.**

### `data/rules.json` — 取碼原則 (coding rules)
`rules[]`, each with `kind`:
- `kind: "enforced"` + `enabled: true` → the rule **actually runs** in the prediction engine.
  Key ones: `stroke_order`, `merge_over_split` (seg_penalty 0.05), `skip_isolated_hv` (lone
  橫→I / 豎→J only if first/last stroke), `max_code_length` (max 5, head 4, tail 1),
  `tier_priority` (次 +1 cost, 三 +2), `enclosure` (囗/匚 first, overrides stroke order).
- `kind: "manual"` → documentation only; not executed.
- **`short_code` rule lives here** — its `entries` list is the hand-picked 簡碼 table (see below).

### Designer-side tools
- **`server.py`** → `http://localhost:8777`, serves the HTML tools and read/writes `data/*.json`.
- **`/` 字根表** — the 26 letters and their zigen, drag to re-group / re-tier.
- **`annotate.html`** (`/annotate`) — click strokes → press a letter → forms a zigen; shows the
  predicted breakdown; shows official stroke order from 3 regions.
- **`rules.html`** (`/rules`) — the coding rules; enforced ones actually bite.
- **`progress.html`**, **`stats.html`**, **`variants.html`**, **`type.html`**, **`editor.html`** —
  progress tracking, stats, variant handling, a typing tester, and a breakdown editor.
- `data/backups/` — timestamped snapshots (auto).

---

## B · User side — IME, code table & candidate bar

### `build_rime.py` — the bridge (run via `./sync.sh`)
Reads `data/codes.json` + `data/rules.json` + `data/freq.json` + `data/phrases_*.txt`, emits:
- **`rime/aiphabi.dict.yaml`** — the dictionary: every char at its `final` code, plus 簡碼,
  三簡碼, and 詞組 (phrase) entries, each with a weight.
- **`rime/lua/aiphabi_data.lua`** — a big Lua table (`require("aiphabi_data")`) the filters read:
  `char2code`, `code2chars`, `shortcode` / `shortcode_rev`, `short3`, `si4` (四碼連打),
  `freq` (single-char), `wordfreq` (multi-char, essay-calibrated), etc.
- The two **schema files** (regenerated so switch lists / phrase toggle stay in sync).

`--install` also copies everything into `~/Library/Rime/`. `./sync.sh "<msg>"` =
`build_rime.py --install` → `Squirrel --reload` → git commit/push. **Deploy is `./sync.sh`,
never hand-edit files in `~/Library/Rime`.**

### Two schemas (macOS)
- **`aiphabi`** (schema_id `aiphabi`) — pure form-code. Translators: `table_translator` +
  wildcard. `enable_sentence: true`, `enable_completion: true`.
- **`aiphabi_plus`** (schema_id `aiphabi_plus`) — form-code **and** luna_pinyin smart pinyin in the
  *same* input field (`table_translator` + `script_translator@pinyin`). Toggle with **F4**.
- They are deliberately **separate schemas** (different schema_id), so a filter can detect which
  it's in via `env.engine.schema.schema_id`.

### iOS (Hamster)
Hamster runs the same `rime/` files. It supports librime-lua **only if** the `lua/` folder +
`rime.lua` are installed; the ordering filters then run. **Without lua it ranks purely by the
dict weight column** — which is why weight columns must be sane on their own (see the mobile
gotcha under Weights).

### Candidate-bar filters (the ordering brain) — `rime/lua/`
Filter chain order matters: `aiphabi_phrase` → `aiphabi_hint` → `aiphabi_fuzzy` →
`aiphabi_order[_plus]`.

- **`aiphabi_order.lua`** (pure) and **`aiphabi_order_plus.lua`** (plus) — the reorder filters.
  **They are two separate files with different structure and MUST be kept in sync** — any ordering
  fix has to be ported to both. Ranking tiers, high → low:
  1. **簡碼** (`ap_short`) — always first (S_FLOOR 9 in plus).
  2. **exact / 四碼連打** (`exactSet` hit, or `ap_si4`) — your code exactly matches a char's full
     code, or a fully-typed 4-code phrase (E_FLOOR 6).
  3. **pool** — completions, 偏旁碼, 同類, 三簡, 容錯 (`ap_pool`), ranked by
     userfreq (session pick count, decaying in plus) then `cf` (word/char frequency).
     Completions ×0.7; cold-reading obscure single-char pinyin ×0.10 (plus only).
  4. **part** — coverage-demoted fragments (a candidate that doesn't span the whole segment,
     e.g. 民 covering only the tail of YCLX) sinks to the bottom. **Coverage is span-based**
     (`[min start, max _end]` over candidates); needed because `enable_sentence` spits out
     prefix/suffix fragments. `segStart = min(c.start)`, code extracted from that segment (not
     the whole `context.input`, which with sentence mode is the full composition).
- **`aiphabi_hint.lua`** — attaches hints to candidates: 同類字, 偏旁碼, 打繁出簡/打簡出繁, and the
  **簡碼 hint** (type a char's full code, see "簡碼 XX" reminder). Also **generates the 四碼連打
  candidates** from `data.si4` (not in the dict): `#code==4` exact → `ap_si4` (exact tier),
  3-prefix → `ap_pool` (完成/墊底). Gated on phrase being on.
- **`aiphabi_phrase.lua`** — the phrase on/off gate (pure only): when `aiphabi_phrase` option is
  off, hides multi-char candidates.
- **`aiphabi_fuzzy.lua`** — input tolerance (missing/extra/adjacent-key/swapped codes).
- **`aiphabi_wildcard.lua`** — the `` ` `` wildcard key (forgot a code or two → press `` ` ``).

---

## Quickcode conventions (the JKXQ example)

Every character has a derivable **主碼 (main code)** = its zigen letters in stroke order,
capped at 5 (first 4 + last). On top of that are three *optional, opt-in* conveniences:

| Layer | What it is | How derived | Toggle | Example (我) |
|---|---|---|---|---|
| **主碼** | full derivable code | zigen in stroke order, cap 5 | always on | **JKXQ** |
| **簡碼** | hand-picked shortcut for ~60 common chars | 首+末 (occasionally 首2+末), by designer discretion | `aiphabi_short100` | **JKQ** |
| **三簡碼** | auto shortcut for every ≥4-code char | 頭2 + 末1, queried as `AB` + `` ` `` + `C` | `aiphabi_short3` | (n/a, 我 is short) |
| **詞組連打** | phrases = each char's 簡碼(or主碼) concatenated | see phrase rules below | `aiphabi_phrase` | 我的 = JKQJA |

**The JKXQ / JKQ story — the core design principle in one example:**
- 我 main code = **JKXQ** (fully derivable from its zigen).
- 我 also has a hand-picked 簡碼 = **JKQ** (in `rules.json` `short_code.entries`).
- **JKXQ stays permanently reserved for 我** — the 簡碼 never steals the main code's slot. So a
  user who never learns the shortcut is never punished: type JKXQ, still get 我 at position 1.
- Type JKXQ and the bar **whispers "簡碼 JKQ"** — teaching the shortcut *through use*, not a
  memorize-up-front table. Muscle memory forms on its own.
- Hate the whole idea? One settings toggle turns 簡碼 off entirely.

Why 我 = JKQ and not JQ? Because **JQ is already 不** (不's main code, verified), and 不 isn't
rare enough to displace. **This is the key architectural stance:** the arbitrariness in the
quickcode system lives in the *designer's curation* (which ~60 chars get a shortcut, why JKQ not
JQ) — **never in the user's memory**. Users only ever meet derivable codes plus optional,
dismissable, self-teaching nudges. (Contrast: Boshiamy's 600+ rote 兩碼字 put that arbitrariness
on the user with no derivation and no hint.)

### 簡碼 source & collision rule
`data/rules.json` → `short_code` rule → `entries: [{c, short}, ...]` (60 entries: 的=JA, 我=JKQ,
是=BY, 這=IZ, 就=IQ, …). Tried auto-picking the top-100 by frequency — too many collisions — so
it's a hand-curated 60. On a 簡碼 collision, **first in the list wins** (matches the rules-page
preview). `build_rime.py` builds `shortcode` (code→char) and `shortcode_rev` (char→its 簡碼,
drives the hint).

---

## Phrase input (詞組連打) & 四碼連打

- **Encoding rule:** a phrase's code = each character's 簡碼 (or 主碼 if no 簡碼) concatenated.
  Verified: 我的 = JKQJA, 你好 = YMLI, 中國人 = QOQY, 香港 = JTBWHZ.
- **2-char phrases** get the cartesian of {short, main} × {short, main} for the two chars
  (short/short, short/main, main/short, main/main) so you don't have to remember which mode.
- **3+ char phrases** use three uniform modes (main / 簡碼-preferred / 三簡碼-preferred) to avoid
  combinatorial explosion.
- **四碼連打 (`data.si4`, generated in `aiphabi_hint.lua`, not in dict):** a 4-key shortcut for
  longer phrases. 3-char → 首首首末; 4-char → 4×首碼; **5+ char → both first-4 AND first-3+last**
  registered (first-4 = partial-recall friendly; first-3+last = better disambiguation on shared
  prefixes like 中國人民X). Exact 4-code → `ap_si4` (ranks as exact); 3-prefix → `ap_pool` (墊底).
- Phrase source files: **`data/phrases_*.txt`** (`build_rime.py` globs `phrases_*.txt`), space-
  separated, `#` comments, Traditional. Current set: `places`, `people`, `history`, `politicians`,
  `english_names`, `common`, `idioms`, `food`, `brands`, `orgs`. `phrases_preview.tsv` is a
  **human-readable reference only — NOT consumed by the IME** (the IME needs `aiphabi.dict.yaml`
  + `aiphabi_data.lua`).

---

## Weights & frequency data (the mobile gotcha)

Two **different scales**, do not mix:
- **Dict weight column** (`aiphabi.dict.yaml`) — raw essay counts, or `PLACE_DICT_FLOOR = 12000`
  for curated phrases. **This is what Hamster ranks by when it has no lua.**
- **`wordfreq` table** (`aiphabi_data.lua`, for the lua filters) — essay-calibrated to char-freq
  scale, or `PLACE_FLOOR = 100000` for curated phrases.

These floors were **deliberately separated**: an earlier bug used the calibrated 100000 on the raw
dict scale, so on mobile a curated 屬鼠 outranked common 屬於 (67100 raw). Keep them separate.

- **`data/freq.json`** — single-char frequency. **gitignored (third-party derived), regenerated by
  `fetch_data.py`.** Blended ordering = `0.55 × word-appearance-percentile + 0.45 ×
  single-char-percentile`. The blend logic lives *inside* `fetch_data.py` so it's reproducible.
- `fetch_data.py` downloads the ~30 MB glyph/frequency source data (licensed separately, not in
  git). Run once before `server.py`.

---

## Current state — built vs in progress

### A · Designer side
- ✅ Zigen learning + reverse prediction pipeline (`zigen.json` ↔ `codes.json`, midline matching).
- ✅ ~5100 characters coded (`codes.json`), ~99.9% char coverage of common text.
- ✅ Enforced rules engine (stroke order, merge-over-split, isolated-stroke skip, cap-5, tiers,
  enclosure).
- ✅ Annotation / rules / 字根表 / progress / stats / variants tools.
- 🔄 Ongoing: keep coding the long tail of characters (`data/todo_chars.txt`); refine tiers/groups;
  `kind:"manual"` rules not yet enforced.

### B · User side
- ✅ Two macOS schemas (pure `aiphabi` + `aiphabi_plus` with F4 pinyin toggle), installed via
  `./sync.sh`.
- ✅ Quickcode stack: 60 hand-picked 簡碼, auto 三簡碼, both with toggles + reserved main codes +
  簡碼 hint.
- ✅ Candidate reorder filters (pure + plus, kept in sync): 簡碼 > exact/四碼 > pool > coverage-
  demoted part; userfreq boosting; completion & cold-reading penalties; span-based coverage gating.
- ✅ 詞組連打: ~40k+ curated phrases across 10 themed files; 2-char cartesian; 3+ uniform modes;
  四碼連打 (first-4 + first-3+last for 5+); `enable_sentence` segmentation.
- ✅ 容錯 (fuzzy), 萬用鍵 `` ` ``, 打繁出簡/打簡出繁, 偏旁碼/同類字 hints.
- ✅ iOS (Hamster) working; dict weights sane for the no-lua path; mobile pulls phrase data + 4-code
  logic from repo.
- 🔄 Ongoing: expand phrase库; ordering edge-cases as they surface (each fix must land in BOTH
  order filters); the last known ordering work shipped at commit `9ffed24`.

### Not started / open
- No formal test harness for candidate ordering (regressions found by manual typing).
- Wubi/Boshiamy重碼率 numbers for the comparison tool are unmeasured (proprietary/methodology).
- Design-philosophy blurb exists as prose (not shipped as a page); decided *not* to name competitors
  for the 無理碼 point ("don't want to pick fights").

---

## Key naming / decisions cheat-sheet
- **Candidate types** (librime-lua `.type`): `ap_short` (簡碼), `ap_si4` (exact 4-code phrase),
  `ap_pool` (everything demotable: completion/偏旁/同類/三簡/容錯/3-prefix). `completion` is
  librime's own type.
- **Candidate span fields:** `.start`, `._end` (Lua keyword `end` → `_end`), `.preedit` (form =
  UPPERCASE, pinyin = lowercase — used to tell form vs pinyin candidates apart).
- **`final` not `code`** is the shipping code in `codes.json`.
- **`shortcode_rev`** drives the 簡碼 hint; **`shortcode`** drives 簡碼 lookup.
- Two order filters (`aiphabi_order.lua` + `aiphabi_order_plus.lua`) — **sync every fix**.
- Deploy = **`./sync.sh "<msg>"`** only. `fetch_data.py` for third-party data (gitignored outputs).
- `Z` = wildcard letter in the alphabet; `` ` `` = wildcard *key* while typing.
