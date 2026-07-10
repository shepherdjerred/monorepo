# Cheaper worktree dependency installs: scoped `--group`/`--link` installs

## Status

Complete. Full plan: `~/.claude/plans/could-we-introduce-1-2-3-prancy-thompson.md`.

## Context

Worktree checkouts themselves are cheap (~700M, shared `.git` objects). The
real cost was `bun run scripts/setup.ts`, which unconditionally installs
**every** package's deps (~35 packages, ~13-15G of `node_modules`) into every
worktree, even when the worktree only touches one package. Shipped:

1. `--group=<scout|pokemon|mk64|birmel>` — scopes `scripts/setup.ts` Phases
   2-5 to one package plus the shared `file:` producers every group needs
2. `--group=<name> --link` — additionally installs that group's own deps with
   Bun's `--backend=symlink` instead of clonefile (verified safe for
   `pokemon` only — see below)
3. A fix for birmel's Prisma client writing into `node_modules/.prisma/client`
   (PR #1422, merged/mergeable independently, CI-verified including the
   Dagger birmel image smoke test)
4. A `~/.bunfig.toml` clonefile pin (chezmoi-managed) — defensive only, Bun
   already defaults to clonefile on macOS
5. Agent-guidance updates (worktree-workflow skill, root `AGENTS.md`, the
   worktree-reminder hook) pointing at `--group`/`--link` and warning against
   ad hoc per-package `bun install`, which is the root cause of the recurring
   "Cannot find module `@shepherdjerred/eslint-config`" failure

PRs: #1422 (birmel Prisma migration, merged prerequisite) and #1425
(`--group`/`--link` in `scripts/setup.ts` + docs).

## Key finding during implementation: `--link` isn't safe for Prisma-using groups

