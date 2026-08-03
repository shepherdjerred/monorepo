---
id: op-helper-whoami-false-negative
type: log
status: complete
board: false
---

# op-helper skill — don't gate on `op whoami` / `op signin` — 2026-08-02

## Problem

Agents kept concluding that 1Password was not signed in and stalling, even
though `op` operations actually worked. Evidence from a live session:

- `op whoami` → `[ERROR] account is not signed in`, exit `1` (repeated).
- `op signin` → no output.
- `op account list`, `op vault list`, `op item get`, `op read` → all succeed.

Root cause: with the **1Password desktop-app integration + biometric unlock**,
auth happens **per command** (Touch ID). There is no long-lived CLI session
token in the shell, so `op whoami` — which checks for that token — reports a
false negative. `op signin` is effectively a no-op in this setup, and each Bash
tool call is a fresh subprocess anyway, so any exported `OP_SESSION_…` would not
persist to the next call.

## Change

Edited `packages/dotfiles/dot_agents/skills/op-helper/SKILL.md` (chezmoi source)
and synced the live copy at `~/.agents/skills/op-helper/SKILL.md`
(`~/.claude/skills` is a symlink to `../.agents/skills`, so both live paths
resolve to the same file):

- Added a prominent **"IMPORTANT: Do NOT gate work on `op whoami` or
  `op signin`"** section: probe with the real command (`op vault list`, or the
  read you actually need); treat data-returning calls as proof `op` works
  regardless of `whoami`; only surface a sign-in problem when the actual read
  fails with no data. Noted the **service-account exception**
  (`OP_SERVICE_ACCOUNT_TOKEN`), where `whoami` is meaningful.
- Annotated the auto-approved `op whoami` bullet with a ⚠️ pointer to the caveat.
- Added a "When to Ask for Help" bullet: escalate only when the actual read
  fails, not merely `whoami`.

## Session Log — 2026-08-02

### Done

- `packages/dotfiles/dot_agents/skills/op-helper/SKILL.md` — new section +
  two annotations (source 8698 → 11291 bytes).
- Synced live copy `~/.agents/skills/op-helper/SKILL.md`; verified both live
  paths and source are byte-identical.

### Remaining

- Not committed. If desired, open a PR for the dotfiles change (chezmoi source
  is checked in; live copy is already applied).

### Caveats

- The live copy was updated directly with `cp` (not `chezmoi apply`, which hit a
  persistent-state lock — "another instance of chezmoi running"). Source and
  live are byte-identical, so a later `chezmoi apply` will be a no-op.
