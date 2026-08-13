#!/usr/bin/env python3
"""PreToolUse guard: stop a Side B session from writing Side A's data files.

Which side this checkout is cannot come from the conversation — the hook is a separate
process and never sees it. It comes from, in order of precedence:

    1. $AIPHABI_SIDE
    2. the .aiphabi-side file at the repo root (gitignored, one letter: A or B)

If neither says "B" the hook allows everything, so an undeclared checkout is unprotected
by design (fail-open: a guard that blocked on a missing marker would break every fresh
clone before it could be configured).

Protects only the three hand-authored Side A files. rime/ is deliberately NOT guarded —
it is regenerable, so a wrong-side rebuild is annoying rather than costly.

Contract: exit 0 allows the tool call, exit 2 blocks it and returns stderr to Claude.
Any unexpected condition exits 0 — a broken guard must not wedge the session.
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

MESSAGE = """\
BLOCKED by .claude/hooks/side-guard.py — this checkout is declared **Side B** (.aiphabi-side).

  {rel}  is owned by Side A (字根/取碼) and is strictly read-only for Side B.

No exceptions — not a one-character fix, not a count bump, not restoring something you are
sure was lost. See PROJECT_NOTES.md -> "Hard rules — no exceptions".

What to do instead: read the file freely, and report the problem so it can be fixed in a
Side A session. If you believe this block is wrong, say so — do not try to route around it
with Bash or another tool.
"""


def resolve_side(root: pathlib.Path) -> str:
    side = os.environ.get("AIPHABI_SIDE", "").strip()
    if not side:
        marker = root / ".aiphabi-side"
        try:
            if marker.is_file():
                side = marker.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return ""
    return side[:1].upper()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    env_root = os.environ.get("CLAUDE_PROJECT_DIR")
    root = pathlib.Path(env_root) if env_root else pathlib.Path(__file__).resolve().parents[2]

    if resolve_side(root) != "B":
        return 0

    tool_input = payload.get("tool_input") or {}
    target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not target:
        return 0

    try:
        rel = pathlib.Path(target).resolve().relative_to(root.resolve()).as_posix()
    except (ValueError, OSError):
        return 0

    if rel in PROTECTED:
        sys.stderr.write(MESSAGE.format(rel=rel))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
