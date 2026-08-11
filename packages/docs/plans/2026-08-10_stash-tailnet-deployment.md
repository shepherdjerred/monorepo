---
id: plan-2026-08-10-stash-tailnet-deployment
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Dedicated Stash Tailnet Deployment

## Goal

Deploy Stash as an isolated homelab service at the MagicDNS host
`stash.tailnet-1a49.ts.net`. Bootstrap the exact synthesized workload directly
with Kubernetes before opening the PR, then make ArgoCD the durable owner after
the PR merges and its internal chart is published. Access must remain private to
the Tailscale tailnet, and Stash's built-in single-user username/password
authentication must be active before the workload becomes Ready.

This first phase proves deployment, persistence, private HTTPS, built-in
authentication, and backup coverage. It knowingly uses the current unencrypted
local storage and backup path temporarily; that accepted risk does not block
personal media use after runtime acceptance.

## Scope

Included:

- A dedicated `stash` namespace, internal Helm chart, and ArgoCD Application.
- The official Stash container pinned to the current stable `v0.31.1` tag and
  immutable multi-architecture digest
  `sha256:df744af5a0c976e2ec671052ecc1f8a9aa757fa12b8f9930b59910b7295f0da6`.
- A private Tailscale Layer 7 ingress with operator-managed HTTPS and no Funnel
  or Cloudflare public route.
- Built-in Stash authentication bootstrapped from 1Password before readiness.
- Dedicated state, generated-content, and library storage with explicit backup
  policy classifications.
- All three persistent volumes included in the existing Velero/OpenEBS backup
  schedules and Cloudflare R2 destination from their first populated state.
- A bounded out-of-band bootstrap using only the synthesized Stash workload
  manifest, followed immediately by a git-spice PR and explicit ArgoCD ownership
  handoff.
- Default-deny network policy, health probes, focused synth tests, and runtime
  acceptance checks.

Excluded:

- SSO, an external authentication proxy, multi-user authorization, or
  identity-aware Tailscale headers.
- Encryption at rest for OpenEBS/ZFS volumes or client-side encrypted backups.
- Automated ingestion, scraper credentials, plugins, metadata-provider
  configuration, API keys, downloader automation, or integrations with the
  existing media chart. Manual library setup remains an operator activity after
  deployment acceptance.
- Public internet exposure, Tailscale Funnel, a `stash.sjer.red` hostname, or a
  Cloudflare tunnel binding.
- Intel GPU allocation and hardware transcoding. Add it only after the initial
  deployment is stable and workload evidence justifies it.

### Public terminology and disclosure

Describe Stash neutrally as a private media organizer and its collection as a
private or personal media library. Do not name, characterize, imply, or provide
examples of the library's content category in any artifact that may leave the
private working context.

This rule applies to source comments, identifiers where a neutral name is
possible, test fixtures, logs, error messages, documentation, commit subjects
and bodies, PR titles and descriptions, review replies, release notes,
screenshots, captions, and demo artifacts. Use synthetic, category-neutral
filenames and metadata in tests. Runtime evidence must use the empty library or
fully neutral synthetic data and must not capture real thumbnails, filenames,
performer metadata, tags, or scan paths.

Before publication, review the complete `origin/main...HEAD` diff together with
all commit and PR metadata for this disclosure boundary. Keep upstream links
limited to technical documentation needed to review or operate the deployment;
do not quote or reproduce upstream marketing copy.

## Decisions

### Isolation

Stash will not join the broad `media` namespace or reuse the Plex, movie,
television, or qBittorrent PVCs. It gets its own namespace, Application,
NetworkPolicies, secret, and volumes. This keeps a private workload outside
the existing media service trust and storage boundaries.

The only user-facing path is:

```text
tailnet browser
  -> Tailscale HTTPS ingress (stash.tailnet-1a49.ts.net)
  -> stash Service:9999
  -> Stash pod:9999
```

The current tailnet ACL already allows members to operator-managed `tag:k8s`
web ingresses on TCP 443 and grants no Funnel capability. No Tailscale policy
change is required for this phase. Stash's password is defense in depth inside
that private connectivity boundary.

### Out-of-band bootstrap and ownership handoff

The operator explicitly authorizes a one-time direct Kubernetes bootstrap
before the PR is opened. This is a deployment-order exception, not a second
configuration path:

