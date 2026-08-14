# PROJECT_NOTES · 愛發筆 AiPhaBi

Working reference for Claude sessions. The goal is to let any session get oriented fast and
to keep the project mentally split into its two halves so we can work on one without dragging
the other in.

> ### ⚠️ Read before your first edit
> 1. `git fetch origin && git status -sb` — **every session, before touching anything.**
> 2. Work out whether you are **Side A** (字根/取碼) or **Side B** (IME/候選) — see the table below.
> 3. Read [**Hard rules — no exceptions**](#hard-rules--no-exceptions). Side A never writes
>    `rime/**` or runs `build_rime.py`/`sync.sh`; Side B never writes `codes.json` / `zigen.json` /
>    `rules.json`. No exemptions, including "it was obviously correct".
>
> A short version of this lives in `CLAUDE.md`, which loads automatically — but **this file is the
> authority**; `CLAUDE.md` is only the pointer. If the two ever disagree, this file wins and
> `CLAUDE.md` should be corrected to match.

---

## Starting a new session (or a new machine)

Do these **in order**, before saying anything substantive to the session.

**On Wilson's Mac both folders already exist** — open `AiPhaBi-A` for Side A or `AiPhaBi-B` for
Side B (see *The two-folder layout* below) and skip to step 10.

Steps 1–9 build that layout from scratch on a new machine. **They produce both sides in one pass —
run them to the end.** Stopping after the clone leaves a single-folder checkout that can only ever
declare one side, which is the exact arrangement the hard rules exist to prevent.

| # | Step | |
|---|---|---|
| 1 | `git clone https://github.com/wilsongrchan/AiPhaBi.git AiPhaBi-A && cd AiPhaBi-A` — the Side A folder, on `main` | new machine |
| 2 | `git worktree add -b side-b ../AiPhaBi-B origin/main` — the Side B folder. One `.git`, two working trees | new machine |
| 3 | `git config push.default upstream` — shared config; both branches track `origin/main`, so a bare `git push` from either folder still lands on `main`. This is what lets `sync.sh` work unmodified (see *Why Side B is on `side-b`* below) | new machine |
| 4 | `echo A > .aiphabi-side && echo B > ../AiPhaBi-B/.aiphabi-side` — **one permanent marker per folder, never flipped** | new machine |
| 5 | `python3 fetch_data.py` — fetches the ~30 MB of third-party glyph/frequency data into `data/`. Everything it writes is **gitignored, so a fresh clone does not have it**: without this, `/annotate` has no strokes and the build has no `freq.json`. Takes a few minutes; files already present are skipped | new machine |
| 6 | `cp data/freq.json data/opencc.json ../AiPhaBi-B/data/` — Side B's build inputs. Worktrees do **not** share untracked files, so B's build fails until these are copied (or `fetch_data.py` is re-run inside B). The bulky annotation-side data (`graphics.txt`, `tw_strokes.json`, `hk_cache.json`) is Side A only — no need to copy it | new machine |
| 7 | Open **each folder in its own VS Code window**, and **trust the directory** when prompted | per folder |
| 8 | **Approve the project hooks** when prompted — Claude Code will not silently run hooks shipped in a cloned repo | per folder |
| 9 | Run `/hooks` and confirm a `PreToolUse` entry pointing at `.claude/hooks/side-guard.py` | per folder |
| 10 | Tell the session which side it is, and to read `PROJECT_NOTES.md` | every session |
| 11 | `git fetch origin && git status -sb` | every session |

Steps 7–9 are **per folder, not per machine**: each folder is its own Claude Code project, so each
one prompts for trust and for hook approval separately. Skipping them in the second window leaves
that side's guard unapproved.

Opening a folder in VS Code gives that window its own Claude Code session, so **one VS Code window
per side** — `File > Open Folder…` on `AiPhaBi-A` or `AiPhaBi-B`, or from a terminal:

```bash
code ~/"Desktop/Wilson Personal/Coding/AiPhaBi-A"    # Side A
code ~/"Desktop/Wilson Personal/Coding/AiPhaBi-B"    # Side B
```

The window's folder decides which marker the guard reads, so the two sessions can run side by side
without ever touching each other's marker.

**Step 4 is the one that is easy to forget** — and the guard **fails closed**, so forgetting it is
loud rather than silent: until the marker says `A`, the three protected files are locked and any
write to them returns instructions for declaring the side. Only an explicit `A` unlocks them; `B`,
a missing marker, and an unrecognised marker all block.

The side comes from `.aiphabi-side` (or `$AIPHABI_SIDE`) — *never* from the conversation, because
the hook is a separate process that cannot see what you tell the session. Saying "you're Side B" in
chat protects nothing on its own. `.aiphabi-side` is **gitignored on purpose**: it describes this
checkout, not the project, so it can never travel with a clone. The marker is re-read on every tool
call, so `echo A > .aiphabi-side` takes effect immediately — **no session restart needed.**

> **One checkout can only declare one side.** Two sessions in one directory share a marker and a
> working tree — precisely what the hard rules exist to prevent. On Wilson's Mac this is already
> solved with two worktrees; see below.

### The two-folder layout (Wilson's Mac)

Both sides run **simultaneously**, each in its own folder, each with a permanent marker. Neither
marker is ever flipped.

| | Side A · 字根/取碼 | Side B · IME/候選 |
|---|---|---|
| Folder | `~/Desktop/Wilson Personal/Coding/**AiPhaBi-A**` | `~/Desktop/Wilson Personal/Coding/**AiPhaBi-B**` |
| `.aiphabi-side` | `A` | `B` |
| Branch | `main` | `side-b` |
| May write | `codes/zigen/rules.json` | `rime/**`, `phrases_*.txt` |
| May run | — | `build_rime.py`, `./sync.sh` |

They are **git worktrees of one repository**, so there is a single `.git` and both sides' commits
are visible from either folder immediately — no fetch needed to run `git log side-b`.

> **Worktrees share history, not files.** Each folder has its own working tree: a file edited (or
> created) in `AiPhaBi-A` does **not** appear in `AiPhaBi-B` until it is committed there and the
> commit is merged across. `build_rime.py` reads `DATA = ROOT / "data"` relative to *its own*
> folder (`build_rime.py:29-30`), so Side B always builds from **`AiPhaBi-B/data/`** — never from
> Side A's copy. An uncommitted edit in the Side A folder is invisible to the build.

#### Getting an edit from one folder to the other

Because the `.git` is shared, this needs **no push and no network**:

```bash
# in the Side A folder — commit the change
git commit -am "[rebuild] 詞庫：新增 …"

# in the Side B folder — pick it up straight from the local branch
cd ../AiPhaBi-B && git merge main
```

Pushing to `origin` is still worth doing for backup and for other machines, but it is not part of
the handoff between these two folders.

**`data/phrases_*.txt` is Side B's file — the simplest fix is to edit it in the Side B folder.**
Then no transfer is needed at all: Side B edits, builds, and deploys from one working tree. Editing
phrases in the Side A folder works, but it costs a commit and a merge before the build can see it,
and it crosses the ownership line for no gain.

**Why Side B is on `side-b` and not `main`:** git refuses to check out one branch in two worktrees
(`fatal: 'main' is already used by worktree at ...`). So Side B gets its own branch. To keep the
"everything lands on `main`" workflow intact, `side-b` **tracks `origin/main`** and the repo sets
`push.default = upstream`, so a bare `git push` from either folder pushes to `origin/main`.
**`sync.sh` therefore works unmodified** — it runs a bare `git push` and still deploys to `main`.

To pick up the other side's work, either folder runs `git pull` as usual. Because the `.git` is
shared, `git worktree list` from either folder shows both.

**Rebuilding this layout on another machine is steps 1–9 of the checklist above** — they are the
commands that created it, in order. The one people cut short is step 6: `build_rime.py` reads
`data/freq.json` and `data/opencc.json`, both **gitignored**, so a new worktree or clone does not
get them and Side B's build fails until they are copied.

### What the guard does and does not do

`.claude/hooks/side-guard.py` is a `PreToolUse` hook on
`Write|Edit|MultiEdit|NotebookEdit|Bash`. It exits 2 — a hard block, not a warning — and returns
the reason to Claude. Two protections, each unlocked only by the correct marker:

| `.aiphabi-side` | write `codes/zigen/rules.json` | run `build_rime.py` / `sync.sh` | everything else |
|---|---|---|---|
| `A` | ✅ allowed | **blocked** | allowed |
| `B` | **blocked** | ✅ allowed | allowed |
| missing / unrecognised | **blocked** | **blocked** | allowed |

Both fail closed, in opposite directions — the marker is a key that unlocks exactly one side's
work, never both. Everything else stays writable, so an undeclared checkout is not wedged.

**Reads are never blocked.** Side B reads the data files freely; only recognised *mutating* forms
are stopped. For `Bash` the guard splits the command into segments, strips heredoc bodies (commit
messages routinely mention `build_rime.py`, and that prose must not read as an invocation), and
classifies each segment's `argv0`. It blocks redirects into a protected file, `sed -i`, `tee`,
`mv`/`cp`/`rm`/`truncate`, `git checkout|restore|clean`, `jq --in-place`, and inline
`python/perl` opening one for write.

**Bash detection is heuristic and best-effort by nature** — it reads command strings, not intent.
Two consequences to expect:
- *False negatives*: an unusual mutation form can slip through. It catches the accident, not a
  determined bypass.
- *False positives*: a command that merely quotes one of these patterns as an argument can be
  blocked even though it writes nothing. This bites when testing the guard itself — put test
  cases in a file, not on the command line.

Still outside the guard entirely: the annotation server writing `data/*.json` (a separate process,
never passes through a hook), hand edits, and `sync.sh`'s `git add -A` (a commit, not a write).

It is **a guardrail against carelessness, not a security boundary.** It does not cover:
`rime/**` (deliberately — regenerable, so a wrong-side rebuild is annoying, not costly);
the annotation server writing `data/*.json` (different process, never passes through a hook);
hand edits; `sync.sh`'s `git add -A` (that's a commit, not a write); or a write routed through
`Bash`. It catches the realistic failure — a session helpfully "just fixing" one character.

