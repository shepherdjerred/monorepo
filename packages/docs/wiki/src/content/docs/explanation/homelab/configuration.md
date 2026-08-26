---
title: Configuration layers
description: Why the repo has five places a value can live, which one to pick, and what the feature flag server does and does not protect.
---

Changing a value used to mean a deploy. Flipping a boolean in cdk8s costs the
`verify` graph, two required review gates, a merge, a main pipeline run, and an
ArgoCD sync — 45 to 90 minutes for a change you already know is correct.

That is the right cost for most changes. GitOps deliberately routes state
through review. But a feature flag is an explicit declaration that one piece of
state does **not** need review, and that cannot live in the machine whose whole
purpose is enforcing review.

So there is now a self-hosted [Flipt](https://www.flipt.io/) instance, and a
layered resolver in front of it.

## The policy

> For any app we wrote or control, environment variables are for **credentials
> and bootstrap**. Everything else is a **feature flag**.

Bootstrap is the part that cannot be a flag because it is needed to construct
the thing that reads flags: `FLIPT_URL` obviously, but also `ENVIRONMENT` (it is
the attribute Flipt targets _on_), `PORT` (it binds a listener), `DATABASE_URL`,
and `TEMPORAL_WORKER_ROLE` (bound one-to-one to a ServiceAccount, so a running
process cannot rebind).

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
self-hosting one of the Discord bots has neither Flipt nor Kubernetes env
injection, so a config file is their entire interface. In our own deployments
that layer is normally absent.

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

**Flipt runs with authentication disabled.** Reachability is the entire
authorization model: a tailnet device or an allowed namespace can read and write
every flag.

That is a deliberate trade for a single-operator homelab, and it has two
consequences worth stating rather than leaving implicit in a policy file:

- The **NetworkPolicy is the access control**. Ingress is limited to Tailscale
  (the UI), Prometheus (scrape and probe), and an explicit list of consumer
  namespaces. A namespace is added to that list in the same change that starts
  reading flags from it. Egress is DNS-only — storage is a local git repo on a
  PVC, there is no remote sync, and both the update check and telemetry are off,
  so Flipt has no legitimate reason to reach the internet.
- **Capability grants stay in Git.** birmel's `TRUSTED_USER_IDS` is the sole gate
  for shell execution, repository writes, and every agent tool. As a flag, any
  tailnet device could grant itself that. The test is blast radius, not
  fail-open-versus-fail-closed. Ordinary allowlists — which guilds may use a
  feature — are a _primary_ use case; ones that grant capability are not.
  Similarly, streambot's `VOICE_CAPTURE_ENABLED` decides whether human audio is
  persisted to S3, and stays in env for the same reason.

If Flipt ever gains authentication, both of those are worth revisiting.

The same boundary keeps several controls outside Flipt: capability grants,
boot-wired startup choices, observability enablement, and CI or automation
deciders. They need lifecycle or authorization changes before they can be
runtime flags. The repository-owned
`packages/feature-flags/src/managed-flag-inventory.json`
records those exemptions alongside the 53 managed keys. Operators can use the
[Flipt inventory check](/how-to/check-flipt-flag-inventory/) to compare it with
the live evaluation snapshot.

## Durability

Flipt v2 defaults to **in-memory storage**. It accepts flag writes, serves them
back, and silently loses every one on restart. The deployment therefore
configures an explicit local git backend on a ZFS PVC, which is backed up by
Velero. A regression test asserts that configuration is present, because losing
it produces a service that looks like it works.

## Analytics has a different ownership boundary

PostHog records behaviour. It is not the switch that decides whether behaviour
exists. Product rollout therefore remains in Flipt, while PostHog's supported
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
unproxied [`j.sjer.red` CNAME](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/cloudflare/sjer-red.tf)
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

## Licensing

Flipt v2 is under the [Fair Core License](https://fcl.dev/): source-available
rather than open source, converting to MIT two years after each release. Its
SDKs remain MIT, so nothing in our application code is affected. The free tier
covers the UI, local git storage, and evaluation; remote SCM sync and secrets
managers are paid features we do not use.
