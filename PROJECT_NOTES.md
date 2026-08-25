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

**On Wilson's Mac all three folders already exist** — open `AiPhaBi-A` for Side A, `AiPhaBi-B` for
Side B, `AiPhaBi-C` for Side C (see *The folder layout* below) and skip to step 9.

Steps 1–8 build that layout from scratch on a new machine. **They produce all three sides in one
pass — run them to the end.** Stopping after the clone leaves a single-folder checkout that can
only ever declare one side, which is the exact arrangement the hard rules exist to prevent.

| # | Step | |
|---|---|---|
| 1 | `git clone https://github.com/wilsongrchan/AiPhaBi.git AiPhaBi-A && cd AiPhaBi-A` — the Side A folder, on `main` | new machine |
| 2 | `git worktree add -b side-b ../AiPhaBi-B origin/main` and `git worktree add -b side-c ../AiPhaBi-C origin/main` — the Side B and Side C folders. One `.git`, three working trees | new machine |
| 3 | `git config push.default upstream` — shared config; all three branches track `origin/main`, so a bare `git push` from any folder still lands on `main`. This is what lets `sync.sh` work unmodified (see *Why Side B is on `side-b`* below) | new machine |
| 4 | `echo A > .aiphabi-side && echo B > ../AiPhaBi-B/.aiphabi-side && echo C > ../AiPhaBi-C/.aiphabi-side` — **one permanent marker per folder, never flipped** | new machine |
| 5 | `python3 fetch_data.py` — **Side A only.** Fetches the ~30 MB of third-party glyph data (`graphics.txt`, `tw_strokes.json`, `hk_cache.json`, `dictionary.txt`) into `data/`; these stay gitignored, and without them `/annotate` has no strokes. Takes a few minutes; files already present are skipped. **Side B does not need this** — every input `build_rime.py` reads is tracked in git, so `AiPhaBi-B` can build straight after the clone | new machine |
| 6 | Open **each folder in its own VS Code window**, and **trust the directory** when prompted | per folder |
| 7 | **Approve the project hooks** when prompted — Claude Code will not silently run hooks shipped in a cloned repo | per folder |
| 8 | Run `/hooks` and confirm a `PreToolUse` entry pointing at `.claude/hooks/side-guard.py` | per folder |
| 9 | Tell the session which side it is, and to read `PROJECT_NOTES.md` | every session |
| 10 | `git fetch origin && git status -sb` | every session |

Steps 6–8 are **per folder, not per machine**: each folder is its own Claude Code project, so each
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

### The folder layout (Wilson's Mac)

All three sides run **simultaneously**, each in its own folder, each with a permanent marker. No
marker is ever flipped.

| | Side A · 字根/取碼 | Side B · IME/候選 | Side C · 公開網站 |
|---|---|---|---|
| Folder | `~/Desktop/Wilson Personal/Coding/**AiPhaBi-A**` | `…/**AiPhaBi-B**` | `…/**AiPhaBi-C**` |
| `.aiphabi-side` | `A` | `B` | `C` |
| Branch | `main` | `side-b` | `side-c` |
| May write | `codes/zigen/rules.json` | `rime/**`, `phrases_*.txt` | `site/**` |
| May run | — | `build_rime.py`, `./sync.sh` | `site/tools/build_site_data.py` |

They are **git worktrees of one repository**, so there is a single `.git` and every side's commits
are visible from any folder immediately — no fetch needed to run `git log side-b`.

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
commands that created it, in order. **Side B needs no copied files at all**: every input
`build_rime.py` reads (`codes.json`, `rules.json`, `freq.json`, `charfreq.json`, `opencc.json`,
`dual_use_merged.json`, `phrases_*.txt`) is tracked, so a fresh `AiPhaBi-B` builds immediately.
`freq.json` and `opencc.json` used to be gitignored and hand-copied; hazard 4 explains why that
stopped. Only `data/predict.db` (智能聯想, optional — the build skips it cleanly) and Side A's
bulky glyph data remain untracked.

### What the guard does and does not do

`.claude/hooks/side-guard.py` is a `PreToolUse` hook on
`Write|Edit|MultiEdit|NotebookEdit|Bash`. It exits 2 — a hard block, not a warning — and returns
the reason to Claude. Two protections, each unlocked only by the correct marker:

| `.aiphabi-side` | write `codes/zigen/rules.json` | run `build_rime.py` / `sync.sh` | write `site/**` | everything else |
|---|---|---|---|---|
| `A` | ✅ allowed | **blocked** | **blocked** | allowed |
| `B` | **blocked** | ✅ allowed | **blocked** | allowed |
| `C` | **blocked** | **blocked** | ✅ allowed | allowed |
| missing / unrecognised | **blocked** | **blocked** | **blocked** | allowed |

All three fail closed, in different directions — the marker is a key that unlocks exactly one
side's work, never another's. Everything else stays writable, so an undeclared checkout is not
wedged.

**`site/**` is guarded more lightly than the other two, deliberately.** Its `Bash` detection covers
redirects and the obvious mutators but skips the `python … >` heuristic used for the data files,
because `python3 site/tools/build_site_data.py` legitimately names a site path — and that command
is the site's own generator, which any side may run. Getting the website wrong is visible and
reversible; getting `codes.json` wrong is neither.

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
| `site/**` (公開網站), `.github/workflows/pages.yml` | **C · 網站** | read only |
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

