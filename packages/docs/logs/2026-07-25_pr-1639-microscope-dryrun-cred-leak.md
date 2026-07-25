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