The plan's original audit checked whether any package's postinstall script
**writes** project-specific content into `node_modules` under symlink backend
— birmel's Prisma client was the only hit, so after fixing birmel the plan
was to ship `--link` for all four groups. Live testing surfaced a different,
unaudited failure: Prisma's own installer packages (`@prisma/engines`,
`prisma`) have postinstall scripts that `require()` their own sibling
dependencies (e.g. `@prisma/debug`) assuming they run from inside a real
project `node_modules` tree. Under `--backend=symlink`, Bun executes those
scripts directly from its shared global cache instead, where the siblings
aren't resolvable — `MODULE_NOT_FOUND` crashes the install every time.
Reproduced on both `--group=scout --link` (`@prisma/engines`'s postinstall)
and `--group=mk64 --link` (`prisma`'s postinstall); confirmed `--group=scout`
and `--group=mk64` **without** `--link` both work cleanly, isolating the cause
to the symlink backend specifically. `pokemon` has no Prisma dependency and
its `--link` install completes and verifies cleanly.

Shipped `LINK_SAFE_GROUPS = new Set(["pokemon"])` — `--link` on any other
group is rejected at CLI-arg-parsing time with this reason, not left to fail
mid-install.

A second, related bug found and fixed: two spots
(`refreshBuiltFileDependencies`'s pokemon-backend entry, and the
`scout-llm-models-refresh` DAG task) ran a bare `bun install --force` on a
workspace member with no `bun.lock` of its own — `bun install` there operates
on the shared workspace root, so a bare `--force` silently **re-links the
whole workspace with the default backend**, undoing an earlier `--link`
install. Both now thread `--backend=symlink` through when the group/link
combination calls for it.

A third bug found via the plan's own "prove full-run parity" verification
step: the Verify-phase filter initially excluded all group-tagged checks
(birmel/scout/mk64 prisma-client checks) when no `--group` flag was passed,
dropping full-run Verify from 8/8 to 5/8. Fixed before shipping.

## Benchmark / proof

Measured on this machine (macOS, APFS), `df` deltas are real physical disk
consumption (not `du`'s logical size, which double-counts clonefile-shared
blocks):

| Scenario                 | Wall clock                   | Real disk (`df` delta) | Verify |
| ------------------------ | ---------------------------- | ---------------------- | ------ |
| Full unscoped (no flags) | 102.6s (98-130s across runs) | **1.38GB**             | 8/8    |
| `--group=pokemon`        | 17.9s                        | ~606MB                 | 5/5    |
| `--group=pokemon --link` | 22.8-23.1s                   | ~606-631MB             | 5/5    |
| `--group=scout`          | 28.6s                        | not measured           | 6/6    |
| `--group=mk64`           | 8.9s                         | not measured           | 6/6    |
| `--group=birmel`         | 8.6s                         | not measured           | 6/6    |

**Correction to this session's own opening estimate:** at the start of this
conversation, `du -sh` on a fully-set-up worktree reported ~13-15G of
`node_modules`, and that figure anchored the entire "worktrees are expensive"
framing. The actual **physical** disk cost of a full unscoped setup, measured
via `df` delta (before/after, clean `node_modules` state), is **~1.38GB** —
roughly 10x less than `du` suggested. `du` reports each clonefile-cloned
file's logical size even though the clones share physical blocks with Bun's
global cache via APFS copy-on-write; it isn't lying, but it isn't measuring
what matters for "how much disk do my 60 worktrees actually cost." The
`--group` scoping work in this session is still a real, measured win (~606MB
vs 1.38GB, both wall-clock and disk), but it's a ~2.3x reduction on this
machine, not the ~20x reduction the initial `du`-based framing implied.
Worth re-checking actual `df` deltas before assuming `du` numbers reflect
real cost on any copy-on-write filesystem.

`--link`'s disk delta wasn't meaningfully smaller than the non-`--link`
scoped install in this measurement — consistent with the finding above:
clonefile already captures most of the real physical-disk win on APFS
(confirmed via a separate raw `cp -c` test earlier this session: cloned files
show distinct inodes but the OS-level physical delta is near-zero until
divergence), so `--link`'s marginal benefit over clonefile is smaller than
expected going in. `--link`'s value here is more about not materializing
files at all until needed, not a large additional disk win beyond clonefile
specifically on this filesystem.

Symlinks were directly verified (not inferred): after a clean `--group=pokemon
--link` run,
`packages/discord-plays-pokemon/node_modules/discord.js/package.json` showed
as `lrwxrwxrwx@ ... -> /Users/jerred/.bun/install/cache/discord.js@14.26.4@@@1/package.json`.

Reversal path verified: re-running `--group=pokemon` (no `--link`) after a
`--link` run produces real files again, confirmed via the same `ls -la`
inspection.

Full-run parity verified: `bun run scripts/setup.ts` with no flags produces
identical behavior to before this change (8/8 Verify artifacts).

## Deferred / not fixed here

- **`refreshBuiltFileDependencies` (Phase 4) has no retry-with-backoff**,
  unlike Phase 2's `installOne`. Surfaced as intermittent `node-av`
  postinstall failures (`No prebuilt binary and no system FFmpeg found`)
  even though the prebuilt binary package was present and a manual
  interactive-shell install succeeded every time — reproduced on both scoped
  and full unscoped runs, so unrelated to this change. Filed:
  `packages/docs/todos/setup-ts-refresh-phase-no-retry.md`.

## Session Log — 2026-07-08

### Done

- PR #1422 (`fix/birmel-prisma-output`): migrated birmel's Prisma client
  output to match scout/mk64's `generated/` pattern, removing the manual
  `.prisma` symlink workaround. CI-verified including the Dagger birmel image
  smoke test. Merge-ready, not merged (user's call).
- PR #1425 (`feature/setup-scoped-installs`): `--group`/`--link` flags in
  `scripts/setup.ts`, `LINK_SAFE_GROUPS` restricted to `pokemon` after live
  testing, two symlink-reversion bugs fixed, the Verify full-run-parity bug
  fixed. Agent-guidance docs updated (worktree-workflow skill × 2 copies, root
  `AGENTS.md`, worktree-reminder hook). `~/.bunfig.toml` clonefile pin added
  (chezmoi source, templated to macOS-only after Greptile review caught the
  original plain-file version as a cross-platform risk, + live copy).
- Full-run `df` delta benchmark completed: **1.38GB real physical disk**,
  correcting this session's own opening `du`-based estimate of 13-15G — see
  Benchmark section above.
- This log + `packages/docs/todos/setup-ts-refresh-phase-no-retry.md`.

### Remaining

- Both PRs need user merge approval (not merged autonomously per this
  session's git-safety norms). PR #1425 should rebase onto `main` after
  #1422 merges (both touch `scripts/setup.ts`'s Verify path).
- `setup-ts-refresh-phase-no-retry` todo is filed but not fixed.
- `--group=scout`/`--group=mk64` `df` deltas weren't captured (only wall-clock
  and Verify counts) — low priority, `pokemon`'s numbers plus the full-run
  correction already establish the pattern.

### Caveats

- `packages/temporal/bun.lock` kept showing spurious modifications during
  this session's repeated `bun run scripts/setup.ts` runs (unrelated to any
  change here) — reverted each time before committing; if you see it again,
  it's very likely the same pre-existing non-issue, not something introduced
  by this work.
