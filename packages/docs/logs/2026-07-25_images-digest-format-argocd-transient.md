---
id: images-digest-format-argocd-transient
type: log
status: complete
board: false
---

# Main build 6296: buildx 0.30 digest-format garbage + ArgoCD op-in-progress

Third leg of the get-main-green session (after
[[ci-main-6281-scout-tag-release-failure]] and
[[bindery-missing-smoke-stage]]). Build 6296 got further than any build since
6277 — images (incl. bindery smoke) and sites (archive + `scout-site-archived`
meta-data handshake) both passed — then failed on two new problems in the
first-ever full run of the #1663 push phase.

## Failure 1 — `scout-tag-release`: image-digests meta-data held garbage

`bake-images.sh` records each pushed image's digest with:

```
docker buildx imagetools inspect <ref> --format '{{.Manifest.Digest}}'
```

The ci-image pins **buildx 0.30.1** (`.buildkite/ci-image/Dockerfile`), and
0.30.x silently ignores that template and prints the **full human-readable
inspect output**. Every value in `image-digests` was a multi-line Name/
MediaType/Manifests blob; `scout-site-release.ts tag-release --digest`
correctly rejected it (`--digest must match /^sha256:[a-f0-9]{64}$/`).

Reproduced deterministically with the pinned binary
(`docker run --entrypoint /buildx docker/buildx-bin:0.30.1@sha256:cc16bd… imagetools inspect … --format '{{.Manifest.Digest}}'`
→ full text) vs local buildx 0.33.0 (→ bare digest) — which is why #1663's
local validation never saw it. `--format '{{json .Manifest}}' | jq -r .digest`
returns the correct index digest on **both** versions (verified against the
live `ghcr.io/shepherdjerred/scout-for-lol:72f9ac87b…` image).

**Fix:** extract via the JSON form, and harden the post-extract check from
`[ -z "$digest" ]` to a `^sha256:[a-f0-9]{64}$` regex assert so no format
regression can ever reach meta-data again.

## Failure 2 — `argocd-sync`: "another operation is already in progress"

ArgoCD code 9 — a sync/refresh op from an overlapping build (the earlier
failed builds' syncs) or auto-sync still held the app. This is inherently
transient, but the phrase wasn't in `TRANSIENT_ERROR_PATTERN`
(`scripts/lib/transient.ts`), so `argocd.ts` exited 1 (hard fail, no retry)
instead of 34 (the pipeline retry anchor's auto-retry code).

**Fix:** add the phrase to the pattern + a regression case in
`transient.test.ts` with the exact HTTP 400 body from build 6296.

## Verification

- `docker buildx imagetools inspect … --format '{{json .Manifest}}' | jq -r .digest`
  → `sha256:5150b9ab…` on buildx 0.30.1 (CI pin, via docker/buildx-bin) and
  0.33.0 (local), against the real pushed image.
- `bun test scripts/lib/transient.test.ts` → 24 pass.
- `bun run verify -- --affected` green (pre-commit).

## Session Log — 2026-07-25

### Done

- Diagnosed both 6296 failures; fixed digest extraction in
  `.buildkite/scripts/bake-images.sh` and transient classification in
  `scripts/lib/transient.ts` (+ test), worktree
  `fix/images-digest-and-argocd-transient`.

### Remaining

- Merge, then watch the next main build end-to-end: it should mint the scout
  release pair (digest now valid) and survive ArgoCD op collisions via retry.

### Caveats

- The scout tag mint for 6296's site archive (2.0.0-6296) never happened; the
  next green build archives + mints its own pair, superseding it.
- Alternative considered: bumping the ci-image buildx pin to 0.33 — rejected
  for now (ci-image rebuild cycle, wider blast radius); the JSON form works on
  both, and a future Renovate buildx bump is unaffected.
