---
id: plan-2026-07-12-strip-ci-remove-dagger
type: reference
status: complete
board: true
verification: agent
disposition: active
---

# Strip CI — Remove Dagger, Buildkite Pipeline, and All Hooks

## Context

Owner decision (2026-07-12): abandon the approved CI replatform
(`2026-07-11_ci-replatform-dagger-exit.md`, now `Status: Abandoned`) — **stripping,
not replatforming**. All existing CI is removed from the repo with **no
replacement**: no Dagger, no Buildkite pipeline files, no lefthook git-hook gating,
no automated deploys or releases. Scope decisions confirmed by the owner:

- **Deploys: delete it all** — no manual deploy scripts kept. Images/charts/sites/
  ArgoCD/npm/release automation all removed.
- **Hooks: strip all** — lefthook and every pre-commit/commit-msg gate removed, not
  just Dagger-specific ones.
- **Buildkite: repo files only** — Buildkite org/pipeline/agent-stack teardown
  (incl. homelab `buildkite`/kueue cdk8s code and the git-mirrors PVC) is a separate
  manual step, out of scope here.

## What was removed

| Target                                                                                                                                                                                      | Notes                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `.dagger/` + `dagger.json`                                                                                                                                                                  | 23 files, ~9k LOC, 121 `@func()`s             |
| `scripts/ci/`                                                                                                                                                                               | Buildkite pipeline generator                  |
| `.buildkite/`                                                                                                                                                                               | pipeline.yml, 17 scripts, ci-image Dockerfile |
| `lefthook.yml` + root `prepare` script + `.claude/hooks/install-git-hooks.sh` (+ settings.json entry)                                                                                       | all hook gating                               |
| `scripts/check-dagger-hygiene.{sh,ts}`, `scripts/prettier-staged.sh`, `scripts/validate-commit-msg.ts`, `scripts/generate-deps.ts`                                                          | CI/hook-exclusive plumbing                    |
| `release-please-config.json`, `.release-please-manifest.json`                                                                                                                               | release automation was CI-driven              |
| homelab `argo-applications/dagger.ts`, `monitoring/rules/dagger.ts` (+ registrations), buildcache storage class, dagger-helm pin/types, velero dagger-PVC matcher, kyverno dagger namespace | Dagger engine infra code                      |
| `packages/dotfiles/dot_agents/skills/dagger-helper/` + live `~/.agents/skills/dagger-helper/`                                                                                               | chezmoi dual-edit                             |
| todos `dagger-engine-tempo-otlp`, `enforce-commit-scopes-in-ci`                                                                                                                             | moot without CI                               |

Config/docs cleaned of dead references: knip.json, renovate.json (3 dagger custom
managers, dagger-helm + OpenTofu rules, `.buildkite/**` pattern), .prettierignore,
.conflictignore, .gitleaks.toml, .largeignore, .gitignore, .greptile/\*,
eslint-config base.ts, scripts/setup.ts, check-suppressions.ts, compliance-check.sh,
check-env-var-names.sh, quality-ratchet.ts, root AGENTS.md (banned-patterns section
generalized; "no CI" stated), homelab/tofu/temporal comments, skills
(pr-monitor, buildkite-helper, pr-workflow-automation, version-management, …).

General-purpose check scripts (`check-todos.ts`, `compliance-check.sh`,
`check-suppressions.ts`, `quality-ratchet.sh`, `check-tunnel-dns-coverage.ts`, etc.)
**stay** — manually runnable, no automated trigger.

## Manual follow-ups (live systems — NOT changed by this PR)

- **The live cluster still runs the Dagger engine.** With CI deleted there is no
  deploy path: the `dagger` namespace (engine STS + 2Ti ZFS PVC
  `data-dagger-dagger-helm-engine-0`) and its in-cluster ArgoCD Application keep
  running until someone manually synths/pushes homelab charts and syncs ArgoCD, or
  `kubectl delete ns dagger` + removes the ArgoCD app + the openebs ZFSVolume.