**3. Side C owns `site/**` — the public website — and only that.**
Sides A and B never edit anything under `site/`. Side C never writes `codes.json` / `zigen.json` /
`rules.json`, never runs `build_rime.py` or `./sync.sh`, and never touches `rime/**` — it **reads**
all of them freely, which is exactly how the site gets its numbers, and *reports* problems to the
owning side. Site changes need **no commit tag**: the website is not a build input, and its own
deploy is triggered by the Pages workflow, not by another session.

> The failure this prevents is not corruption, it is **a public page that contradicts the IME**.
> The site is the only artifact strangers read, so a wrong number or a stale code there is the one
> mistake in this repo that gets quoted back. Hence the standing rule for Side C: **never hand-copy
> a code or a count into the site** — either generate it (`site/tools/build_site_data.py`) or check
> it against `data/` at the moment you write it. See *C · 公開網站* below.

**4. Every session starts with `git fetch` + `git status`.**
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

**4. The remaining `fetch_data.py` outputs are gitignored and shared by both sides.**
`data/cangjie.json`, `data/tw_strokes.json`, `data/graphics.txt`, `data/hk_cache.json`,
`data/dictionary.txt` — all Side A / annotation-side. Because they're untracked, a re-run leaves
**no diff and no commit** — the change is invisible to the other session while silently shifting its
inputs. Neither session should re-run `fetch_data.py` casually (~30 MB download); if it must happen,
say so out loud.

> **Every input `build_rime.py` reads is now tracked in git — deliberately, because this bit us.**
> `data/freq.json` (139K) and `data/opencc.json` (115K, OpenCC, Apache-2.0) used to be gitignored
> `fetch_data.py` outputs, so each machine held its own copy. Two machines building in turn rewrote
> **8210 weights** every time — identical code table, different tie-breaks. Measured: of 1167 codes
> carrying more than one candidate, **15 changed order**, 13 of them among characters the modern
> frequency table scores at 0; the visible one was `JTFC` (乘 ⇄ 乖). Small, but it never settles and
> it buries real diffs in noise. `opencc.json` was the same hazard one step behind — it feeds
> 打繁出簡/打簡出繁, so a drifted copy silently changes those candidates.
>
> **The rule this leaves:** anything `build_rime.py` reads belongs in git. If `fetch_data.py` is
> re-run and it rewrites `freq.json`/`opencc.json`, **commit the result** — otherwise that machine
> quietly builds a different code table from everyone else, with no diff to warn you.

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
the tool rather than merged. When a genuine merge is unavoidable and both sides hold real deltas to
the same shared counter (`count`), don't just pick a side's number either — read the value at the
merge-base commit (`git show <base>:data/zigen.json`) and add both sides' deltas back on top; that's
the only way neither side's coding session gets silently discounted.

**7. `pull.sh`'s stash step can fail outright, safely, before doing anything.** It stashes dirty
annotation data with `git stash push -- data/*.json`. That glob is expanded by the shell *before*
git sees it, so on a machine where `fetch_data.py`'s gitignored outputs already sit in `data/`
(`cangjie.json`, `cangjie_map.json`, `hk_cache.json`, `tw_strokes.json`, …), the expanded argument
list includes untracked paths — and `git stash push -- <pathspec>` errors out entirely if *any*
pathspec doesn't match a tracked file, rather than just skipping it. Observed failure:
`error: pathspec ':(prefix:0)data/cangjie.json' did not match any file(s) known to git`, and the
script exits before running `git pull` at all. **Nothing is lost** (it fails before staging
anything), but the pull silently doesn't happen.

**Fixed 2026-08-24**: the glob is now quoted (`-- 'data/*.json'`), so git does its own pathspec
matching against tracked files instead of the shell expanding it against whatever's on disk. If
this ever regresses, the workaround is the same as before: stash by hand naming only the real
tracked files, e.g. `git stash push -- data/codes.json data/zigen.json data/rules.json`, then
`git pull --rebase origin main`, then `git stash pop`.

**8. `graphics.txt`'s "為" entry is not 為 — it's 爲.** makemeahanzi has exactly one entry keyed
`為`, but the drawing under it is the 12-stroke 爲 form (爫 head), confirmed by rendering it
stroke-by-stroke; 爲 (U+7228) isn't in makemeahanzi separately at all. Anything sourced from that
entry for the real 9-stroke 教育部標準 為 (U+7232) will be wrong — segments built against it won't
match Wilson's stroke chart, and the annotate 田字格 will draw the wrong glyph.