Hooks are **snapshotted when a session starts**, so adding or editing one mid-session has no effect
until restart. After changing the guard, restart the session before trusting it.

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

## File ownership across parallel sessions

This project is worked on in **two Claude sessions at once**, one per sub-ecosystem. They share a
single working tree and a single `main` branch, so
ownership is by file, not by intent. **A session never writes a file it doesn't own** — even a
"tiny fix", even when it's obviously correct. Hand it to the owning session instead.

| File / dir | Owner | The other session |
|---|---|---|
| `data/codes.json` | **A · annotation** | **read only** |
| `data/zigen.json` | **A · annotation** | **read only** |
| `data/rules.json` | **A · annotation** | **read only** — but see the `short_code` note below |
| `data/todo_chars.txt` | **A · annotation** | read only |
| `server.py` + every page it serves (`editor.html`, `annotate.html`, `rules.html`, `stats.html`, `progress.html`, `variants.html`, `type.html`) | **A · annotation** | read only |
| `rime/**` (schemas, dict, `lua/`) | **B · IME** | read only |
| `data/phrases_*.txt`, `phrases_preview.tsv` | **B · IME** | read only |
| `build_rime.py`, `sync.sh` | **B · IME** | read only |
| `PROJECT_NOTES.md` | **shared** | see below |

### Hard rules — no exceptions

These three override every convenience argument below. They are not guidelines, and "it was
obviously correct" / "it was only bookkeeping" / "it was already rebuilt anyway" are not exemptions.
Both sessions follow them from now on.

