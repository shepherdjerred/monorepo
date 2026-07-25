---
id: 2026-07-25-pr-1639-microscope-dryrun-cred-leak
type: log
status: complete
board: false
---

# PR #1639 — microscope dry-run failure: leaked SeaweedFS creds

## Context

PR #1639 (`feature/ci-write-reduction`, "feat(ci): 10x write reduction") merged
the former per-path PR dry-run micro-lanes (`tofu-plan`, `sites-pr`, `helm-pr`,
`release-pr`, drift) into ONE pod: the `:microscope: pr dry-run (deploy paths +
drift)` step (key `pr-dryrun`) in `.buildkite/pipeline.yml`.

Buildkite build #6142 failed on that step (exit 1):

```
aws: [ERROR]: The user-provided path /workspace/build/buildkite/packages/sjer.red/dist does not exist.
error: Command failed (exit 255): aws s3 sync .../packages/sjer.red/dist s3://sjer-red/ ... --dryrun
  at s3SyncStaticSite (scripts/lib/s3-static-site.ts:78)
  at main (scripts/deploy-site.ts:324)
```

## Root cause

The merged step runs the tofu section and the deploy-site/scout dry-run
rehearsals **in the same shell**. The tofu section did a bare
`export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...` (SeaweedFS creds for
tofu's S3 state backend). Those exports **persisted** into the subsequent
`scripts/deploy-site.ts <site> --dry-run` loop.

`deploy-site.ts` computes `haveCreds` purely from the presence of those two env
vars (lines 302-304). In dry-run the build is stubbed (no `dist/` produced), but
with `haveCreds=true` `s3SyncStaticSite` runs a **real** `aws s3 sync --dryrun`
(s3-static-site.ts, the "creds present — surface what would move" branch), and
AWS errors because the local `dist/` path doesn't exist.

On `main` these were separate pods: the old `sites-pr` lane exported NO AWS
creds, so `haveCreds=false` → the print-only early return. The merge introduced
the leak. `scripts/lib/s3-static-site.ts` and `scripts/deploy-site.ts` are
unchanged by this PR — the regression is entirely in the merged pipeline step.

## Fix

Wrapped the tofu credential export + `tofu-stack.ts plan` loop in a `( … )`
subshell so the SeaweedFS creds are confined to the tofu plans and never reach
the deploy-site/scout rehearsals. `toolchain.sh` sets `set -eu` (sourced as the
step's first line), so a failing tofu plan inside the subshell still fails the
step — error propagation preserved.

## Verification

- `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY bun --no-install scripts/deploy-site.ts sjer.red --dry-run` → exit 0, print-only ("AWS credentials absent; skipping the real aws s3 sync --dryrun call"). This is the post-fix rehearsal path.
- `AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake bun --no-install scripts/deploy-site.ts sjer.red --dry-run` → reproduces the exact CI error ("path ... /dist does not exist"), confirming the leak mechanism.
- `bun --no-install .buildkite/scripts/validate-pipeline.ts` → pass (27 command steps, unique keys, bounded installs).
- `bunx prettier --check .buildkite/pipeline.yml` → pass.
- Banned-pattern scan on the added diff lines → clean.

## Session Log — 2026-07-25

### Done

- `.buildkite/pipeline.yml` (`pr-dryrun` step): confined the SeaweedFS AWS creds to a subshell around the tofu plans so they no longer leak into the `deploy-site`/`scout-site-release` dry-run rehearsals.
- Reproduced the failure locally both ways (creds present = fail, absent = pass) and confirmed the fix restores main's print-only behavior.

### Remaining

- Push and let Buildkite re-run the `microscope-pr-dry-run-deploy-paths-plus-drift` step (plus the docker-images and greptile steps that were canceled when the build failed fast).

### Caveats

- The real `aws s3 sync --dryrun` path in `s3SyncStaticSite` is only meaningful when a `dist/` exists (real deploys / `--prebuilt`). In these PR rehearsals the build is intentionally stubbed, so print-only is the correct behavior — do not "fix" this by building sites in the dry-run lane.

## Codex substitute-review findings (2026-07-25, review #4780326327)

Greptile is credit-paused, so Codex (gpt-5.6-sol) reviewed head `8df970cff` and
posted 3 findings. Two were real and fixed; one was a false positive.

### [P1] checkout-container tmpfs OOM — FALSE POSITIVE

Claim: agent-stack-k8s v0.45.0 clones in a dedicated `checkout` container that
gets only the `buildkite-default-resources` LimitRange (64Mi request / 768Mi
limit), and the tmpfs `workspace-volume` (this PR's cutover) would push a ~1Gi
checkout over that limit and OOM the writer before the command runs.

Evidence it doesn't hold:

- The monorepo **working tree is 56M** (`git ls-files | xargs du -ch` → 56M
  total; no submodules, no LFS). The "~1Gi" conflates the **964MB `.git`** with
  the checkout.
- With git mirrors configured (`default-checkout-params.gitMirrors`,
  buildkite.ts:130-139; restored 2026-07-18), the checkout is a **reference
  clone** — `.git` objects live on the 20Gi `buildkite-git-mirrors` PVC via
  alternates, NOT on the tmpfs workspace. So the checkout container writes only
  the ~56M working tree to tmpfs.
- 56M sits inside the 768Mi checkout-container limit with >13× headroom. No OOM.
- Residual dependency: this holds because git mirrors are configured. If the
  mirror PVC were removed and full clones resumed, 964MB `.git` on tmpfs would
  reintroduce the risk — but mirrors are deliberately in place.

No code change. (The command container's own tmpfs write sizing — node_modules /
turbo scratch charged to container-0 — is the PR author's separate, claimed-sized
concern, not this finding.)

### [P2] shared retry can skip Cooklang commit-back — FIXED

`packages/cooklang-for-obsidian/scripts/publish.ts`: the publisher returned early
when the built artifacts matched the latest release, BEFORE `cooklangCommitBack`.
Under the merged publish lane's shared `retry: *retry`, an interruption after the
GitHub release is cut but before commit-back lands would, on retry, hit that gate
and return — leaving `packages/cooklang-for-obsidian/manifest.json` permanently
stale (the cooklang change gate won't revisit it).

Fix: `builtArtifactsMatchLatestRelease` → `matchingLatestReleaseTag` (returns the
tag `string | null`); the early-return path now compares the built
`manifestVersion` to the matched tag and, when the manifest is behind, resumes
`cooklangCommitBack(matchedTag, …)` before returning. `cooklangCommitBack` is
idempotent (no push / no PR when nothing differs) and the guard skips the
monorepo clone on the common in-sync build, so no infinite-loop regression and no
per-build cost. Verified: cooklang typecheck + lint pass.

### [P2] lockfile format fields missing from the image fingerprint — FIXED

`.buildkite/scripts/select-image-targets.ts`: `parseLockfile` accepts
`lockfileVersion` and `configVersion` (both in `KNOWN_LOCK_KEYS`) but the
`sentinel` omitted them, so a bun format-only bump left every closure fingerprint
equal → selected NO images, and the schema-drift canary stayed green.

Fix: folded `raw["lockfileVersion"]` and `raw["configVersion"]` into the
`sentinel` array, so a format bump flips every fingerprint (fails open to all
targets). Added a regression test ("a lockfile format bump flips the fingerprint
even with no dep change"). Verified: 20/20 select-image-targets tests pass.

## Session Log — 2026-07-25 (findings pass)

### Done

- Fixed [P2] cooklang commit-back resume (`packages/cooklang-for-obsidian/scripts/publish.ts`).
- Fixed [P2] lockfile format fields in the image-selection sentinel (`.buildkite/scripts/select-image-targets.ts`) + regression test (`.buildkite/scripts/select-image-targets.test.ts`).
- Investigated [P1] checkout-container tmpfs OOM and determined it is a false positive (working tree 56M, `.git` on the git-mirror PVC via alternates) — no change.
- Verified: cooklang typecheck/lint pass; root-scripts typecheck/lint/test pass (fresh, `--force`); prettier clean; no banned automation patterns.

### Remaining

- Push and let Buildkite re-run. Greptile gate stays red while credit-paused (out of scope).

### Caveats

- The [P1] false-positive verdict depends on git mirrors staying configured; if the mirror PVC is ever removed, revisit the checkout-container memory limit before enabling tmpfs.
