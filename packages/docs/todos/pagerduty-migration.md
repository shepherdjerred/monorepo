---
id: pagerduty-migration
type: todo
status: in-progress
board: true
verification: operator
disposition: blocked
source_marker: false
---

# Complete the Alerts cutover and retire PagerDuty

## Context

The Alerts service, durable ledger, UI, APIs, image build, deployment chart, and
`toolkit alerts` command are implemented. The activation and cutover source
changes are staged on separate branches. PagerDuty remains the active live
Alertmanager receiver until Buildkite publishes the changes and ArgoCD syncs
them.

The activation branch registers the Argo CD Application, service-health rules,
probe, and network paths while leaving the existing receiver intact. The
cutover branch switches Alertmanager to the authenticated Alerts webhook with a
Postal fallback, migrates Temporal and TRMNL, and removes the active `toolkit
pd` command and PagerDuty runtime references. The image version is pinned to a
real digest; production acceptance remains a separate deployment gate.

After production cutover, retain the PagerDuty account and
`packages/homelab/src/tofu/pagerduty` state read-only for 30 days. Account
cancellation and OpenTofu destruction remain separate, explicitly authorized
operations.

## Remaining

- [ ] Let the main image lane publish
      `ghcr.io/shepherdjerred/alert-dashboard`, mark the GHCR package public,
      and merge the generated real digest pin.
- [x] Register the Alert Dashboard Argo CD Application and service-health rules
      with normal email disabled in the activation branch.
- [x] Replace the PagerDuty receiver with the authenticated Alerts webhook and
      independent Postal fallback route in the cutover branch.
- [ ] Verify a synthetic fire/resolve lifecycle without normal email, including
      webhook retry idempotency and reconciliation repair.
- [ ] Enable Postal opening email and verify one distinct synthetic firing alert
      produces exactly one grouped message.
- [x] Migrate the Temporal audit and TRMNL consumers, remove the `toolkit pd`
      command, and remove runtime PagerDuty credentials from active source.
- [ ] Deploy the activation and cutover branches, then verify database
      migration, snapshot bootstrap, UI, REST, previews, reconciliation
      freshness, probes, consumers, and live routing.
- [ ] Record the production cutover timestamp in the Comment Log, then wait 30
      full days before performing the operator verification below.
- [ ] Complete the production acceptance checks in
      `packages/docs/plans/2026-08-08_alert-dashboard-pagerduty-replacement.md`.
- [ ] With separate explicit operator approval, cancel the PagerDuty account and
      destroy or remove the retained OpenTofu stack.
- [ ] Archive this TODO and the completed implementation plan.

## Operator Verification

The report-only Temporal task deliberately has no PagerDuty credential. It may
verify source, CI, and live workload state, but it cannot prove that PagerDuty
received no incidents.

After 30 full days from the recorded production cutover, use an operator shell
to inject the retained PagerDuty REST token from 1Password for one read-only API
session. Query and paginate incidents created from the cutover timestamp through
the audit timestamp, record the count and any incident IDs in the Comment Log,
then clear the shell environment. Do not restore the token to Kubernetes,
Temporal, Buildkite, toolkit configuration, or tracked files. Separately verify
the live cluster, CI secrets, and active source contain no PagerDuty credential
consumer before requesting authorization to cancel the account or destroy the
OpenTofu state.

## Comment Log

### 2026-08-09 — activation and cutover source staged

The activation branch registers the deployable service while preserving the
PagerDuty receiver. The cutover branch migrates Alertmanager, Temporal, TRMNL,
and toolkit to Alerts and Postal. Live deployment, synthetic fire/resolve,
email, and no-new-PagerDuty verification remain outstanding.

### 2026-08-08 — deployment credentials provisioned

Created the application 1Password item with email disabled and a dedicated
Grafana Viewer service-account token. The shared Postal sender credential was
copied from the existing Temporal mail integration; no email was sent.
PostgreSQL credentials are generated and owned by the Zalando operator. The
committed vault snapshot contains hashes and blank-state metadata only.

### 2026-08-08 — retention eligibility check scheduled

The scheduled follow-up is report-only and checks whether a production cutover
timestamp exists and 30 full days have elapsed. It has no PagerDuty credential
and cannot substitute for the operator API check.

<!-- temporal-agent-task
{
  "title": "Check PagerDuty retention-audit eligibility",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-09-07T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/todos/pagerduty-migration.md"
  },
  "prompt": "Read this TODO and inspect current source plus read-only live state. Report whether a production cutover timestamp is recorded, whether 30 full days have elapsed, and whether any active workload or CI path still requires PagerDuty credentials. This task intentionally has no PagerDuty credential: do not claim that PagerDuty received no incidents. Direct the operator to complete the explicitly credentialed API check under Operator Verification before decommission approval. Do not edit files, cancel the account, or run tofu destroy."
}
-->