- Finish the repository implementation first, commit it locally, and synthesize
  from that clean commit.
- Apply only `packages/homelab/src/cdk8s/dist/stash.k8s.yaml`. Do not apply
  `apps.k8s.yaml`, `service-probes.k8s.yaml`, a whole `dist/` directory, or any
  other chart out of band.
- Do not hand-author, edit, or retain a second manifest. Record the source commit
  and SHA-256 of the exact synthesized file used for dry-run, diff, and apply.
- Use server-side apply with the dedicated field manager `stash-bootstrap` and
  never use `--force-conflicts`.
- Open the git-spice PR immediately after the direct workload reaches its
  initial acceptance boundary. The period before ArgoCD adoption is expected
  drift and must remain short and visible in the PR.
- After merge, chart publication, and ArgoCD adoption, stop using the bootstrap
  field manager. Every later change goes through Git and ArgoCD.

The direct manifest creates the namespace and workload resources, including the
`OnePasswordItem`, PVCs, Deployment, Service, Tailscale Ingress, and
NetworkPolicies. The PR adds the durable internal chart, ArgoCD Application, and
shared service-probe registration. Existing cluster-wide Velero schedules will
select the backup-enabled PVCs as soon as they exist; they do not require the
new ArgoCD Application to start protecting them.

If the committed source changes during review in a way that changes
`stash.k8s.yaml`, regenerate, re-run focused checks, inspect the new diff, apply
that exact revision with the same field manager, and update the manifest hash
and live verification in the PR. Documentation-only or PR-metadata changes do
not require a live reapply.

### Authentication bootstrap

Stash v0.31.1 stores `username` and a bcrypt password hash in `config.yml`.
Its supported `STASH_` environment overrides intentionally do not include
credentials, so directly injecting `STASH_USERNAME` and `STASH_PASSWORD` into
the main container would not enable authentication.

Create a 1Password Login item named `stash` with these fields:

- `username`: a simple value limited to ASCII letters, digits, `.`, `_`, and
  `-`.
- `password`: the generated plaintext used by the operator to sign in; never
  mounted into the Stash container.
- `password_hash`: a bcrypt cost-10 hash of that same password.

Generate the hash interactively so the plaintext does not appear in shell
history or process arguments. Stash uses Go's bcrypt verifier; accept only a
cost-10 `$2a$`, `$2b$`, or `$2y$` hash. Reference the item by immutable item ID
through `vaultItemPath(...)`, then refresh the committed vault-structure
snapshot. The snapshot contains only hashes of item metadata and field names,
not secret values.

An init container based on the repository's already-pinned BusyBox image will:

1. Read only `username` and `password_hash` from the operator-created Secret.
2. Fail if either value is absent or does not match the expected format.
3. Remove only existing top-level `username:` and `password:` entries from the
   persistent configuration, append the desired values, and atomically replace
   `config.yml` with mode `0600`.
4. Exit before the Stash container starts.

Run the init container on every pod start so 1Password remains authoritative.
Changing a password only in the Stash UI is therefore not durable; rotation is
a coordinated update of both 1Password fields followed by a controlled
deployment restart. Never log either credential field. The main Stash
container must not receive the plaintext password or mount the Kubernetes
Secret.

This ordering removes the first-boot unauthenticated window. Stash must not be
marked Ready unless its persistent configuration already contains both auth
fields.

### Runtime and health

Run one replica with `Recreate` strategy because Stash uses SQLite and its state
PVC is ReadWriteOnce. Expose only container port 9999 through a ClusterIP
Service. Use the upstream `/healthz` heartbeat for startup, readiness, liveness,
and the registered blackbox probe; upstream installs that heartbeat before its
authentication middleware, so probes do not need credentials.

Use `withCommonProps`, explicit resource requests and limits, a medium Tailscale
proxy class, no host networking, no host ports, no privileged mode, no
privilege escalation, and no service-account token. Start with:

- CPU: 250m request, 4 cores limit.
- Memory: 512 MiB request, 4 GiB limit.
- Startup: `/healthz` every 5 seconds, allowing up to 5 minutes for first-run
  database initialization.
- Readiness: `/healthz` every 10 seconds.
- Liveness: `/healthz` every 30 seconds.

