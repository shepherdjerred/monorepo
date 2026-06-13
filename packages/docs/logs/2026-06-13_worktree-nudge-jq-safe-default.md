# Fix: worktree-reminder.sh jq safe-default

## Status

Complete

## Context

PR #1149 (`feature/worktree-nudge`) added `.claude/hooks/worktree-reminder.sh`,
a `SessionStart` hook that nudges agents into a git worktree when a session opens
in the main checkout. Greptile flagged a P2: when `jq` is absent, `src` stays
`""` (never matching `resume|compact`), so the hook fires on every session start
— including resumed and compacted sessions — violating the "no nagging" contract.

## Fix

Added an `elif [ -n "$input" ]` branch after the `jq` block in
`.claude/hooks/worktree-reminder.sh`. When input is present but `jq` is
unavailable, the hook exits 0 immediately (the safe "no nagging" default) since
the session source cannot be classified. The happy path (jq present, startup
source) is unchanged.

Changed lines 30-32 of `.claude/hooks/worktree-reminder.sh`:

```bash
elif [ -n "$input" ]; then
  # jq unavailable — can't classify source, so skip the nudge (safe default).
  exit 0
fi
```

Verified behavior:

- jq present + source=startup: nudge fires (happy path unchanged)
- jq present + source=resume: exits 0, no nudge
- jq present + source=compact: exits 0, no nudge
- jq absent + any input: exits 0 silently (fixed)
- no input at all: proceeds normally (unchanged, exits via worktree check)

## Session Log — 2026-06-13

### Done

- Read `.claude/hooks/worktree-reminder.sh` and identified root cause
- Added `elif [ -n "$input" ]` safe-default branch (3 lines)
- `shellcheck` passes clean
- Pre-commit hooks all green (including staged shellcheck)
- Pushed SHA `7d6b10fa6` to `feature/worktree-nudge`
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWPNq` via GraphQL mutation

### Remaining

- None — fix is complete and thread resolved.

### Caveats

- The `trust-mise.sh` sibling hook has a similar gap for a different field
  (noted in the Greptile comment as "similar gap"). That hook's contract was
  described as less strict, so it was not touched in this session — but it may
  warrant a follow-up review.
