# 偏旁縮碼 investigation — working notes

Investigating whether characters using certain 偏旁 (component) as a **left or top** part should get
a shortened *alternate* code (via `codes.json`'s existing `alts` field), on top of their normal main
code. Main code (`final`) never changes — this is purely an additional, opt-in code, same mechanism
already used by 247 characters today (`codes.json` → `alts: [{code, segments}]` → `build_rime.py`
turns each into a real dict entry at native weight + a `[code]` hint via `aiphabi_hint.lua`'s
`altcode` table). No Side-B/lua changes needed — implementation is pure Side-A data entry.

There's also a narrower, already-partially-wired mechanism worth knowing about:
`rules.json` → `convention` rule → `偏旁另有取法` group → per-character `compCode` field. That only
attaches a **pool-tier hint** ("偏旁碼 XX → 某字") pointing back at the bare radical itself — it does
not create a new typeable code for every compound. 金 already has a placeholder entry there
(`compCode: "YFV"`, currently a no-op because it equals 金's own main code). Complementary to, not a
replacement for, the `alts`-based approach below.

## Why the budget squeeze happens

`max_code_length` rule: raw code ≥ 5 letters → keep first 4 + last 1, drop the middle. A left/top
component's own code eats the front of that window. A 4-letter component (魚 = SOTM) consumes the
*entire* first-4 window, leaving exactly one surviving letter (the tail) to disambiguate every
compound that uses it. A 3-letter component (金/馬/車/酉 etc.) leaves two.

## Methodology & pitfalls (read before trusting a family list)

Found by scanning `codes.json` for `final` strings starting with a candidate component's own code —
**this is a prefix match, not a semantic one**, and produces false positives:
- **倖** (亻+幸) coincidentally starts `YFV`, same as 金 — not actually 金-radical.
- **裹** (亠+果+衣) coincidentally starts `IBT`, same as 車 — not actually 車-radical.
- **魯** excluded on the assumption 魚 sits at the bottom of it, not left/top — **unverified,
  worth Wilson double-checking**; if 魚 is actually top-positioned in 魯 it belongs back in the family.
- `notComponent: true` (existing field in `codes.json`) correctly flags some of these automatically
  — e.g. 西/亞 both coincidentally code to `IHI` (same as 酉) and are already flagged — but it does
  **not** catch coincidences like 倖/裹 that aren't otherwise-atypical characters.
- **Nested cases**: 暫 = 斬(top) + 日(bottom), and 斬 itself = 車+斤. 車 is still visually "drawn
  first" so it still gets the compressed code, but it's not a flat "車 + X" compound — same story for
  磐 (舟 family, via 般=舟+殳).
- **Nearby-but-different component**: 遷's upper part is really 覀 (西) not 酉 the wine-jar radical —
  same code (`IHI`), different real identity. Cosmetically included, semantically iffy.

**Rule of thumb: always hand-verify the member list before committing data entry.** Prefix match is
a good first pass, not a final list.

## The five originally-proposed radicals — final numbers

Standalone character's own code is unaffected either way (魚 alone is always `SOTM`, never `SM`,
etc.) — the short code only applies to compounds using it as a left/top component. This matters: an
earlier pass of this investigation wrongly checked the bare radical's own code against the global
table (e.g. "does 魚→SM collide with 尔?") — that's not applicable since 魚 itself never takes the
short code. Corrected numbers below reflect compounds only.

| Radical | Prefix→short | Genuine family | Existing collisions | Resolved by shortening | New collisions created |
|---|---|---|---|---|---|
| 魚 | SOTM→SM | 14 | 2 groups: 鮮/鯉/鮭 (`SOTMF`), 鰂/魝 (`SOTMN`) | **all** | none |
| 馬 | SHM→SM | 24 | 0 | — | none |
| 金 | YFV→YV | 81 | 7 groups, 15 chars | 5 groups / 10 chars (鐘/鋅, 鈕/鉗 remain stuck) | 針's alt `YVT` ties with existing 伞 (rank 7454 — negligible, 針 rank 897 wins) |
| 車 | IBT→IT | 29 | 1 group: 較/轍 | all | none |
| 酉 | IHI→II | 26 | 1 group: 醇/醯 | all | none |

Cross-check: 魚's and 馬's *compound* families never land on the same new code as each other (only
the bare radicals themselves would, and bare radicals don't take the short code — so this isn't
actually a live collision under the corrected scope).

**Verdict so far:** 金 is the only one with collision counts (7 groups) that clearly justify the
curation cost of a whole-family rule. 魚/車/酉 are clean (zero new cost) but small (1-2 groups each).
馬 has zero benefit — not worth curating regardless of cost. Wilson's read: even the strongest
single-digit-collision cases may not be worth a dedicated family-wide rule; **still undecided**.

## Broader scan — other candidate components

Same method (own code 3-4 letters, family ≥ ~12), looking for anything with a better collision count
than the five above:

| Component | Code | Family | Existing collisions | Notes |
|---|---|---|---|---|
| 飠 (食) | AEG | 24 | 1: 飾/餘 | food radical, very common |
| 穴 | QUV | 25 | 1: 窗/竅 | top-position, biggest family found |
| 舟 | JUI | 16 | 1: 磐/船 | 磐's link is nested (磐=般+石, 般=舟+殳) |
| 言→訁 | own code `IO`, compound form `IOJ` | 13 | 1: 託/許 | notable: compound form (訁) is *longer* than the standalone char's own code — shortening `IOJ`→`IO` would just align it back to 言's own code |
| 尚 (in 堂常掌黨賞) | WUO | 13 | 0 | |
| 雨 | MII | 24 | 0 | big family, zero pain |
| 走 | FTY | 14 | 0 | 轮 in the member list looks like a coincidental match (simplified 輪, 車-radical) — false positive |
| 革 | HOT | 13 | 0 | 薑 looks like a coincidental match — false positive |

None of these beat 金's 7-group count; all sit at 0-1 groups against a 13-25-member family, i.e. the
same thin ratio Wilson already pushed back on for 飠. **Conclusion of this pass: only 金 stands out
on pure "how much pain does this solve" grounds — everything else here (including the original
魚/車/酉) is arguably typing-speed convenience more than a real disambiguation fix.**

## Open questions / where to pick this up

1. Verify 魯's actual structure (魚 top or bottom?) — changes whether it re-enters the 魚 family.
2. Decide whether "solves ≥ N collision groups" is the right bar at all, or whether typing-speed
   alone justifies some of these regardless of collision count.
3. If proceeding with any radical: hand-curate the member list (drop false positives per the
   Methodology section above) before writing `alts` entries — don't trust the raw prefix match.
4. If 金 is the only one worth doing, decide whether a single-radical `alts` rollout still "feels
   like a rule" on its own, or whether that concern only applies when the payoff is marginal.
