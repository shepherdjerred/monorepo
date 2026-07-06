# Plan: Shrink the blast radius of the `Buildkite CI Secrets` god item

## Status

In Progress (planning — not yet implemented)

## Context

`Buildkite CI Secrets` (1Password item `rzk3lawpk4yspyyu5rxlz44ssi`, vault _Homelab (Kubernetes)_
`v64ocnykdqju4ui6j6pua56xw4`) bundles **25 credentials** into one item. The `OnePasswordItem`
operator syncs _all_ fields of an item into a single k8s secret `buildkite-ci-secrets`, and that
secret is `envFrom`-mounted into **every CI job pod**. So every step — including build/test/lint
steps that run untrusted PR code, and the greptile review step that checks out and runs PR code —
has all 25 creds in its environment. A poisoned dependency in _any_ package's build, or a malicious
same-repo PR, can exfiltrate the GitHub App private key (repo write), Cloudflare token, SeaweedFS
S3 keys, npm publish token, ArgoCD token, Tailscale OAuth, Home Assistant token, etc.

The operator can only sync a _whole item_ to _one secret_ — you cannot project a subset of fields.
So scoping which step sees which credential **requires splitting the item into several items**, each
synced to its own k8s secret, each mounted only on the steps that need it. The per-step mechanism
already exists: `k8sPlugin({ secrets: [...] })`.

**Goal:** ~80% of steps (everything that runs untrusted PR code) mount **zero** secrets; every other
step mounts only the minimal bundle it uses.

### Two facts discovered during research

1. **`buildkite-argocd-token` is a half-finished migration.** It's referenced as an _optional_ per-step
   secret in `images/sites/tofu/argocd` steps, and a Tofu resource (`token.tf`) writes a 1Password item
   for it — but **there is no `OnePasswordItem` in cdk8s**, so the k8s secret never reaches the cluster.
   Every `secrets: ["buildkite-argocd-token"]` mount today is a **dead no-op**, and `argocd-sync`'s live
   `ARGOCD_AUTH_TOKEN` actually comes from the god secret. This plan finishes that migration.
2. **The GitHub App private key is PR-reachable today.** `greptile-review` (`quality.ts`) runs as a
   `plainStep` that checks out and executes PR code with the god secret mounted; `github-app-token.ts`
   mints a token from `GITHUB_APP_*`. Scoping closes this.

### Decisions (owner)

- **Single PR** for the substantive change (owner accepts the one transient race window; mitigated below).
- **9 tightly-scoped bundles** (per-consumer), not coarse trust-tiers.
- **Evict true non-secrets** to committed config.

## Current distribution points (all three must change)

| #   | Where                | What                                                                                                                                           | File                                                                              |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | universal step mount | `k8sPlugin()` unconditionally adds the god `secretRef` to every step's `container-0`                                                           | `scripts/ci/src/lib/k8s-plugin.ts:57-59`                                          |
| 2   | agent sidecar        | agent-stack `pod-spec-patch` `envFrom`s god secret onto the `agent` daemon container of every job pod (it already has `buildkite-agent-token`) | `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts:140-148` |
| 3   | bootstrap            | static "Generate Pipeline" step `envFrom`s god secret; only needs `BUILDKITE_API_TOKEN` (`change-detection.ts:456`, main-only)                 | `.buildkite/pipeline.yml:27-32`                                                   |

## Target design — scoped bundles

Each bundle = a new 1Password item in vault `v64ocnykdqju4ui6j6pua56xw4`, synced via a new `OnePasswordItem`
(namespace `buildkite`) to a like-named k8s secret. **PR-reachable bundles are kept tiny.**

| Bundle / k8s secret                                         | Fields                                                                                                                                                | Mounted on (✱ = runs untrusted PR code)                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `buildkite-bootstrap-secrets`                               | `BUILDKITE_API_TOKEN`                                                                                                                                 | bootstrap ✱                                                                                                       |
| `buildkite-temporal-secrets`                                | `HASS_TOKEN`, `HASS_URL`                                                                                                                              | temporal `pkg-check` ✱                                                                                            |
| `buildkite-github-app`                                      | `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`                                                                               | greptile-review ✱ (PR); release-please, cooklang-publish, version-commit-back, ci-base-version-commit-back (main) |
| `buildkite-seaweedfs`                                       | `SEAWEEDFS_ACCESS_KEY_ID`, `SEAWEEDFS_SECRET_ACCESS_KEY`                                                                                              | deploy-sites (PR dryrun + main); all tofu steps                                                                   |
| `buildkite-tofu-secrets`                                    | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET`, `TOFU_GITHUB_TOKEN`, `PAGERDUTY_TOKEN` | tofu-plan (PR); tofu-apply-all/github (main)                                                                      |
| `buildkite-ghcr-push`                                       | `GH_TOKEN`                                                                                                                                            | image push, ci-base push (main)                                                                                   |
| `buildkite-npm-publish`                                     | `NPM_TOKEN`                                                                                                                                           | npm publish dev/prod (main)                                                                                       |
| `buildkite-helm-push`                                       | `CHARTMUSEUM_USERNAME`, `CHARTMUSEUM_PASSWORD`                                                                                                        | helm-push-all (main)                                                                                              |
| `buildkite-claude-secrets`                                  | `CLAUDE_CODE_OAUTH_TOKEN`                                                                                                                             | release-please (main)                                                                                             |
| `buildkite-argocd-token` _(Tofu-managed, finish migration)_ | `ARGOCD_AUTH_TOKEN`                                                                                                                                   | argocd-sync (main)                                                                                                |

Notes:

- **Claude OAuth kept out of `buildkite-github-app`** on purpose: greptile (untrusted PR code) mounts the
  github-app bundle; a subscription token there would be PR-exposed. Worth a 1-field item.
- **SeaweedFS split from tofu**: a field lives in only one item; sites + tofu both need SeaweedFS, so it gets
  its own bundle. Tofu steps mount **both** `buildkite-seaweedfs` + `buildkite-tofu-secrets` (the
  `secrets[]` array already supports multiple).
- `HASS_URL`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` are not strictly secret but are _needed inputs_;
  they ride in their consuming bundle (optionally de-concealed in 1Password; no separate plumbing).

