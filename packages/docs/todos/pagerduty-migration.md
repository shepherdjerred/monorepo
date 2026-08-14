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
- [ ] Deploy the activation and cutover branches, then verify the SQLite PVC
      creation, snapshot bootstrap, UI, REST, previews, reconciliation
      freshness, probes, consumers, and live routing.
- [x] Decide whether to export the live PostgreSQL ledger into SQLite or
      explicitly discard that history; do not remove the PostgreSQL PVC or
      operator resources before this decision is executed.
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

### 2026-08-13 — PostgreSQL history discarded and the stack torn down

The owner chose discard: keep SQLite, remove the PostgreSQL stack. Executed
against the live cluster in that order — a final `pg_dump` of `alert_dashboard`
was taken as a safety net (900 KB gzipped, six tables, kept off-cluster at
`~/Downloads/alert_dashboard_pg_final_2026-08-14.sql.gz`), then the Zalando
`postgresql/alert-dashboard-postgresql` was deleted. The operator garbage
collected the pod, both services, the three generated credential secrets, and
the 16 GiB `pgdata-alert-dashboard-postgresql-0` PVC. The two `Certificate`s,
two `Issuer`s, `NetworkPolicy/alert-dashboard-postgres-netpol`, and the two
orphaned cert-manager TLS secrets were removed explicitly.

Note the 2026-08-11 entry below is no longer accurate about content: the
database did hold six tables by the time it was dropped, including
`_prisma_migrations` and the ledger tables, so migrations had run since that
audit. The dump is the record of what was discarded.

The teardown also cleared the `argocd.argoproj.io/compare-options:
IgnoreExtraneous` annotations that had been applied to those six resources to
unblock main CI, since the resources they were attached to no longer exist.

### 2026-08-11 — live PostgreSQL ledger audited and found empty

Read-only inspection of the live cluster while reviewing the SQLite replacement
branch. `alert-dashboard-postgresql` is Running with its 16 GiB PVC bound, but
the `alert_dashboard` database contains **zero tables** (`\dt` reports "Did not
find any tables"), so Prisma migrations never ran and no ledger history exists.
The cause is visible in the same namespace: the `alert-dashboard` Deployment has
never started, sitting in `Init:CrashLoopBackOff` on the Prisma engine
permission failure.

This does not by itself check the export-or-discard decision below, but it
establishes that there is no history to export. Note also that the SQLite branch
removes only the PostgreSQL _declarations_: the `alert-dashboard` Argo CD
Application enables automated sync without prune, the release prune allowlist in
`helm-push.ts` covers only `service-probes` and `turbo-cache`, and the
`Postgresql` resource carries `argocd.argoproj.io/sync-options: Delete=false`.
Merging therefore cannot delete the live cluster or its PVC; those resources
would persist as orphaned, no longer GitOps-declared, and need a separate
deliberate teardown once the decision is recorded.

### 2026-08-09 — activation and cutover source staged

The activation branch registers the deployable service while preserving the
PagerDuty receiver. The cutover branch migrates Alertmanager, Temporal, TRMNL,
and toolkit to Alerts and Postal. Live deployment, synthetic fire/resolve,
email, and no-new-PagerDuty verification remain outstanding.

### 2026-08-08 — deployment credentials provisioned

Created the application 1Password item with email disabled and a dedicated
Grafana Viewer service-account token. The shared Postal sender credential was
copied from the existing Temporal mail integration; no email was sent.
The live PostgreSQL resource now has a bound 16 GiB PVC and generated
credentials, so its ledger must be treated as potentially valuable until an
explicit export/import or discard decision is completed. The SQLite
replacement owns a backup-enabled `alert-dashboard-data` PVC instead. The
committed vault snapshot contains hashes and blank-state metadata only.

### 2026-08-08 — retention eligibility check scheduled

The scheduled follow-up is report-only and checks whether a production cutover
timestamp exists and 30 full days have elapsed. It has no PagerDuty credential
and cannot substitute for the operator API check.

<!-- temporal-agent-task
{
  "contractVersion": 2,
  "title": "Check PagerDuty retention-audit eligibility",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-09-07T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "checks": [
    { "id": "cutover-timestamp", "label": "Production cutover timestamp", "required": true, "evidenceRequirement": "A dated Comment Log heading explicitly records the production cutover.", "evidenceCollectors": [{ "id": "cutover-marker", "kind": "command", "argv": ["rg", "--json", "^### 2026-[0-9]{2}-[0-9]{2}.*production cutover", "packages/docs/todos/pagerduty-migration.md"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] },
    { "id": "retention-window", "label": "Thirty-day retention window", "required": true, "evidenceRequirement": "The recorded cutover marker is present and the current UTC timestamp is available for the report calculation.", "evidenceCollectors": [{ "id": "cutover-marker", "kind": "command", "argv": ["rg", "--json", "^### 2026-[0-9]{2}-[0-9]{2}.*production cutover", "packages/docs/todos/pagerduty-migration.md"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "current-time", "kind": "command", "argv": ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] },
    { "id": "credential-consumers", "label": "Remaining PagerDuty consumers", "required": true, "evidenceRequirement": "No active source reference remains and live workload inventory is available.", "evidenceCollectors": [{ "id": "active-source-scan", "kind": "command", "argv": ["rg", "--json", "-i", "pagerduty", "packages/homelab", "packages/temporal", "packages/trmnl-dashboard", ".buildkite"], "output": "allow-empty", "successExitCodes": [0, 1], "expectation": { "kind": "exit-code", "passedExitCodes": [1] } }, { "id": "live-workloads", "kind": "command", "argv": ["kubectl", "get", "deployments,statefulsets,daemonsets,cronjobs", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] }
  ],
  "source": {
    "docPath": "packages/docs/todos/pagerduty-migration.md"
  },
  "prompt": "Read this TODO and inspect current source plus read-only live state. Report whether a production cutover timestamp is recorded, whether 30 full days have elapsed, and whether any active workload or CI path still requires PagerDuty credentials. This task intentionally has no PagerDuty credential: do not claim that PagerDuty received no incidents. Direct the operator to complete the explicitly credentialed API check under Operator Verification before decommission approval. Do not edit files, cancel the account, or run tofu destroy."
}
-->