**1. Side A owns `data/codes.json`, `data/zigen.json`, `data/rules.json`.**
Side B **never opens these in write mode — ever, for any reason.** Not a one-character fix, not a
count bump, not restoring something Side B itself is sure was lost. Side B reads them freely and
*reports* problems; the fix lands in Side A. (`rules.json` stays readable as the 簡碼 source — see
hazard 2 — but readable is the whole of it.)

### Commit convention: `[rebuild]`

Side A cannot rebuild, so the commit message is the handoff. **Literal format — put it at the very
start of the subject line, then write the subject as normal:**

```
[rebuild] <subject>
```

Real examples:

```
[rebuild] 新增取碼字 氈慼嗡鵲嗔 共 5 字
[rebuild] 簡碼表調整：裡 QF → QV，避開卞
[rebuild] 修正 覺 的取碼：FXXFUDJL → FXXFL
```

**Tag it only when the commit changes a build input.** `build_rime.py` reads:

| file | tag? |
|---|---|
| `data/codes.json` | ✅ **yes** |
| `data/rules.json` (incl. `short_code`) | ✅ **yes** |
| `data/phrases_*.txt` | ✅ **yes** — globbed at `build_rime.py:335`, they become dictionary entries |
| `data/charfreq.json`, `data/dual_use_merged.json` | ✅ yes (rare) |
| `data/zigen.json` | ❌ **no — not a build input** |
| `PROJECT_NOTES.md`, `server.py`, the HTML tools | ❌ no |

`zigen.json` is the one to get right: retiering, regrouping and `thr` tuning change *prediction*
inside the annotation site, never the shipped code table. Tagging those would train Side B to
ignore the tag. A commit that changes both `zigen.json` and `codes.json` **does** get tagged —
because of `codes.json`.

**Side B, when the deploy lands, prefixes its commit `[rebuilt]`.** That makes "is anything
waiting?" answerable:

```bash
git log --oneline --grep='^\[rebuild\]' -10                 # all rebuild requests, newest first
last=$(git log -1 --format=%H --grep='^\[rebuilt\]')        # ... since the last deploy
git log --oneline "$last"..HEAD --grep='^\[rebuild\]'
```

The prefix is anchored with `^` so prose *about* the convention (this file, commit bodies that
mention it) does not match. Nothing enforces the tag — it is a convention, not a hook.

**2. Side B owns `rime/**` — and the build that produces it.**
Side A **never runs `build_rime.py`, never runs `./sync.sh`, and never edits anything under
`rime/`**, including after its own data edits, and including when the rebuild is plainly needed.
Side A commits its data change with **`[rebuild]`** starting the subject line (see *Commit
convention* above, and note that `zigen.json`-only changes are not tagged); Side B picks
it up and rebuilds. A stale IME is a temporary, harmless state — a rebuild from the wrong session
is a silent ownership breach that also desyncs the other session's installed copy.

> This one is written from experience: `a18d9fd` ("重建碼表輸出：合併後 rebuild") was a Side-A
> rebuild that regenerated and pushed `aiphabi.dict.yaml`, `aiphabi_data.lua`, `aiphabi.schema.yaml`
> and `rime/README.md`. Nothing was corrupted — regenerated artifacts are reproducible — but it left
> Side B's `~/Library/Rime/` silently out of sync with a `rime/` it had not built.

**3. Every session starts with `git fetch` + `git status`.**
Before the first edit of a session — not mid-task, not at deploy time — run both, and read this file.
The cost of catching a divergence at minute zero is one command; the cost of catching it at push
time is an unmergeable conflict in someone else's file. If `git status` shows changes outside your
own scope, say so before doing anything else.

```bash
git fetch origin && git status -sb          # then read PROJECT_NOTES.md
```

### Shared-file hazards worth knowing

**1. `sync.sh` runs `git add -A` — this is the sharp edge.** Side B's deploy path
(`./sync.sh "<msg>"`) stages the *entire* working tree, not just `rime/`. If the IME session
deploys while this session has half-finished annotation edits sitting uncommitted in
`codes.json`/`zigen.json`, those edits get swept into a Side-B commit and pushed. Mitigation:
**this session commits its annotation work before the IME session deploys**, and vice versa —
don't leave Side-A edits uncommitted across a known Side-B deploy. Both sessions land on `main`
(Side B via `side-b` → `origin/main`; see *The two-folder layout*).

**With the two-folder layout this hazard is largely defused**: the folders have separate working
trees, so Side B's `git add -A` can only see Side B's own files. It still applies to anything
*inside one folder* — commit before deploying from that same folder.

**2. `rules.json` is owned here but consumed there.** `build_rime.py:77` reads it, and the
`short_code` rule's 60 `entries` become the IME's 簡碼 table (`shortcode` / `shortcode_rev` in
`aiphabi_data.lua`, which drives both 簡碼 lookup and the 簡碼 hint). So editing `short_code` in
this session is a *user-visible IME change* that doesn't take effect until the IME session
rebuilds. Tell the other session when 簡碼 entries move.

**3. `server.py`'s optimistic lock only guards the tool tabs, not the sessions.** It compares file
mtime, so it catches a stale browser tab — but a session editing `codes.json` with `Edit`/`Write`
bypasses it entirely, and any open annotation tab will 409 on its next save. If you write to
`data/*.json` from the shell while a tool tab is open, say so, so it can be reloaded.

**4. The `fetch_data.py` outputs are gitignored and shared by both sides.** `data/freq.json`
(`build_rime.py:78` + `/api/freq`), `data/opencc.json` (`build_rime.py:247` + `/api/opencc`),
`data/cangjie.json`, `data/tw_strokes.json`, `data/graphics.txt`, `data/hk_cache.json`. Because
they're untracked, a re-run leaves **no diff and no commit** — the change is invisible to the other
session while silently shifting its inputs. Neither session should re-run `fetch_data.py` casually
(~30 MB download); if it must happen, say so out loud.

