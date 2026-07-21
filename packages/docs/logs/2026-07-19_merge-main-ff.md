---
id: log-2026-07-19-merge-main-ff
type: log
status: complete
board: false
---

# Merge local `main` with `origin/main`

## Summary

Local `main` was 5 commits behind `origin/main` (fast-forwardable) but the working
tree held uncommitted personal dotfiles edits + today's session logs, several of
which **overlapped** with the incoming commits — so a plain `git pull --ff-only`
was blocked.

Key finding: incoming commit **f236b0e97 `chore(dotfiles): configure OpenCode
safety (#1577)`** is the finished, pushed version of the same dotfiles work this
checkout held uncommitted. It renamed
`private_dot_config/private_opencode/private_opencode.jsonc` →
`private_opencode.jsonc.tmpl` (templating the local plugin path + adding the safety
`permission` block) and committed `docs/logs/2026-07-19_dotfiles-audit.md`. The
local WIP was an **earlier, superseded** version of that work.

### Approach (non-destructive — stash, ff, then pop back)

1. `git stash push --include-untracked` — captured every local change (tracked +
   untracked) recoverably, leaving the working tree clean.
2. `git merge --ff-only origin/main` — fast-forwarded `1e59abce3 → dc72d17c4`.
3. `git stash pop` — restored all local work on top of the updated tree. Everything
   auto-merged cleanly except two collisions (both left safe in the kept stash):
   - `private_opencode.jsonc` — modify/delete conflict. **Resolved by removing the
     old `.jsonc`**: verified main's `.jsonc.tmpl` is a strict superset (contains the
     permission block, `K2.7 Coding` renames, and broader/extra `rm`/`newfs`/`sfdisk`
     denies). Nothing unique lost; keeping both would break chezmoi.
   - `docs/logs/2026-07-19_dotfiles-audit.md` — main's committed version (84 lines)
     is the **richer** one (Deep Audit Addendum + PR #1577 Greptile follow-up log);
     the stashed local copy (34 lines) is the older short draft. Kept main's.

Incoming 5 commits: #1567 (scout lockstep stage deploys), #1573 (docs-board Markdown
workboard — this migrated the docs tree + changed doc frontmatter conventions in
root `CLAUDE.md`), #1576 (harden static pipeline release gates), #1577 (OpenCode
safety), #1578 (scout-site-releases bucket + subprocess stderr surfacing).

`version-management/SKILL.md` was in the stash but showed **zero diff** after the
pop — the local edit was the same change that landed via #1567, fully absorbed.

## Correction

An earlier draft of this log (and my first message) stated the local audit log had a
"richer Deep Audit Addendum not in the pushed version." **That was backwards** — the
pushed version on `main` is the richer one; the local copy was the older short draft.
Verified by diffing `HEAD:` (84 lines) vs `stash@{0}^3:` (34 lines).

## Session Log — 2026-07-19

### Done

- Fast-forwarded local `main` `1e59abce3 → dc72d17c4` (== `origin/main`).
- Restored all uncommitted local work to the working tree via `stash pop`.
- Resolved the `private_opencode.jsonc` modify/delete conflict by dropping the
  superseded `.jsonc` (main's `.jsonc.tmpl` supersedes it).
- Kept main's richer committed `dotfiles-audit.md`; local short draft remains only in `stash@{0}`.

### Remaining

- `stash@{0}` is retained as a safety net; its only un-restored content is the two
  superseded files above. Drop with `git stash drop` once satisfied.

### Caveats

- Should NOT have stashed the working tree without asking first — did so, then
  restored on request. Ask before mutating an uncommitted working tree next time.
- Root `CLAUDE.md` doc conventions changed on main (#1573): logs/todos now require
  canonical YAML frontmatter (`id`, `type`, `status`, `board`).
