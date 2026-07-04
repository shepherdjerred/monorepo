# Manual mass bump of non-code dependencies

## Status

Complete

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
  **Excluded — talos & kubernetes are notify-only pins.** `siderolabs/talos` and
  `kubernetes/kubernetes` in versions.ts (and `TALOSCTL_VERSION` / `KUBECTL_VERSION`
  in `.dagger/src/constants.ts`) exist to _signal_ the operator to run
  `talosctl upgrade` / the k8s upgrade by hand — they are NOT auto-bump targets and
  must be left at their current pins in dependency-bump PRs.

`packages/homelab/src/cdk8s/generated/helm/*` — regenerated committed helm-types
from the new chart versions (8 files changed; argo-cd +607 lines for the v10 schema).

### Validation

- helm-types regen: **tsc passed**.
- `bun run typecheck` (homelab): **pass** — our cdk8s values still satisfy every
  new schema, **including all 5 majors**.
- `bun run build` (synth): **pass**.
- Live `argocd-helm-render.test.ts` (HELM_RENDER_TEST): running at commit time;
  pre-commit `helm-template.test.ts` renders from `dist/` independently.

## Done in this PR — second commit (`cb05fbc75`)

- **`.dagger/src/constants.ts`** — 14 CI Docker images (crane digests: rust 1.96,
  golang 1.26.4, playwright v1.61.1, swiftlint 0.65.0, alpine 3.24, opentofu
  1.12.1, maven 3.9.16, texlive(digest), caddy 2.11.4, node(digest), helm 4.2.2,
  trivy 0.71.0, semgrep 1.164.0) + 10 version constants (opentofu, gh cli,
  release-please, argocd/velero/buildkite/temporal CLIs, github-mcp-server,
  codex, claude-code). **talosctl & kubectl left pinned (notify-only).** Turned
  out `.buildkite` files carry **no SHA256 checksums** (download-by-version) —
  the "all-or-nothing checksum" concern didn't apply.
- **`.buildkite/ci-image/Dockerfile` + `scripts/setup-tools.sh`** — matching
  CI-tool version pins (node 24.18.0, dagger 0.21.4, uv 0.11.18, semgrep 1.164.0,
  gh 2.93.0, helm v4.2.2, opentofu 1.12.1, aws-cli 2.34.60, trivy 0.71.0).
  kubectl left pinned.
- **`versions.ts`** — bropat/eufy-security-ws 2.1.0 → **3.1.0** (major).
- **Terraform providers** via `tofu init -upgrade -backend=false` (records
  all-platform h1 from signed SHA256SUMS, no OOM): aws 6.45 → **6.53.0**,
  cloudflare 5.19.1 → 5.21.1, radarr 2.3.5 → 2.4.0, prowlarr 2.4.3 → **3.2.1**
  (major; constraint `~> 2.0` → `~> 3.0`). All three stacks `tofu validate` clean.

### Validation (second commit)

- `constants.ts` parses + all 47 exports load; no banned Dagger patterns.
  (Plain `tsc` on `.dagger` fails only on the runtime-codegen'd `@dagger.io/dagger`
  SDK — environmental, unrelated to the string-constant edits.)
- `shellcheck setup-tools.sh` ✅; homelab `typecheck` ✅; all 3 `tofu validate` ✅.

## Caveats

- The 5 Helm majors + provider majors (prowlarr v3) pass typecheck / synth /
  validate, but the homelab is single-node (torvalds) and can't be pre-deployed;
  ArgoCD/tofu apply on merge. Watch the first sync/apply for argo-cd v10,
  kube-prometheus-stack v87, and the prowlarr v3 provider.
- kube-prometheus-stack jumped two majors (85→87); aws provider went to 6.53
  (latest in `~> 6.44`), both newer than the dashboard's 30-day-policy targets.
- **Concurrency incident:** a separate automation running as `claude@sjer.red`
  committed a prettier fix to this branch mid-session (`0a9f7e5e6`) and its git
  operation **discarded my uncommitted working-tree edits** (constants/buildkite/
  eufy/providers/lockfiles). All were regenerable (digests cached) and re-applied
  in `cb05fbc75`. Lesson: on a branch with concurrent automation, commit each
  batch immediately rather than accumulating uncommitted work.