The upstream image runs as root. Keep that explicit and add only the required
kube-linter exception. Attempt a read-only root filesystem with writable mounts
for `/state`, `/generated`, `/cache`, and `/tmp`; if upstream behavior writes
elsewhere, identify and mount the exact path instead of making the whole root
filesystem writable without evidence.

Configure these supported paths:

- `STASH_CONFIG_FILE=/state/config.yml`
- `STASH_STASH=/data/`
- `STASH_METADATA=/state/metadata/`
- `STASH_BLOBS=/state/blobs/`
- `STASH_GENERATED=/generated/`
- `STASH_CACHE=/cache/`
- `STASH_PORT=9999`

Pass `--nobrowser` to the Stash entrypoint. Keep cache and `/tmp` on bounded
`emptyDir` volumes; do not persist disposable cache data.

### Storage and backup boundary

Create three dedicated thin-provisioned ReadWriteOnce PVCs:

| PVC               | Class    | Initial size | Contents                                                    | Phase-one backup policy                                                |
| ----------------- | -------- | -----------: | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `stash-state`     | ZFS NVMe |       64 GiB | Config, SQLite database, metadata, plugins, scrapers, blobs | Enabled: application configuration, database, and curated metadata     |
| `stash-generated` | ZFS SATA |      256 GiB | Screenshots, previews, sprites, and transcodes              | Enabled: preserve generated assets and avoid a full regeneration cycle |
| `stash-media`     | ZFS SATA |        1 TiB | Source library mounted at `/data`                           | Enabled: preserve the personal media library                           |

Use an 8 GiB disk-backed `emptyDir` for `/cache` and a 2 GiB disk-backed
`emptyDir` for `/tmp`. The PVC requests establish initial ceilings, not a claim
that the physical data already exists.

Add all three PVCs to `pvc-backup-policy.json` as `enabled`; synthesis must fail
if any is unclassified. Their labels must opt into both the six-hourly recovery
points and the daily, weekly, and monthly retention schedules already generated
from the repository's Velero configuration.

This temporarily accepts two facts: the local ZFS datasets are not encrypted at
rest, and the OpenEBS ZFS data stream sent to R2 is not client-side encrypted by
this deployment. Recoverability is preferred over waiting for that hardening.
The follow-up encryption design must cover local datasets, backup data, key
custody, recovery, and a migration path that does not discard these backups.

The first backup can transfer up to the populated size of the three volumes;
later backups use the existing incremental ZFS path. Confirm capacity and
completion from actual R2 objects rather than assuming a Velero phase alone
proves that the volume streams arrived.

### Network policy

Select the Stash pod with a stable `app: stash` label and apply ingress and
egress policy together:

- Permit TCP 9999 ingress only from the `tailscale` namespace and from the
  Prometheus namespace used by the registered blackbox probe.
- Permit TCP/UDP 53 egress only to kube-dns.
- Permit TCP 80 and 443 egress to the internet for release checks, scraper
  catalogs, plugins, and future metadata providers.
- Permit no ingress from the `media`, `cloudflare-tunnel`, or default namespace.
- Do not add DLNA, multicast, host networking, downloader, or cross-namespace
  media rules in this phase.

### Documentation

Add a focused explanation page at
`packages/docs/wiki/src/content/docs/explanation/homelab/stash-security-boundary.md`
when implementing the deployment. It should explain the isolation, two-layer
tailnet-plus-password access model, credential bootstrap, and the explicit
temporary encryption risk. Keep operating steps in the plan/PR or a separate
how-to page rather than mixing them into the explanation.

## Implementation Changes

### Image and secret prerequisites

- Add the Renovate-managed `stashapp/stash` v0.31.1 tag and digest to
  `packages/homelab/src/cdk8s/src/versions.ts`.
- Create the 1Password item and record its immutable item ID.
- Refresh
  `packages/homelab/src/cdk8s/onepassword-vault-snapshot.json` with
  `bun run scripts/snapshot-1password-vault.ts` from the CDK8s package.

### Workload chart

- Add `packages/homelab/src/cdk8s/src/resources/stash/index.ts` for the
  OnePasswordItem, PVCs, init container, Deployment, Service,
  `TailscaleIngress`, probes, and NetworkPolicies.
- Add `packages/homelab/src/cdk8s/src/cdk8s-charts/stash.ts` for the dedicated
  namespace and workload.
