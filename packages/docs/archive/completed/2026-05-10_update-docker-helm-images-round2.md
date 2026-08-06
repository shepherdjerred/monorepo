---
id: reference-completed-2026-05-10-update-docker-helm-images-round2
type: reference
status: complete
board: false
---

# Update docker / helm / infra-tool pins (round 2)

## Intent

Bundle the docker/helm/infra-tool updates currently sitting in Renovate dashboard
issue #481 ("Pending Status Checks" + "Awaiting Schedule") into one PR, following
the pattern of #748 (which just merged). Helm chart versions in
`packages/homelab/src/cdk8s/src/versions.ts` are all already at upstream latest
(verified via `helm show chart`), so this round is mostly Dagger base images,
CI-image tool pins, and the prod-image tag bump.

## Scope

### `packages/homelab/src/cdk8s/src/versions.ts`

| entry                                     | current                     | target                      |
| ----------------------------------------- | --------------------------- | --------------------------- |
| `shepherdjerred/scout-for-lol/prod`       | `2.0.0-1904@sha256:3f0baa…` | `2.0.0-2195@sha256:7b1048…` |
| `shepherdjerred/starlight-karma-bot/prod` | `2.0.0-1904@sha256:f722a8…` | `2.0.0-2195@sha256:8b60bc…` |

### `packages/discord-plays-pokemon/compose.yml`

| entry                                          | current digest     | target digest                       |
| ---------------------------------------------- | ------------------ | ----------------------------------- |
| `ghcr.io/shepherdjerred/discord-plays-pokemon` | `sha256:e9c30483…` | `sha256:fe9a84c2…` (= `2.0.0-2195`) |

### `.dagger/src/constants.ts`

| const                   | current                                      | target                                       |
| ----------------------- | -------------------------------------------- | -------------------------------------------- |
| `CADDY_IMAGE`           | `caddy:2.11.1-alpine@sha256:3b2a01…`         | `caddy:2.11.2-alpine@sha256:834468…`         |
| `CADDY_BUILDER_IMAGE`   | `caddy:2.11.1-builder-alpine@sha256:fd1e63…` | `caddy:2.11.2-builder-alpine@sha256:ced7ea…` |
| `GO_IMAGE`              | `golang:1.26.1-bookworm@sha256:ab3d69…`      | `golang:1.26.3-bookworm@sha256:252599…`      |
| `RUST_IMAGE`            | `rust:1.94.1-bookworm@sha256:6ae102…`        | `rust:1.95.0-bookworm@sha256:503651…`        |
| `GOLANGCI_LINT_VERSION` | `v2.11.4`                                    | `v2.12.2`                                    |
| `ARGOCD_CLI_VERSION`    | `v3.3.6`                                     | `v3.4.1`                                     |

### `.buildkite/ci-image/Dockerfile`

| ARG               | current   | target    |
| ----------------- | --------- | --------- |
| `UV_VERSION`      | `0.11.12` | `0.11.13` |
| `GH_VERSION`      | `2.91.0`  | `2.92.0`  |
| `AWSCLI_VERSION`  | `2.34.35` | `2.34.45` |
| `SEMGREP_VERSION` | `1.161.0` | `1.162.0` |

`.buildkite/ci-image/VERSION` (currently `406`) is left untouched — CI bumps it via
version-commit-back after publishing the new ci-base image. Pipeline guard
`ci-base-version-guard` enforces this.

## Out of scope (for this PR)

- Terraform provider bumps (`aws`, `cloudflare`, `github`) — require running
  `tofu init -upgrade` against the SeaweedFS state backend; renovate will handle
  these once schedule fires.
- `ghcr.io/siderolabs/installer` schematic pin (errored entry) — requires
  regenerating the Talos factory schematic via
  `packages/homelab/src/talos/update-image-id.ts`. Defer.
- Major-version npm bumps (zod v4, typescript v6, eslint v10, vite v8, etc.) —
  separate open Renovate PRs already exist (#608, #611, #619, #621, #623, #626).
- Beta/CI-managed images (`shepherdjerred/{scout,starlight,birmel,discord-plays-pokemon,
trmnl-dashboard,temporal-worker,…}` in `versions.ts`) — auto-updated by
  version-commit-back on next CI run; comment is `// not managed by renovate`.

## Files to touch

- `packages/homelab/src/cdk8s/src/versions.ts`
- `packages/discord-plays-pokemon/compose.yml`
- `.dagger/src/constants.ts`
- `.buildkite/ci-image/Dockerfile`

## Verification

1. `cd packages/homelab/src/cdk8s && bun test src/versions.test.ts src/helm-template.test.ts`
2. `cd packages/homelab && bun run scripts/check-docker-images.ts`
3. `bun test ./.dagger/src/__tests__/constants.test.ts`
4. `cd scripts/ci && bun test`
5. `bunx prettier --check <changed files>`
6. `git diff --check`
