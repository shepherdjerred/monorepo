---
id: log-2026-07-19-generated-code-freshness-implementation
type: log
status: complete
board: false
---

# Generated-code freshness automation — implementation session

## Status Notes (Historical)

Complete (all five PRs open; merges + post-deploy verification remain)

Implements `packages/docs/plans/2026-07-19_generated-code-freshness-automation.md`
(the plan file lands with PR #1562). Started from the resume.pdf question and
ended with repo-wide freshness automation.

## PRs opened this session

| PR                                                            | Phase      | Content                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1560](https://github.com/shepherdjerred/monorepo/pull/1560) | (pre-plan) | resume.pdf untracked; CI builds it in the texlive step and ships it as a Buildkite artifact to deploy `--prebuilt`. All green.                                                                                                                                                                                                                                                                                             |
| [#1562](https://github.com/shepherdjerred/monorepo/pull/1562) | 0          | DPP pin unification: generators read `OTTOHG_SHA` from `build-wasm.sh`, repointed to the ottohg fork; Renovate regex now manages the Dockerfile `ENV` copy too; map-names generator gains a prettier pass (byte-stable regen); PATCHES.md rewritten; plan doc mirrored. Data proved identical across the two forks' pins.                                                                                                  |
| [#1563](https://github.com/shepherdjerred/monorepo/pull/1563) | 1          | `helm-types-drift-check` Buildkite step (PR-only, git-diff self-scoping; no builds needed — bun resolves helm-types `/src` directly; helm already in ci-image via mise). Proven end-to-end on its own build. Root AGENTS.md's false "weekly refresh" claim fixed.                                                                                                                                                          |
| [#1566](https://github.com/shepherdjerred/monorepo/pull/1566) | 2          | CRD imports: committed hand-shims replaced with real `cdk8s import` output (21MB, user decision; `.largeignore` + check-suppressions exemptions); `pg_hba`→`pgHba` + rules-optionality consumer migration (synth YAML verified byte-identical); `homelab-crd-imports-daily` schedule (05:30 PT); `temporal-worker-crd-reader` ClusterRole (user hardened to SA-derived namespace in `af7da1a91`); cdk8s-cli pinned devDep. |
| [#1568](https://github.com/shepherdjerred/monorepo/pull/1568) | 3          | `dpp-pokeemerald-data-daily` schedule (04:30 PT) — the post-Renovate-pin-bump regen PR (hosted Renovate can't run generators).                                                                                                                                                                                                                                                                                             |
| [#1569](https://github.com/shepherdjerred/monorepo/pull/1569) | 4          | `scout-showcase-refresh-weekly` schedule (Mon 10:00 PT) with `generatedAt`-only-diff suppression; **scout-image-gc showcase exemption** (fetches manifest from main, fails loud); manifest re-curated; 10 GC'd source PNGs restored to `scout-prod` byte-identically from the committed copies (verified: zero regen diff).                                                                                                |

## Session Log — 2026-07-19

### Done

- Everything in the table above, each PR locally verified (`bun run verify --
--affected` green per branch) before opening.
- Live-system actions taken: uploaded 10 PNGs back to `scout-prod` at their
  original manifest keys (additive restoration of GC'd objects, byte-identical
  to committed copies); retried the Greptile gate job on Buildkite build 5818
  after Greptile finished reviewing the 21MB diff.
- Repo-wide generated-artifact audit (all 22 artifacts dispositioned — see the
  plan doc); confirmed Prisma/data-dragon/llm-catalog/README automation healthy
  as-is.

### Remaining

- Merge the six PRs (all were green or trending green at session end; #1566
  rebuilt after the user's RBAC tweak).
- Post-deploy (after #1566/#1568/#1569 merge + worker/ArgoCD deploy):
  - `kubectl auth can-i list customresourcedefinitions.apiextensions.k8s.io --as=system:serviceaccount:temporal:temporal-worker` → yes
  - `temporal schedule trigger --schedule-id homelab-crd-imports-daily` → expect `no-diff`
  - `temporal schedule trigger --schedule-id dpp-pokeemerald-data-daily` → expect `no-diff`
  - `temporal schedule trigger --schedule-id scout-showcase-refresh-weekly` → expect `timestamp-only-no-pr`
  - Next `scout-image-gc-daily` run logs the manifest fetch and prunes nothing showcase-referenced.
- After #1560 merges: confirm https://resume.sjer.red serves post-deploy.
- When all merged: set the plan doc's Status to Complete and `git mv` it to
  `packages/docs/archive/completed/`; remove the five worktrees
  (`resume-pdf-artifact`, `dpp-pokeemerald-pin`, `helm-types-drift-gate`,
  `crd-imports-refresh`, `dpp-data-refresh`, `scout-showcase-refresh`) and
  their branches.
- User's two old stashes (`scanner-agent-shell-fix`, `wip-docs`) confirmed
  stale/droppable but not dropped (awaiting explicit go-ahead).

### Caveats

- **Renovate chart-bump PRs touching homelab `versions.ts` will now sit red**
  on `helm-types-drift-check` until someone pushes the regen commit — accepted
  user decision; the check output prints the fix command.
- First `cdk8s-cli` Renovate bump after #1566 → large (collapsed,
  linguist-generated) CRD-import bot PR the next morning — expected.
- The showcase GC exemption reads the manifest from `main` — manifest changes
  on a branch don't protect newly-referenced keys until merged.
- `bun run generate` (bootstrap in every worktree) kept dirtying scout's
  committed `src/testing/template.db` with byte-churn; I reverted it each time
  rather than committing nondeterministic bytes — see Workflow Friction.
- Greptile times out the review gate on very large diffs (the 21MB imports PR
  needed a manual Buildkite job retry after Greptile finished).

## Workflow Friction

- **`template.db` regenerates dirty on every fresh worktree bootstrap** —
  `bunx turbo run generate` rewrites
  `packages/scout-for-lol/packages/backend/src/testing/template.db` with
  different bytes than committed, in every one of six worktrees this session
  (reverted each time). Either the template generation is nondeterministic or
  the committed copy is stale; `bun scripts/../check-test-template-db.ts`
  (the `generate-check` task) should be run/fixed so a fresh clone's generate
  is byte-stable. Recurring, low effort to root-cause, medium QOL.
- **Piping `git commit` through `tail` swallowed a pre-commit failure** and the
  subsequent `&&`-chained push shipped an empty branch (PR #1566 first
  attempt, "No commits between main and branch"). Commit unpiped, or check
  `git log` before pushing — worth remembering for bot-style commit chains.
