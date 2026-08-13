# 愛發筆 AiPhaBi — read this before your first edit

**Start every session with:**

```bash
cat .aiphabi-side 2>/dev/null || echo "NO SIDE DECLARED — ask which side before editing"
git fetch origin && git status -sb
```

`.aiphabi-side` (gitignored, per-checkout) says whether this checkout is **A** or **B**. It also
drives the `PreToolUse` guard in `.claude/hooks/side-guard.py`, which hard-blocks a Side B session
from writing `codes.json` / `zigen.json` / `rules.json`. **If the file is missing the guard fails
open and nothing is enforced** — full setup steps are in `PROJECT_NOTES.md` §
*Starting a new session*.

Then read **`PROJECT_NOTES.md`** — it is the working reference for this repo (data formats,
the two sub-ecosystems, coding rules, quickcode conventions, known hazards). Do it before the
first edit, not mid-task.

## This repo is worked on by two parallel sessions

They share one working tree and one `main` branch, so **ownership is by file, not by intent**.
Figure out which side you are on before touching anything:

| | **Side A · 字根/取碼** | **Side B · IME/候選** |
|---|---|---|
| Owns | `data/codes.json`, `data/zigen.json`, `data/rules.json`, `data/todo_chars.txt`, `server.py` + the pages it serves | `rime/**`, `build_rime.py`, `sync.sh`, `data/phrases_*.txt` |

## Hard rules — no exceptions

Full text and the reasoning behind each is in `PROJECT_NOTES.md` § *File ownership across parallel
sessions*. "It was obviously correct", "it was only bookkeeping", and "it needed a rebuild anyway"
are **not** exemptions.

1. **Side A owns `codes.json`, `zigen.json`, `rules.json`.** Side B **never opens these in write
   mode — ever, for any reason.** Not a one-character fix, not a count bump. Side B reads them
   freely and *reports* problems; the fix lands in Side A.

2. **Side B owns `rime/**` and the build that produces it.** Side A **never runs `build_rime.py`,
   never runs `./sync.sh`, never edits anything under `rime/`** — including after its own data
   edits, and including when a rebuild is plainly needed. Side A commits its data change with
   **`rebuild needed`** in the commit message; Side B picks it up. A stale IME is harmless and
   temporary; a rebuild from the wrong session silently desyncs the other session's installed copy.

3. **Every session starts with `git fetch` + `git status`** (above), before the first edit.
   If `git status` shows changes outside your own scope, say so before doing anything else.

## Two traps worth knowing on day one

- **`./sync.sh` runs `git add -A`.** It stages the *entire* working tree, not just `rime/`, so a
  Side-B deploy sweeps up any uncommitted Side-A work. Commit before the other session deploys.
- **A live annotation server may be writing `data/*.json` underneath you** (`server.py` on :8777).
  Writing to those files from the shell makes an open browser tab fail its next save with a 409.
  `git` reads and commits are safe — they do not touch the working file.
