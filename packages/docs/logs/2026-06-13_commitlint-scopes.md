---
id: log-2026-06-13-commitlint-scopes
type: log
status: complete
board: false
---

# Commitlint scopes & types — review and tune

## Context

The owner asked whether the monorepo has a good set of commit **scopes** and
**types**, and whether to add/remove any. Plan mode was used; this log doubles
as the record of the assessment and the change that shipped.

## Assessment

Validation is a single custom hook — `scripts/validate-commit-msg.ts` — wired
through `lefthook.yml` (`commit-msg` → `bun scripts/validate-commit-msg.ts {1}`).
There is no root `commitlint` package; the only `commitlint.config.ts` is inside
`packages/starlight-karma-bot/` and is unrelated.

**Types (12, hard-coded):** `feat, fix, chore, ci, docs, refactor, test, perf,
build, style, revert, misc`. Healthy — full conventional set. Last 400 commits
used 8 of 12, all valid. Left unchanged (`misc` kept as a harmless catch-all).

**Scopes:** auto-derived from `packages/*` directory names **+** an
`EXTRA_SCOPES` list. The auto-derivation is the nice part — new packages become
valid scopes automatically.

The real finding was about **enforcement, not the list**. The local hook is the
only gate, and the two highest-volume paths bypass it:

| Out-of-allowlist scope | ~Count (last 400) | Source          | Why it slipped through                          |
| ---------------------- | ----------------- | --------------- | ----------------------------------------------- |
| `deps`                 | 14                | `renovate[bot]` | Renovate commits via GitHub API — no local hook |
| `cooklang`             | 4                 | `CI Bot` bumps  | programmatic commits bypass the hook            |
| `ci`                   | 1                 | a `fix(ci):`    | squash-merge (PR title → merge subject)         |

No CI/PR-title validation exists (searched `.buildkite`, `scripts/ci`,
`.github`). GitHub squash-merges build the merge-commit subject from the PR
title server-side, so the allowlist is never enforced on merged history. Filed
as `packages/docs/todos/enforce-commit-scopes-in-ci.md` (deferred).

## Change shipped

`scripts/validate-commit-msg.ts`:

- Added `deps`, `ci`, `cooklang` to `EXTRA_SCOPES`, with a comment documenting
  what each extra scope is for.
  - `deps` — Renovate's `chore(deps):` convention (was rejected for humans
    while the bot sailed through).
  - `ci` — `scripts/ci/` (pipeline generator) and `.buildkite/`, which
    previously had to masquerade as `root`/`dagger`.
  - `cooklang` — the `CI Bot` release-bump pattern (`chore(cooklang): bump`);
    no single `cooklang` package exists, so an umbrella scope is the clean fit.
- Removed the lone `as` cast (`type as (typeof VALID_TYPES)[number]`) by typing
  `VALID_TYPES` as `readonly string[]`, matching the repo's no-`as` preference.
  (Root `scripts/` is not covered by any eslint/typecheck pre-commit step, so
  this is a tidy-up, not a gated fix.)

## Verification

Dry-ran the validator directly (no commit needed) from the worktree:

- `chore(<scope>): x` passes for `deps ci cooklang root toolkit dagger practice
archive`.
- `feat(nonexistent): x` → exit 1, error lists the new scopes (sorted).
- `badtype(root): x` → exit 1, type error.
- `Merge branch ...` → passes silently (bypass pattern intact).

## Session Log — 2026-06-13

### Done

- Assessed commitlint types/scopes; root cause of inconsistencies is
  enforcement (bots + squash-merges bypass the local hook), not the list.
- `scripts/validate-commit-msg.ts`: added `deps`/`ci`/`cooklang` scopes +
  documenting comment; removed the `as` cast via `readonly string[]`.
- Filed `packages/docs/todos/enforce-commit-scopes-in-ci.md` for the deferred
  CI/PR-title enforcement work.
- Verified all pass/fail cases with the validator directly.

### Remaining

- CI/PR-title enforcement of the allowlist — deferred, tracked in the todo doc.

### Caveats

- `misc` type kept intentionally (harmless catch-all).
- The new scopes only help locally-authored commits today; Renovate and
  squash-merges still bypass the hook until the deferred CI check lands.
