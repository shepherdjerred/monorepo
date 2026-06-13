# Tailscale ACLs — enablement runbook

## Status: In Progress — reconciled & validated, not yet applied

The OpenTofu module (`packages/homelab/src/tofu/tailscale/`) is authored, **reconciled against the live console policy, and validated against Tailscale's API** (see step 2), but **not yet applied** and **not yet in CI drift**. The OAuth client exists and is stored in 1Password (step 1). This runbook is the operator path to turn it on safely. It exists because the tailnet currently trusts every device (implicit allow-all); the module moves it to deny-by-default.

## Why a runbook instead of "just apply"

- First apply **overwrites the admin-console policy**. The Tailscale K8s operator relies on `tagOwners` for `tag:k8s`; if those aren't carried over, new `*.ts.net` ingresses break.
- The tailnet hosts the control plane and the OpenTofu **state backend** (`seaweedfs-s3.tailnet-1a49.ts.net`). A bad policy can cut off CI/operator/admin. The module keeps `autogroup:admin` at full access to prevent owner lockout, but infra paths must still be verified.

## 1. Create a Tailscale OAuth client — DONE

Admin console → Settings → OAuth clients → Generate. Scope: **Policy File → Read/Write** (`acl`). Record the client ID + secret.

**Status: done.** A dedicated `acl`-scoped OAuth client was created (separate from the operator's `Tailscale k8s OAuth client`, which is `devices`/`auth_keys`-scoped and returns `403` on `/acl`). Its credentials are stored in the **`Buildkite CI Secrets`** 1Password item (`v64ocnykdqju4ui6j6pua56xw4/rzk3lawpk4yspyyu5rxlz44ssi`) as fields `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` — so both CI (`buildkite-ci-secrets` `envFrom`) and local `op run` (`src/tofu/.env` references) resolve them. Only `op://` references are committed; the secret itself lives only in 1Password.

## 2. Reconcile the current console policy (critical) — DONE

The robust way to reconcile is a **local-state `tofu import` + Tailscale `/acl/validate` dry-run** — it produces a structured diff and verifies the rendered policy without writing to the live tailnet or to remote state:

```bash
# throwaway copy WITHOUT backend.tf so tofu uses local state (no AWS creds, no remote state)
mkdir /tmp/ts-dryrun && cp acl.tf providers.tf variables.tf .terraform.lock.hcl /tmp/ts-dryrun/
cd /tmp/ts-dryrun && tofu init                     # local backend
op run --env-file=<repo>/packages/homelab/src/tofu/.env -- tofu import tailscale_acl.homelab acl
op run --env-file=<repo>/packages/homelab/src/tofu/.env -- tofu plan      # live -> acl.tf diff
# render acl.tf to JSON and POST to the validator (runs the `tests` server-side, no apply):
#   POST https://api.tailscale.com/api/v2/tailnet/-/acl/validate   (200 + {} == valid)
```

> `-backend=false` only works for `tofu validate`; `import`/`plan` need a backend, hence the backend-less throwaway copy for a pure local dry-run.

**Reconciliation result (done).** The live policy was Tailscale's default (allow-all + operator `tagOwners` + default Tailscale-SSH-to-self + Funnel `nodeAttrs`). Findings folded into `acl.tf`:

- **Bug fixed:** the `tests` block used `autogroup:members` as a test `src` — the validator **rejects autogroups as test sources** ("user or host is invalid"), so `tofu apply` would have failed its server-side tests. That member test was removed (the invariant is still enforced by the `acls` rule; a solo tailnet has no member principal to name in a test). Member references normalized to the canonical `autogroup:members`.
- **Preserved:** operator `tag:k8s` ownership (ingresses keep working), `autogroup:admin` full access (no lockout), and **Tailscale-SSH into your own devices** (`{action=check, src=autogroup:members, dst=autogroup:self}`) — the owner SSHes into a Steam Deck / MacBook this way; Windows uses regular sshd (covered by the `admin -> *:*` acl).
- **Dropped on purpose:** the default Funnel `nodeAttrs` grants — Funnel is unused (all `TailscaleIngress` are tailnet-only), so public exposure stays off by default.

Net effect of an apply is now only the intended change: **allow-all → deny-by-default**.

## 3. Plan, preview, apply (local, as operator)

Run from `packages/homelab/src/tofu/` using the shared `.env` (op:// references for `AWS_*` state creds + `TAILSCALE_OAUTH_*`), same as the other stacks:

```bash
cd packages/homelab/src/tofu
op run --env-file=.env -- tofu -chdir=tailscale init      # AWS_* (state) + TAILSCALE_OAUTH_*
op run --env-file=.env -- tofu -chdir=tailscale plan      # review every change
```

This is the first apply against the **real S3 backend** (creates `tailscale/terraform.tfstate`). The dry-run in step 2 used a backend-less local copy; here the backend is real. Rely on `tofu plan` plus the validated `tests` block, then apply:

```bash
op run --env-file=.env -- tofu -chdir=tailscale apply
```

`tests` in `acl.tf` run server-side on apply; a failing assertion blocks the change.

## 4. Verify

- Admin device: can still reach apps and hit the k8s API.
- **SSH into your own devices still works** — `tailscale ssh` / regular SSH into the Steam Deck, MacBook, and Windows PC (the preserved `autogroup:self` rule + the `admin -> *:*` acl).
- A non-admin/member device (if the tailnet is ever shared): can reach `*.ts.net` apps (80/443) but **not** SSH or the k8s API.
- Operator still works: trigger/observe a new `tag:k8s` ingress proxy coming up healthy.
- CI/state: confirm `tofu`/ArgoCD can still reach `seaweedfs-s3.tailnet` and the k8s API.

## 5. Enable CI drift detection — DONE

The OAuth secrets exist in CI (`buildkite-ci-secrets` → `TAILSCALE_OAUTH_CLIENT_ID`/`SECRET`, step 1, reached via the existing `envFrom`), and the code wiring is in place:

1. `scripts/ci/src/catalog.ts` — `tailscale` added to `TOFU_STACKS` + `TOFU_STACK_LABELS` (`"Tailscale ACLs"`).
2. `scripts/ci/src/steps/tofu.ts` — both `tofuStackStep` and `tofuPlanStep` pass `--tailscale-oauth-client-id env:TAILSCALE_OAUTH_CLIENT_ID` / `--tailscale-oauth-client-secret env:TAILSCALE_OAUTH_CLIENT_SECRET` for `stack === "tailscale"`.
3. `.dagger/src/release.ts` (`tofuApplyHelper`/`tofuPlanHelper`) + `.dagger/src/index.ts` (`tofuApply`/`tofuPlan`) — optional `tailscaleOauthClientId` / `tailscaleOauthClientSecret` `Secret` params wired via `.withSecretVariable("TAILSCALE_OAUTH_CLIENT_ID"/"…_SECRET", …)`, mirroring `cloudflareApiToken`.

Verified locally: `scripts/ci` typecheck + 57 pipeline tests pass; `dagger call tofu-apply --help` exposes the two new flags.

> ⚠️ **First apply now happens via CI on merge.** With `tailscale` in `TOFU_STACKS`, PR builds run `tofu plan` (`tofu-plan-tailscale`, drift preview — review it on this PR) and **`main` builds run `tofu apply -auto-approve` (`tofu-tailscale`)**. So merging this to `main` performs the first apply (the `overwrite_existing_content` policy swap) automatically — there is no separate manual step 3 anymore. The plan was validated as behaviour-preserving (allow-all → deny-by-default only), and the PR plan step is the pre-merge review. If you want to apply manually first anyway, run step 3 before merging; CI will then just reconcile against the existing state.

## 6. Phase C — finer, per-service hardening (follow-up)

Today all `*.ts.net` ingresses share `tag:k8s`, so ACLs can't distinguish e.g. argocd from jellyfin. To restrict sensitive surfaces (argocd, temporal-ui, seaweedfs, grafana) to admins only, give each sensitive ingress its own tag via the `TailscaleIngress` construct / operator `ProxyClass` (cdk8s), then add per-tag rules + tests here. Track separately.