- Register `createStashChart` in
  `packages/homelab/src/cdk8s/src/setup-charts.ts` before the service-probes
  chart, which must remain last.
- Add the three explicit entries to
  `packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json`.

### GitOps publication

- Add `packages/homelab/src/cdk8s/helm/stash/Chart.yaml` and `values.yaml`, using
  the repository's `$version`/`$appVersion` internal chart convention.
- Add
  `packages/homelab/src/cdk8s/src/resources/argo-applications/stash.ts` with
  chart `stash`, destination namespace `stash`, ChartMuseum source, automated
  sync, `CreateNamespace=true`, and the standard `~2.0.0-0` target revision.
- Register `createStashApp` in
  `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts`.
- Do not add a Cloudflare binding, Funnel annotation, public DNS record, or
  permanent direct-apply script. The bootstrap uses the generated workload
  artifact only and is not committed as a parallel deployment mechanism.
- Assert that the application release policy adds the standard lifecycle
  annotation and resources finalizer needed by the root app's prune safety
  model.

### Tests

Add a focused Stash synth test that validates the emitted manifests, including:

- Exactly one Stash replica with `Recreate` strategy and the pinned image.
- The auth init container consumes only `username` and `password_hash`, rejects
  malformed values, updates the config atomically, and runs before Stash.
- The main container receives no plaintext password or secret volume.
- All supported Stash path variables, volume mounts, storage classes, sizes,
  resource bounds, and `/healthz` probes are exact.
- The ingress uses class `tailscale`, host `stash`, TLS, medium proxy class, and
  no Funnel/public annotations.
- NetworkPolicy admits only the intended ingress and egress paths.
- All three PVCs have explicit backup-enabled labels and policy entries.
- The Argo Application and both chart registration points are present.

## Verification

### Source and manifest validation

From `packages/homelab/src/cdk8s`:

```bash
bun run build
bun test src/resources/stash/index.test.ts
bun run typecheck
bun run lint
bun run check:1password
HELM_RENDER_TEST=1 bun test src/argocd-helm-render.test.ts
```

From the repository root, validate the plan and all changed documentation with
the focused Prettier and TODO checks. Do not substitute a whole-repository
`bun run verify` for these implementation checks; Buildkite remains the
exhaustive gate.

Before touching the cluster, restack the branch on current `origin/main` with
git-spice if needed, create the reviewed local commit, and require a clean
worktree. Synthesize from that exact commit. Inspect
`dist/stash.k8s.yaml` to confirm it contains only the dedicated Namespace,
OnePasswordItem, PVCs, Deployment, Service, Ingress, and NetworkPolicies. Record
both `git rev-parse HEAD` and `shasum -a 256 dist/stash.k8s.yaml` for the PR.

### Direct Kubernetes bootstrap

First prove the current kube context resolves to the production `torvalds` node.
Inventory any existing `stash` namespace or same-named resources. A missing
namespace is the expected first-deploy state; if anything already exists, stop
and reconcile ownership and data before applying.

Run server validation and inspect the full diff before the one authorized
mutation:

```bash
kubectl config current-context
kubectl get node torvalds
kubectl apply --server-side --field-manager=stash-bootstrap --dry-run=server -f dist/stash.k8s.yaml
kubectl diff --server-side --field-manager=stash-bootstrap -f dist/stash.k8s.yaml
kubectl apply --server-side --field-manager=stash-bootstrap -f dist/stash.k8s.yaml
```

`kubectl diff` exits 1 when it finds the expected create diff; inspect that diff
rather than treating the status as an infrastructure failure. Do not pass
`--force-conflicts`, apply a directory, or broaden the target after dry-run.

After the apply:

1. Confirm the namespace exists, the `OnePasswordItem` reconciles, all three
   PVCs are Bound with backup-enabled labels, and the Deployment rollout
   completes.
2. Confirm the auth init container exits successfully and neither its output nor
   the Stash logs contain secret values.
3. Confirm the Tailscale ingress receives its MagicDNS address and valid TLS
   certificate, and that the service is unreachable with Tailscale disabled.
4. Confirm `/healthz` returns success without credentials while `/` redirects
   to `/login` for a new session.
5. Confirm an incorrect password is rejected, the 1Password password succeeds,
   logout removes access, and a fresh browser session requires login.