**Fixed 2026-08-24**: 為's `codes.json` segments (`Y[0,1] J[2] J[3] C[4] M[5,6,7,8]`, code `YJJCM`)
are built against **`data/tw_strokes.json`** instead — it has 為 as 9 properly separated stroke
outlines (2048×2048, y-down; needs `x*0.5, 900-y*0.5` to land in graphics.txt's convention) matching
the real chart. Verified two independent ways that agreed: frame-diffing twpen.com's stroke-order
GIF at the exact point each stroke settles from "being drawn" to "done" (pixel-precise, no
reconstruction), and Side C cross-referencing `zigen.json`'s own shape library (為 already appears
in two shapes' `seen` lists). `data/graphics.txt`'s "為" entry was also replaced with the same
tw_strokes-derived 9-stroke data so `/annotate`'s 田字格 shows the correct glyph too — but remember
`graphics.txt` is gitignored (hazard #4), so that fix is local-only; the site gets 為's glyph from
Side C pointing `build_site_data.py` at `tw_strokes.json` directly, not from `graphics.txt`.
爲 (U+7228) was re-annotated directly by Wilson via `/annotate` against its own real 12-stroke
`graphics.txt` entry (code `WJJJCM`) — unrelated to 為's fix, don't conflate the two.

If a future session finds 為 or 爲 looking wrong again, check `graphics.txt`'s stroke *count* first
(9 = correct 為 source, 12 = 爲) before assuming the segments are the problem.

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

#### `meta.distinct` has decayed — running `retune.py` would now loosen 122 zigen

Measured 2026-08-17, after a Side C report. `meta.distinct` is an **adjudication log**: each entry
says "these two shapes are genuinely different, don't merge them", and its *only* effect is to set
`thr = max(0.01, dist(a,b) × 0.9)` on both shapes. `retune.py` pops every `thr` and rebuilds them
from this list, matching entries by the exact string `letter:glyph.src#strokes` — **primary glyph
only, `alts` not consulted** (`retune.py:118-121`).

Re-coding a character changes that string, and the adjudication silently stops matching:

| | |
|---|---|
| adjudications total | 543 |
| same-letter (dropped by `retune.py:105` — same code, tightening is meaningless) | 12 |
| cross-letter (the ones that do anything) | 531 |
| …still matching a primary glyph on **both** ends | **163** |
| …orphaned, so no longer applied | **368** |
| orphaned pairs now within the global 0.25 (i.e. mergeable again) | **290** |

**Consequence: `retune.py` today would cut the zigen carrying a tightened `thr` from 279 to 162 —
122 shapes revert to the loose global threshold**, including pairs adjudicated as distinct at
d≈0.004 (`A:全#0,1` × `Y:俗#4,5`). The stored `thr` values are still in the file and still working;
the decay only bites the moment someone regenerates them. This is why "import from it, don't run
it" above is a hard rule and not a style preference.

Worth knowing before fixing it: the orphaned entries are **not** proof the shapes are gone. Of 59
tokens that match nothing at all (not even via `alts`), the median matcher still finds a live
equivalent for 23 — they were merely re-represented under a different source character. A real
repair means re-resolving each adjudication by geometry, not by string, and that needs
`data/graphics.txt` — **which only Side A has** (gitignored; Sides B and C cannot do this analysis).

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

**`./commit_annotation.sh --build` carries it through the rebuild too** — commit → `pull --rebase`
→ push → *then*, **in the Side-B worktree**, `git pull` and that folder's own `./sync.sh`. The build
never runs from Side A; if no `B`-marked worktree is found it stops and says so rather than falling
back (that fallback is exactly the `a18d9fd` incident above). It also refuses to build when Side B's
tree is dirty, because `sync.sh` is `git add -A` and would sweep up unfinished work there.

**Use `--build` rather than running `./sync.sh` by hand.** Both produce the same table, but
`sync.sh` alone commits with its default message, so the deploy carries no `[rebuilt]` prefix and
the "is anything waiting?" query starts reporting already-built commits as pending. This happened on
2026-08-14: two hand-run deploys left five `[rebuild]`s looking unbuilt. It self-heals — the next
`--build` walks back to the last `[rebuilt]`, lists everything since, and resets the marker
(`34351ee` did exactly that, listing all six) — but the window in between is misleading.

The everyday commands, for a machine where the folders are `~/Desktop/Wilson Personal/Coding/`:

```bash
cd ~/Desktop/Wilson*/Coding/AiPhaBi-A && python3 server.py              # 開站
cd ~/Desktop/Wilson*/Coding/AiPhaBi-A && ./commit_annotation.sh         # 只送出取碼
cd ~/Desktop/Wilson*/Coding/AiPhaBi-A && ./commit_annotation.sh --build # 送出＋重建 IME
cd ~/Desktop/Wilson*/Coding/AiPhaBi-B && git pull && ./sync.sh          # 只重建（不加 [rebuilt]）
```

The `Wilson*` glob is deliberate: the path contains a space, and quoting it invites the smart-quote
paste failure — a `”` copied from a notes app leaves the shell at a `dquote>` prompt, silently
swallowing every following line, so nothing runs at all and it looks like git did nothing.

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
  `merge_threshold`, tier names, and `distinct` = manually-asserted
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

  **Caveat on `enclosure`/`long_stroke`, verified by testing against the live predictor:**
  neither has code that checks *for* an enclosure or a trunk shape by name — there's no entry for
  either in `rules.html`'s `PARAMS` map, and no ID lookup anywhere in `annotate.html`. What
  actually produces the effect is generic: `zigen.js`'s `candidates()` lets any zigen defined with
  a head+tail gap (跳筆) match non-adjacent strokes as one unit (`囗` = first 2 strokes + last;
  `木`-as-trunk in 東/陳 = first stroke + last 3), and `merge_over_split`'s `seg_penalty` then
  naturally prefers using that one bigger unit over a contiguous-only split. Confirmed correct
  against real segment data for 因/困/區/樞/東/陳. The mechanism doesn't distinguish "this is an
  enclosure" from "this is a trunk" — both rule names describe the same underlying `gapped`
  infrastructure, applied to two different shape categories a human chooses to define that way.

  **Caveat on `skip_isolated_hv`: it's a soft cost, not a guarantee.** The skip penalty (0.3)
  competes with ordinary shape-match distance, and when some *other*, unrelated zigen in the
  ever-growing library happens to fall under threshold against the "isolated" stroke's neighbor,
  the predictor can and does prefer that coincidental match over actually skipping — verified: the
  rule's own named examples, 孔/孩, do **not** reproduce from `predict()` alone (top guess for 孔
  is `JTL`, not the approved `PL`; root cause traced to a 轮-derived zigen coincidentally matching
  under threshold, cost 0.332 vs. the correct skip-based path at 0.479). The approved `codes.json`
  entries for characters like this were hand-corrected, not reproduced by the algorithm on its own.
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
| `/progress` | `progress.html` | 取碼進度 | **官方字表覆蓋率** (collapsible; see below) + a stacked-area cumulative chart by 繁體/簡體/傳承/日本漢字. The bands are made disjoint before stacking (`trad−inter`, `inherited−jp`, each only when the overlapping category is also shown), so the stack top equals the union for every toggle combination — 日本漢字 is a *subset* of 傳承字, and a naive stack double-counts it |

Data APIs: `GET /api/{zigen,codes,rules,learned,freq,progress,state,…}`;
`PUT /api/{zigen,codes,rules,learned}` to write.

### 取碼目標：官方字表 (`data/standards/`)

**"How far along is the coding?" is answered against official character lists, never against the
size of `codes.json`.** The raw total is not a claim anyone can check: it mixes in Cantonese
characters (咁 咗 哋 啲 喺), zigen components (㠯 丂), Japanese kanji and HK forms, and it is
bounded by makemeahanzi's 9574 — a *font dataset*, not a standard published by anyone.

Two target lists, committed to git (unlike the `fetch_data.py` downloads, these define the goal
rather than supply glyph data — each file's header records its provenance):

| File | List | Size |
|---|---|---|
| `data/standards/tw_common_4808.txt` | 中華民國教育部《常用國字標準字體表》甲表 | 4808 |
| `data/standards/gb2312.txt` | GB 2312—80 基本集漢字 (一級 3755 ＋ 二級 3008) | 6763 |

- **TW 4808** was taken from two independent public copies and diffed — byte-identical, 4808 with
  no duplicates. It is **not** the same set as `data/tw_strokes.json` (g0v stroke-order data, which
  is also MOE-derived): the stroke file is missing 乃 and 彝, and adds 彞 plus the Taiwanese-language
  characters 𠊎 𪜶. Cite `standards/`, never `tw_strokes.json`, for coverage.
- **GB 2312** is generated locally from Python's `gb2312` codec rather than downloaded — the
  encoding *is* the standard's definition, so it is exactly reproducible and needs no network.
- The two lists overlap by 3060 characters; their union is 8511.

`server.py` `_standards_coverage()` reports done/missing per list into `/api/progress`; `/progress`
draws a bar per list, and the "照字表順序接著取" link feeds the missing characters to `/annotate`
**in the list's own order** (MOE is stroke-count ordered, GB2312 level 1 is pinyin ordered), capped
at 300 per link because a URL cannot carry 3000 characters.

Adding a third list means one row in `STANDARDS` plus a file in `data/standards/` — nothing else.

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
     **Three-layer cap against I/J-style lag** (2026-08-25): root letters `I`/`J` carry
     17,727 / 12,978 dict rows (by far the two largest — next is `Y` at 8,100; check with
     `awk -F'\t' '{print substr($2,1,1)}' rime/aiphabi.dict.yaml | sort | uniq -c | sort -rn`).
     Typing just that one letter used to force **every** filter in the chain (`hint` → `fuzzy`
     → `order[_plus]`) to each independently drain and touch the *entire* completion stream —
     that repeated full materialization, not the sort, turned out to be the dominant cost
     (confirmed by profiling after the first fix — capping only the sort barely moved the
     needle; Wilson could still feel the lag after that deploy). The real fix has to sit at the
     front of the chain so it cascades:
     1. **`RAW_CAP = 1500`** in `aiphabi_hint.lua` (first filter in the chain) — simply stops
        pulling from upstream after 1,500 raw candidates. Everything downstream (`fuzzy`,
        `order[_plus]`) then only ever sees ≤1,500 candidates for free, without needing its own
        cap. This is a real, disclosed trade-off, not just a quality cap: candidates past 1,500
        genuinely never appear for a single-letter query — acceptable because page_size is 8–10
        (1,500 is triple-digit pages deep) and typing one more code letter shrinks the raw
        stream far below the cap anyway (Wilson's own stated usage pattern).
     2. **`MAX_SORT = 40`** in both order filters — of what survives `RAW_CAP`, only the first
        40 get a real `table.sort`; the rest are appended in upstream (dict-weight) order.
     3. **Userfreq/pick-history candidates bypass `MAX_SORT`** (but not `RAW_CAP`) — split into
        a separately-and-always-sorted `boosted` bucket in `aiphabi_order.lua` (keyed off
        `USERFREQ`, small — bounded by *this user's* distinct picks, not dict size);
        `aiphabi_order_plus.lua` already had this for free via its `top` bucket
        (`PROMOTE_MIN`), untouched. A character you pick a lot but that starts beyond
        `RAW_CAP` in the *raw* stream is the one narrow edge case this doesn't cover — accepted
        as unlikely (personal pick frequency and static dict weight correlate for nearly
        everything) rather than adding cross-module state sharing to close it.
     Also fixed in the same pass: `aiphabi_fuzzy.lua` was draining-and-yielding the full stream
     *before* checking whether fuzzy matching even applies (only meaningful at code length ≥2)
     — pure wasted work for the exact single-letter case this was all about.
     `tests/run_tests.lua`'s perf group asserts all three layers are active (a candidate past
     `RAW_CAP` must be absent entirely; one past `MAX_SORT` but within `RAW_CAP` must survive
     but not be pulled to top; a boosted one must reach the top regardless) — mutation-tested,
     each assertion goes red if its layer is removed.
  4. **part** — coverage-demoted fragments (a candidate that doesn't span the whole segment,
     e.g. 民 covering only the tail of YCLX) sinks to the bottom. **Coverage is span-based**
     (`[min start, max _end]` over candidates); needed because `enable_sentence` spits out
     prefix/suffix fragments. `segStart = min(c.start)`, code extracted from that segment (not
     the whole `context.input`, which with sentence mode is the full composition).
- **`aiphabi_hint.lua`** — attaches hints to candidates: 同類字, 偏旁碼, 打繁出簡/打簡出繁, and the
  reverse-hint trio that all follow the same "you typed the long way, here's the short way"
  pattern — **簡碼** (`shortcode_rev`), **左簡碼** (`leftshort_rev`), and **四碼快打**
  (`si4_rev`, added 2026-08-15). Also **generates the 四碼快打 candidates** from `data.si4` (not
  in the dict): `#code==4` exact → `ap_si4` (exact tier), 3-prefix → `ap_pool` (完成/墊底).
  Gated on phrase being on. `si4_rev` only fires when the 4-code path is genuinely shorter than
  every normal way to type the word (`main`/`simp`/`t3` modes) — no point whispering a code that
  doesn't save keys.
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
| `標籤 碼` — **no brackets** | a code you could **type instead**, shorter than what you just typed | type `JKXQ` → 我 `簡碼 JKQ`; type a phrase's full code → `四碼 XXXX` |
| `[ 碼 ]` — **square brackets** | a 容錯 guess (`aiphabi_fuzzy` only) — deliberately distinct so a guess can never read as a reference | type `JKQ` → 不 `[ JQ ]` |

The label never repeats the word 主碼: the brackets already mean that, so the label slot is spent
on the route instead (簡碼 / 三簡 / 左簡 / 四碼 / 偏旁碼 / 同類 / 兼容). `- XX` is the odd one out and
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

## C · 公開網站 (Side C)

The public-facing site that introduces AiPhaBi to strangers. Scaffolded 2026-08-17 by Side A as a
one-time bootstrap (Side C did not exist yet to build its own folder); **everything under `site/`
is Side C's from now on**, and the guard enforces it.

### Where it lives and how it ships

| | |
|---|---|
| Source | `site/` — hand-written HTML/CSS/JS, no toolchain, no `node_modules` |
| Deploy | `.github/workflows/pages.yml` → GitHub Pages, on every push to `main` that touches `site/**` or the data the site is generated from |
| URL | `https://wilsongrchan.github.io/AiPhaBi/` |
| Language | 繁體中文 written once; 简体 converted **in the browser** from `assets/t2s.json` |

**One manual step, done once on github.com:** *Settings → Pages → Build and deployment → Source*
must be **GitHub Actions**. The workflow cannot set this itself and its deploy step fails without it.

**It is a project site, so everything is served under `/AiPhaBi/`.** Every link and asset path in
`site/` must be **relative** (`assets/site.css`, `design.html`). An absolute path (`/assets/…`)
works in local preview and 404s in production — the worst kind of bug to ship.

### The generated files (this is the important part)

`site/assets/dict.json`, `t2s.json`, `zigen.json`, `glyphs.json`, `principles.json`, and
`jianma.json` are all **generated and gitignored** (the same reasoning as the first two, below):

```bash
python3 site/tools/build_site_data.py       # 本機預覽前先跑一次
python3 -m http.server 8099 --directory site
```

The workflow reruns it right before deploy, so the published site always matches `main`'s
`data/codes.json`. **They are gitignored on purpose:** a committed copy is a second code table
living in the repo, and "the website types differently from the IME" is close to undiscoverable.

`build_site_data.py` reads Side A's and Side B's data and writes **only** into `site/assets/`.
Its `shorten()` is a copy of `build_rime.py:36` — **if the cap rule ever changes, both must change**,
or the demo starts lying. It emits:

| key | what |
|---|---|
| `codes` | 碼 → 候選字串, frequency-ordered; 主碼 + 完整碼 + 兼容碼, honouring `display` |
| `short` / `short_rev` | 約定簡碼 both directions — drives the 「簡碼 JKQ」 whisper |
| `stats` | `chars`, `tw4808`, `gb2312`, `clash` — every number the site prints |

`stats` exists so **no number is ever hand-typed into the HTML**. The pages carry a stale fallback
value inline (so they read correctly without JS) and `site.js` overwrites it from `dict.json`.

### What is built and what is not

Built and verified: five pages (`index.html` 簡介, `zigen.html` 字根表, `principles.html`
取碼原則, `jianma.html` 簡碼, `try.html` 線上試打), the shared shell (side nav, 繁簡 toggle,
字級 small/normal/large — the last two are site-wide via `site.js`, not per-page), the deploy
workflow, the generator, and a working 試打 demo — 主碼/完整碼/兼容碼 lookup, prefix completion,
frequency ordering, 約定簡碼 with the reverse hint, digit/space selection, 正體 punctuation.

`jianma.html` (2026-08-21) is a plain reference page for the three code-shortening mechanisms —
no stroke diagrams, just tables, per Wilson's call to keep this one auto-generated-only rather than
full explanatory prose. `build_jianma()` in `build_site_data.py` derives all three straight from
`data/rules.json` + `data/codes.json`: 約定簡碼 lists all 63 hand-picked `short_code` entries with
their real 主碼; 三簡碼 has no fixed list (it's a blanket rule over any 主碼 ≥4 字, `code[0]+code[1]
+code[-1]`) so the page just demos 5 picked chars (`SHORT3_DEMO_CHARS`, deliberately none from the
63 約定簡碼 list, to avoid the two mechanisms reading as one) plus a live-counted eligible total;
左簡碼 reproduces the 8 component families straight from `rules.json`'s `left_short.entries`
(comp/code/short/ok/no/members), which is Wilson's own vetted table, not computed. The page states
plainly that 左簡碼 is design-only, not shipped — see below.

`zigen.html` also carries a 相近字形辨析 section (from `content/similar.md`, hand-written) and
`principles.html` is new (2026-08-21): the nine 取碼原則 with worked examples. Both pages can
render a "正確 vs 錯誤拆法" colour diagram per example — each stroke-group gets one of six
rainbow colours (`--rb-0`…`--rb-5`, deliberately skipping orange: red/orange/yellow read as one
blur at small icon sizes) plus a background-coloured stroke outline so adjacent same-colour
strokes still separate. The "correct" side is always derived from `data/codes.json` at build time
(never hand-typed); the "wrong" side is authored by hand in `build_site_data.py`
(`WRONG_BREAKDOWN` for `zigen.html`, `PRINCIPLE_WRONG` for `principles.html`) **only** when there's
a real basis for the stroke split — either Wilson states it directly, or it's the unique remainder
once the known groups are subtracted, or it matches an actual shape already catalogued under that
letter in `zigen.json`. Where none of those held, the page shows the wrong code as plain text with
no diagram rather than guessing a stroke split.

**Not usable in the 試打 demo** (it must keep saying so there): 三簡碼, 左簡碼, 詞組連打, 四碼快打,
輸入容錯, 萬用鍵 `` ` ``, 同類字, 偏旁碼, 智能分詞 — typing those codes in `try.html` still won't
resolve. 三簡碼 and 左簡碼 now have *reference tables* on `jianma.html` (rules + real data), which is
a different claim from "usable here" — 三簡碼 actually ships in `rime/` behind a default-off switch
(`aiphabi_short3`), 左簡碼 does not ship anywhere yet (`rules.json`'s own note says so; it's a
Side B build task). Neither is wired into the `try.html` lookup regardless. Also not built: the
下載安裝 page (Wilson deferred it — the site currently points at GitHub instead).

### Copy

`site/content/blurb.md` is Wilson's own text, fetched verbatim from his Google Doc on 2026-08-17,
plus a **fact-check table**. Use its voice — it is the outward-facing register, where this file is
the inward-facing one. Two things it records that matter:

- Its numbers hold up (重碼率 4.5% → measured 4.4%; 「近五萬詞組」 → actually 100,856 multi-char
  entries, so it understates).
- **Verify codes against `rime/aiphabi.dict.yaml`, not by reassembling `codes.json` yourself.**
  The blurb's 香港 ＝ `JTBWHZ` looks wrong if you concatenate main codes (香 `JTB` ＋ 港 `WHVZ`
  ＝ `JTBWHVZ`) — and it is not wrong: `_word_codes` (`build_rime.py:363`) emits **every
  combination of each character's 簡碼-or-主碼**, so 港's 三簡碼 `WHZ` puts `jtbwhz` in the dict
  too. Both spellings ship. Side A got this wrong once during the bootstrap by reasoning instead
  of grepping the dict.
- Codes do genuinely get revised (福 `QMIOOT`→`QMOOT`), so any code printed on the site still has
  to be generated or re-checked against the shipped dict at the moment it is written.

Its 取碼原則 section was left unfinished in the source doc (stroke-order references were still
`XXX`) — Wilson gave the complete nine-principle text directly in chat instead on 2026-08-21,
now built into `principles.html`. `blurb.md` points at that page rather than re-quoting it.

### Reference sites (content, not visual)

Wilson's picks for *what a 形碼 site conventionally covers* — he notes they are "kinda ugly", so
read them for information architecture only: <http://xumax.cn> (徐碼),
<https://boshiamy.com/tutorial_why.php> (嘸蝦米's "why" page — the direct foil; the 無理碼 argument
in *Quickcode conventions* below is aimed squarely at it), <https://www.ckcsys.com> (縱橫碼).

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
- **`alts`（兼容碼）are scanned too, not just the main code.** Fixed 2026-08-16 (`cca07ff`) after
  a Side-A bug report (`左簡碼_alts未涵蓋.md`, since resolved and removed) found 9 of the 249
  members had a compatible alt code that never got its own 左簡碼 — the generator used to read
  only `codes[ch]["code"]`. 2 of those 9 (餵, 轄) end up with the *same* signature for their main
  code and their alt once the remainder gets capped past 3 codes — expected, not a regression.

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

### 左簡碼 — the 偏旁 layer (spec'd + curated by Side A; **shipped** — `build_rime.py` + `aiphabi_hint.lua`)

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
- **2-char phrases** get the cartesian of {short, main, *alts*} × {short, main, *alts*} for the
  two chars — not just {short, main} (fixed 2026-08-24, see the alts box below).
- **3+ char phrases** use four uniform modes (main / 簡碼-preferred / 三簡碼-preferred / *alt*) to
  avoid combinatorial explosion — "alt" substitutes each character's first 兼容碼 where it has one,
  main code otherwise, applied uniformly per character (not a per-word cartesian product).
- **四碼快打 (`data.si4`, generated in `build_rime.py`, not in dict):** a 4-key shortcut for
  longer phrases. 3-char → 首首首末; 4-char → 4×首碼; **5+ char → both first-4 AND first-3+last**
  registered (first-4 = partial-recall friendly; first-3+last = better disambiguation on shared
  prefixes like 中國人民X). Exact 4-code → `ap_si4` (ranks as exact); 3-prefix → `ap_pool` (墊底).
  Each position also tries its character's alt-code letter if it differs from the main one
  (one position substituted at a time, not a cartesian product across positions — see below).

> **`alts`（兼容碼）were invisible to 詞組連打 / 四碼快打 until 2026-08-24 — same class of bug as
> the 左簡碼 one (`cca07ff`, 2026-08-16), just never audited here.** `char2code`, the table both
> generators read from, was built from `rec["code"]` only; `rec.get("alts", [])` was never
> consulted. A user whose mental breakdown of a character matches its *alt* segmentation (not its
> 主碼) got no phrase-level shortcut across that character — they could still type the phrase by
> spelling every character out in full (each character's dict entry always includes its alt code,
> `alts` are full citizens there), but not via the compressed 詞組連打/四碼快打 path.
>
> Measured before fixing: 317 characters carry `alts`; 451 of 4050 curated `phrases_*.txt` words
> (11%) contain one. Of those, 56 alts differ from their character's main code in the **first**
> letter — the one that matters for 四碼快打 — affecting 116 of 2711 si4-eligible curated words,
> including common ones: 臺北市, 高雄市, 上海市, 京都大學, 忠孝敦化.
>
> Fix: `char_alt_codes` (built once, alongside `char2code`) holds each character's alt codes,
> shortened and de-duplicated against its main code. Phrase generation's 2-char cartesian and
> 3+-char "alt" mode both draw on it (`_char_options`/`_pcode`); si4 generation draws on it through
> `_si4_signatures`, which substitutes **one position's letter at a time** rather than taking the
> full cartesian product across positions — bounded growth (only 12 characters carry more than one
> alt, worst case 3), consistent with the project's existing "avoid combinatorial explosion" stance
> for 3+-char phrase modes. Build now prints how many phrase/si4 words picked up an alt path
> (`含兼容碼路徑的詞 N 個`), so a future gap of this kind is visible in the build log, not silent.
- **Reverse hint (`data.si4_rev`, added 2026-08-15):** word → its 4-code, registered only when
  that's genuinely shorter than every normal typing mode for the word (`main`/`simp`/`t3`).
  Typing a phrase the normal 詞組連打 way and getting it back as an ordinary candidate now appends
  `四碼 XXXX` — same pattern as the 簡碼/左簡碼 reverse hints. 5+ char words register only the
  first-4 variant (most memorable — "just remember the opening"); the first-3+last variant is
  left unhinted so the hint doesn't have to choose which one to show.
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

- **`data/freq.json`** — single-char frequency. **Tracked in git** (it is a build input; see
  hazard 4). Regenerated by `fetch_data.py`, but a re-run must then be committed, or the machine
  that ran it silently builds a different weight column from everyone else. Blended ordering = `0.55 × word-appearance-percentile + 0.45 ×
  single-char-percentile`. The blend logic lives *inside* `fetch_data.py` so it's reproducible.
- `fetch_data.py` downloads the ~30 MB glyph/frequency source data (licensed separately, not in
  git). Run once per machine, before `server.py` — it is **step 5** of *Starting a new session*.

---

## Current state — built vs in progress

### A · Designer side
- ✅ Zigen learning + reverse prediction pipeline (`zigen.json` ↔ `codes.json`, midline matching).
- ✅ 6847 characters coded (`codes.json`, 2026-08-24). Against the official lists (see
  *取碼目標：官方字表*): **教育部常用國字 4808 / 4808 = 100%** — done, closed out this session
  (was 99.1%/45 left as of 2026-08-21). **GB 2312 4755 / 6763 = 70.3%** (2008 left, now the only
  remaining job). Quote those, not the raw total.
- ✅ Enforced rules engine (stroke order, merge-over-split, isolated-stroke skip, cap-5, tiers,
  enclosure).
- ✅ Annotation / rules / 簡碼 / 字根表 / progress / stats / variants tools.
- ✅ 簡碼 split onto its own page (`/short`), with the two-page save merge in `assets/rulesio.js`.
- ✅ 左簡碼 **spec'd and curated on the A side**: 8 偏旁, 249 reviewed members, 6 conditions,
  collision numbers live on `/short`. Handoff spec is in commit `d84e690`.
- ✅ **Zigen consolidation, ongoing**: 418 → 363 shapes across 109 取形意圖, as of 2026-08-24
  (re-sourcing to simpler representative characters + merging duplicate clusters + folding
  near-duplicate auto shapes into existing ones as `alts`). Every 取形意圖 with real shapes now has
  a description. See *Zigen curation tools* below for the three generators driving this.
- 🔄 Ongoing: keep coding toward GB 2312 (2008 left — the only remaining job now that 教育部常用
  國字 甲表 is fully coded). The `/annotate` 未取碼 queue sorts by those tables directly
  (**國字表 / GB表**, replacing the old 字頻／新聞／簡體 buttons; 姓名／地名／連綿詞 kept), so
  working top-down *is* working down the official list. `data/todo_chars.txt` is the older
  frequency-ordered queue and its header counts are stale; `/progress` is the authority. Also:
  refine tiers/groups; `kind:"manual"` rules not yet enforced.
- ⏳ Waiting on Side B: 左簡碼 has no IME implementation yet. Nothing else is blocked on it.

### Zigen curation tools (`tools/*.py`, Side A only — need `data/graphics.txt`)

Three generators produce **review lists, never auto-applied changes**. Each measures against the
real glyph geometry (median matching, same as `retune.py`) so a candidate is never just "looks
similar" — but "geometrically close" still isn't the same as "good judgement", so all three stop at
generating a shortlist. Wilson (or a session acting on his explicit picks) chooses; the tool only
narrows 350+ zigen down to a few dozen worth a human look.

| tool | output | finds |
|---|---|---|
| `tools/辨析候選.py` | `字根辨析候選.md` | cross-letter pairs from `meta.distinct` worth explaining to a reader (feeds Side C's 相近字形辨析) — excludes same-letter pairs (no code difference, no reader-visible confusion) and ranks example characters 甲表 > non-甲表 variant > simplified-only, since `freq.json` doesn't distinguish variants from standard forms (衆 outranks 眾 611 vs 4759) |
| `tools/簡化候選.py` | `字根簡化候選.md` | zigen whose representative character is more complex than an already-matching example (資→目, 把→巴 style) — stroke count alone can't judge "reads as natural", so this is candidates only |
| `tools/合併候選.py` | `字根合併候選.md` | same-intention same-stroke-count shape pairs that may really be one shape, split into 乾淨 (distance passes both shapes' own thresholds) and 臨界 (passes only the looser one — a tight threshold with no `meta.distinct` entry isn't necessarily accidental, since `editor.html:1013-1021` lets a threshold be hand-set with no adjudication record) |

Re-run whichever is relevant after any zigen restructure; all three are cheap (seconds) and their
`.md` outputs are committed so anyone can read the current shortlist without running Python.

### A correction worth keeping in mind: `AiPhaBi-C`'s branch name is misleading

`git worktree add -b side-c ../AiPhaBi-C origin/main` (setup step 2) means the branch is *called*
`side-c`, but per step 3 it **tracks `origin/main`** — same mechanism as `side-b`. A bare `git push`
from the `AiPhaBi-C` folder lands directly on `main`, with no merge step and no PR. This is not a
bug; it's documented at setup time (line 35 above). But it bit this project once (2026-08-20–21):
many Side C status updates said things like "18 commits on `side-c`, `main` untouched, Pages
disabled" as if that were a stable, reviewable state — until Wilson ran a plain `git push` from that
folder and all of it landed on `main` in one step, `origin/side-c` and `origin/main` now pointing at
the identical commit. Nothing was lost (Pages was independently confirmed still disabled via the
API), but **don't read "N commits on side-c" as "not on main yet"** — it can become the same thing
the moment anyone in that folder pushes.

### B · User side
- ✅ Two macOS schemas (pure `aiphabi` + `aiphabi_plus` with F4 pinyin toggle), installed via
  `./sync.sh`.
- ✅ Quickcode stack: 60 hand-picked 簡碼, auto 三簡碼, 左簡碼 (8 偏旁 families, 299 members as of
  2026-08-16), all three with toggles + reserved main codes + reverse hints — see *Candidate-bar
  filters* and *Candidate comment convention*.
- ✅ Candidate reorder filters (pure + plus, kept in sync): 簡碼 > exact/四碼/左簡碼 > pool >
  coverage-demoted part; userfreq boosting; completion & cold-reading penalties; span-based
  coverage gating.
- ✅ 詞組連打: ~40k+ curated phrases across 10 themed files; 2-char cartesian; 3+ uniform modes;
  四碼快打 (first-4 + first-3+last for 5+, plus a reverse hint `si4_rev` since 2026-08-15);
  `enable_sentence` segmentation.
- ✅ 容錯 (fuzzy), 萬用鍵 `` ` ``, 打繁出簡/打簡出繁, 偏旁碼/同類字 hints.
- ✅ iOS (Hamster) working; dict weights sane for the no-lua path; mobile pulls phrase data + 4-code
  logic from repo.
- ✅ Offline test harness (`tests/run_tests.lua` + `harness.lua`) runs the real filter files against
  the real generated `aiphabi_data.lua` — see *Testing the candidate bar offline*.
- ✅ Fixed 2026-08-16: 左簡碼 generation was reading only each member's main code and silently
  ignoring `alts` — 9 of 249 members had a compatible alt code with no shortcut of its own
  (`cca07ff`; bug report `左簡碼_alts未涵蓋.md` from Side A, now resolved and removed).
- ✅ Fixed 2026-08-24: 詞組連打 / 四碼快打 had the *same* class of bug — see the alts box under
  *Phrase input (詞組連打) & 四碼快打* above. Caught from a Side B hunch, not a bug report.
- 🔄 Ongoing: expand phrase庫; ordering edge-cases as they surface (each fix must land in BOTH
  order filters). Current build: 6820 字, 8950 碼, 499 重碼組 (as of 2026-08-24).

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
- **`shortcode_rev` / `leftshort_rev` / `si4_rev`** each drive one reverse hint (簡碼 / 左簡碼 /
  四碼快打); **`shortcode` / `leftshort` / `si4`** drive the matching forward lookup.
- Two order filters (`aiphabi_order.lua` + `aiphabi_order_plus.lua`) — **sync every fix**.
- Deploy = **`./sync.sh "<msg>"`** only. `fetch_data.py` for third-party data (gitignored outputs).
- `` ` `` is the wildcard *key* while typing (`aiphabi_wildcard.lua`). There is no wildcard
  *letter* in the alphabet — `Z` is a normal, populated letter (辶-shaped radicals) like any
  other. An early design reserved `Z` as a wildcard, but that was superseded by the `` ` `` key;
  the leftover `meta.wildcard_key: "Z"` field in `zigen.json` wasn't read by any tool on either
  side, and has been removed (Side A, since it's their file).
