---
title: Configuration layers
description: Why the repo has five places a value can live, which one to pick, and what the feature flag server does and does not protect.
---

Changing a value used to mean a deploy. Flipping a boolean in cdk8s costs the
`verify` graph, two required review gates, a merge, a main pipeline run, and an
ArgoCD sync. That is 45 to 90 minutes for a change you already know is right.

That cost is deliberate for most infrastructure changes because GitOps routes
state through review. A feature flag is an explicit declaration that one piece
of state does **not** need review, so it cannot live inside the machine whose
purpose is enforcing review.

First-party runtime behavior therefore lives in the repository's own
[`@shepherdjerred/flags`](https://github.com/shepherdjerred/monorepo/blob/main/packages/flags/src/app.ts)
service, with a layered resolver in front of it.

## The policy

> For any app we wrote or control, environment variables are for **credentials
> and bootstrap**. Everything else is a **feature flag**.

Bootstrap is the configuration needed to construct the client that reads flags.
Hosted workloads set `FEATURE_FLAGS_MODE=flags`, `FLAGS_URL`, and
`FLAGS_DEPLOYMENT` as validated by
[`schema.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/config/schema.ts).
Every client sets all three explicitly without defaults, so a missing bootstrap
variable fails at startup rather than quietly serving call-site defaults.

The unit of runtime state is a **deployment** (`<catalog>/<stage>`), declared in
[`deployments.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/deployments.ts)
— such as `scout/prod`, `scout/beta`, `streambot/prod`, or `minecraft/tsmc`.
Flag definitions live once in
[`managed-flag-inventory.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/managed-flag-inventory.json),
while values exist only on deployments a workload actually reads. Prod-only
services keep one document rather than carrying unused `beta` copies, and
co-deployed readers that share one contract — such as Storm forum and Storm
brain — share `storm/prod`.

The application `ENVIRONMENT` remains separate. It describes the application
stage and may be passed as a targeting attribute. It does not choose which
document Flags serves. Other bootstrap values include `PORT`, `DATABASE_URL`,
and `TEMPORAL_WORKER_ROLE`.

Shared service connections also belong to reviewed infrastructure wiring.
Endpoints and storage locations describe how workloads connect, while flags
describe their behavior. The
[Temporal worker wiring](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/temporal/workers/operations-workers.ts)
keeps these connection settings in Git and supplies credentials separately.

1Password keeps secrets and the context needed to use or recover them:
issuer and account identifiers, credential scopes, and recovery material.
Dashboard entity selections and mail routing are application behavior.
They belong to typed configuration, rather than credential fields.

A shared credential has one owning item. Consumers can bind that item in
several namespaces without maintaining several editable copies of its value.
The [vault binding helper](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/misc/onepassword-vault.ts)
supports stable item IDs so title changes do not change consumer identity.

Retired items stay recoverable in the archive. Ordinary field edits use
[1Password item history](https://support.1password.com/item-history/) for recovery;
they do not require another editable copy of every credential.
Targeted edits preserve unrelated fields, attachments, and passkeys.
JSON templates overwrite passkeys, so those items require targeted field edits
or the 1Password UI. [1Password documents that limitation](https://www.1password.dev/cli/item-edit/)
and the [archive recovery behavior](https://support.1password.com/archive-delete-items/).

## Which layer?

Six questions, first match wins.

| Question                                   | Layer                         |
| ------------------------------------------ | ----------------------------- |
| Is it a secret?                            | 1Password → Kubernetes Secret |
| Is it needed before flags exist?           | Bootstrap env                 |
| Does an end user own it?                   | Database row                  |
| Is it shared across packages or languages? | JSON catalog + schema         |
| Does it change only when code changes?     | A constant                    |
| Otherwise                                  | A flag                        |

Database rows are not really configuration — they are product data an end user
sets, like karma's per-guild recap channel or scout's `ServerPermission` grants.

The `file` layer exists for **apps distributed to other people**. Someone
self-hosting one of the Discord bots has neither the flag service nor Kubernetes
env injection, so a config file is their entire interface. In our own
deployments that layer is normally absent.

## What was here before

Eight places, and the choice between them was largely historical accident: four
of them occupied the same cell — developer-changed, PR-reviewed, deploy latency —
and differed only in file format.

One was actively harmful. The game bots' entire `config.toml` — stream settings,
notification toggles, goal-agent config, none of it secret — was a field in a
1Password item, synced to a Kubernetes Secret and mounted into the pod.
Behaviour configuration with no Git history, no review, and no diff. The
codebase was already routing around it: knobs had been moved _out_ of that TOML
into env vars specifically so they would stay reviewable.

## The rule that makes layering safe

Resolution falls through on **absence**, never on a resolved value.

A source returns "no opinion" and resolution continues. Anything else is an
**answer** and stops it — including `false` and `0`.

If a flag turned off fell through, an env var still set to `true` would silently
re-enable exactly what an operator just disabled, and nothing in a normal test
run would show it. Two corollaries follow: a source that _fails_ has not
answered, and a value that is present but invalid throws rather than deferring to
a lower layer — a source with an opinion it cannot express is a bug worth
surfacing, not one worth masking.

Every read returns the value **and the layer that produced it**, because "I set
the env var and nothing happened" is the classic failure of layered config, and
provenance is what answers it.

## Security boundary — read this part

Evaluation and management are separated by listener, NetworkPolicy, and
authentication in the
[Flags deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/flags/index.ts)
and
[request authenticator](https://github.com/shepherdjerred/monorepo/blob/main/packages/flags/src/auth.ts):

- **Evaluation is credentialless and port-isolated.** Port `7361` mounts only
  `/healthz`, `GET /v1/deployments/:catalog/:stage/snapshot`, and
  `POST /v1/evaluate`. It exposes no management routes or UI, ignores operator
  headers, and rejects any `Authorization` header with `401`. Consumer
  NetworkPolicies open only `7361`, and consumer pods hold no management
  credential.
- **Management requires verified operator or machine identity.** Port `7360`
  reaches only the Tailscale ingress proxy, Prometheus probes, and the Temporal
  repo worker. Human requests require an allowed `Tailscale-User-Login` verified
  through a read-only Kubernetes API double-fence on the Ingress UID, owning
  StatefulSet, and ready proxy Pod IP, with same-origin enforcement on browser
  writes. Automation uses the brokered `FLAGS_MACHINE_TOKEN` from the
  `flags-auth` 1Password item.
- **Capability grants stay in Git.** birmel's `TRUSTED_USER_IDS` gates shell
  execution, repository writes, and agent tools. Streambot's
  `VOICE_CAPTURE_ENABLED` decides whether human audio is persisted to S3. The
  test is blast radius, not fail-open versus fail-closed: guild feature
  allowlists belong in Flags, whereas grants that widen host or data capability
  stay in reviewed Git configuration.

## Durability

Flags stores deployment documents in SQLite (`/var/lib/flags/flags.sqlite`) on a
dedicated `ReadWriteOnce` ZFS NVMe PVC backed up by Velero, as implemented in
[`store.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/flags/src/store.ts).
Startup seeds only deployments not yet stored in SQLite and leaves existing
documents untouched across restarts.

Missing declared inventory keys are inserted automatically through
`create-missing` without overwriting live defaults or segment rollouts. Every
mutation (`apply` and `retire`) binds `expectedRevision` and writes nothing when
the stored revision has advanced, preventing stale browser tabs or concurrent
automation from clobbering an intervening edit.

## Analytics has a different ownership boundary

PostHog records behaviour. It is not the switch that decides whether behaviour
exists. Product rollout therefore remains in Flags, while PostHog's supported
control-plane objects live in OpenTofu. That makes dashboards, insights,
layouts, the project proxy, and their supported settings reviewable rather than
personal UI state.

This boundary is intentionally selective. A provider cannot represent every
PostHog setting, so options such as IP anonymisation and retention remain
UI-managed. Supported resources do not get that exception: a UI edit is drift
and the next OpenTofu reconciliation restores the reviewed configuration.
Dashboard layouts deserve special care because the provider treats each layout
as complete, not partial. A missing tile is therefore a deletion, not an
unmanaged detail. The [layout resource documentation](https://registry.terraform.io/providers/PostHog/posthog/latest/docs/resources/dashboard_layout)
explains that authority model.

The allowed browser origins come from the shared
[analytics registry](https://github.com/shepherdjerred/monorepo/blob/main/config/analytics-sites.json),
not from a hand-maintained PostHog list. This keeps the project URL policy and
session-replay policy aligned with the sites that actually emit analytics. The
unproxied [`j.sjer.red` CNAME](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab-cdktn/src/stacks/cloudflare/sjer-red.ts)
is part of the same boundary: Cloudflare routes the hostname, while PostHog owns
the ProxyHog target behind it.

Analytics state is unusually sensitive because it contains the complete shape
of the control plane. Its SeaweedFS state and plans use enforced,
[PBKDF2-derived AES-GCM encryption](https://opentofu.org/docs/v1.12/language/state/encryption/).
The dedicated passphrase is deliberately not recoverable from the backend. That
trade rejects convenient emergency access in favour of keeping state useful
only to the intended operator.

Finally, configuration success is not ingestion success. A clean plan and a
resolving CNAME show that the control plane agrees with Git. They do not show
that a browser event arrived or that replay persisted. Live Events across every
registered site are the acceptance boundary because they observe the product
path that the configuration exists to support.

## Where a flag does nothing

Before adding one, check where the value is read:

- **Per-call** — evaluated each time the behaviour runs. Fully live.
- **Session-scoped** — read once per session or job. Takes effect next session.
- **Boot-wired** — read once at startup to decide what to _construct_. A flag
  here does nothing until the pod restarts. Move the read to a call site, or
  don't bother.

Some values cannot be live wherever they are read. ffmpeg encoder arguments are
fixed for the process's lifetime, so flipping one drops the broadcast exactly as
a redeploy would.

For synchronous call sites — scout hands its explore allowlist to Discord command
registration as a plain function returning an array — the resolver offers a
snapshot that is seeded with current values and refreshed in the background. That
seeding matters: an empty allowlist in command registration does not disable a
feature, it _unregisters_ the command in every guild.

## Related

- [Operate feature flags and check the inventory](/how-to/check-flag-inventory/)
- [Homelab control-plane access](/reference/homelab-control-plane-access/)