6. Confirm no Cloudflare tunnel, Funnel annotation, public DNS record, real
   library data, scan path, or scraper credential was introduced by the
   bootstrap manifest.
7. Create or await a backup. Confirm it attempts all three ZFS volume snapshots
   and that R2 contains a non-empty data stream plus its metadata object for each
   PVC. Record exact object names, sizes, and the backup revision without
   exposing library metadata.

Open the draft PR immediately after steps 1 through 6. Backup verification may
finish while the draft and Buildkite checks run, but it must be added to the PR
before the PR is marked ready.

### PR publication and GitOps adoption

Use git-spice for the stack-of-one PR. Preview the submission first and provide
explicit metadata synthesized from the complete `origin/main...HEAD` diff. The
neutral title should be `feat(homelab): deploy private Stash media service`.
The body must use `Why`, `What`, and `Verification` sections and include:

- The direct-bootstrap source commit and manifest SHA-256.
- The fact that the live workload temporarily precedes ArgoCD ownership.
- Tailnet, authentication, PVC, and backup evidence using neutral terminology.
- Exact focused commands, Buildkite status, and any still-pending backup or
  post-merge adoption check.

After merge and internal-chart publication:

1. Confirm the exact published chart revision is the one the root `apps`
   Application reconciles and that it creates the `stash` Application.
2. Confirm the `stash` Application adopts the existing resources without PVC or
   namespace replacement, then reaches Synced and Healthy.
3. Confirm `argocd app diff stash` is empty and ArgoCD resource tracking covers
   every object emitted by the Stash chart.
4. Confirm the shared service-probes chart now contains the Stash blackbox probe
   and remains Healthy.
5. Restart the pod through GitOps and confirm built-in authentication,
   application state, PVC identity, and backup labels persist.
6. Recheck that scheduled backups continue after ownership transfer. Update the
   PR's final verification boundary with the exact deployed chart revision and
   live ArgoCD state.

Runtime success establishes an authenticated Stash instance and observed backup
coverage for all three PVCs. It does not establish encryption at rest,
client-side backup encryption, restoreability, or GPU transcoding. Library
population may proceed as a separate operator activity under the accepted
temporary encryption risk.

## Rollout and Rollback

The rollout has two explicit ownership states:

1. **Bootstrap:** the committed and hashed Stash manifest is applied directly
   with field manager `stash-bootstrap`; no ArgoCD Application exists yet.
2. **Steady state:** the merged internal chart and root app create the Stash
   Application, which adopts the exact resources; Git and ArgoCD become the only
   mutation path.

The first certificate request can be slow while the Tailscale operator obtains
the certificate, so distinguish that known startup condition from a failing
workload. Do not create the PR until the direct workload itself is Ready and
authentication works, but do not wait for the first scheduled backup before
opening the draft.

Before ArgoCD adoption, an application regression may be contained by scaling
the Stash Deployment to zero. Preserve the namespace, PVCs, and 1Password item.
Record any imperative containment in the PR and make the committed desired state
match before resuming. Do not delete stateful resources as routine rollback.

After ArgoCD adoption, roll back the image or configuration through Git and let
ArgoCD reconcile it. Never return to `stash-bootstrap` direct apply. If the PR is
delayed or rejected, explicitly choose whether to keep the documented temporary
deployment or scale it to zero; do not leave its unmanaged status unstated. Any
resource or data deletion requires a fresh exact inventory and explicit
destructive approval.

## Remaining

- [x] Create the Stash 1Password Login item with matching plaintext password
      and cost-10 bcrypt hash, then refresh the safe vault snapshot.
- [x] Add the pinned Stash version, dedicated chart, namespace, workload,
      volumes, probes, auth init container, and restrictive NetworkPolicies.
- [x] Add and register the internal Helm chart and ArgoCD Application.
- [x] Classify all Stash PVCs as backup-enabled and add manifest-level tests
      for the security and storage invariants.
- [x] Add the focused human wiki explanation of the Stash security boundary.
- [x] Run focused CDK8s, 1Password, Helm render, and docs validation.
- [ ] Confirm Buildkite is green for the published PR head.
- [x] Commit and hash the exact synthesized Stash manifest, validate the
      production context, inspect the server-side diff, and apply only that
      manifest with the `stash-bootstrap` field manager.
- [x] Complete direct-deployment authentication and storage acceptance, then
      immediately submit the neutral-language draft PR with git-spice.