- **GitHub branch protection**: if `main` requires Buildkite status checks, PRs
  (including the strip PR) block once the pipeline stops reporting — remove the
  required checks (managed via OpenTofu per `scripts/github-rulesets.py` note).
- Buildkite org/pipeline/agent teardown; homelab `buildkite` + kueue cdk8s code;
  `buildkite-git-mirrors` PVC; `ghcr.io/shepherdjerred/ci-base` images;
  `mac-mini-buildkite-agent` todo becomes moot at that point.
- Renovate keeps opening dep PRs but nothing validates them automatically anymore.
- Run `lefthook uninstall` in existing checkouts/worktrees to drop installed git
  hooks (`core.hooksPath` cleanup).
- Live agent-skill copies (`~/.agents/skills`, symlinked from `~/.claude/skills`)
  still contain `dagger-helper` and the pre-strip versions of the 11 updated
  skills — run `chezmoi apply` after this PR merges to sync them from the
  chezmoi source (`packages/dotfiles/dot_agents/`).

## Session Log — 2026-07-12

### Done

- Deleted `.dagger/` (23 files, ~9k LOC), `dagger.json`, `scripts/ci/`,
  `.buildkite/`, `lefthook.yml`, root `prepare` script,
  `.claude/hooks/install-git-hooks.sh` + settings entry, hook-only scripts
  (`check-dagger-hygiene.{sh,ts}`, `prettier-staged.sh`, `validate-commit-msg.ts`,
  `generate-deps.ts`), release-please config + manifest, the dagger-helper skill
  (chezmoi source), homelab Dagger infra code (ArgoCD app, Prometheus rules,
  buildcache storage class, dagger-helm pin + generated types, velero matcher,
  kyverno namespace, code-workspace/mise tasks), and 2 moot todos + 2 homelab
  cursor-rule files that were 100% about the pipeline.
- Removed the `buildkite/monorepo/pr/*` required status checks from
  `packages/homelab/src/tofu/github/rulesets.tf` (`ci/merge-conflict` stays —
  Temporal posts it). Requires a manual `tofu -chdir=github apply`.
- Relocated the pokeemerald wasm source pin from the deleted
  `.dagger/src/constants.ts` into `packages/discord-plays-pokemon/scripts/build-wasm.sh`
  (`OTTOHG_SHA`) with a matching Renovate git-refs manager.
- Cleaned every functional/config reference: knip, renovate, gitleaks,
  prettierignore/conflictignore/largeignore/gitignore, greptile, eslint-config,
  setup.ts, check-suppressions, compliance-check, quality-ratchet,
  check-env-var-names, per-package mise/gitignore/Dockerfile/bunfig references.
- Rewrote root `AGENTS.md` (no-CI statement, banned-patterns section
  generalized) and swept 11 skills + ~15 package AGENTS.md/README/GEMINI/cursor
  docs so no living doc claims the repo has CI/hooks/automated deploys.
- Marked `2026-07-11_ci-replatform-dagger-exit.md` Abandoned (superseded).
- Verified: homelab typecheck+test, eslint-config typecheck+test, temporal /
  toolkit / birmel typecheck, scripts/ typecheck+eslint (0 errors), prettier on
  all 87 modified files, markdownlint on changed docs, check-todos,
  compliance-check.

### Remaining

- Manual follow-ups listed above (cluster teardown, `tofu apply` for rulesets,
  Buildkite org teardown, `chezmoi apply`, `lefthook uninstall` in checkouts).

### Caveats

- `bun run knip` exits 1 on this branch **and on main** (env-dependent
  findings — unused deps/binaries that the removed containerized CI runner
  evaluated differently). Not introduced by this change; no knip config error.
- The live cluster still runs the Dagger engine + Buildkite agent stack until
  homelab charts are manually re-synthesized and synced (no deploy path exists
  anymore by design).
