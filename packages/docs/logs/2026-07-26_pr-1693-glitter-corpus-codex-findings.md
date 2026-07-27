---
id: log-2026-07-26-pr-1693-glitter-corpus-codex-findings
type: log
status: complete
board: false
---

# PR #1693 — Glitter Discord corpus Codex findings

Drove PR #1693 (`feature/glitter-discord-sot`, draft) through its 19 unresolved
non-outdated Codex review threads. Only red was `robot-face-review-gate`
(itself blocked by the known #1704 gate bug regardless of findings).

## What the findings actually were

The PR is a ~7,800-line loss-intolerant Discord corpus backfill (Temporal
workflows + activities, dual-store SeaweedFS/R2 mirroring, snapshot lineage,
deterministic projection). Codex reviewed a **stale base** — 12 of 19 findings
were already fixed by the existing "harden Glitter corpus guarantees" commit
(`1db74fc5e`) but their threads were still unresolved and non-outdated.

### Fixed + pushed (commit `0b4d65689`)

- **Forward-pass observations** (`glitter-corpus.ts` verify + `glitter-corpus-recovery.ts`):
  the projection was built from `backward.observations + seed` only, dropping
  edits captured solely on the forward pass. Now `backward + forward + seed`;
  recovery updated to match so observation/duplicate counts still reconcile.
  Also hoisted the triple `backward.messageIds.toSorted(...)` to stay under the
  500-line cap.
- **Seed checksum pin** (`glitter-corpus-seed.ts`): pinned the trusted archive
  SHA-256 (`19aaca11…cc92`) and projection SHA-256 (`8bad3bee…572f`) and gate
  `--mirror=true` on both, so a substituted archive with the same 76,762 count
  can't be mirrored under its own hash.
- **Test fixture** (`glitter-corpus.test.ts`): base overlap fixture now sets
  `lineageDepth: 1` + `seedPrefix: null` and a positive base-fixture test, so
  each mutation test fails for its intended reason.

### Resolved as already-fixed (12, code-cited justifications on each thread)

boundary-freeze across traversals, docs storage-var table, seed-channel
fail-approval (`validateSeedForApprovedInventory`), monotonic `latest.json`
(`latestSnapshotPointerNeedsUpdate` + `IfMatch` ETag), metric rehydration at
startup (`restoreGlitterCorpusSnapshotMetrics`), revalidate-all-objects before
publish (`verifyGlitterCorpusSnapshotGraph`), attachment-URL stripping
(`stableAttachments`), null-baseline traverse-to-empty, initial-pause preserved,
bounded lineage (`MAX_OVERLAP_LINEAGE_DEPTH = 6`), six-overlap edit refresh,
empty-denylist accepted (`requiredPresentEnvironment`).

## Session Log — 2026-07-26

### Done

- Fixed 3 real gaps + pushed `0b4d65689` to `origin/feature/glitter-discord-sot`
  (full `verify --affected` + pre-push green, all 34 gates incl. `check:1password`).
- Resolved 16 review threads (4 fixed + 12 already-fixed) with per-thread
  justifications; posted an escalation note on finding [14].
- Worked in a fresh isolated worktree (`.claude/worktrees/pr-1693-sot-clean`)
  to avoid a concurrent session's uncommitted homelab changes that had landed in
  the original worktree.

### Remaining

- **[1]/[10] worker env wiring** (`register-schedules.ts:348/352`) — operator-blocked:
  needs 6 new 1Password fields (`GLITTER_DISCORD_TOKEN`/`GUILD_ID`/`GUILD_SLUG`,
  `GLITTER_CORPUS_R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) +
  `onepassword-vault-snapshot.json` refresh (needs `op`). Owned by another
  concurrent session doing the homelab env wiring. Left untouched.
- **[14] deleted messages across the six-overlap full refresh**
  (`glitter-corpus.ts:426`) — genuine P1 vs. documented contract: the full
  refresh rebuilds from live Discord + seed only, dropping post-seed messages
  deleted before the weekly refresh. Proper fix (checksummed carried-forward
  retained object, keeping lineage bounded) is ~150–200 lines; alternative is to
  scope the contract and correct the runbook. Escalated to the owner; thread left
  unresolved with a note.
- Review-gate stays blocked on the #1704 gate bug regardless of findings.

### Caveats

- `origin/feature/glitter-discord-sot` is now at `0b4d65689`. The original
  colliding worktree's local branch is still at `1db74fc5e` with another
  session's uncommitted homelab changes — that session must fetch+rebase before
  pushing (non-fast-forward otherwise). My push touched only temporal files, so
  no file-level conflict with their homelab work is expected.
- A fresh `@codex` re-review will fire on `0b4d65689` and may raise new findings
  on the large diff.