- [x] Verify non-empty R2 data streams for all three PVCs.
- [ ] Promote the PR only after focused checks and Buildkite are green.
- [ ] After merge and chart publication, prove the Stash Application adopted
      every live resource with an empty ArgoCD diff, then retire direct apply.
- [ ] Plan encryption at rest, client-side backup encryption, restore testing,
      and key recovery as follow-up hardening without blocking initial use.

## References

- [Stash Docker installation](https://docs.stashapp.cc/installation/docker/)
- [Stash authentication configuration](https://docs.stashapp.cc/in-app-manual/configuration/)
- [Stash v0.31.1 source](https://github.com/stashapp/stash/tree/v0.31.1)
- [Tailscale Kubernetes ingress](https://tailscale.com/docs/kubernetes-operator/ingress)

## Comment Log

- 2026-08-10 — Initial plan. The requested first phase is a dedicated Stash
  deployment on Tailscale with Stash's built-in authentication. External auth,
  encryption at rest, encrypted backups, and library use were initially treated
  as follow-up gates; the backup and initial-use boundary is superseded below.
- 2026-08-10 — Backup posture revised by operator direction: enable the existing
  Velero/OpenEBS-to-R2 path for every persistent Stash volume immediately.
  Unencrypted local and backup storage is an accepted temporary risk and no
  longer blocks initial library use.
- 2026-08-10 — Rollout order revised by operator direction: deploy the exact
  committed and synthesized Stash workload directly first, then immediately
  submit the PR that publishes the chart and transfers ownership to ArgoCD. The
  direct apply is a bounded bootstrap exception, not a durable second path.
- 2026-08-10 — Source implementation completed. The generated credential and
  cost-10 hash match, the safe vault snapshot is current, all 406 CDK8s tests
  pass (392 active and 14 intentional integration skips), and all 34 internal
  charts render.
- 2026-08-10 — The exact workload synthesized from source commit
  `782f49caf7f1732fdd1e0206559ad4414f12187c` was applied with manifest SHA-256
  `c8c22e3cf0b1c24eb455494a38cdcd63ad5cc9fb88b08021b8988904fc497918`.
  Runtime acceptance found that the image required an explicit `stash` command;
  that correction was committed, re-synthesized, and re-applied before the pod
  reached Ready with the auth init container complete and zero restarts.
- 2026-08-10 — The live cluster's backup admission policy and `medium`
  Tailscale ProxyClass lagged the already-committed global desired state. The
  bootstrap applied only those two exact resources extracted from the committed
  `apps.k8s.yaml`, without a broad apps apply or forced conflicts, before
  retrying the exact Stash workload manifest. The backup policy reached observed
  generation 16 before all three PVCs were admitted.
- 2026-08-10 — On-demand backup `stash-bootstrap-20260811-0225` completed at
  `2026-08-11T02:25:59Z` with 9 of 9 Kubernetes items, three of three ZFS
  snapshots, zero errors, and one known plugin interruption warning. R2 contains
  a non-empty metadata object and data stream for each volume: state (1,437 and
  888,400 bytes), generated (1,437 and 58,184 bytes), and media (1,438 and
  45,776 bytes). This proves transfer of the new empty-volume recovery points,
  not application restoreability.
- 2026-08-10 — Tailnet acceptance completed at the exact MagicDNS hostname.
  Tailscale's first certificate attempts validated before its DNS update had
  propagated, so a temporary exact-version proxy extended only that issuance
  window. After staging proved the timing diagnosis, production issuance
  succeeded with the propagated record. The temporary proxy classes, loader
  pod, and node-local image tags were removed; the durable `medium` ProxyClass
  now runs the standard pinned Tailscale image and serves the trusted certificate.
  A normal MagicDNS request returns 200 from `/healthz`, while an unauthenticated
  request to `/` returns 302 to `/login`.
- 2026-08-10 — Draft PR #2109 was published with the complete neutral-language
  diff narrative. Buildkite #8963 passed the PR Playwright and Semgrep lanes,
  but exhaustive verify hit the same `tasknotes-core` transitive-dependency
  advisory already failing current-main build #8941. The dependent review and
  deployment-dry-run jobs were canceled, so the PR remains draft pending the
  independent main-branch repair and a fresh green build.
