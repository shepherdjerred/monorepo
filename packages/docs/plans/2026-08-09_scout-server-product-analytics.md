---
id: plan-2026-08-09-scout-server-product-analytics
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout server-side product analytics

## Goal

Measure Scout's guild lifecycle in the existing PostHog US project:

`guild installed → first subscription → first core output → recurring outputs → removal`

The lifecycle uses an opaque identity per installation. It does not correlate
browser sessions, capture slash-command usage, or cover Scout desktop or evals.
Existing browser analytics and Prometheus operational metrics remain separate.

## Event contract

The backend uses `posthog-node@^5.39.4`. Delivery is best effort through the SDK
queue, and graceful shutdown flushes queued events. Capture and delivery errors
are logged and counted without failing product behavior.

Beta and production receive `POSTHOG_PROJECT_TOKEN`, `POSTHOG_API_HOST`,
`POSTHOG_SITE_KEY`, and `POSTHOG_SITE_HOSTNAME` from
`config/analytics-sites.json`. Missing or partial deployed configuration fails
startup. Development and tests remain disabled.

`GuildInstall` stores:

- `analyticsInstallationId`: unique UUID, preserved across reconnects and
  rotated after a confirmed removal and reinstall.
- `analyticsLifecycleTracked`: true for new and reinstalled guilds. Migration
  backfills existing guilds as false.
- `firstCoreOutputAt`: atomically claimed by the first successful core output.

PostHog distinct IDs use the stage site key plus the opaque installation UUID.
Every event disables person-profile processing and GeoIP. Scout never calls
`identify`, `alias`, or group APIs.

| Event                         | Authoritative source                                   | Properties                            |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------- |
| `guild_installed`             | Successful first-install or genuine-reinstall upsert   | `install_kind`, `member_count_bucket` |
| `first_subscription_created`  | First committed web or Discord subscription            | `surface`                             |
| `core_output_delivered`       | Successful logical Discord product output              | `output_kind`                         |
| `first_core_output_delivered` | Atomic first-output claim for tracked lifecycle cohort | `output_kind`                         |
| `guild_removed`               | First `removedAt: null → timestamp` transition         | `activation_state`, `tenure_bucket`   |

Member buckets are `1-10`, `11-50`, `51-250`, `251-1000`, and `1001+`.
Tenure buckets are `<1d`, `1-6d`, `7-29d`, `30-89d`, and `90d+`. Removal states
are `installed_only`, `configured`, and `activated`.

Only bounded properties are allowed. Events must never contain Discord guild,
user, or channel IDs; guild names; Riot IDs; command options; content; URLs; or
error messages.

## Delivery semantics

The closed output registry is:

- `prematch`, `postmatch`
- `report_scheduled`, `report_manual`
- `competition_started`, `competition_ended`, `competition_leaderboard`
- `pairing_weekly`

Match delivery aggregates channels by guild and emits once when at least one
channel succeeds. Report and pairing events emit only after every message chunk
succeeds. Failed sends, previews, setup and welcome messages, ephemeral command
replies, DMs, recovery notices, debug output, and cancellation notices do not
count.

Removal capture is idempotent across Discord deletion and reconciliation.
Activation is classified before subscriptions, reports, and competitions are
deleted. Existing installations get opaque IDs for future recurring outputs and
removal, but receive no synthetic historical milestones.

## PostHog dashboard

Create a saved Scout lifecycle dashboard with:

- a 30-day install → first subscription → first output funnel;
- weekly install-to-core-output retention;
- core-output trends by kind and stage;
- removal breakdown by activation state and tenure.

## Verification

Repository verification covers configuration validation, disabled local
behavior, anonymous common properties, flush/error handling, migration and
identity behavior, first-subscription callers, output delivery semantics,
concurrent first-output claims, removal classification/idempotency, synthesized
manifests, and the analytics registry check.

Roll out through GitOps to beta first. With controlled guilds, inspect PostHog
Live Events for first install, both subscription surfaces, each core-output
family, removal, and reinstall. Inspect raw payloads for prohibited identifiers
and verify that no person profile is created. Build the saved dashboard, then
promote through the normal production release. Production acceptance requires
fresh events from a controlled production guild; repository and CI evidence are
not production proof.

## Remaining

- [ ] Deploy the beta image and manifests through the normal GitOps release.
- [ ] Complete controlled beta lifecycle and privacy verification in PostHog.
- [ ] Create and validate the saved Scout lifecycle dashboard.
- [ ] Promote the verified release and collect fresh controlled production
      events.

## Comment Log

- 2026-08-09: Scope approved. Browser correlation, slash-command analytics,
  Scout desktop, and Scout evals are excluded. Delivery is best effort without
  a durable outbox.