**5. `data/backups/` is gitignored**, so it never appears in `git status` — but it *does* grow on
every tool save (one snapshot per PUT, pruned to 200 per stem). It's the recovery path if a session
does clobber `codes.json`/`zigen.json`: pull the newest `codes-*.json` / `zigen-*.json` from there.

**6. `zigen.json` is merge-hostile in a way `codes.json` is not.** `codes.json` is keyed by
character, so two sides editing different characters merge cleanly by line (verified: a 107-char
divergence auto-merged with the exception-flag edits from both sides preserved). `zigen.json`
is **not** safe that way: `count` and `seen` are *derived* aggregates recomputed across the whole
table, so a textual merge can interleave two different recomputations and produce numbers that
came from neither side.

> **This has already happened once — investigated and closed, no data lost.** Merge `04441f1`
> ("Merge remote-tracking branch 'origin/main'") has parents `902f5b7` (391 zigen) and `37ea2d9`
> (400 zigen) but came out with **420** — the textual merge interleaved both sides and produced
> **9 duplicated keys**, each a real entry plus a phantom twin (`count: 0`, `seen: []`, blank group).
> It also zeroed 5 further entries and dropped the R 捺劃 exemplar `大#2` (count 323, 23 seen).
> The "刪除 14 條孤兒字根" cleanup (`cff3be4`) then deleted exactly those 14 zero-count entries.
>
> Verdict after checking each of the 14 against both parents: **9** were the phantom twins (real
> instance survived — correct cleanup); **5** were zeroed *by the merge*, not by disuse. Of those 5,
> `R:灸#2` was legitimately dead (灸 recoded, its stroke 2 is now `Q`), and the other four shapes
> are still matched by surviving exemplars — verified with the real matcher, not by eye. `大#2`
> was **re-exemplified**, not lost: the 捺劃 group now carries `發#4`, and `發` was already in
> `大#2`'s `seen` list. Net unintended loss: **none**. Counts fell broadly at that merge
> (76% of shared keys below both parents); deliberately not chased — `count` is derived.

**Rule: never resolve `zigen.json` by textual merge or by hand-picking hunks.** Take one side whole,
then re-apply the other side's *non-derived* fields (`thr`, tier/intention placement, `distinct`)
on top — `count`/`seen` should be left to whichever side is newer and, if in doubt, regenerated by
the tool rather than merged.

#### Checking a zigen offline (no browser)
`retune.py` contains a faithful Python port of `assets/shape.js` (`stroke_vec` / `dist` / `vec_of`,
same `SAMPLES` and aspect-ratio term). Import it to answer "would this shape still match?" without
opening `/annotate`:

```python
from retune import vec_of, dist          # needs data/graphics.txt (gitignored, fetch_data.py)
tv = vec_of({'glyph': {'src': '货', 'strokes': [2, 3]}})
# a candidate zigen e matches if dist(tv, vec_of(e)) <= (e['thr'] if e.get('thr') else 0.25)
```

The threshold belongs to the **candidate** being matched against, not the query
(`thrOf = e => e.thr ?? globalThr`). Two caveats: `seen` is **capped at 24**, so absence from a
`seen` list never proves a zigen is unused — use the matcher; and `retune.py`'s `main()` *rewrites*
`zigen.json` (it recomputes every `thr` from `meta.distinct`), so import from it, don't run it.

### Refresh protocol

New characters coded here don't reach the IME by the other session reading the file mid-flight.
The sequence is: **this session codes → commits → the IME session is told to refresh its
understanding of `codes.json`** → that session re-reads and rebuilds. The IME session should never
edit `codes.json` to "fix" a code it dislikes — it reports the problem, and the fix lands here.

**`./commit_annotation.sh` does the "commits" step for you**, and can be run from *either* folder
(it locates the Side-A worktree by its `.aiphabi-side` marker, so no hardcoded paths). It only ever
runs git — it never writes the data files, so it is safe to invoke from Side B. It exists because
the manual sequence has three easy-to-miss conventions baked in:

- **stages only the four annotation files**, never `git add -A` (contrast `sync.sh`, which sweeps
  the whole working tree);
- **adds `[rebuild]` only when `codes.json`/`rules.json` changed** — not for `zigen.json`-only
  commits, which are not a build input;
- **commits *before* pulling**: `pull --rebase` refuses to run with unstaged changes, while `push`
  fails when behind `origin/main`, so the order is forced and the obvious order is wrong.

`./commit_annotation.sh -n` is a dry run: it prints which characters changed and the message it
would use, and touches nothing. A worked failure this came from: the commands were run on a second
machine where the edits didn't exist, so `add`/`commit`/`push` all "succeeded" while doing nothing —
the annotation tool had written them on the *other* machine. Check `git log origin/main` actually
moved before assuming a commit landed.

`PROJECT_NOTES.md` is shared: **each session edits only its own half** (Side A owns § A and this
ownership section; Side B owns § B). If a change spans both, whoever makes it says so in the commit
message so the other session re-reads before its next edit.

**Exception: the "Hard rules" block above is cross-cutting and belongs to neither half.** It binds
both sessions equally, so either may amend it — but an amendment must be flagged in the commit
message *and* mentioned to Wilson, since loosening a hard rule is a decision about how the two
sessions co-exist, not a note-keeping tidy-up.

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

**The global `0.25` is more nominal than it looks.** Individual zigen carry a per-shape `thr`
field that overrides it, and **268 of 417 zigen (64%) now have one** — values seen range from
`0.0317` (日) to `0.1993` (炯), i.e. almost always *tighter* than the global. The lookup is
`thr = shape.thr != null ? shape.thr : globalThr`, implemented in several places in
`annotate.html` (see `thrOf` at lines ~2173, 2320, 2397, 4027). Practical consequence: changing
`meta.merge_threshold` only moves the ~149 zigen that have no override, so it is **not** the knob
for fixing a specific bad merge — tighten that zigen's own `thr` instead (which is what the
per-shape overrides are for, and why there are so many).

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

