---
id: log-2026-05-23-scout-version-commit-back-check
type: log
status: complete
board: false
---

# Scout Version Commit-Back Check

## Summary

Checked GitHub `main` and recent Buildkite `main` builds after Scout appeared older than expected.

Findings:

- GitHub `main` currently pins `shepherdjerred/scout-for-lol/beta` to `2.0.0-2635@sha256:6ccc83d9011751f50f69a40cc6b585bb99e9a7bf7957810f85665102983b1979`.
- Recent Buildkite main builds did schedule `version-commit-back`; builds 2725, 2741, and 2752 reported the step as passed.
- Build 2752's `version-commit-back` log shows it updated nine image entries locally, including Scout to `2.0.0-2752`, but `git push` failed with `remote: No anonymous write access.` No PR or commit reached GitHub.
- GitHub search found no PR or commit for `2.0.0-2752`.
- Current main build 2760 has `version-commit-back` waiting, but image push jobs are failing first because `GHCR_TOKEN` is missing in Dagger (`secret env var not found`).

## Session Log -- 2026-05-23

### Done

- Loaded relevant version-management, Buildkite, GitHub, and Git skills.
- Checked GitHub `main` via the GitHub connector for `packages/homelab/src/cdk8s/src/versions.ts`.
- Queried recent Buildkite `main` builds with `bk build list` and `bk build view`.
- Inspected Buildkite job logs for build 2752 `version-commit-back` and build 2760 image push failure.

### Remaining

- Fix the CI auth path so `version-commit-back` fails hard on push/PR failures and can actually push `chore/version-bump-pending`.
- Restore/provide the GHCR image push secret or update image pushes to use the intended replacement credential.
- After the auth fixes, rerun or manually apply a version bump newer than `2.0.0-2635` for Scout beta.

### Caveats

- Build 2760 was still in progress/failing during this check; its `version-commit-back` job had not run because dependency image pushes were failing.
- The Buildkite step status is currently misleading: at least build 2752 reported `version-commit-back` as passed despite a failed `git push`.

## Session Log -- 2026-05-23 Implementation

### Done

- Updated `.dagger/src/release.ts` so GitHub App git auth uses explicit `https://git@github.com/...` write URLs and token-only `GIT_ASKPASS`.
- Added `set -eu` and `GIT_TERMINAL_PROMPT=0` to the version, ci-base, cooklang manifest, and cooklang plugin publish git flows.
- Rewrote version, ci-base, and cooklang manifest commit-back PR handling into explicit fail-fast `gh pr list/create/view/merge --repo shepherdjerred/monorepo` steps with non-empty PR number assertions.
- Added `scripts/ci/src/__tests__/dagger-hygiene.test.ts` coverage for the hardened commit-back behavior.
- Verified `bun run scripts/check-dagger-hygiene.ts`, `cd scripts/ci && bun run test`, and `cd scripts/ci && bun run typecheck`.

### Remaining

- Restore/provide the GHCR image push secret or update image pushes to use the intended replacement credential.
- After GHCR image pushes work again, rerun main CI or manually bump Scout beta past `2.0.0-2635`.

### Caveats

- The implementation hardens GitHub App PR creation/failure semantics only; it does not fix the separate `GHCR_TOKEN` image-push failure seen in build 2760.
- `mise` emitted a sandbox warning about tracking trusted config under `~/.local/state/mise`, but the requested checks completed.

## Session Log -- 2026-05-23 PR Follow-Up

### Done

- Opened PR #907 from `codex/fix-version-commit-back-auth`.
- Addressed CodeRabbit's major review finding by removing `>/dev/null 2>&1` hidden-stderr handling from the commit-back branch probes and the cooklang release existence probe.
- Added commit-back hygiene test coverage to reject `>/dev/null 2>&1` in the hardened helpers.
- Re-verified `bun run scripts/check-dagger-hygiene.ts`, `cd scripts/ci && bun run test`, and `cd scripts/ci && bun run typecheck`.
- Addressed Greptile's P2 finding by using the next exported function as the helper-source delimiter instead of the next JSDoc block.

### Remaining

- Wait for Buildkite PR CI to finish.
- Confirm PR #907 has no merge conflicts and no remaining P3-or-higher review comments after the follow-up commit.

### Caveats

- Further direct `bk` polling was temporarily blocked by the local sandbox reviewer usage limit, so PR status polling continued via the GitHub app commit status APIs until escalation is available again.
