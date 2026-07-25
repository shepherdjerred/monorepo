---
id: log-2026-07-25-ghcr-stale-package-cleanup
type: log
status: complete
board: false
---

# GHCR package cleanup — audit, stale deletions, dotfiles + golink fork removal

## Context

Started from "are we still producing all 28 published GHCR packages in CI?" The
authoritative build set is `docker-bake.hcl` (14 service/infra images) +
`.buildkite/scripts/build-ci-image.sh` (`ci-base`) = **15 images CI builds+pushes**.
GHCR never GCs packages, so the Packages page had accumulated leftovers from the
Dagger/Bazel eras, removed workloads, and static sites.

Tooling note: shell/tool output in this session had a display glitch mangling
`shepherdjerred/<name>` → `l`/`n`; every load-bearing string was re-read via
`... | base64` to defeat it.

## Phase 1 — delete 10 stale packages (done, out of band)

Verified 0 runtime image refs (homelab `versions.ts` pins + `resources/*.ts`
`image:` refs), then deleted via `gh api --method DELETE
/user/packages/container/<name>` (needs **both** `delete:packages` and
`read:packages` scopes — `gh auth refresh` added them):

`dns-audit`, `dependency-summary`, `obsidian-sync-client`, `dagger-engine`,
`sjer.red`, `better-skill-capped`, `better-skill-capped-fetcher`, `homelab`,
`sentinel`, `status-page-api`.

Kept `macos-cross-compiler` (user exclusion). Two packages that looked stale from
the CI-build angle were confirmed **live** and held:

- **golink** — homelab Deployment (`cdk8s-charts/golink.ts`) + daily Temporal
  `golink-sync` schedule (05:30 PT). Image built outside the monorepo.
- **dotfiles** — devcontainer/Cursor base image, digest-pinned across 4 packages.
  Built out of band (no Buildkite step, no GH Actions).

## Phase 2 — dotfiles removal + golink fork drop (PR #1635)

User then confirmed dotfiles is unused (purge everything) and that the golink
**fork** is no longer needed (keep the service, move to upstream).

- **dotfiles**: removed `.devcontainer/` (root + homelab + dotfiles + scout),
  `.cursor/Dockerfile` + `.cursor/environment.json` (homelab/dotfiles/scout, kept
  rules/mcp/worktrees), `packages/dotfiles/Dockerfile` + `.dockerignore` +
  `docker-entrypoint.sh` + `scripts/test-docker-image.sh` + dead `.chezmoiignore`
  lines, and the `renovate.json` packageRule. Deleted the GHCR package.
- **golink**: repointed `versions.ts` (`shepherdjerred/golink` →
  `tailscale/golink`) and `golink.ts` to upstream
  `ghcr.io/tailscale/golink:main@sha256:dc62e0d3…` (verified live, multi-arch,
  README-documented). Chart + Temporal sync unchanged. Fork GHCR package deletion
  **deferred** to post-deploy → `packages/docs/todos/golink-fork-ghcr-cleanup.md`.

Verification: `bun run verify -- --affected` green; cdk8s synth confirms the
golink Deployment renders the upstream image; cdk8s tests 239 pass / 0 fail.

## Session Log — 2026-07-25

### Done

- Audited 28 GHCR container packages vs. real build sources + runtime pins.
- Deleted 11 stale/unused GHCR packages total: the 10 above + `dotfiles`.
- PR #1635 (branch `chore/purge-dotfiles-golink-fork`): dotfiles purge + golink
  upstream repoint. Verified green, marked ready for review.
- Added `packages/docs/todos/golink-fork-ghcr-cleanup.md` for the deferred fork
  deletion.
- `gh` token gained `delete:packages` + `read:packages` scopes this session.

### Remaining

- Merge PR #1635.
- Post-deploy: confirm golink pod runs on the upstream image + `go/` links
  resolve, then delete `ghcr.io/shepherdjerred/golink` (the todo tracks this).

### Caveats

- GHCR deletions are irreversible (all versions). `golink` and `macos-cross-compiler`
  intentionally retained.
- The golink repoint drops whatever the fork patched; user confirmed it's no
  longer needed. The real end-to-end check is the pod running upstream in-cluster
  (only observable post-merge/deploy).
- `dotfiles` GHCR image deleted before PR merge — safe because it's dev-only
  (devcontainer/Cursor), nothing at runtime pulls it.
