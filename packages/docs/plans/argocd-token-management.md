# Plan: ArgoCD Token Management via OpenTofu + 1Password

## Status: Implementation Complete, Manual Steps Remaining

## Context

Renamed the ArgoCD CI account from `gha` to `buildkite`. The `ARGOCD_TOKEN` previously lived as a manually-managed field in the `buildkite-ci-secrets` 1Password item. This plan automates token generation: OpenTofu creates the ArgoCD account token and saves it to 1Password. The 1Password K8s operator syncs it to a K8s secret, which BuildKite CI mounts as env vars.

## What Was Implemented

### New tofu module: `packages/homelab/src/tofu/argocd/`

- `backend.tf` — S3 backend (same pattern as cloudflare/github/seaweedfs)
- `providers.tf` — `argoproj-labs/argocd` (~> 7.0) + `1Password/onepassword` (~> 2.0)
- `variables.tf` — `argocd_admin_password` (sensitive) + `cloudflare_account_id` (required by Dagger)
- `token.tf` — `argocd_account_token.buildkite` JWT + `onepassword_item.argocd_buildkite_token` + output UUID

### Dagger pipeline changes

- `homelab-tofu.ts` — Added `"argocd"` to `TOFU_DIRS`, `argocdAdminPassword` + `opServiceAccountToken` to plan options, conditional env var injection
- `homelab-index.ts` — Added new secrets to `HomelabSecrets`
- `homelab-ci-steps.ts` — Threaded new secrets into `planAll()`
- `index.ts` — Added new params to `ci()` and `homelabCi()`, threaded into release options
- `index-ci-helpers.ts` — Added new fields to `ReleasePhaseOptions`
- `index-release-helpers.ts` — Threaded new secrets into `runHomelabRelease()` homelabSecrets

### BuildKite/K8s changes

- `ci.sh` — Added `--argocd-admin-password` + `--op-service-account-token` to base ARGS
- `pipeline.yml` — Added `buildkite-argocd-token` secretRef to CI step's envFrom
- `buildkite.ts` — Added `OnePasswordItem` CRD for `buildkite-argocd-token` (placeholder item ID)

## Next Steps (Manual)

### Step 1: Create 1Password Service Account

Create a service account with access to vault `v64ocnykdqju4ui6j6pua56xw4`. Save the token.

### Step 2: Get ArgoCD admin password

```bash
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath='{.data.password}' | base64 -d
```

### Step 3: Add secrets to `buildkite-ci-secrets` 1Password item

Add two new fields:
- `ARGOCD_ADMIN_PASSWORD` = admin password from step 2
- `OP_SERVICE_ACCOUNT_TOKEN` = service account token from step 1

### Step 4: Run tofu apply locally

```bash
cd packages/homelab/src/tofu/argocd
op run --env-file=.env -- tofu init
op run --env-file=.env -- tofu apply
```

Note: you'll need `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TF_VAR_argocd_admin_password`, `TF_VAR_cloudflare_account_id`, and `OP_SERVICE_ACCOUNT_TOKEN` in your env.

### Step 5: Update placeholder in buildkite.ts

Get the UUID:
```bash
op run --env-file=.env -- tofu output onepassword_item_id
```

Replace `PLACEHOLDER_REPLACE_WITH_TOFU_OUTPUT` in `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts` with the actual UUID.

### Step 6: Deploy cdk8s changes via ArgoCD

Push changes to main. ArgoCD will sync the new `OnePasswordItem` CRD, creating the `buildkite-argocd-token` K8s secret in the `buildkite` namespace.

### Step 7: Verify

```bash
# Verify K8s secret exists with ARGOCD_TOKEN key
kubectl get secret buildkite-argocd-token -n buildkite -o jsonpath='{.data}'

# Push to main and verify CI tofu plan shows no drift for argocd module
# Verify ArgoCD sync step uses the new token successfully
```

### Step 8: Clean up old token

After confirming the new flow works end-to-end, remove the old `ARGOCD_TOKEN` field from the `buildkite-ci-secrets` 1Password item.

## Deployment Order

1. Steps 1-3 (1Password setup) — prerequisite
2. Step 4 (tofu apply) — creates the token and 1P item
3. Step 5 (update placeholder) — connects cdk8s to the 1P item
4. Step 6 (deploy) — creates the K8s secret
5. Push all code changes to main — CI picks up new args and secret mounts
6. Step 7-8 (verify and clean up)
