# CI Parity Gap Audit — BK+Dagger → BK-only

## Status

Complete

Q&A session: audited the replatformed static Buildkite pipeline
(`.buildkite/pipeline.yml`) against the pre-strip BK+Dagger pipeline
(generator at `scripts/ci/` + `.dagger/`, both deleted in #1516, parent
`6dba01a90^` used as the old-world reference).

## Confirmed gaps

1. **CI is not a required PR check.** `packages/homelab/src/tofu/github/rulesets.tf`
   still has the `buildkite/monorepo` `required_check` commented out (staged
   deliberately during the replatform; the parity plan's 2026-07-15 session log
   lists "enable the GitHub ruleset required check now that the pipeline is
   green" as an operator follow-up that never happened). The only required
   check on `main` today is `ci/merge-conflict` (Temporal-posted). The old
   pipeline's `ci-complete` step backed `buildkite/monorepo/pr/*` required
   checks — red CI blocked merge; today it does not. Fix: uncomment the
   `required_check` block + `tofu apply` (or let the `tofu apply (github)`
   step ship it) after confirming Buildkite has posted `buildkite/monorepo`
   on at least one PR build.
2. **Greptile review gate demoted from blocking to soft-fail.** Old:
   `greptileReviewStep()` was in `blockingGates` → part of `releaseDeps` →
   fed the required check on PRs. New: the ":robot_face: greptile review
   gate" step has `soft_fail: true`, so an unaddressed review blocks nothing.
   Decide: restore blocking, or accept as intentional.
3. **Leftover `feature/ci-parity` clause in the ci-image refresh step** —
   `.buildkite/pipeline.yml` says in its own comment to drop it after merge;
   it's still there.

## Minor behavioral deltas (probably fine, noting for the record)

- Old CI published `-dev.N` npm versions (`--tag dev`) on non-release main
  builds; new npm step only prod-publishes (idempotent via
  `--tolerate-republish`). Dev-tag consumers, if any, stopped getting builds.
- `aquasec/trivy:latest` / `semgrep/semgrep:latest` in the soft-fail lane are
  unpinned (no renovate comment), unlike every other image in the file.
- Release-please's own PR no longer auto-skips full CI (old
  `shouldSkipReleasePleasePrBuild`); cost only, not a gate gap.

## Verified NOT gaps (parity confirmed)

- All 15 old quality-bundle checks live in root `verify` (todos, suppressions,
  markdownlint, prettier, shellcheck, gitleaks, compliance, lockfile,
  merge-conflicts, env-var-names, line-endings, react-version-sync,
  large-files, migration guard, ratchet) plus caddyfile/talos/tunnel-dns/
  1Password/test-template/contract/rehearsal; knip went soft-fail → blocking
  (improvement).
- Git hooks restored (`lefthook.yml`): commit-msg validation, pre-commit
  safety + turbo affected lint/typecheck, pre-push affected verify.
- Images: all 13 bake targets (9 app + 4 infra) with smoke, PR dry-run lane
  rehearses the main path; sites (9) deploy + PR dry-run; helm push; tofu
  plan (PR) / apply with github isolation and the cloudflare tunnel-deletion
  gate; ArgoCD sync + health-wait; release-please; version commit-back
  (digest plumbing fixed in #1546); cooklang plugin publish.
- e2e: only `sjer.red` and `llm-observability` define `test:e2e`; both have
  dedicated steps. `resume` only ever had `build` + `deploy` scripts, so its
  build-only step loses nothing.
- Old nested-workspace `bun.lock` drift gate (`--seeds`, PR #1213) is
  obsolete: no `file:` deps remain (all `workspace:*`); `lockfile-check` and
  the turbo graph cover the scenario.

## Session Log — 2026-07-18

### Done

- Diffed old pipeline (generator `pipeline-builder.ts`, `catalog.ts` at
  `6dba01a90^`) against `.buildkite/pipeline.yml`, root `verify`/`turbo.json`,
  `lefthook.yml`, `bake-images.sh`, `publish-npm.ts`, `rulesets.tf`.
- Findings written up above; no code changed (assessment-only session).

### Remaining

- Operator/next session: uncomment `buildkite/monorepo` required check in
  `rulesets.tf` + apply; decide on greptile gate blocking vs soft; drop the
  `feature/ci-parity` clause from the ci-image step.

### Caveats

- Did not verify via Buildkite/GitHub APIs that the aggregate
  `buildkite/monorepo` commit status is actually being posted on PR builds —
  confirm one PR build shows it before requiring it.

## Session Log — 2026-07-18 (fixes)

### Done

All gaps + minor deltas fixed on branch `fix/ci-gap-fixes`:

- **Required check (gap 1):** verified live via `gh api` that Buildkite posts
  the aggregate context **`buildkite/monorepo/pr`** — NOT the bare
  `buildkite/monorepo` the replatform staged (success on PR #1542 head
  `1433973f`, failure on #1543–#1547 heads, all of which merged red —
  the gap in action). Uncommented the `required_check` in
  `packages/homelab/src/tofu/github/rulesets.tf` with the corrected
  context; validated with `tofu init -backend=false && tofu validate`.
  Applies via the main-build `tofu apply (github)` step post-merge.
- **Greptile gate (gap 2):** removed `soft_fail: true`, added `retry`
  (infra-only exit codes) — blocking again, matching the old
  `blockingGates` behavior.
- **Parity-branch leftover (gap 3):** dropped the
  `|| build.branch == "feature/ci-parity"` clause + TEMPORARY comment from
  the ci-image refresh step.
- **npm dev lane:** the ":npm: publish packages" step now also publishes
  `<version>-dev.<build#>` to `--tag dev` for all 3 npm packages on every
  main build (old npm-publish-all-dev parity); prod lane runs first because
  dev mode rewrites package.json versions in the working tree.
- **Scanner pins:** `aquasec/trivy:0.72.0` and `semgrep/semgrep:1.170.0`
  with renovate docker annotations (were unpinned `:latest`).
- **Release-please PR auto-skip:** every PR-facing step now carries the
  skip guard (branch is `release-please--branches--main` AND source is
  `webhook` AND `RUN_RELEASE_CI` unset ⇒ step filtered) — webhook builds of
  the release PR upload zero jobs (old `shouldSkipReleasePleasePrBuild`
  parity, incl. the manual-build and RUN_RELEASE_CI escape hatches).
- Doc updated: `packages/homelab/AGENTS.md` ruleset section now names the
  verified `buildkite/monorepo/pr` context and both required checks.

### Remaining

- Merge the PR; the required check goes live when main's
  `tofu apply (github)` step runs. No manual apply needed.

### Caveats

- **Semantics change vs old CI:** the old per-step required checks left
  release-please PRs _unmergeable_ until someone manually triggered CI. With
  the aggregate check + auto-skip, the empty build passes (the
  pipeline-upload step always runs) and the release PR is mergeable
  _without_ CI. Accepted deliberately: the merge itself triggers a full
  main verify, and deploys gate on that.
- Dev-tag npm publishes resume at the next main build; the `-dev.N` suffix
  numbering restarts from the current Buildkite build number.
