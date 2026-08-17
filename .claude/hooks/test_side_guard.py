#!/usr/bin/env python3
"""Exercise side-guard.py as a subprocess, exactly as Claude Code invokes it.

Cases live in this file rather than on a command line, because the guard inspects
command *strings* — a shell harness would trip on its own test data.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile

# Derived from this file's own location (<root>/.claude/hooks/), never hardcoded — the suite
# must keep working if the folder is renamed and must run in either worktree.
ROOT = pathlib.Path(__file__).resolve().parents[2]
GUARD = ROOT / ".claude" / "hooks" / "side-guard.py"

D = "data/codes.json"
Z = "data/zigen.json"
R = "data/rules.json"

BLOCK, ALLOW = 2, 0


# "Undeclared" cannot be tested from the real repo — it has a marker file, and the guard
# reads it whenever $AIPHABI_SIDE is absent. Undeclared cases get a marker-free root.
NOMARK = pathlib.Path(tempfile.mkdtemp(prefix="sideguard-nomark-"))
(NOMARK / "data").mkdir(exist_ok=True)


def run(side, tool, payload_input, root=None):
    root = root or (NOMARK if side == "" else ROOT)
    env = dict(os.environ)
    env.pop("AIPHABI_SIDE", None)
    if side:
        env["AIPHABI_SIDE"] = side
    env["CLAUDE_PROJECT_DIR"] = str(root)
    p = subprocess.run(
        [sys.executable, str(GUARD)],
        input=json.dumps({"tool_name": tool, "tool_input": payload_input}),
        capture_output=True, text=True, env=env,
    )
    return p.returncode


def bash(side, cmd):
    return run(side, "Bash", {"command": cmd})


def edit(side, path):
    root = NOMARK if side == "" else ROOT
    return run(side, "Edit", {"file_path": str(root / path)}, root=root)


# (label, want, callable)
CASES = [
    # --- Bash: writes to protected data files ---
    ("B: sed -i on codes",        BLOCK, lambda: bash("B", f"sed -i '' 's/x/y/' {D}")),
    ("B: redirect over codes",    BLOCK, lambda: bash("B", f"echo '{{}}' > {D}")),
    ("B: append to zigen",        BLOCK, lambda: bash("B", f"cat /tmp/n.json >> {Z}")),
    ("B: cp onto rules",          BLOCK, lambda: bash("B", f"cp /tmp/x.json {R}")),
    ("B: tee into codes",         BLOCK, lambda: bash("B", f"tee {D} < /tmp/x")),
    ("B: git checkout zigen",     BLOCK, lambda: bash("B", f"git checkout -- {Z}")),
    ("B: rm codes",               BLOCK, lambda: bash("B", f"rm -f {D}")),
    ("B: python open w",          BLOCK, lambda: bash("B", f"python3 -c \"open('{D}','w')\"")),
    ("B: jq --in-place",          BLOCK, lambda: bash("B", f"jq -i '.' {Z}")),
    ("B: truncate codes",         BLOCK, lambda: bash("B", f"truncate -s 0 {D}")),
    ("undeclared: sed -i",        BLOCK, lambda: bash("", f"sed -i '' 's/x/y/' {D}")),
    ("A: sed -i allowed",         ALLOW, lambda: bash("A", f"sed -i '' 's/x/y/' {D}")),
    ("A: redirect allowed",       ALLOW, lambda: bash("A", f"echo '{{}}' > {D}")),

    # --- Bash: reads must stay allowed for everyone ---
    ("B: cat codes",              ALLOW, lambda: bash("B", f"cat {D} | head")),
    ("B: python json.load",       ALLOW, lambda: bash("B", f"python3 -c \"import json;json.load(open('{D}'))\"")),
    ("B: git show to tmp",        ALLOW, lambda: bash("B", f"git show HEAD:{D} > /tmp/o.json")),
    ("B: grep zigen",             ALLOW, lambda: bash("B", f"grep -c final {Z}")),
    ("B: jq read",                ALLOW, lambda: bash("B", f"jq '.meta' {Z}")),
    ("B: wc -l rules",            ALLOW, lambda: bash("B", f"wc -l {R}")),
    ("B: diff two snapshots",     ALLOW, lambda: bash("B", f"diff /tmp/a.json {D}")),

    # --- Bash: build / deploy is Side B's alone ---
    ("A: ./sync.sh",              BLOCK, lambda: bash("A", "./sync.sh 'msg'")),
    ("A: python3 build_rime",     BLOCK, lambda: bash("A", "python3 build_rime.py --install")),
    ("A: bash -n sync.sh",        BLOCK, lambda: bash("A", "bash -n sync.sh")),
    ("undeclared: ./sync.sh",     BLOCK, lambda: bash("", "./sync.sh")),
    ("B: ./sync.sh allowed",      ALLOW, lambda: bash("B", "./sync.sh 'deploy'")),
    ("B: build_rime allowed",     ALLOW, lambda: bash("B", "python3 build_rime.py --install")),

    # --- false-positive guards ---
    ("A: heredoc naming build",   ALLOW, lambda: bash("A", "git commit -F- <<'EOF'\nfix\n\nrun build_rime.py later\n./sync.sh too\nEOF")),
    ("B: heredoc naming codes",   ALLOW, lambda: bash("B", "git commit -F- <<'EOF'\nnote\n\nedited data/codes.json by hand\nEOF")),
    ("B: grep for the word",      ALLOW, lambda: bash("B", "grep -rn 'build_rime.py' PROJECT_NOTES.md")),
    ("B: echo mentioning file",   ALLOW, lambda: bash("B", "echo 'see data/codes.json for detail'")),

    # --- file tools (regression: must still work) ---
    ("B: Edit codes",             BLOCK, lambda: edit("B", "data/codes.json")),
    ("undeclared: Edit zigen",    BLOCK, lambda: edit("", "data/zigen.json")),
    ("A: Edit codes",             ALLOW, lambda: edit("A", "data/codes.json")),
    ("B: Edit rime dict",         ALLOW, lambda: edit("B", "rime/aiphabi.dict.yaml")),
    ("B: Edit notes",             ALLOW, lambda: edit("B", "PROJECT_NOTES.md")),

    # --- Side C: the public site is C's, and C is not entitled to A's or B's work ---
    ("C: Edit codes",             BLOCK, lambda: edit("C", "data/codes.json")),
    ("C: sed -i on zigen",        BLOCK, lambda: bash("C", f"sed -i '' 's/x/y/' {Z}")),
    ("C: ./sync.sh",              BLOCK, lambda: bash("C", "./sync.sh 'deploy'")),
    ("C: build_rime",             BLOCK, lambda: bash("C", "python3 build_rime.py --install")),
    ("C: read codes",             ALLOW, lambda: bash("C", f"cat {D} | head")),
    ("C: Edit site page",         ALLOW, lambda: edit("C", "site/index.html")),
    ("C: redirect into site",     ALLOW, lambda: bash("C", "echo hi > site/index.html")),

    # --- site/** is C's alone ---
    ("A: Edit site page",         BLOCK, lambda: edit("A", "site/index.html")),
    ("B: Edit site css",          BLOCK, lambda: edit("B", "site/assets/site.css")),
    ("undeclared: Edit site",     BLOCK, lambda: edit("", "site/index.html")),
    ("A: redirect into site",     BLOCK, lambda: bash("A", "echo x > site/index.html")),
    ("A: rm under site",          BLOCK, lambda: bash("A", "rm -f site/try.html")),
    ("B: cp onto site asset",     BLOCK, lambda: bash("B", "cp /tmp/x.css site/assets/site.css")),
    ("A: sed -i under site",      BLOCK, lambda: bash("A", "sed -i '' 's/x/y/' site/index.html")),

    # site false positives: reading, and the generator naming a site path
    ("A: cat site page",          ALLOW, lambda: bash("A", "cat site/index.html")),
    ("A: grep under site",        ALLOW, lambda: bash("A", "grep -rn todo site/")),
    ("A: ls site",                ALLOW, lambda: bash("A", "ls -A site/assets")),
    ("A: git add site",           ALLOW, lambda: bash("A", "git add site/ && git status")),
    ("A: run the generator",      ALLOW, lambda: bash("A", "python3 site/tools/build_site_data.py")),
    ("A: heredoc naming site",    ALLOW, lambda: bash("A", "git commit -F- <<'EOF'\nsite\n\nedited site/index.html\nEOF")),

    # --- robustness ---
    ("B: empty command",          ALLOW, lambda: bash("B", "")),
    ("B: unbalanced quote",       ALLOW, lambda: bash("B", "echo 'unclosed")),
]


def main():
    fails = []
    for label, want, fn in CASES:
        got = fn()
        ok = got == want
        if not ok:
            fails.append(label)
        print(f"  {'ok  ' if ok else 'FAIL'} {'BLOCK' if got == BLOCK else 'allow':5}"
              f" (want {'BLOCK' if want == BLOCK else 'allow'})  {label}")
    print(f"\n{len(CASES) - len(fails)}/{len(CASES)} passed")
    if fails:
        print("FAILED: " + ", ".join(fails))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
