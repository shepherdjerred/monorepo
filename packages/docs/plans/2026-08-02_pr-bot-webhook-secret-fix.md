---
id: plan-2026-08-02-pr-bot-webhook-secret-fix
type: plan
status: in-progress
board: false
---

# pr-bot GitHub webhook secret corruption — recovery + long-term fix

## Context

`ci/merge-conflict` (a required GitHub status check on every PR) stopped
posting on 2026-07-31T16:25:18Z. Root cause, confirmed by recomputing the
HMAC-SHA256 signature on a live GitHub webhook delivery: the literal string
`"********"` — GitHub's own masked placeholder for a webhook secret — was
the real, live signing secret on the `pr-bot.sjer.red` webhook.

**Mechanism:** `packages/homelab/src/tofu/github/webhooks.tf`'s
`github_repository_webhook.pr_bot` was brought under Terraform via
`terraform import`. GitHub's API always echoes back `"********"` for
`configuration.secret` on Read, never the real value — so that literal
string is what state's `configuration.secret` held from the moment of
import. The resource had `lifecycle { ignore_changes = [configuration[0].secret] }`,
which only suppresses _diff display_ for that one field; it does not stop
Terraform from resending state's (placeholder) value in the _entire_
`configuration` PATCH payload whenever any other attribute on the resource
changes. PR #1863 changed `pr_bot`'s `events` list; the resulting
`tofu apply (github)` re-sent the whole `configuration` block including the
literal `"********"`, and GitHub accepted it as the new real secret —
silently breaking the webhook's HMAC verification. 100% of deliveries
failed signature verification from that moment until the fix below.

`buildkite`'s webhook (drives all CI) had the identical latent bug and had
simply never been triggered (its `events`/`url` hadn't been edited since
import) — the next unrelated edit to it would have silently broken all of
CI the same way.

Upstream confirmation: `integrations/terraform-provider-github` issues #81
and #171 document this exact masked-echo behavior; PR #251 (merged 2019,
v2.2.1+) fixed it for secrets Terraform itself generates and sets — it does
nothing for a value captured from an import, which is exactly this case.

## Approach considered and rejected: tofu-owned secret

The initial plan had tofu generate and own a real `pr_bot` secret
(`random_password` + a dedicated `onepassword_item`, mirroring
`packages/homelab/src/tofu/argocd/token.tf`'s pattern), reasoning that this
would let tofu manage the secret's lifecycle without ever needing a manual
rotation again.

This was over-engineered for the actual bug and was abandoned mid-implementation
after review: it required adding the `onepassword` Terraform provider to
this stack for the first time, which needed 1Password Connect credentials
that didn't exist for this stack, which cascaded into minting new standing
Connect tokens and editing the shared `Buildkite CI Secrets` 1Password item
that every CI job reads from — a materially larger blast radius (new
standing credential, write access to a shared production vault, a new CI
dependency) than the bug requires. Both minted tokens were revoked before
being used for anything beyond validation.

## Actual fix (implemented)

Neither webhook's secret is knowable by tofu — both are owned by the
receiving end (1Password for `pr_bot`, Buildkite for `buildkite`) — so tofu
has no business ever writing to that field again, period. Both resources in
`webhooks.tf` now have `lifecycle { ignore_changes = all }` (not just on
`.secret`), which stops tofu from resending _any_ attribute on a future
apply, closing the actual defect. Verified live: `tofu plan`/`apply` for
this change reported "No changes" against real infrastructure — adding the
lifecycle meta-argument makes no GitHub API call, so this is a pure
prevention fix with zero risk to the live resources.

Recovery (separate from the structural fix, done manually, outside tofu):

1. Generated a new real secret, set it on the live `pr_bot` GitHub webhook
   via `gh api PATCH repos/shepherdjerred/monorepo/hooks/616025071`
   (preserving `url`/`content_type`/`insecure_ssl`).
2. Updated the existing `GITHUB_WEBHOOK_SECRET` field on the
   `temporal-worker-secrets` 1Password item (`mjgnqqh37jxyzseqrddde2jgaq`) to
   match — no new item, no new provider, no change to
   `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`'s existing
   secret wiring.
3. The 1Password Kubernetes operator (`AUTO_RESTART=true`,
   `POLLING_INTERVAL=60`) detected the field change and rolled the
   `temporal-worker` deployment automatically within seconds — no manual
   pod restart needed.
4. Verified end-to-end: redelivered a real GitHub webhook payload
   (`gh api POST .../deliveries/<id>/attempts`) and confirmed it changed
   from `401 Invalid HTTP Response` to `200 OK`, with the worker actually
   processing the payload (started a real `cancel-bk-builds` workflow from
   it).

## Backfill

Every currently-open PR still needs one `ci/merge-conflict` post to catch
up (the workflow only fires on new `push`/`pull_request` events going
forward). The manual `kind: "all-prs"` backfill workflow start could not be
run from this session's sandbox — `kubectl port-forward` to the Temporal
frontend hit a namespace-loopback quirk (listener starts, but the actual
pod-network dial inside the pod's netns is refused) on both a
service-targeted and pod-targeted forward, and a throwaway
`temporalio/admin-tools` pod timed out scheduling/pulling. Not pursued
further (two independent dead ends is enough to stop, per this repo's
step-back-on-complexity-spirals principle) since it isn't load-bearing:
**user decision — leave it to organic recovery.** Any push/synchronize on
an already-open PR now re-triggers the per-PR check (webhook works again),
and the next push to `main` sweeps every open PR via the `kind: "all-prs"`
trigger. No PR is permanently stuck; the only cost is some PRs wait for
their next natural push instead of getting an immediate backfill.

## Remaining (optional defense-in-depth, not required for the fix)

`PrWebhookSignatureFailures` (existing Prometheus alert,
`increase(pr_webhook_signature_failures_total[30m]) > 5`, routed to
PagerDuty) already exists and fired correctly during this incident. There
is no equivalent staleness alert for "`ci/merge-conflict` hasn't posted in
N hours," which would also catch a quieter failure mode (deliveries that
never arrive at all, or a workflow-start failure) that a pure
signature-failure counter can't. Candidate addition, not yet decided/built:

- `pr_merge_conflict_check_last_success_timestamp_seconds` +
  `pr_merge_conflict_check_active` gauges in
  `packages/temporal/src/observability/metrics.ts`, set from
  `packages/temporal/src/activities/check-pr-merge-conflicts.ts` and
  restored at startup in `packages/temporal/src/worker.ts` (mirroring the
  existing `glitterCorpusLastSnapshotTimestampSeconds` /
  `glitterCorpusSnapshotMetricsConfigured` idiom in
  `packages/temporal/src/observability/metrics-glitter.ts` and
  `packages/temporal/src/activities/glitter-corpus-snapshot.ts`).
- A `PrMergeConflictCheckStale` alert in
  `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`'s
  existing `github-webhook` group.

## Critical files

- `packages/homelab/src/tofu/github/webhooks.tf` — the fix (both webhooks
  frozen with `ignore_changes = all`)
- `packages/temporal/src/observability/metrics.ts`,
  `packages/temporal/src/activities/check-pr-merge-conflicts.ts`,
  `packages/temporal/src/worker.ts`,
  `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`
  — candidate follow-up alert, if built
