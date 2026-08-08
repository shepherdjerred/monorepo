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
parallel `toolkit alerts` command are implemented. PagerDuty remains the active
Alertmanager receiver and the Temporal/TRMNL consumers remain unchanged until a
deployable Alerts image exists.

The first merge intentionally does not register the Alert Dashboard Argo CD
Application, switch Alertmanager receivers, enable the service-health rules, or
replace the active Temporal/TRMNL clients. The existing `toolkit pd` command is
retained beside `toolkit alerts`. The image version is an all-zero placeholder
until the main image lane publishes a real digest. Activating those resources
before that pin would guarantee an `ImagePullBackOff` while removing working
PagerDuty paths.

After production cutover, retain the PagerDuty account and
`packages/homelab/src/tofu/pagerduty` state read-only for 30 days. Account
cancellation and OpenTofu destruction remain separate, explicitly authorized
operations.

## Remaining

- [ ] Let the main image lane publish
      `ghcr.io/shepherdjerred/alert-dashboard`, mark the GHCR package public,
      and merge the generated real digest pin.
- [ ] Register the Alert Dashboard Argo CD Application and service-health rules
      with normal email disabled; verify database migration, snapshot bootstrap,
      UI, REST/tRPC, previews, reconciliation freshness, and probes.
- [ ] Only after the service is ready, replace the PagerDuty receiver with the
      authenticated Alerts webhook and independent Postal fallback route.
- [ ] Verify a synthetic fire/resolve lifecycle without normal email, including
      webhook retry idempotency and reconciliation repair.
- [ ] Enable Postal opening email and verify one distinct synthetic firing alert
      produces exactly one grouped message.
- [ ] Migrate and deploy the Temporal audit and TRMNL consumers, remove the
      retained `toolkit pd` command, and remove runtime PagerDuty credentials
      only after those consumers and alert routing are healthy.
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

### 2026-08-08 — implementation staged behind a deployable image

The replacement service and parallel toolkit client are complete, but activation
and active workload migration are deliberately split from the foundation merge.
Alertmanager, Temporal, TRMNL, and `toolkit pd` continue using PagerDuty until a
real, public GHCR digest is pinned and the Alerts service passes its
email-disabled bootstrap checks. This preserves every working path while the
first image is produced.

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
