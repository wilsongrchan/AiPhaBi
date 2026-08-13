#!/usr/bin/env python3
"""PreToolUse guard: stop a Side B session from writing Side A's data files.

Which side this checkout is cannot come from the conversation — the hook is a separate
process and never sees it. It comes from, in order of precedence:

    1. $AIPHABI_SIDE
    2. the .aiphabi-side file at the repo root (gitignored, one letter: A or B)

**Fails closed.** Only an explicit "A" unlocks the protected files. Side B is blocked, and so
is an undeclared or unrecognised marker — forgetting to declare a side costs you a write you
can unblock in one command, whereas failing open would leave the data silently unprotected and
give no signal that anything was wrong.

The marker is re-read on every invocation, so `echo A > .aiphabi-side` takes effect on the very
next tool call — no session restart needed. (Restart is only needed if the hook *registration*
in .claude/settings.json changes; that part is snapshotted at session start.)

Protects only the three hand-authored Side A files. rime/ is deliberately NOT guarded —
it is regenerable, so a wrong-side rebuild is annoying rather than costly.

Contract: exit 0 allows the tool call, exit 2 blocks it and returns stderr to Claude.
A malformed payload exits 0 — the guard must not wedge the session on tool calls it cannot
parse — but an unreadable *side marker* is treated as undeclared, and so blocks.
"""
import json
import os
import pathlib
import sys

PROTECTED = {
    "data/codes.json",
    "data/zigen.json",
    "data/rules.json",
}

MESSAGE_B = """\
BLOCKED by .claude/hooks/side-guard.py — this checkout is declared **Side B** (.aiphabi-side).

  {rel}  is owned by Side A (字根/取碼) and is strictly read-only for Side B.

No exceptions — not a one-character fix, not a count bump, not restoring something you are
sure was lost. See PROJECT_NOTES.md -> "Hard rules — no exceptions".

What to do instead: read the file freely, and report the problem so it can be fixed in a
Side A session. If you believe this block is wrong, say so — do not try to route around it
with Bash or another tool.
"""

MESSAGE_UNDECLARED = """\
BLOCKED by .claude/hooks/side-guard.py — this checkout has **no side declared**{found}.

  {rel}  is a Side A (字根/取碼) data file, and the guard fails closed: until this checkout
  says which side it is, the three hand-authored data files stay locked.

Fix it by declaring the side at the repo root — ask which one if you do not already know:

    echo A > .aiphabi-side     # 字根/取碼 — may write these files
    echo B > .aiphabi-side     # IME/候選  — may not

This takes effect on the next tool call; no session restart is needed. The file is gitignored
on purpose: it describes this checkout, not the project. See PROJECT_NOTES.md ->
"Starting a new session".
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


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    env_root = os.environ.get("CLAUDE_PROJECT_DIR")
    root = pathlib.Path(env_root) if env_root else pathlib.Path(__file__).resolve().parents[2]

    side = resolve_side(root)
    if side == "A":
        return 0                      # only an explicit A unlocks the protected files

    tool_input = payload.get("tool_input") or {}
    target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not target:
        return 0

    try:
        rel = pathlib.Path(target).resolve().relative_to(root.resolve()).as_posix()
    except (ValueError, OSError):
        return 0

    if rel in PROTECTED:
        if side == "B":
            sys.stderr.write(MESSAGE_B.format(rel=rel))
        else:
            raw = os.environ.get("AIPHABI_SIDE", "").strip()
            if not raw:
                marker = root / ".aiphabi-side"
                try:
                    raw = marker.read_text(encoding="utf-8", errors="replace").strip() \
                        if marker.is_file() else ""
                except OSError:
                    raw = ""
            found = f' (found {raw!r}, expected "A" or "B")' if raw else ""
            sys.stderr.write(MESSAGE_UNDECLARED.format(rel=rel, found=found))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
