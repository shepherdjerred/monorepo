# Manual mass bump of non-code dependencies

## Status

In Progress

## Goal

User asked to **manually apply** (not reconfigure Renovate) all pending non-code
dependency updates — Helm charts, Docker images, CI tools, Terraform providers —
in **one PR**, right now, **including major versions**.

## Approach

Rather than trust the Dependency Dashboard's partial major info, resolved
authoritative latest versions directly:

- **Docker digests** — `crane digest <ref>:<tag>` for every bumped image (short
  hashes cross-checked against the dashboard's computed values — they match).
- **Helm majors** — parsed each repo's `index.yaml` for true latest stable
  (argo-cd 10.1.1, kube-prometheus-stack 87.6.0, redis 27.0.13, mariadb 26.1.7;
  note kube-prometheus-stack's true latest is v87, newer than the dashboard's
  30-day-policy-filtered v86 — took v87 since the ask was "latest").
- **Helm minors / talos** — dashboard exact targets.

## Done in this PR (validated)

`packages/homelab/src/cdk8s/src/versions.ts` — **41 bumps**:

- **28 Docker images** (tag + recomputed digest): minecraft-server, tautulli,
  bazarr(digest), seerr v3.3.0, jellyfin 10.11.11, kometa v2.4.4, prowlarr,
  radarr, sonarr, cloudflared, home-assistant 2026.7.0, zwave-js-ui, syncthing,
  pinchtab, agent-stack-k8s, kueue, gickup, qbittorrent-exporter, postal,
  library/mariadb(digest), clickhouse(digest), library/debian(digest), bugsink,
  temporalio auto-setup/ui/admin-tools, scout-for-lol/prod, karma-bot/prod.
- **12 Helm charts**: argo-cd **10.1.1** (major), cert-manager v1.20.3,
  intel-device-plugins-operator 0.36.0, kube-prometheus-stack **87.6.0** (major),
  prometheus-blackbox-exporter 11.15.1, tailscale-operator 1.98.4, pyroscope
  2.1.0, openebs 4.5.1, velero 12.0.2, redis **27.0.13** (major), seaweedfs
  4.31.0, mariadb **26.1.7** (major).
- **1 github-release**: siderolabs/talos 1.13.5.

`packages/homelab/src/cdk8s/generated/helm/*` — regenerated committed helm-types
from the new chart versions (8 files changed; argo-cd +607 lines for the v10 schema).

### Validation

- helm-types regen: **tsc passed**.
- `bun run typecheck` (homelab): **pass** — our cdk8s values still satisfy every
  new schema, **including all 5 majors**.
- `bun run build` (synth): **pass**.
- Live `argocd-helm-render.test.ts` (HELM_RENDER_TEST): running at commit time;
  pre-commit `helm-template.test.ts` renders from `dist/` independently.

## Remaining (explicitly scoped — NOT in this commit)

The CI-image surface is all-or-nothing (version + SHA256 checksum must move in
lockstep or the CI image build breaks), so it was deliberately not rushed:

- **`.dagger/src/constants.ts`** — ~14 Docker images (rust 1.96, golang 1.26.4,
  playwright v1.61.1, swiftlint 0.65.0, alpine 3.24, opentofu 1.12.1, maven
  3.9.16, texlive(digest), caddy 2.11.4, node(digest), helm 4.2.2, trivy 0.71.0,
  semgrep 1.164.0) + ~12 version-string constants (release-please, gh cli,
  tofu, talos, argocd/velero/buildkite/temporal CLIs, github-mcp-server, codex,
  claude-code).
- **`.buildkite/`** (`setup-tools.sh`, `ci-image/Dockerfile`) — parallel CI-tool
  pins, several with **SHA256 checksums** to recompute per binary.
- **Terraform providers** — aws 6.47.0, cloudflare 5.21.1, radarr 2.4.0, prowlarr
  **v3** (major, constraint widen); each needs `tofu init -upgrade` to regen the
  per-stack `.terraform.lock.hcl`.
- **eufy-security-ws v3** (docker major) and any npm-datasource MCP pins in
  versions.ts (@r-huijts/canvas-mcp 1.3.0) — left out (borderline code).

## Caveats

- The 5 Helm majors pass typecheck + synth, but a homelab is single-node
  (torvalds) and can't be pre-deployed; ArgoCD will apply on merge. Watch the
  first sync for argo-cd v10 / kube-prometheus-stack v87 CRD or values drift.
- kube-prometheus-stack jumped two majors (85→87) vs the dashboard's 85→86.