### `data/codes.json` — the per-character breakdown & final code (5211 chars as of writing)
```json
"的": { "segments": [ {"strokes":[0],"letter":"J"}, {"strokes":[1,2,3,4],"letter":"B"},
                      {"strokes":[5,6,7],"letter":"A"} ], "code": "JBA", "final": "JBA" }
```
- `segments`: the actual stroke→letter decomposition.
- `code`: raw concatenation of segment letters.
- `final`: the **code the IME actually uses** after the 碼長上限 rule (≥5 letters → keep first 4
  + last 1). `code` may be longer; `final` is what ships. **Always read `final`.**

#### Rule-exception flags (per character)
A character's breakdown can legitimately disagree with the enforced rules. Rather than weakening
the rule, `annotate.html` records *why* on the character itself (UI at `annotate.html` ~L2571–2712).
Three mutually-distinct verdicts, each a list of rule-instance keys like `merge:1-2`, `lone:0`,
`comp:共:4`, `skip:4`, `letter:1`, `conv`:

| Field | Meaning | Count |
|---|---|---|
| `conventional` | 約定特例 — genuinely breaks the rule, accepted by convention (上, 大, 三, 五) | 29 |
| `compliant` | **not** an exception — the breakdown obeys the rule, the checker misjudged (見, 覺, 界, 士) | 43 |
| `overrides` | ignore this rule here (業, 認, 鎮, 觸, 顛) | 17 |
| `compliantWhy` | free-text reason, keyed by the same rule-instance key | 22 |

`compliant` is the one to reach for when the *checker* is wrong; `conventional`/`overrides` when
the *character* is. Flags are keyed to live rule instances — `annotate.html` prunes keys (and their
`compliantWhy` text) when a re-code makes them stale, so they don't survive a changed breakdown.

### `data/rules.json` — 取碼原則 (coding rules)
11 rules total, each with `kind`:
- `kind: "enforced"` + `enabled: true` → the rule **actually runs** in the prediction engine.
  **All 7 enforced rules:** `stroke_order`, `merge_over_split` (seg_penalty 0.05),
  `skip_isolated_hv` (lone 橫→I / 豎→J only if first/last stroke), `max_code_length` (max 5,
  head 4, tail 1), `tier_priority` (次 +1 cost, 三 +2), `enclosure` (囗/匚 first, overrides
  stroke order), and **`long_stroke`**.
- `kind: "manual"` → documentation only; not executed. The 4 manual rules are `convention`,
  `short_code`, `short3`, `left_short`.
- **The three 簡碼 rules (`short_code`, `short3`, `left_short`) still live in this file**, but
  they are **edited on `/short`, not `/rules`** — see *Quickcode conventions* below. Only
  `short_code` and `convention` are read by the build; `short3` is computed from the code table
  and `left_short` is not implemented yet.

> **Two pages write this one file.** `/rules` owns every non-簡碼 rule, `/short` owns the three
> 簡碼 rules, and each holds the whole file in memory. Both save through
> `assets/rulesio.js`, which sends `X-Base-Stamp` and, on a 409, re-reads the file, re-applies
> only the rules that page owns, and retries once. Before this existed `rules.html` sent no stamp
> at all, so the server's optimistic lock was inert for `rules.json` and whoever saved last
> silently won. Known limit: deleting a rule on one page while the other has unsaved edits
> brings it back.

### Designer-side tools
`server.py` → `http://localhost:8777`, serves the HTML tools and read/writes `data/*.json`.
The routes, as actually wired in `server.py` `do_GET` (~L353):

| Route | File | Nav label | What it is |
|---|---|---|---|
| **`/`**, `/index.html` | **`editor.html`** | 字根表 | the 字根表: 26 letters and their zigen, drag to re-group / re-tier. **`editor.html` *is* the 字根表 editor — there is no separate "breakdown editor" page** |
| `/annotate` | `annotate.html` | 逐字取碼 | the main tool: click strokes → press a letter → forms a zigen; shows the predicted breakdown + official stroke order from 3 regions |
| `/variants` | `variants.html` | 兼容字型 | regional glyph variants |
| `/stats` | `stats.html` | 碼表分析 | code-table analysis |
| `/rules` | `rules.html` | 取碼原則 | the coding rules; enforced ones actually bite. **The 簡碼 rules are hidden here** — they render on `/short` |
| `/short` | `shortcodes.html` | 簡碼 | 約定簡碼 / 三簡碼 / 左簡碼. Same `rules.json`, different page: 取碼原則 is "how does this character break apart", 簡碼 is "having broken it, how do you type fewer keys" |
| `/type` | `type.html` | 試打 | actually type with AiPhaBi |
| `/progress` | `progress.html` | 取碼進度 | daily cumulative coding curve |

Data APIs: `GET /api/{zigen,codes,rules,learned,freq,progress,state,…}`;
`PUT /api/{zigen,codes,rules,learned}` to write.

- **Optimistic locking on write** (`do_PUT`, ~L507): the page sends `X-Base-Stamp` = the file
  mtime it read; if the file changed since, the server returns **409 `{"error":"stale"}`** instead
  of writing. This is what stops a stale tab's autosave from clobbering another writer. If you edit
  `data/*.json` from a script while a tool tab is open, that tab will 409 on its next save — reload it.
- **`codes.json` is normalized on save**: `_normalize_finals(data)` forces `final == shorten(code)`
  for every entry, so a programmatic write can't leave `final` inconsistent with `code`.
- `data/backups/` — timestamped snapshot taken on *every* PUT, pruned to the last 200 per stem
  (currently ~500 files across stems).

---

## B · User side — IME, code table & candidate bar

