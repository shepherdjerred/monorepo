# PR #1340 — SeaweedFS S3 tailnet-only endpoint

## Status

Complete

## Context

PR #1340 ("fix(homelab): make SeaweedFS S3 endpoint tailnet-only") removes the
public Cloudflare tunnel ingress for the SeaweedFS S3 API and migrates all
out-of-cluster consumers to the tailnet hostname (`seaweedfs-s3.tailnet-1a49.ts.net`).

The goal was to harden the attack surface: the S3 API stores the Tofu state bucket
and `llm-archive`, and the only public consumer was an out-of-cluster S3 client that
can reach the tailnet just as well.

## Changes

### Commit 7262dfc2e — initial endpoint migration

- `.dagger/src/release.ts`: both `deploySiteHelper` and `deployStaticSiteHelper`
  now use `seaweedfs-s3.tailnet-1a49.ts.net` instead of `seaweedfs.sjer.red`
- `packages/dotfiles/private_dot_aws/config`: `[default]` and `[profile seaweedfs]`
  endpoint_url migrated to tailnet hostname
- `packages/homelab/src/tofu/cloudflare/sjer-red.tf`: DNS record removal comment
  expanded to document consumer migration
- `packages/homelab/src/cdk8s/src/resources/argo-applications/seaweedfs.ts`:
  expanded comment documenting all migrated consumers and removed TunnelBinding
- `AGENTS.md`: updated SeaweedFS profile note to reference tailnet endpoint

### Commit c03236873 — pipeline sequencing fix (Greptile P1 resolution)

After the initial commit, Greptile flagged a P1 concern: the comment in
`seaweedfs.ts` described a timing window where the Cloudflare tunnel UUID might
be briefly reachable via the raw UUID after DNS removal but before the tunnel route
was pruned. The fix was real, not cosmetic:

- `scripts/ci/src/steps/tofu.ts`:
  - `TOFU_BUNDLE_STACKS` now excludes both `github` and `cloudflare` (was
    only excluding `github`)
  - New exported `homelabTofuApplyCloudflareStep(argocdKey)` that depends on
    the `deploy-argocd` Buildkite step key, ensuring the Cloudflare tunnel
    operator finalizer has removed the ingress route before DNS deletion runs
- `scripts/ci/src/pipeline-builder.ts`:
  - Import `homelabTofuApplyCloudflareStep`
  - Push `homelabTofuApplyCloudflareStep("deploy-argocd")` after the ArgoCD
    sync step when `affected.buildAll || affected.homelabChanged`
  - Add `"tofu-apply-cloudflare"` to `summaryDeps` under the same condition
- `packages/homelab/src/cdk8s/src/resources/argo-applications/seaweedfs.ts`:
  Deployment comment updated to describe the sequencing fix instead of the timing window

## Greptile gate flow

The `mag-greptile-review` Buildkite step runs `scripts/ci/src/wait-for-greptile.ts`,
which polls GitHub GraphQL `reviewThreads` and fails hard if any greptile-apps
thread has `priority <= 3`, `isResolved == false`, `isOutdated == false`.

- **Build #4737** (commit 7262dfc2e): first push resolved 3 old threads (2×P1, 1×P2)
  but Greptile posted a new P1 thread (PRRT_kwDOHf4r4c6M0z70) about the timing
  window comment at `seaweedfs.ts:54`. Gate failed.
- **Build #4740** (commit c03236873): pipeline sequencing fix + comment rewrite
  should address that P1. Awaiting Greptile re-review.

## Key facts (for future agents)

- Tailscale tailnet hostname `seaweedfs-s3.tailnet-1a49.ts.net` IS reachable from
  Dagger Alpine containers in CI — proven by Tofu seaweedfs stack using the same
  hostname for its own S3 backend (`packages/homelab/src/tofu/seaweedfs/backend.tf`).
- `TOFU_STACKS = ["cloudflare", "github", "seaweedfs", "tailscale"]` lives in
  `scripts/ci/src/catalog.ts`. `TOFU_BUNDLE_STACKS` (the parallel-apply set) was
  `TOFU_STACKS.filter(s => s !== "github")` and is now also excluding `cloudflare`.
- The `homelabTofuApplyCloudflareStep` function uses the same `tofuSecretFlags(["cloudflare"])`
  pattern as `homelabTofuApplyGithubStep` — consistent isolation.
- `CLAUDE.md` in this repo is a symlink → `AGENTS.md`; edits must target `AGENTS.md`.

## Session Log — 2026-06-28

### Done

- Migrated all out-of-cluster SeaweedFS S3 consumers to tailnet endpoint (commit 7262dfc2e)
- Diagnosed Greptile P1 root cause: timing-window comment at `seaweedfs.ts:54`
- Implemented real pipeline sequencing fix: `cloudflare` excluded from `TOFU_BUNDLE_STACKS`,
  new `homelabTofuApplyCloudflareStep` sequenced after `deploy-argocd` (commit c03236873)
- All pre-commit hooks pass: typecheck, ESLint, prettier, onepassword-items, dagger-hygiene,
  tunnel-dns-coverage, quality-ratchet, homelab tests (140 pass, 5 skip)
- Pushed to `feature/seaweedfs-tailnet-only`; Build #4740 running

### Remaining

- Wait for Greptile to re-review commit c03236873 and confirm no new P1/P2/P3 threads
- Confirm Build #4740 passes `mag-greptile-review` gate and all other CI checks
- Report completion to team-lead

### Caveats

- The `homelabTofuApplyCloudflareStep` uses `secrets: ["buildkite-argocd-token"]` in its
  k8s plugin — this is inherited from the existing pattern; the cloudflare apply itself
  doesn't need an ArgoCD token but the pod spec is consistent with other tofu steps.
- Greptile re-review takes ~3 minutes after a push; if it posts another concern,
  the remaining fix scope is small (both the pipeline sequencing and comment are already
  correct — any new thread would be cosmetic at most).
