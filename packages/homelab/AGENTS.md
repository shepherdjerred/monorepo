# Homelab constraints

This package is the declarative owner of the production homelab. It contains
Talos machine configuration, CDK8s charts, Helm types, OpenTofu stacks, and
release tooling. The wiki explains topology and operator workflows; load a
homelab repository skill before changing or operating it.

## Ownership

- `torvalds` is the production/control-plane node; `liskov` is the dedicated CI
  worker. Keep production and Buildkite resource policy distinct.
- Every hosted first-party workload uses a repo-owned namespace/chart and
  ArgoCD Application. Reuse the established deployment, ingress, storage,
  observability, and LinuxServer helpers.
- Recurring work belongs in Temporal. Kubernetes CronJobs are prohibited.
- Versions come from the language-neutral catalog. A chart bump that changes a
  Helm generator input must regenerate and commit the matching types.
- OpenTofu owns external control planes and remote state. Inspect the owning
  stack before changing a provider dashboard or API directly.

## Secrets and network

Secrets are required and fail fast. Add the semantic field to the owning
1Password item, refresh the committed vault snapshot, declare the exact
Buildkite grant when needed, and reference it only in the intended workload.
Buildkite jobs use the tokenless service account and explicit `secretKeyRef`
entries on `container-0`; no `envFrom`, optional refs, or sidecar credentials.

Probe local 1Password access with the exact read or `op vault list`, not
`op whoami`. The `cf` wrapper uses an environment token; test with
`cf auth whoami` or a read-only call. Do not confuse a 403 with failed login.

DNS and public exposure follow the existing Tailscale and Cloudflare paths.
The local `cf` workflow is read-only for DNS; declarative changes remain in
OpenTofu.

## Release and destructive work

Root ArgoCD sync/prune uses `scripts/argocd.ts release-root` with an exact
rendered revision, release inventory, request UUID, operation ownership, child
preflight, wave restoration, and lifecycle annotations/finalizers. Do not
replace it with manual root sync logic or classify pruning from status alone.

Immutable-field preflight evaluates the revision being applied and respects
only declared, effective `jsonPointers`. Unknown selectors or operation fields
fail closed.

Storage deletion, R2 orphan cleanup, state surgery, and resource replacement
are destructive. Produce and review the exact candidate set first, then use the
existing revalidation workflow. A successful backup is not restore proof.

## Verification

Use package scripts rather than ad-hoc tool invocations:

```bash
bun run build
bun run typecheck
bun run test
bun run lint
bun run --cwd packages/homelab/src/cdk8s check:1password
bun run lint:tofu
bun run check:kubeconform
```

Some checks need network schemas or authorized local credentials. State those
separately. Source, Buildkite, artifact, ArgoCD, and live health remain distinct.
