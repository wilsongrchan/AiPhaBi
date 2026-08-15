#!/usr/bin/env python3
"""PreToolUse guard: keep each side out of the other side's files.

Which side this checkout is cannot come from the conversation — the hook is a separate
process and never sees it. It comes from, in order of precedence:

    1. $AIPHABI_SIDE
    2. the .aiphabi-side file at the repo root (gitignored, one letter: A or B)

**Fails closed.** Each protection unlocks only on an explicit, correct marker; "B", "A",
missing and unrecognised all block the thing they are not entitled to:

    data/{codes,zigen,rules}.json  writable only when side == A   (hand-authored, irreplaceable)
    build_rime.py / sync.sh        runnable only when side == B   (Side B owns the build)

The marker is re-read on every invocation, so `echo A > .aiphabi-side` takes effect on the very
next tool call — no session restart needed. (Restart is only needed if the hook *registration*
in .claude/settings.json changes; that part is snapshotted at session start.)

rime/ itself is deliberately NOT guarded — it is regenerable, so a wrong-side edit there is
annoying rather than costly.

Two tool shapes are inspected:
  * Write/Edit/MultiEdit/NotebookEdit — exact path match on tool_input.file_path. Reliable.
  * Bash — heuristic inspection of tool_input.command. Best-effort by nature: it classifies
    argv0 per command segment and looks for redirects into a protected file. Reads are
    deliberately left alone (Side B reads these files freely), so only recognised *mutating*
    forms are blocked. A determined bypass is always possible; this catches the accident.

Contract: exit 0 allows the tool call, exit 2 blocks it and returns stderr to Claude.
A malformed payload exits 0 — the guard must not wedge the session on calls it cannot parse —
but an unreadable *side marker* counts as undeclared, and so blocks.
"""
import json
import os
import pathlib
import re
import shlex
import sys

PROTECTED = {
    "data/codes.json",
    "data/zigen.json",
    "data/rules.json",
}

# Matches the protected data files as they appear inside a shell command.
PROTECTED_IN_CMD = re.compile(r"(?:\./)?(?:data/)?(codes|zigen|rules)\.json\b")

# Redirection whose *target* is a protected file:  > data/codes.json   >>codes.json
REDIRECT_TO_PROTECTED = re.compile(
    r">>?\s*[\"']?(?:\./)?(?:data/)?(?:codes|zigen|rules)\.json\b"
)

# argv0 values that mutate a file named in their arguments.
MUTATORS = {
    "tee", "mv", "cp", "rm", "truncate", "install", "dd", "sponge",
    "shred", "chmod", "chown", "touch", "ln", "split", "patch",
}
# git subcommands that overwrite working-tree files
GIT_MUTATING_SUBCMDS = {"checkout", "restore", "clean", "apply", "stash"}

BUILD_SCRIPTS = ("build_rime.py", "sync.sh")

MSG_DATA_B = """\
BLOCKED by .claude/hooks/side-guard.py — this checkout is declared **Side B** (.aiphabi-side).

  {what}

is owned by Side A (字根/取碼) and is strictly read-only for Side B. No exceptions — not a
one-character fix, not a count bump. See PROJECT_NOTES.md -> "Hard rules — no exceptions".

Reading is fine; only writes are blocked. Report the problem so it can be fixed in a Side A
session. Do not route around this with another tool.
"""

MSG_DATA_UNDECLARED = """\
BLOCKED by .claude/hooks/side-guard.py — this checkout has **no side declared**{found}.

  {what}

is a Side A (字根/取碼) data file, and the guard fails closed. Declare the side at the repo root:

    echo A > .aiphabi-side     # 字根/取碼 — may write these files
    echo B > .aiphabi-side     # IME/候選  — may not

Takes effect on the next tool call; no session restart needed. See PROJECT_NOTES.md ->
"Starting a new session".
"""

MSG_BUILD = """\
BLOCKED by .claude/hooks/side-guard.py — running the code-table build is Side B's job{whose}.

  {what}

Side A never runs `build_rime.py` and never runs `./sync.sh`, even right after its own data
edits and even when a rebuild is plainly needed — a rebuild from the wrong session silently
desyncs the other session's installed ~/Library/Rime. See PROJECT_NOTES.md -> "Hard rules".

What to do instead: commit the data change with `[rebuild]` starting the subject line —

    git commit -m "[rebuild] <what changed>"

— and stop there. Side B picks it up and rebuilds. A stale IME is temporary and harmless.
(Tag only if the commit touches codes.json / rules.json; zigen.json is not a build input.)
"""


def resolve_side(root: pathlib.Path) -> str:
    """Return "A", "B", or "" (undeclared / unreadable / unrecognised)."""
    side = os.environ.get("AIPHABI_SIDE", "").strip()
    if not side:
        marker = root / ".aiphabi-side"
        try:
            if marker.is_file():
                side = marker.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return ""
    initial = side[:1].upper()
    return initial if initial in ("A", "B") else ""


