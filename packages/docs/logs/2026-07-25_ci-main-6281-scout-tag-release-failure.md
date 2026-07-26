---
id: ci-main-6281-scout-tag-release-failure
type: log
status: complete
board: false
---

# CI main build 6281 failure — scout tag release lane-gate mismatch

Q&A session: diagnosed why the latest `main` Buildkite build failed.

## Symptom

Build [6281](https://buildkite.com/sjerred/monorepo/builds/6281) (commit `734b56e8d`,
"chore: bump pending image versions (#1665)", the automated version commit-back)
failed on the `:label: scout tag release` step:

```
error: no archive manifest for 2.0.0-6281 in s3://scout-site-releases/ —
refusing to mint ghcr.io/shepherdjerred/scout-for-lol:2.0.0-6281: only
archived site versions may become promotable tags.
```

(`assertArchived`, `scripts/scout-site-release.ts:496`.) Downstream steps
(tofu apply, argo sync, scout prod reconcile, cloudflare, build summary) went
`waiting_failed`; helm push / release-please / version commit-back were canceled.

## Root cause — `sites` vs `site-scout` lane path-list mismatch

The commit touched only `packages/homelab/src/cdk8s/src/versions.ts`.

- `scout-tag-release` gates on the **`site-scout`** lane
  (`.buildkite/scripts/ci-changed.sh`), whose path list **includes**
  `packages/homelab/src/cdk8s/src/versions.ts` → "changed; running". It then
  asserts an archive manifest for `2.0.0-6281` exists.
- The archive is produced inside the `:rocket: deploy sites` step
  (`.buildkite/pipeline.yml` ~line 1028: `scout-site-release.ts archive`),
  but that step first gates on the broader **`sites`** lane, whose path list
  does **not** include `versions.ts` → "sites: unchanged since b4948f07c;
  skipping" — the step exited before ever evaluating its inner `site-scout`
  check, so `archive 2.0.0-6281` never ran.
- `image-digests` meta-data was `{}` (images lane skipped too), so no digest
  existed either. Tag step ran with no archive → 404 on the S3 HeadObject →
  hard fail by design (fail-fast guard is working correctly; the gate wiring
  is what's wrong).

The pipeline comment at `.buildkite/pipeline.yml:1197-1200` even documents the
intended deferral ("the commit-back merge touches versions.ts, which IS in the
site lane, so the next build archives + mints the pair") — but versions.ts is
only in `site-scout`/`scout-reconcile`, not in `sites`, so the deferred archive
never happens for a versions.ts-only commit.

## Fix (applied in this session, `.buildkite/pipeline.yml` only)

Two changes, keeping the separate tag step (it's a legitimate DAG join of the
`images` and `sites` lanes) but removing the duplicated gate inference:

1. **Deploy-sites outer gate can no longer veto the scout lane.** The early
   exit now fires only when _both_ `ci-changed.sh sites` and
   `ci-changed.sh site-scout` report unchanged. The site-scout lane carries
   paths the aggregate `sites` list doesn't (notably `versions.ts`, whose
   commit-back build must archive + mint the deferred pair — the
   content-currency guard in `scripts/scout-site-release.ts:557` depends on
   that build doing so).
2. **Meta-data handshake replaces the re-derived gate.** After a successful
   `archive`, deploy-sites records
   `buildkite-agent meta-data set scout-site-archived 2.0.0-<build>`.
   `scout-tag-release` now gates on that meta-data (absent → defer, exit 0)
   and mints `--version "$archived"` — it observes what the sites step
   actually did instead of re-running `ci-changed.sh site-scout` with a
   second path list that can skew. No script changes needed;
   `assertArchived` stays as the fail-fast backstop.

## Session Log — 2026-07-25

### Done

- Diagnosed build 6281 failure end-to-end: pulled job list + logs via
  Buildkite API, traced gate evaluation in both steps, confirmed lane path
  lists in `.buildkite/scripts/ci-changed.sh` and the changed files of
  `734b56e8d`.
- Applied the fix above in `.buildkite/pipeline.yml` (worktree
  `feature/scout-tag-release-gate`): OR'd outer sites gate, meta-data
  handshake for the tag mint. Validated YAML parse + `bash -n` on both
  edited command blocks; `bun run verify -- --affected` green.

### Remaining

- Merge the PR, then watch the next main build (and especially the next
  image-version commit-back build) mint the scout release pair cleanly.

### Caveats

- Build 6281's release-please and version commit-back were canceled, so
  release artifacts for that build did not complete; the next green main
  build supersedes them.
- The `sites` vs `site-scout` path lists in `ci-changed.sh` still differ
  (also `scripts/lib` granularity); the OR'd gate + handshake makes that
  skew harmless rather than eliminating the duplication.