### `build_rime.py` — the bridge (run via `./sync.sh`)
Reads `data/codes.json` + `data/rules.json` + `data/freq.json` + `data/phrases_*.txt`, emits:
- **`rime/aiphabi.dict.yaml`** — the dictionary: every char at its `final` code, plus 簡碼,
  三簡碼, and 詞組 (phrase) entries, each with a weight.
- **`rime/lua/aiphabi_data.lua`** — a big Lua table (`require("aiphabi_data")`) the filters read:
  `char2code`, `code2chars`, `shortcode` / `shortcode_rev`, `short3`, `si4` (四碼快打),
  `freq` (single-char), `wordfreq` (multi-char, essay-calibrated), etc.
- **`rime/aiphabi.schema.yaml`** — regenerated every build, so its switch list stays in sync.

#### ⚠️ A new switch has THREE homes — miss one and it half-works

Learned the hard way with `aiphabi_left_short`, which shipped missing #3 and looked like a bug:

| # | File | Generated? | Miss it and… |
|---|---|---|---|
| 1 | `rime/aiphabi.schema.yaml` | ✅ by `build_rime.py` | the toggle doesn't exist in pure 愛發筆 |
| 2 | `rime/aiphabi_plus.schema.yaml` | ❌ **hand-maintained** — `--install` only *copies* it | the toggle silently exists in pure but not in 二合一 |
| 3 | `rime/default.custom.yaml` → `switcher/save_options` | ❌ hand-maintained, **and `--install` never overwrites an existing one** | **the toggle works but is never remembered** — Rime won't write it to `user.yaml`, so switching app or toggling to English and back reverts it to default. Looks exactly like a broken feature. |

`build_rime.py` now **checks #3 automatically** and prints a `⚠ 開關 … 不在 …save_options` line for
any switch declared in either schema but absent from the save list. It cannot fix it for you.

Because `--install` preserves an existing `~/Library/Rime/default.custom.yaml`, fixing the repo
copy is **not enough** — the installed copy needs the same edit by hand, or the user keeps the
broken behaviour. Check with `diff rime/default.custom.yaml ~/Library/Rime/default.custom.yaml`.

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
  2. **exact / 四碼快打 / 左簡碼** (`exactSet` hit, or `ap_si4`, or `ap_left`) — your code exactly
     matches a char's full code, a fully-typed 4-code phrase, or a **fully-typed 左簡碼**
     (E_FLOOR 6). The rule for this tier is *derivable, not guessed*: a complete 左簡碼 is as
     definite as hitting a main code (247 codes for 249 chars, 2 collisions), so it must not
     sit in the pool competing on raw frequency against 容錯 guesses and sentence-mode debris.
     A **partially**-typed 左簡碼 is a guess and stays in the pool.
  3. **pool** — completions, 偏旁碼, 同類, 三簡, 容錯 (`ap_pool`), ranked by
     userfreq (session pick count, decaying in plus) then `cf` (word/char frequency).
     Completions ×0.7; cold-reading obscure single-char pinyin ×0.10 (plus only).
  4. **part** — coverage-demoted fragments (a candidate that doesn't span the whole segment,
     e.g. 民 covering only the tail of YCLX) sinks to the bottom. **Coverage is span-based**
     (`[min start, max _end]` over candidates); needed because `enable_sentence` spits out
     prefix/suffix fragments. `segStart = min(c.start)`, code extracted from that segment (not
     the whole `context.input`, which with sentence mode is the full composition).
- **`aiphabi_hint.lua`** — attaches hints to candidates: 同類字, 偏旁碼, 打繁出簡/打簡出繁, and the
  **簡碼 hint** (type a char's full code, see "簡碼 XX" reminder). Also **generates the 四碼快打
  candidates** from `data.si4` (not in the dict): `#code==4` exact → `ap_si4` (exact tier),
  3-prefix → `ap_pool` (完成/墊底). Gated on phrase being on.
- **`aiphabi_phrase.lua`** — the phrase on/off gate (pure only): when `aiphabi_phrase` option is
  off, hides multi-char candidates.
- **`aiphabi_fuzzy.lua`** — input tolerance (missing/extra/adjacent-key/swapped codes).
- **`aiphabi_wildcard.lua`** — the `` ` `` wildcard key (forgot a code or two → press `` ` ``).

### Candidate comment convention (what the bar writes next to a candidate)

One rule, and every hint follows it — `refMark()` in `aiphabi_hint.lua` is the single place that
formats the bracketed form:

| Form | Means | Example |
|---|---|---|
| `標籤 (碼)` — **round brackets** | the bracketed code is that character's **主碼**, shown for reference. The label says *how you got here* | type `JKQ` → 我 `簡碼 (JKXQ)`; type `IF` → 主 `兼容 (QE)` |
| `標籤 碼` — **no brackets** | a code you could **type instead**, shorter than what you just typed | type `JKXQ` → 我 `簡碼 JKQ` |
| `[ 碼 ]` — **square brackets** | a 容錯 guess (`aiphabi_fuzzy` only) — deliberately distinct so a guess can never read as a reference | type `JKQ` → 不 `[ JQ ]` |

The label never repeats the word 主碼: the brackets already mean that, so the label slot is spent
on the route instead (簡碼 / 三簡 / 左簡 / 偏旁碼 / 同類 / 兼容). `- XX` is the odd one out and
means "these keys still to press" — actionable, hence no brackets.

### Testing the candidate bar offline

`tests/` runs the **real** filter files against the **real** generated `aiphabi_data.lua`, with
librime's `Candidate` / `yield` / `env.engine.context` / `input:iter()` stubbed out:

```bash
LUA_PATH="./tests/?.lua;;" ~/.local/bin/lua tests/run_tests.lua
~/.local/bin/luac -p rime/lua/*.lua          # syntax check — catches a missing `end`
```

