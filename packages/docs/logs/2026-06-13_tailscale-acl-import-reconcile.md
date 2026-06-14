# Tailscale ACL (PR #1045) — import, reconcile, validate

## Status: In Progress (module reconciled & validated; not yet applied / not yet in CI)

Session goal: assess the risk of PR #1045 (Tailscale tailnet ACL as OpenTofu) — specifically the user's worry that the first `tofu apply` (`overwrite_existing_content = true`) would clobber existing tailnet settings — and reconcile `acl.tf` against the live policy before any apply.

## What we did

1. **Read the PR.** `tailscale_acl` module with `overwrite_existing_content = true` fully replaces the console policy on first apply. Intentionally not in `TOFU_STACKS`, so merging is inert; the risk is only at a manual `tofu apply`.
2. **Created an `acl`-scoped OAuth client.** The existing operator client (`Tailscale k8s OAuth client`) is `devices`/`auth_keys`-scoped and returns `403` on `/acl` (verified). A dedicated Policy-File Read/Write client was created and stored in the **`Buildkite CI Secrets`** 1P item (`v64ocnykdqju4ui6j6pua56xw4/rzk3lawpk4yspyyu5rxlz44ssi`) as `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET`.
3. **Local-state dry-run import.** `-backend=false` only works for `validate`; for `import`/`plan` we used a throwaway copy of the module without `backend.tf` (local state, no AWS creds, no remote-state write). Imported the live policy and diffed against `acl.tf`.
4. **Live policy was Tailscale's default:** allow-all `* -> *:*`, operator `tagOwners` (`tag:k8s` ← `tag:k8s-operator`), default Tailscale-SSH-to-self, and Funnel `nodeAttrs`. No `groups`/`autoApprovers`/`tests`.
5. **Validated the rendered policy** against `POST /api/v2/tailnet/-/acl/validate` (runs `tests` server-side, no apply).

## Findings & fixes (all in `acl.tf`)

- **Apply-blocking bug fixed:** the `tests` block used `autogroup:members` as a test `src`. Tailscale rejects autogroups as test sources (`user or host is invalid`) — `tofu apply` would have failed its server-side tests. Removed that test (the `acls` rule still enforces the invariant; a solo tailnet has no member principal to name). Confirmed via per-test probing that the other 3 tests pass.
- **Preserved SSH-to-own-devices:** re-added `{action=check, src=autogroup:members, dst=autogroup:self}`. The owner SSHes into a Steam Deck / MacBook via Tailscale SSH; Windows uses regular sshd (covered by `admin -> *:*`). The PR would have dropped this.
- **Funnel dropped on purpose:** the PR omitted the default Funnel `nodeAttrs`; we briefly re-added then removed them per the owner — Funnel is unused (all `TailscaleIngress` are tailnet-only), so public exposure stays off by default.
- Normalized member references to canonical `autogroup:members`.

Net effect of a first apply is now only the intended change: **allow-all → deny-by-default**. Operator tagging, admin full access (no lockout), and SSH-to-self are carried over. Final policy validates clean (`{}`).

## Supporting changes

- `src/tofu/.env`: added `op://` **references** (not secrets) for `TAILSCALE_OAUTH_CLIENT_*` so the stack runs locally like the others (`op run --env-file=.env -- tofu -chdir=tailscale ...`).
- Runbook (`2026-06-06_tailscale-acls-runbook.md`): documented the import+validate dry-run, the autogroup-as-test-source gotcha, the reconciliation outcome, the corrected `.env` path, and that the OAuth secret is in 1P.

## Session Log — 2026-06-13

### Done

- Created dedicated `acl`-scoped Tailscale OAuth client; stored in `Buildkite CI Secrets` 1P item (CI + local `op run` both resolve it). Only `op://` refs committed.
- Reconciled `packages/homelab/src/tofu/tailscale/acl.tf`: removed invalid member test, preserved SSH-to-self, dropped Funnel, normalized `autogroup:members`. Validated clean against Tailscale `/acl/validate`.
- Added `op://` refs to `src/tofu/.env`; updated the runbook.
- **CI wiring done** (runbook step 5): added `tailscale` to `TOFU_STACKS` + label; wired `--tailscale-oauth-client-id/-secret` in `scripts/ci/src/steps/tofu.ts` (apply + plan); added `tailscaleOauthClientId`/`tailscaleOauthClientSecret` `Secret` params to `tofuApply`/`tofuPlan` + helpers in `.dagger`. Verified: `scripts/ci` typecheck + 57 tests pass; `dagger call tofu-apply --help` exposes the flags.

### Remaining

- **First apply now happens via CI on merge** — `tofu-plan-tailscale` previews on PRs; merging to `main` runs `tofu-tailscale` (`tofu apply -auto-approve`), performing the first `overwrite_existing_content` swap. Review the PR plan step before merging; optionally run the manual apply first for extra caution.
- Phase C per-service tagging (argocd/grafana admins-only) — separate follow-up.

### Caveats

- **CI/ArgoCD backend access gap (found & fixed).** The k8s node `torvalds` is `tag:k8s`; the tofu state backend `seaweedfs-s3` and ArgoCD's `chartmuseum` are `tag:k8s` ingresses reached over the tailnet on 443. The first reconciled draft had **no `tag:k8s -> tag:k8s:443` rule**, and `/acl/validate` confirmed deny-by-default would **Drop** that traffic — which would break `tofu apply` for every stack and ArgoCD chart pulls. Fixed by adding an explicit `tag:k8s -> tag:k8s:443` acl + test. Lesson: `/acl/validate` proves the policy is valid and that _named_ tests pass, but it does NOT enumerate every real device-to-device path — those must be reasoned out from live tags (`tailscale status --json`).
- The OAuth **client secret was pasted into chat** — rotate it in the admin console when convenient and re-store the new value in the same 1P fields.
- `overwrite_existing_content = true`: apply replaces the entire console policy. The dry-run confirms the diff is behavior-preserving except allow-all→deny, but re-run `tofu plan` immediately before applying.
- The state backend (`seaweedfs-s3.tailnet-1a49.ts.net`) is reachable only over the tailnet and only while the homelab is up.
