---
id: bindery-missing-smoke-stage
type: log
status: complete
board: false
---

# Main red: bindery image missing the in-image smoke stage (builds 6286, 6288)

Continuation of [[ci-main-6281-scout-tag-release-failure]] (same session): after
PR #1666 merged, main build 6288 failed on a different, pre-existing breakage.

## Symptom

Builds [6286](https://buildkite.com/sjerred/monorepo/builds/6286) and
[6288](https://buildkite.com/sjerred/monorepo/builds/6288) failed in
`:docker: images — build, smoke, push`:

```
ERROR: target bindery: failed to solve: target stage "smoke" could not be found
```

(The `ERROR: no builder "ci" found` earlier in those logs is benign — the
script inspects, then creates the builder.)

## Root cause — cross-PR race between #1643 and #1663

- PR #1643 (`b4948f07c`, merged 21:39) added the self-built bindery image.
  Under the bake flow of that time (no per-target smoke stages) it was
  complete; its main build 6277 went green.
- PR #1663 (`ed13d1bb7`, merged 22:23) cut the image lane over to in-image
  smoke stages: `bake-images.sh` now applies `--set <target>.target=smoke` to
  every bake target, and the PR added `AS smoke` + `AS image` stages to every
  image Dockerfile **in its tree** — which branched before #1643 landed, so
  `packages/homelab/images/bindery/Dockerfile` was never swept.
- Post-merge, bindery is in `INFRA_IMAGES`, gets the smoke override, and has
  no `smoke` stage → deterministic bake failure on every main build that
  selects the `infra` group. 6285 was canceled (superseded), 6286 and 6288
  both died on it; no green main since 6277.

The bindery bake target was also still on pre-cutover conventions:
`tags = ["bindery:dev"]` and no `target = "image"` (every sibling uses
`imagetags(...)` + `target = "image"`).

## Fix

- `packages/homelab/images/bindery/Dockerfile`:
  - named the distroless runtime stage `release`;
  - added a `smoke` stage — based on the existing alpine `source` stage
    (reusing its Renovate-annotated pin rather than duplicating it; the
    distroless release stage has no shell to RUN in), it copies the built
    static binary, boots it with `BINDERY_DB_PATH=/tmp/bindery.db
BINDERY_DATA_DIR=/tmp` (the same env the retired
    `packages/homelab/scripts/smoke-images.ts` bindery check used — default
    DB dir /config doesn't exist in the bare image) and polls
    `/bindery healthcheck` for up to 30s, dumping the boot log on failure —
    the shelfbridge/redlib pattern;
  - added the terminal `FROM release AS image` stage.
- `docker-bake.hcl` bindery target: `target = "image"`,
  `tags = imagetags("bindery")`.

## Verification

- `docker buildx bake --set bindery.target=smoke bindery` locally: full build
  (upstream fetch + patch, frontend, go test gate, go build), smoke stage
  executed — first healthcheck probe hit connection-refused during boot, a
  later one passed, exit 0.
- `docker buildx bake bindery` (default `image` target): builds and tags.
- `bun run verify -- --affected`: green.

## Session Log — 2026-07-25

### Done

- Diagnosed builds 6286/6288: bindery Dockerfile missing the `smoke`/`image`
  stages required since the #1663 cutover (cross-PR race with #1643).
- Fixed Dockerfile + bake target (worktree `fix/bindery-smoke-stage`);
  verified the exact CI bake invocations locally; repo verify green.

### Remaining

- Merge the PR and confirm the next main build goes green end-to-end
  (images → sites archive → scout tag mint, exercising PR #1666's fix too).

### Caveats

- The first green build's version commit-back will bump several image pins at
  once (builds 6278–6288 never completed a commit-back).
- `packages/homelab/scripts/smoke-images.ts` still exists for local
  `bun run smoke`; CI no longer runs it. Left as-is.