Lua is **not** installed system-wide on this Mac and there is no Homebrew; the binary at
`~/.local/bin/lua` was built from source (`make macosx`). If it's missing, rebuild it there —
nothing in the repo depends on its location except the command above.

- **Run it before and after touching `aiphabi_hint.lua` / either order filter.** A broken filter
  does not crash Rime — librime-lua logs and moves on, so the only symptom is "ordering went
  weird", which is easy to miss.
- The harness **models `uniquifier`** (last in the schema's filter chain). It has to: the 約定簡碼
  branch deliberately ignores `seen` so it can promote a character to first place, so the same
  character legitimately appears twice before `uniquifier` collapses it. Test the post-uniquifier
  view, or you assert on something the user never sees.
- **It cannot test** Rime's own dict lookup or `enable_sentence` segmentation — those inputs are
  supplied by hand in each test case. So it proves *"given these candidates, we rank them thus"*,
  not *"typing X produces exactly this bar"*. Typing is still the end-to-end check.
- When an ordering bug turns up, **add the failing case first**, watch it fail, then fix.

---

## Quickcode conventions (the JKXQ example)

Every character has a derivable **主碼 (main code)** = its zigen letters in stroke order,
capped at 5 (first 4 + last). On top of that are four *optional, opt-in* conveniences.
**All of them are edited on `/short`, not `/rules`.**

| Layer | What it is | How derived | Toggle | Example (我) |
|---|---|---|---|---|
| **主碼** | full derivable code | zigen in stroke order, cap 5 | always on | **JKXQ** |
| **簡碼** | hand-picked shortcut for ~60 common chars | 首+末 (occasionally 首2+末), by designer discretion | `aiphabi_short100` | **JKQ** |
| **三簡碼** | auto shortcut for every ≥4-code char | 頭2 + 末1 — **you type just those 3 keys**, no wildcard (`aiphabi_hint.lua` gates on `#code == 3`; the effect equals `AB` + `` ` `` + `C`, but `` ` `` is never pressed) | `aiphabi_short3` | (n/a, 我 is short) |
| **左簡碼** | 8 curated 偏旁; when one sits on the far left, it contributes only 首+末 | 偏旁 2 codes + remainder, then the usual cap | `aiphabi_left_short` (default off) | (n/a, 我 has no such 偏旁) |
| **詞組連打** | phrases = each char's 簡碼(or主碼) concatenated | see phrase rules below | `aiphabi_phrase` | 我的 = JKQJA |

**左簡碼 shipped notes** (Side B, `build_rime.py` + `aiphabi_hint.lua`): codes are computed live
from `codes.json` — the `members` list stores characters only, never codes, so a re-coded character
can't leave a stale shortcut behind. Three things worth knowing:
- **Only 97 of the 249 family characters actually save a keystroke.** Once the remainder exceeds
  3 codes, the cap squeezes both paths to 5 (鐵 主碼 `YFVFQ` vs 左簡碼 `YVFOQ`) — that's condition 6
  and the cap agreeing, exactly as `over_cap_note` says. The forward lookup covers all 249, but the
  **reverse hint fires only for the 97 that genuinely shorten**; whispering an equal-length code
  would be telling the user to memorise nothing.
- **It never enters the dict** — lua-only (`M.leftshort`). That is what makes condition 5
  ("不可疊加三簡碼") true *structurally*: `short3` is derived from `code2chars`, so if 左簡碼 isn't
  in the code table, no 三簡碼 can be built on top of one.
- **Partial codes need their own completion table** (`M.leftshort_pre`, ≥3 codes). Main codes get
  completion free from `enable_completion`; a lua-only code gets nothing, so typing `SMB` for 鯉
  (`SMBF`) silently produced no candidate at all until the prefix table existed.

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

### 左簡碼 — the 偏旁 layer (spec'd and curated; **not built yet**)

When a curated 偏旁 sits at the far left of a character, the 偏旁 contributes only its **首+末**
two codes and its middle is skipped. 鮭 完整碼 `SOTMFF` → 左簡碼 `SMFF`.

The 8 偏旁 and their 左簡碼: 魚 `SOTM`→`SM`, 金 `YFV`→`YV`, 馬 `SHM`→`SM`, 食 `AEG`→`AG`,
車 `IBT`→`IT`, 足 `OTL`→`OL`, 酉 `IHI`→`II`, 革 `HOT`→`HT`. **249 member characters**, all
hand-reviewed. Note 食 and 足: the code is the *radical form as written on the left*
(飠 `AEG`, 𧾷 `OTL`), which differs from the standalone character (食 `AEK`, 足 `OTY`).

Six conditions, in `rules.json` → `left_short` → `conditions`. The two that carry the weight:
**the 偏旁 must be leftmost with nothing to its left**, and **左簡碼 never stacks with 三簡碼** —
one simplification per character.

- **The member list is stored, not derived** (`entries[].members`). Two reasons, both load-bearing:
  deriving needs `data/dictionary.txt` (IDS decomposition), which is **gitignored and absent from
  Side B's worktree** — the build could not do it; and a derived list would silently grow every
  time a new 金-radical character gets coded, gaining a code and possibly a collision that nobody
  reviewed.
- **Members store characters only, never their codes.** Codes are recomputed from `codes.json`
  every time. A stored code goes stale the moment a character is recoded — 福 went
  `QMIOOT`→`QMOOT` in Aug 2026.
- **Prefix matching is not sufficient**, and this is the trap: 魯 `SOTMB` and 鮮 `SOTMVF` both
  start with `SOTM`, but 魚 sits on *top* in 魯. The test is the IDS decomposition — `⿰`/`⿲`
  with the 偏旁 as first component, accepting radical variants (釒 for 金, 飠 for 食). This is
  also what excludes the false positives the earlier prefix-scan collected: 倖, 裹, 西, 亞, 遷,
  轮, 薑, 暫, 磐.
- `/short` shows **待審 / 失效** — candidates the IDS test finds that aren't on the list, and
  members that no longer qualify. That keeps drift visible instead of automatic. It currently
  reads 名單與部件拆分一致.
- **Condition 6 needs no separate implementation.** It says "if the remainder still exceeds
  3 codes, take the remainder's 首2+尾1, total ≤5" — since the 左簡碼 is always exactly 2 codes,
  that is arithmetically identical to the existing `max_code_length` cap. Verified across all
  249 with zero divergence, so the build can just call `shorten()`.
- Known collisions: 針's `YVT` vs 伞 (伞 ranks 7454, 針 ranks 897 — judged negligible), plus
  鈕鉗鋅鐘 colliding inside 金.
- Simplified forms (跃 践 跻 酿 …) **are** included; `aiphabi_no_simp` already filters them out
  of the dict for anyone who doesn't want that collision surface.

Background and the numbers that led here: `偏旁縮碼investigation.md` at the repo root.

---

## Phrase input (詞組連打) & 四碼快打

- **Encoding rule:** a phrase's code = each character's 簡碼 (or 主碼 if no 簡碼) concatenated.
  Verified: 我的 = JKQJA, 你好 = YMLI, 中國人 = QOQY, 香港 = JTBWHZ.
- **2-char phrases** get the cartesian of {short, main} × {short, main} for the two chars
  (short/short, short/main, main/short, main/main) so you don't have to remember which mode.
- **3+ char phrases** use three uniform modes (main / 簡碼-preferred / 三簡碼-preferred) to avoid
  combinatorial explosion.
- **四碼快打 (`data.si4`, generated in `aiphabi_hint.lua`, not in dict):** a 4-key shortcut for
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
  git). Run once per machine, before `server.py` — it is **step 5** of *Starting a new session*.