def raw_marker(root: pathlib.Path) -> str:
    raw = os.environ.get("AIPHABI_SIDE", "").strip()
    if raw:
        return raw
    marker = root / ".aiphabi-side"
    try:
        return marker.read_text(encoding="utf-8", errors="replace").strip() \
            if marker.is_file() else ""
    except OSError:
        return ""


def strip_heredocs(cmd: str) -> str:
    """Drop heredoc bodies — commit messages routinely mention build_rime.py and sync.sh,
    and that prose must not read as an invocation."""
    lines = cmd.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = re.search(r"<<-?\s*([\"']?)([A-Za-z_][A-Za-z0-9_]*)\1", line)
        if m:
            terminator = m.group(2)
            i += 1
            while i < len(lines) and lines[i].strip() != terminator:
                i += 1
            i += 1  # skip the terminator itself
            continue
        i += 1
    return "\n".join(out)


def segments(cmd: str):
    """Split a command line into roughly-independent command segments."""
    return [s for s in re.split(r"(?:\|\||&&|[;\n|&])", cmd) if s.strip()]


def tokens(segment: str):
    try:
        return shlex.split(segment)
    except ValueError:
        return segment.split()


def argv0(toks):
    """First token that is not an env assignment or a leading builtin."""
    for t in toks:
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
            continue
        if t in ("sudo", "command", "exec", "nohup", "time", "env"):
            continue
        return t
    return ""


def is_build_invocation(toks) -> str:
    """Return the matched build script if this segment *runs* one, else ""."""
    if not toks:
        return ""
    a0 = os.path.basename(argv0(toks))
    for script in BUILD_SCRIPTS:
        base = os.path.basename(script)
        # direct: ./sync.sh   /path/build_rime.py
        if a0 == base:
            return base
        # via an interpreter: python3 build_rime.py, bash sync.sh, bash -n sync.sh
        if a0 in ("python", "python3", "bash", "sh", "zsh", "source", "."):
            for t in toks[1:]:
                if os.path.basename(t.strip("\"'")) == base:
                    return base
    return ""


def mutates_protected(segment: str, toks) -> str:
    """Return a description if this segment writes a protected file, else ""."""
    hit = PROTECTED_IN_CMD.search(segment)
    if not hit:
        return ""
    name = hit.group(0)

    if REDIRECT_TO_PROTECTED.search(segment):
        return f"redirect into {name}"

    if not toks:
        return ""
    a0 = os.path.basename(argv0(toks))

    if a0 in MUTATORS:
        return f"{a0} targeting {name}"
    if a0 == "sed" and any(t == "-i" or t.startswith("-i") for t in toks):
        return f"sed -i on {name}"
    if a0 == "git":
        rest = [t for t in toks[1:] if not t.startswith("-")]
        if rest and rest[0] in GIT_MUTATING_SUBCMDS:
            return f"git {rest[0]} on {name}"
    if a0 in ("python", "python3", "perl", "ruby", "node"):
        # inline script opening the file for writing
        if re.search(r"open\s*\([^)]*[\"'][wax]", segment) or ">" in segment:
            return f"inline {a0} write to {name}"
    if a0 == "jq" and any(t in ("-i", "--in-place") for t in toks):
        return f"jq --in-place on {name}"
    return ""


def check_bash(command: str, side: str, root: pathlib.Path) -> int:
    cleaned = strip_heredocs(command)
    for seg in segments(cleaned):
        toks = tokens(seg)

        script = is_build_invocation(toks)
        if script and side != "B":
            whose = " — this checkout is Side A" if side == "A" else \
                    " — and this checkout has no side declared"
            sys.stderr.write(MSG_BUILD.format(
                what=f"Blocked command segment: {seg.strip()[:200]}", whose=whose))
            return 2

        why = mutates_protected(seg, toks)
        if why and side != "A":
            what = f"{why}\n  in: {seg.strip()[:200]}"
            if side == "B":
                sys.stderr.write(MSG_DATA_B.format(what=what))
            else:
                raw = raw_marker(root)
                found = f' (found {raw!r}, expected "A" or "B")' if raw else ""
                sys.stderr.write(MSG_DATA_UNDECLARED.format(what=what, found=found))
            return 2
    return 0


def check_file(target: str, side: str, root: pathlib.Path) -> int:
    if side == "A":
        return 0
    try:
        rel = pathlib.Path(target).resolve().relative_to(root.resolve()).as_posix()
    except (ValueError, OSError):
        return 0
    if rel not in PROTECTED:
        return 0
    if side == "B":
        sys.stderr.write(MSG_DATA_B.format(what=rel))
    else:
        raw = raw_marker(root)
        found = f' (found {raw!r}, expected "A" or "B")' if raw else ""
        sys.stderr.write(MSG_DATA_UNDECLARED.format(what=rel, found=found))
    return 2


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    env_root = os.environ.get("CLAUDE_PROJECT_DIR")
    root = pathlib.Path(env_root) if env_root else pathlib.Path(__file__).resolve().parents[2]

    side = resolve_side(root)
    tool = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}

    if tool == "Bash":
        command = tool_input.get("command") or ""
        return check_bash(command, side, root) if command else 0

    target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    return check_file(target, side, root) if target else 0


if __name__ == "__main__":
    sys.exit(main())
