# Tailscale ACLs — enablement runbook

## Status: Not Started

The OpenTofu module (`packages/homelab/src/tofu/tailscale/`) is authored and validated, but **not yet applied** and **not yet in CI drift**. This runbook is the operator path to turn it on safely. It exists because the tailnet currently trusts every device (implicit allow-all); the module moves it to deny-by-default.

## Why a runbook instead of "just apply"

- First apply **overwrites the admin-console policy**. The Tailscale K8s operator relies on `tagOwners` for `tag:k8s`; if those aren't carried over, new `*.ts.net` ingresses break.
- The tailnet hosts the control plane and the OpenTofu **state backend** (`seaweedfs-s3.tailnet-1a49.ts.net`). A bad policy can cut off CI/operator/admin. The module keeps `autogroup:admin` at full access to prevent owner lockout, but infra paths must still be verified.

## 1. Create a Tailscale OAuth client

Admin console → Settings → OAuth clients → Generate. Scope: **`acl`** (write). Optionally `auth_keys` if you later manage keys here. Record the client ID + secret.

Store them in 1Password (the homelab vault) so CI can read them later as `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET`.

## 2. Reconcile the current console policy (critical)

Fetch what's live and merge anything the module is missing (especially `tagOwners` and `autoApprovers` the operator depends on). Using a Tailscale API access token (basic auth: token as the username), `GET` the current policy and save it locally:

```text
GET https://api.tailscale.com/api/v2/tailnet/-/acl   ->   /tmp/current-acl.hujson
```

Compare that file against `acl.tf`. Make sure every tag the operator/devices currently use appears in `tagOwners` with the correct owner. Adjust `acl.tf` as needed.

## 3. Plan, preview, apply (local, as operator)

```bash
cd packages/homelab/src/tofu/tailscale
op run --env-file=../../../../.env.tailscale -- tofu init      # needs AWS_* (state) + TAILSCALE_OAUTH_*
op run --env-file=../../../../.env.tailscale -- tofu plan       # review every change
```

Optionally preview the rendered policy against Tailscale's validator (`POST /api/v2/tailnet/-/acl/preview`) before applying — or just rely on `tofu plan` plus the `tests` block — then apply:

```bash
op run --env-file=../../../../.env.tailscale -- tofu apply
```

`tests` in `acl.tf` run server-side on apply; a failing assertion blocks the change.

## 4. Verify

- Admin device: can still reach apps, SSH a `tag:server`, and hit the k8s API.
- A non-admin/member device: can reach `*.ts.net` apps (80/443) but **not** SSH or the k8s API.
- Operator still works: trigger/observe a new `tag:k8s` ingress proxy coming up healthy.
- CI/state: confirm `tofu`/ArgoCD can still reach `seaweedfs-s3.tailnet` and the k8s API.

## 5. Enable CI drift detection

Once the OAuth secrets exist in CI (`buildkite-ci-secrets` → `TAILSCALE_OAUTH_CLIENT_ID`/`SECRET`), wire the stack in:

1. `scripts/ci/src/catalog.ts` — add to the list + label:

   ```ts
   export const TOFU_STACKS = [
     "cloudflare",
     "github",
     "seaweedfs",
     "tailscale",
   ] as const;
   // TOFU_STACK_LABELS: add  tailscale: "Tailscale ACLs",
   ```

2. `scripts/ci/src/steps/tofu.ts` — in both `tofuStackStep` and `tofuPlanStep`, pass the OAuth secrets for the tailscale stack:

   ```ts
   stack === "tailscale"
     ? "--tailscale-oauth-client-id env:TAILSCALE_OAUTH_CLIENT_ID --tailscale-oauth-client-secret env:TAILSCALE_OAUTH_CLIENT_SECRET"
     : "",
   ```

3. `.dagger/src/release.ts` (`tofuApplyHelper`/`tofuPlanHelper`) + `.dagger/src/index.ts` (`tofuApply`/`tofuPlan`) — add optional `tailscaleOauthClientId` / `tailscaleOauthClientSecret` `Secret` params and `.withSecretVariable("TAILSCALE_OAUTH_CLIENT_ID", …)` / `…_SECRET`, mirroring the existing `cloudflareApiToken` wiring.

After this, PR builds run `tofu plan` (drift) and `main` runs `tofu apply` for the tailscale stack, same as the other modules.

## 6. Phase C — finer, per-service hardening (follow-up)

Today all `*.ts.net` ingresses share `tag:k8s`, so ACLs can't distinguish e.g. argocd from jellyfin. To restrict sensitive surfaces (argocd, temporal-ui, seaweedfs, grafana) to admins only, give each sensitive ingress its own tag via the `TailscaleIngress` construct / operator `ProxyClass` (cdk8s), then add per-tag rules + tests here. Track separately.