---

## Current state — built vs in progress

### A · Designer side
- ✅ Zigen learning + reverse prediction pipeline (`zigen.json` ↔ `codes.json`, midline matching).
- ✅ 5215 characters coded (`codes.json`, Aug 2026), ~99.9% char coverage of common text.
- ✅ Enforced rules engine (stroke order, merge-over-split, isolated-stroke skip, cap-5, tiers,
  enclosure).
- ✅ Annotation / rules / 簡碼 / 字根表 / progress / stats / variants tools.
- ✅ 簡碼 split onto its own page (`/short`), with the two-page save merge in `assets/rulesio.js`.
- ✅ 左簡碼 **spec'd and curated on the A side**: 8 偏旁, 249 reviewed members, 6 conditions,
  collision numbers live on `/short`. Handoff spec is in commit `d84e690`.
- 🔄 Ongoing: keep coding the long tail of characters (`data/todo_chars.txt`, 785 left); refine
  tiers/groups; `kind:"manual"` rules not yet enforced.
- ⏳ Waiting on Side B: 左簡碼 has no IME implementation yet. Nothing else is blocked on it.

### B · User side
- ✅ Two macOS schemas (pure `aiphabi` + `aiphabi_plus` with F4 pinyin toggle), installed via
  `./sync.sh`.
- ✅ Quickcode stack: 60 hand-picked 簡碼, auto 三簡碼, both with toggles + reserved main codes +
  簡碼 hint.
- ✅ Candidate reorder filters (pure + plus, kept in sync): 簡碼 > exact/四碼 > pool > coverage-
  demoted part; userfreq boosting; completion & cold-reading penalties; span-based coverage gating.
- ✅ 詞組連打: ~40k+ curated phrases across 10 themed files; 2-char cartesian; 3+ uniform modes;
  四碼快打 (first-4 + first-3+last for 5+); `enable_sentence` segmentation.
- ✅ 容錯 (fuzzy), 萬用鍵 `` ` ``, 打繁出簡/打簡出繁, 偏旁碼/同類字 hints.
- ✅ iOS (Hamster) working; dict weights sane for the no-lua path; mobile pulls phrase data + 4-code
  logic from repo.
- 🔄 Ongoing: expand phrase库; ordering edge-cases as they surface (each fix must land in BOTH
  order filters); the last known ordering work shipped at commit `9ffed24`.

### Not started / open
- ~~No formal test harness for candidate ordering~~ — **done**, see *Testing the candidate bar
  offline* below. Coverage is still thin (left-short, the hint marks, one 簡碼 case); widen it
  as ordering bugs surface, by adding the failing case first.
- Wubi/Boshiamy重碼率 numbers for the comparison tool are unmeasured (proprietary/methodology).
- Design-philosophy blurb exists as prose (not shipped as a page); decided *not* to name competitors
  for the 無理碼 point ("don't want to pick fights").

---

## Key naming / decisions cheat-sheet
- **Candidate types** (librime-lua `.type`): `ap_short` (簡碼), `ap_si4` (exact 4-code phrase),
  `ap_left` (fully-typed 左簡碼 — exact tier), `ap_pool` (everything demotable:
  completion/偏旁/同類/三簡/容錯/3-prefix/partial 左簡碼). `completion` is librime's own type.
  **A new type must be taught to both order filters** — an unknown `.type` silently falls
  through to the pool, which looks like a ranking bug rather than a missing case.
- **Candidate span fields:** `.start`, `._end` (Lua keyword `end` → `_end`), `.preedit` (form =
  UPPERCASE, pinyin = lowercase — used to tell form vs pinyin candidates apart).
- **`final` not `code`** is the shipping code in `codes.json`.
- **`shortcode_rev`** drives the 簡碼 hint; **`shortcode`** drives 簡碼 lookup.
- Two order filters (`aiphabi_order.lua` + `aiphabi_order_plus.lua`) — **sync every fix**.
- Deploy = **`./sync.sh "<msg>"`** only. `fetch_data.py` for third-party data (gitignored outputs).
- `Z` = wildcard letter in the alphabet; `` ` `` = wildcard *key* while typing.