### Evicted non-secrets → committed config

`PUBLIC_REDDIT_PIXEL_ID`, `PUBLIC_PINTEREST_TAG_ID` are public client-side tracking IDs that already ship
in the scout site's JS. Remove from 1Password; pass as literal build-env values via a new
`PROD_BUILD_ENV_VALUES` map mirroring the existing `DRYRUN_BUILD_ENV_VALUES` in `sites.ts:24-27`. This is
the only reason `deploy-sites` would need anything beyond `buildkite-seaweedfs`.

### Parked audit fields (do NOT delete — owner-gated)

`OPENAI_API_KEY` (only a smoke-test dummy in CI: `.dagger/src/misc.ts:267`), `ARR_API_KEYS` (no consumer
found), `DAGGER_CLOUD_TOKEN` (CI telemetry goes to in-cluster Tempo/Loki via `DAGGER_ENV`, no Dagger Cloud
config found). Leave these fields in the now-dormant god item (renamed for clarity) for owner review later.
`PAGERDUTY_TOKEN` is **incoming-live** for the PagerDuty tofu stack (PR #1343, not yet in this checkout) —
pre-placed in `buildkite-tofu-secrets`; coordinate merge order with #1343.

## Implementation

Do all of this in a single feature branch / **git worktree** (per repo policy), then one PR.

### A. cdk8s — `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`

- Add a `new OnePasswordItem(...)` for each of the 9 new items + `buildkite-argocd-token`, namespace
  `buildkite` (mirror the existing block at lines 27-47; `itemPath: vaults/<vault>/items/<id>`).
- **Remove** the god `envFrom` from the `agent` sidecar (lines 140-148).
- **Keep** the existing `buildkite-ci-secrets` `OnePasswordItem` (lines 38-47) as a _dormant, unmounted_
  rollback net for this PR; deleting it is a trivial noted follow-up after one green main cycle.

### B. `scripts/ci/src/lib/k8s-plugin.ts`

- Delete the unconditional god `secretRef` (lines 57-59); `k8sPlugin()` with no `secrets` now mounts nothing.
- Change the `secrets[]` loop (line 62) to emit **required** refs (drop `optional: true`) so a missing scoped
  secret hard-fails as `CreateContainerConfigError` instead of silently dropping the env var (repo rule:
  no `optional:true` masking — see `feedback_no_optional_secrets`).
- Thread `secrets` through `k8sPluginWithCheckout` (already does) and ensure `plainStep`/`daggerStep` in
  `lib/buildkite.ts` pass `secrets` (daggerStep already does at line 186; add to `plainStep`).

### C. Per-step wiring (`scripts/ci/src/steps/*.ts`)

Add `secrets: [...]` to each consuming step; **remove every dead `buildkite-argocd-token` optional mount**.

| Step file / fn                      | Add bundle(s)                                      | Remove                                 |
| ----------------------------------- | -------------------------------------------------- | -------------------------------------- |
| `per-package.ts` (temporal)         | `buildkite-temporal-secrets`                       | —                                      |
| `images.ts` (push)                  | `buildkite-ghcr-push`                              | dead `buildkite-argocd-token` (`:291`) |
| `ci-image.ts` (push)                | `buildkite-ghcr-push`                              | —                                      |
| `ci-image.ts` (version-commit-back) | `buildkite-github-app`                             | —                                      |
| `npm.ts`                            | `buildkite-npm-publish`                            | —                                      |
| `helm.ts` (push-all)                | `buildkite-helm-push`                              | —                                      |
| `release.ts` (release-please)       | `buildkite-github-app`, `buildkite-claude-secrets` | —                                      |
| `cooklang.ts`                       | `buildkite-github-app`                             | —                                      |
| `version.ts` (commit-back)          | `buildkite-github-app`                             | —                                      |
| `tofu.ts` (all 3)                   | `buildkite-seaweedfs`, `buildkite-tofu-secrets`    | dead argocd (`:73,108,134`)            |
| `sites.ts`                          | `buildkite-seaweedfs`                              | dead argocd (`:142`); evict `PUBLIC_*` |
| `argocd.ts`                         | `buildkite-argocd-token` (now real, required)      | —                                      |
| `quality.ts` (greptile, plainStep)  | `buildkite-github-app`                             | —                                      |

### D. Bootstrap — `.buildkite/pipeline.yml:27-32`

Replace the god `envFrom` with `buildkite-bootstrap-secrets`; delete the dead `buildkite-argocd-token` block.

### E. Finish argocd-token migration — `packages/homelab/src/tofu/argocd/token.tf:13`

Rename the 1Password field label `ARGOCD_TOKEN` → `ARGOCD_AUTH_TOKEN` (matches what `argocd.ts:33` reads).
Owner runs `tofu -chdir=argocd apply` (this stack is a manual owner apply, not in CI `TOFU_STACKS`).

### F. Evict non-secrets — `scripts/ci/src/steps/sites.ts`

Add `PROD_BUILD_ENV_VALUES` (mirror `DRYRUN_BUILD_ENV_VALUES`, lines 24-27) carrying
`PUBLIC_REDDIT_PIXEL_ID` / `PUBLIC_PINTEREST_TAG_ID` literals; drop the `--build-env-values env:PUBLIC_*`
flags.

### G. 1Password linter snapshot

After the owner creates the new items (Phase 0 below), refresh and commit **in this PR**:
`cd packages/homelab/src/cdk8s && bun run scripts/snapshot-1password-vault.ts` →
commit `onepassword-vault-snapshot.json`. The linter validates every `OnePasswordItem.itemPath` against
the snapshot; the new items must be present or `check-1password-items.ts` fails (pre-commit + CI gate).

### H. Tests (lockstep)

- `scripts/ci/src/__tests__/k8s-plugin.test.ts:41-54` — drop "always injects `buildkite-ci-secrets`";
  assert base `k8sPlugin()` injects no secret and that scoped secrets are **required** (no `optional`).
- `scripts/ci/src/__tests__/pipeline-builder.test.ts` — update `env:PUBLIC_*` → literal-prefix expectations;
  add per-step assertions that the correct scoped secret name is present and `buildkite-ci-secrets` is absent.

## Merge-day procedure (the single-PR race mitigation)

The only step that runs _before_ ArgoCD can reconcile the new `OnePasswordItem`s is the **bootstrap** step
(it generates the pipeline). Every other scoped consumer (deploy/publish/tofu) runs many minutes later, by
which time the operator has synced. Forks are disabled, so untrusted-fork exposure is not in scope.

**Phase 0 — owner prep, before merge (batch the `op` calls):**

1. Create the 9 new 1Password items, **copying** values out of the god item. Verify **no field is blank**
   (the operator skips empty fields, and `envFrom` is not field-linted, so a blank field silently drops an
   env var).
2. `token.tf` field rename + `tofu -chdir=argocd apply`.
3. Refresh + commit the vault snapshot (step G) on the PR branch.

**At merge:**

1. Merge the PR.
2. Immediately `argocd app sync buildkite` (or wait for auto-sync); confirm with
   `kubectl get secret -n buildkite` that all 10 new secrets exist and
   `kubectl get secret <name> -n buildkite -o jsonpath='{.data}'` shows the expected keys.
3. Watch the first post-merge main build. If the bootstrap step lost the race
   (`CreateContainerConfigError`, secret not yet synced), it self-heals on **retry** once the secret exists.

## Verification

- `cd packages/homelab && bun run test` _(not bare `bun test`)_ — homelab suite incl. 1Password linter.
- `cd packages/homelab/src/cdk8s && bun run scripts/check-1password-items.ts` — green.
- `cd scripts/ci && bun test` — updated pipeline-builder + k8s-plugin assertions.
- **Generated-pipeline diff:** run `bun scripts/ci/src/main.ts` with representative `BUILDKITE_*` env and
  inspect each step's `envFrom` — confirm the right scoped secret per step and that `buildkite-ci-secrets`
  appears **nowhere**.
- `bun run typecheck` at root.

## Rollback

Revert the PR → restores the god `envFrom` everywhere. Because the god `OnePasswordItem`/secret is kept
dormant in this PR, the god secret still exists, so revert is instant with no re-sync needed.

## Follow-ups (separate, trivial)

- Delete the dormant `buildkite-ci-secrets` `OnePasswordItem` from `buildkite.ts` after one green main cycle.
- Rename the god 1Password item → `buildkite-ci-secrets-ATTIC`; owner decides fate of parked audit fields
  (`OPENAI_API_KEY`, `ARR_API_KEYS`, `DAGGER_CLOUD_TOKEN`).
- Coordinate `PAGERDUTY_TOKEN` placement with PR #1343 (PagerDuty tofu stack).
