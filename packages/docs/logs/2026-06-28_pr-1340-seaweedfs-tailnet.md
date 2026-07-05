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
- Greptile re-reviewed and posted a new P1 at `steps/tofu.ts:105`: ArgoCD health-wait does
  not prove the TunnelBinding finalizer has completed
- Implemented explicit fail-closed deletion check: new `waitForArgoCdResourceDeletionHelper`
  Dagger function polls ArgoCD resource API until resource returns 404; new
  `waitForTunnelBindingDeletionStep` Buildkite step between `deploy-argocd` and
  `tofu-apply-cloudflare` (commit 21ba154fd, with namespace fix 1a8c554f4 and version fix
  f55d3f748 based on Greptile's subsequent P1s identifying wrong namespace/CRD version)
- Final pipeline chain: `deploy-argocd` → `wait-tunnel-binding-deletion` → `tofu-apply-cloudflare`
- Build #4748: `mag-greptile-review` passes, all hard gates pass, 0 unresolved Greptile threads
- Session log committed with working code

### Remaining

- Nothing. PR #1340 is CI-green and Greptile-clean. Owner approval required to merge.

### Caveats

- The `wait-tunnel-binding-deletion` step will succeed immediately (first-poll 404) after
  this PR is deployed and the TunnelBinding is permanently gone from the cluster.
- The overall `buildkite/monorepo/pr` context shows "failed" because knip and trivy are soft-fail
  steps — this is normal for all PRs and does NOT block merging (required checks are step-level).
- Greptile caught two real bugs in my initial implementation (wrong namespace `cloudflare-tunnel`
  instead of `seaweedfs`, wrong CRD version `v1` instead of `v1alpha1`). Both were fixed before
  the final green build.

## Session Log — 2026-07-04 (verification pass)

### Done

- Re-verified PR #1340 against all merge-readiness criteria in a fresh worktree:
  - **CI:** Buildkite build #4752 — all 39 GitHub status contexts report SUCCESS.
    The only "Soft failed" steps are `scissors-knip` and `shield-trivy-scan`
    (soft-fail by design; they report SUCCESS to GitHub and do not gate).
  - **Merge conflicts:** clean. `git fetch origin main` + dry-run `git merge --no-ff`
    against `origin/main` merges cleanly (auto-merges only, no conflict markers).
  - **Review comments:** 0 unresolved review threads. All 7 Greptile threads
    (`isResolved=true`), and each verified addressed in the current tree:
    deploy path + dotfiles/toolkit AWS profiles use `seaweedfs-s3.tailnet-1a49.ts.net`
    (`release.ts:830,855`, `dotfiles/private_dot_aws/config`); argocd wait step uses
    `--namespace seaweedfs` and `--version v1alpha1`; fail-closed TunnelBinding deletion
    step sits between `deploy-argocd` and `tofu-apply-cloudflare`.

### Remaining

- Nothing for CI-green. Owner approval still required to merge (out of scope for this pass).

### Caveats

- The author's issue-level question "Is this safe to merge? There is a concerning comment above"
  (2026-07-02) refers to the 2026-06-28 "Hold for sequencing" comment. That P1 sequencing concern
  (network-isolated Dagger deploy container could not reach SeaweedFS after the public host is
  removed) was resolved by commit 7262dfc2e, which repointed consumers to the tailnet endpoint
  after confirming Dagger containers can reach `*.tailnet-1a49.ts.net` (the Tofu seaweedfs stack
  already uses that endpoint for its state backend and bucket management). No new review threads
  or CI failures resulted; the question predates the author's awareness the fix had landed.
